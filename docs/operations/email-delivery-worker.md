# Email Delivery Worker Runbook

The worker is a bounded CLI sweep. It is not a request-time sender and Stage
3.13C does not install or activate it in production.

## Commands

```shell
npm run email:delivery:sweep
npm run email:delivery:sweep -- --limit 10
npm run email:delivery:canary -- --message-id <EmailMessage-ID>
npm run email:backlog:quarantine -- --batch-size 100
npm run email:backlog:quarantine -- --apply --batch-size 100
npm run email:events:consume
npm run email:events:consume -- --once
npm run email:events:reconcile
npm run email:retention:dry-run
npm run email:retention:cleanup
```

## Disabled Mode

Default configuration:

```text
EMAIL_DELIVERY_ENABLED=false
EMAIL_PROVIDER=disabled
```

When disabled, the delivery sweep exits with a clear no-op result. It does not mark queued messages failed and does not busy-loop.

## Claim Model

The worker:

1. Recovers stale `PROCESSING` messages whose claim lease expired.
2. Selects bounded eligible candidates.
3. Claims each row with conditional `updateMany`.
4. Moves the row to `PROCESSING` and stores a random claim token plus lease.
5. Rechecks suppression from the current database state before provider send.
6. Allocates the next attempt number only while `id + PROCESSING + claimToken` is still owned.
7. Calls the provider adapter.
8. Records accepted, failure, suppression, or ambiguous outcome only through claim-token CAS.

Two workers racing for the same row should result in one successful claim and one skipped candidate.
If a stale worker loses ownership, it emits a sanitized `claim_lost` event and does not schedule another retry.

Hard-bounce, complaint, manual, and applicable temporary suppressions also
block SECURITY mail. Product/marketing unsubscribe does not block SECURITY
mail. This policy is identical at enqueue and worker recheck.

## Retry Defaults

- Maximum attempts: 5.
- Initial delay: 60 seconds.
- Exponential backoff with bounded jitter.
- Maximum delay: 12 hours.
- Stale processing lease: 600 seconds by default.
- Provider request timeout: 30 seconds by default.
- Provider timeout safety margin: 30 seconds by default.

Provider request timeout must stay shorter than the processing lease minus the safety margin. Invalid timeout/lease configuration fails validation before delivery can activate.

Password-reset dispatch also has a separate bounded advisory-fence acquisition
deadline: `CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS` defaults to 5000 ms and accepts
only 50..30000. Acquisition uses `pg_try_advisory_lock` plus bounded backoff.
Timeout or abort releases the claim to `FAILED_RETRYABLE` with sanitized state;
invalid configuration fails closed. The dedicated connection is always closed.

Provider authentication/configuration errors become final failures and operational alerts. Throttle, pre-dispatch network, and pre-dispatch server failures may retry within bounds. Once a request has been dispatched and acceptance cannot be ruled out, the message becomes `ACCEPTANCE_UNKNOWN`, the claim is released, and the normal worker will not retry it automatically.

## Acceptance Unknown

`ACCEPTANCE_UNKNOWN` requires operator review or a later provider event. It is
not eligible for normal sweep retry. For password-reset messages, ciphertext,
nonce, and late-rendered bodies are cleared atomically when this state is
recorded, and repeated retention cleanup remains idempotent. Stage 3.13B-H
intentionally does not add a retry button or manual resend endpoint. Future
manual handling is deferred to Stage 3.13E.

## Canary and quarantine

The canary command requires exactly one explicit strict message id, requires
delivery to already be enabled, verifies current eligibility, and scopes stale
lease recovery plus claim/send to that id. It never falls back to the normal
sweep and exits nonzero on refusal or any non-acceptance outcome.

The password-reset backlog command is dry-run by default. `--apply` is required
for mutation, and `--batch-size` must be 1..500. It classifies expired,
consumed, superseded, generation-mismatched, status-ineligible, revoked,
missing/association-invalid, and legacy-plaintext rows. Apply cancels and
clears sensitive fields; it never constructs a provider. Partial failure is a
nonzero exit.

## Provider Event Reconciliation

Unmatched provider events stay `UNMATCHED` until the reconciliation sweep finds a provider-qualified message id match or the bounded reconciliation window expires.

```shell
npm run email:events:reconcile
```

Expired unmatched events become `IGNORED` with a stable processing result. The sweep is bounded and idempotent.

## Provider Event Ingestion

`email:events:consume` reads Yandex Cloud Postbox events from Yandex Data
Streams using the Kinesis-compatible AWS SDK v3 client. It is disabled by
default and refuses to run unless `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED=true`
and the dedicated `YANDEX_DATA_STREAMS_*` settings are valid. It never calls the
Postbox sending API and never exposes a public webhook.

The consumer acquires a dedicated PostgreSQL session advisory lock before
processing. Loss of, or an error on, that connection stops the consumer
immediately, and a bounded liveness probe on the same connection runs at each
shard-refresh cycle, so processing can never continue after PostgreSQL has
released the lock.

Shards are scheduled fairly. A manager loop discovers and refreshes shards, and
each round gives every known open shard one bounded slice — at most
`EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS` polls — before any shard gets a
second slice, with at most `EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY` slices in
flight. A high-volume shard therefore cannot starve a quiet one. `ListShards`
pagination is followed to exhaustion and fails closed rather than returning a
partial shard list.

`GetRecords` is paced per shard at no more than one call per
`EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS` (floored at 200 ms for the
five-per-second-per-shard Data Streams limit), after empty and non-empty
responses alike. Transient failures back off exponentially with bounded jitter;
`EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES` consecutive failures stop the
shard through the retryable exit path.

Checkpoints advance in exactly two cases: the provider event was processed
successfully, or the record was deterministically classified as a poison record
and the failure-ledger row plus the checkpoint were committed in one
transaction. A processor, database, or unexpected error never advances the
checkpoint and never writes a poison record, so the record stays replayable.
Replay after a successful process but a failed checkpoint write is safe because
provider-event processing is idempotent.

Iterator position: `AFTER_SEQUENCE_NUMBER` once a sequence checkpoint exists;
`TRIM_HORIZON` until then when configured that way; and for `LATEST`, a durable
`initialReadAt` boundary is persisted on first acquisition so any reacquisition
or restart before the first checkpoint resumes with `AT_TIMESTAMP` instead of
silently skipping the initial window.

Poison records store provider, stream, shard, sequence, approximate arrival
timestamp, payload SHA-256, an allowlisted error code, a static bounded message
selected by that code, and status. They never store raw payload, recipient email,
subject, body, free-form exception text, credentials, or provider raw responses.
Replaying the same poison record is idempotent by
provider/stream/shard/sequence.

Shutdown and exit codes: `SIGTERM`/`SIGINT` aborts the consumer, which is then
awaited for at most `EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS` before a
sanitized `shutdown_timeout` event and a retryable exit. Exit `0` is a controlled
stop or disabled ingestion, `78` invalid configuration, `77` authentication or
authorization failure, and `75` a transient runtime failure. The systemd unit
lists `78` and `77` in `RestartPreventExitStatus` and bounds restarts with
`StartLimitIntervalSec`/`StartLimitBurst`, so a terminal fault cannot hot-loop.

The reconciliation sweep supplements ingestion for unmatched already-recorded
events. It does not consume Data Streams and does not replace the live consumer.

## Logging

Logs may include message id, provider, attempt number, status, redacted
recipient, error category, and bounded counts. Provider-event consumer logs emit
stable event codes with bounded fields only: length-limited shard id, sanitized
error class, attempt counts, checkpoint counts, and lag. Logs must not include
subject/body, full recipient email, raw provider event payloads, bounce
`diagnosticCodes`, free-form exception text, credentials, tokens, provider raw
responses, transcript content, or AI output.

Stable provider-event codes: `provider_event_consumer_started`,
`provider_event_shard_discovered`, `provider_event_shard_retired`,
`provider_event_checkpoint_advanced`, `provider_event_poison_record_classified`,
`provider_event_transient_retry`, `provider_event_retry_exhausted`,
`provider_event_processor_retry`, `provider_event_processor_retry_exhausted`,
`provider_event_iterator_reacquired`, `provider_event_lock_lost`,
`provider_event_terminal_failure`, `provider_event_consumer_stopped`. The CLI
adds `consumer_disabled`, `consumer_invalid_config`, `shutdown_requested`,
`shutdown_timeout`, `consumer_stopped`, `consumer_completed`, and
`consumer_failed`.

## Production Installation

Do not activate worker or provider-event units during local Stage 3.13C work.
Committed systemd templates use `/etc/negotaitions/env.production`;
worker/retention timers, manual canary/quarantine units, provider-event
consumer, and provider-event reconciliation timer remain disabled. The normal
worker must remain stopped during the isolated canary.

The local fake-provider procedure is documented in
`stage-3-13c-local-email-testing.md`. The preview must remain disabled in
production.
