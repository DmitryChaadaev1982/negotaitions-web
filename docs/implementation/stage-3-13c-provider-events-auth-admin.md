# Stage 3.13C Provider Events, Auth, And Admin Diagnostics

Starting SHA: `4a29ccfebfd03a3d465e557ea7bff4384945a19a`

Branch: `feat/stage-3-13c-provider-event-ingestion`

Worktree: `C:\Projects\Negotiations AI\negotiations-web-stage-3-13c-provider-events`

## Scope

This implementation adds three production-readiness workstreams without
production access or activation:

1. disabled-by-default Yandex Cloud Postbox provider-event ingestion through
   Yandex Data Streams;
2. login/logout Server Actions proxy-origin fix and redirect hardening;
3. runtime-derived admin configuration diagnostics.

An independent review of the first pass returned `BLOCK_INTEGRATION`. The
sections below describe the code as it stands after that remediation, including
the places where an earlier claim was withdrawn.

## Auth: Server Action Origin Trust

### What is confirmed

Next rejects a forwarded Server Action request when `x-forwarded-host` and the
browser `Origin` host disagree and the origin is not in
`experimental.serverActions.allowedOrigins`. This is reproduced locally and
observable in the dev-server log as
`` `x-forwarded-host` header with value ... does not match `origin` header ... ``
followed by `Invalid Server Actions request.`

### What is locally reproduced, not production-confirmed

`tests/e2e/stage-3-13c-production-proxy-login.spec.ts` drives login, logout, and
login again through `tests/e2e/helpers/production-proxy-harness.ts`, a local
reverse proxy built from the committed nginx contract
(`deploy/nginx/trusted-client-ip-snippet.conf`). The harness overwrites `Host`,
`X-Forwarded-Host`, `X-Forwarded-Proto`, `X-Forwarded-For`, `X-Real-IP`, and
`X-NegotAItions-Client-IP` exactly as the snippet does, discarding any
browser-supplied copy. The full auth cycle succeeds under that relationship.

Documented difference from production: the local listener is plain HTTP, so a
faithful `$scheme` is `http` rather than `https`.

A separate negative test forwards `X-Forwarded-Host: attacker.example` while the
browser `Origin` stays on the loopback host. The Server Action is refused and no
`auth_session` cookie is issued.

### What remains unresolved

The original claim that the local synthetic header mismatch *was* the production
root cause is withdrawn. No production request has been observed in this task,
so the production failure mode is not proven. The fix does not depend on that
explanation: it narrows trust rather than widening it, so it stays correct
whichever production condition triggered the original error page.

The proxy harness attaches a bounded, PII-free trace
(`proxy-forwarded-requests.json`: method, path, host/origin relationship,
upstream status) so a later production comparison has something concrete to
check against. No cookies, tokens, authorization headers, or bodies are recorded.

### Allowlist contents

`lib/config/server-action-origins.ts` owns the allowlist and reads only
`NODE_ENV`. No request-scoped input and no override environment variable reaches
production trust decisions.

- Production build: `negotaitions.ru` only.
- Development and managed-test builds add exactly `local.negotaitions.ru`,
  `localhost:3000`, `localhost:3100`, `127.0.0.1:3000`, `127.0.0.1:3100`.
- There is no production local-origin override; removed/legacy local-origin
  variables are ignored.
- No wildcards. `allowedDevOrigins` remains a dev-server asset setting gated
  behind the development branch and is not Server Action trust.

Why the other production hostnames are not in the list: the committed vhost
evidence (`docs/audits/stage-3-13c-proxy-readiness/nginx-header-flow.md`) shows
`server_name` covering `app.negotaitions.ru`, `negotaitions.ru`, and
`www.negotaitions.ru`, with `proxy_set_header Host $host`, and the target snippet
adds `X-Forwarded-Host $host`. Under both the current and target configurations
the host Next sees equals the host the browser sent, so `Origin` and the
forwarded host agree and Next admits the request without consulting the
allowlist. The allowlist is only reached when they disagree, which the nginx
contract does not produce. Adding those hostnames would therefore widen trust
without enabling anything.

Residual risk, stated deliberately: if production is ever changed so a proxy
rewrites the forwarded host to a value the browser did not send, Server Actions
for that hostname will be refused until the hostname is added to
`PRODUCTION_SERVER_ACTION_ORIGINS` under review. That is the fail-closed
direction and is preferred over pre-trusting hosts.

Same-origin validation, trusted-proxy client-IP handling, secure session
cookies, account-status checks, and password-reset anti-enumeration timing are
unchanged.

## Auth: Return URL Hardening

`lib/auth/return-url.ts` resolves a candidate `returnUrl` against the canonical
internal origin and requires the resolved origin to match exactly. Rejected
inputs include `//example.com`, `/\example.com`, encoded slash and backslash
variants, double-encoded forms, absolute and scheme-relative URLs, userinfo
tricks, non-HTTP schemes, control characters, and malformed percent-encoding.
Legitimate internal paths keep their query string and fragment. Every accepted
value is idempotent under a second sanitization pass, so no later browser
normalization can change the target origin.

## Admin Diagnostics

`lib/services/admin-env-display.ts` exposes a typed descriptor registry for the
in-scope runtime settings. Each descriptor names the runtime file that consumes
the key, and the test suite asserts two-way set equality against the expected
key set, so adding a runtime setting without a descriptor, or keeping a
descriptor for a key nothing reads, fails the build.

Effective values come from the same runtime parser the application uses, so a
defaulted setting reports `using_effective_default` with the real default rather
than a missing status. When `getEmailConfig()` cannot parse the environment, the
email-owned descriptors fall back to raw presence checks and report
`missing_required` or `invalid` instead of collapsing the whole table.

Children of a disabled feature report `not_applicable`, never
`missing_required`, except `EMAIL_SENSITIVE_PAYLOAD_KEY`: password-reset enqueue
encrypts sensitive payloads before delivery is enabled, so that key is required
whenever the application accepts ACTIVE-user password-reset intake.

Secrets carry state only: `value` is always `null`, with no prefix, suffix,
length, or fingerprint. The reversible `maskSecretValue` helper and the tests
that encouraged it are removed (F-20).

The admin health route returns a stable generic message and code instead of an
internal `error.message`, and logs only sanitized operational context (F-19).

The documented coverage matrix in
`docs/operations/admin-configuration-diagnostics.md` is asserted equal to the
emitted descriptors, including which keys are secret.

## Provider Event Ingestion

### Migrations

- `20260806113000_add_email_provider_event_ingestion` (unchanged) adds
  `EmailProviderStreamCheckpoint` and `EmailProviderIngestionFailure`.
- `20260806160000_harden_email_provider_event_ingestion` (new, additive) adds
  the nullable `EmailProviderEvent.suppressionDisposition`
  (`EmailProviderEventSuppressionDisposition`: `NONE`, `HARD_BOUNCE`,
  `COMPLAINT`), the nullable `EmailProviderStreamCheckpoint.initialReadAt`, and
  the indexes the corrected scheduler and checkpoint flow rely on.
- `20260806183000_add_provider_event_consumer_fencing` (new, additive) adds
  `EmailProviderConsumerLease`, `EmailProviderStreamCheckpoint.revision`, and
  nullable checkpoint writer generation/holder fields for durable fencing.

Both added columns are nullable with no default, so a runtime version that never
writes them keeps working. No column is dropped, renamed, or repurposed.
`scripts/verify-stage-3-13c-production-overlay.ts` asserts this against a real
disposable schema.

### Fair multi-shard scheduler

The previous consumer looped forever on the first open shard because
`NextShardIterator` never became null, so later shards and shard refresh were
unreachable. The scheduler is now a manager loop plus bounded slices:

- the manager loop owns shard discovery and refresh;
- each round hands every known open shard exactly one bounded slice before any
  shard receives a second slice;
- a slice ends after at most `EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS` polls;
- up to `EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY` slices run at once;
- unfinished open shards return to the tail of the fair queue;
- shards discovered during refresh join the next round;
- closed shards drain and retire.

No-starvation property: a shard can only be scheduled again after every other
queued shard has been scheduled, and a slice is bounded, so the wait before any
shard's next slice is bounded by the number of known shards times the slice
bound. Progress does not depend on a shard becoming idle.

`ListShards` pagination follows `NextToken` until exhausted, deduplicates shard
ids across pages, bounds total pages, classifies authentication and transient
failures the same way `GetRecords` does, and fails closed rather than returning
a partial shard list.

### Checkpoint and failure model

A checkpoint advances only in two cases:

1. the processor succeeded for the record; or
2. the record was deterministically classified as a poison record and the
   failure-ledger row plus the checkpoint were committed in one transaction.

Everything else fails closed and leaves the record replayable:

- a processor, database, or unexpected implementation failure never writes a
  poison-record disposition and never advances the checkpoint;
- transient failures retry through bounded backoff, and retry exhaustion stops
  the shard through the retryable failure path without checkpointing;
- if the failure-ledger transaction fails, no checkpoint is written;
- if the processor commits but the checkpoint write fails, replay is allowed and
  provider-event deduplication makes it safe.

Deterministic classification is limited to oversized stream records, invalid
transport encoding, malformed JSON, deterministic schema validation failures,
and deterministic unsupported envelopes. Parsed-but-unsupported events use the
reviewed `UNKNOWN`/`IGNORED` path and are not treated as infrastructure
failures.

Failure-ledger rows carry an allowlisted deterministic error code and a static
bounded message selected by that code. No free-form exception text, Prisma
argument rendering, provider response body, recipient, or stack trace is
persisted.

### Bounce classification

`bounceType` is authoritative and is evaluated first. `Permanent` may map to
hard-bounce suppression under existing policy. `Transient` never creates
hard-bounce suppression, regardless of subtype, so `General`, `MailboxFull`,
`MessageTooLarge`, and `ContentRejected` stay unsuppressed. A missing or
undetermined type creates no permanent suppression. `bounceSubType=General`
alone is never treated as proof of permanence.

The parse-time decision is persisted in the typed
`EmailProviderEvent.suppressionDisposition` column and read back during
reconciliation, so a `BOUNCED` event is never reconstructed as a hard bounce
from its event type alone. A row with a null disposition — one written by an
older runtime — is treated as "no permanent suppression".

Suppression reconciliation is intentionally independent of whether the locked
monotonic `EmailMessage` transition applies. An old permanent bounce still
ensures one active `HARD_BOUNCE` suppression, while complaint atomically
upgrades an active hard bounce and can never be downgraded by a later bounce.
Duplicate and replayed events repair a missing or weaker suppression inside the
same provider-event transaction before the consumer may checkpoint the stream
record.

Provider-controlled diagnostic text is not persisted. Bounce metadata keeps only
a bounded classification (`bounceClass`) and a `diagnosticCodeCount`; no email
address, SMTP response text, or free-form provider string reaches
`EmailProviderEvent.metadata`, the failure ledger, logs, or counters.

### Pacing, retry, and iterator boundary

`GetRecords` is paced per shard: calls are never issued more frequently than
`EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS`, which the runtime parser floors at
200 ms to respect the five-calls-per-second-per-shard limit. Pacing applies
after empty and non-empty responses alike, so throttling is never used as the
regulator. Transient failures use exponential backoff with bounded jitter and a
capped delay; consecutive failures are counted, a successful provider operation
resets the count, and crossing
`EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES` stops the shard through the
retryable path. Abort interrupts pacing and backoff immediately, and
`abortableSleep` removes its `AbortSignal` listener on timeout, abort, and error
through a deterministic `finally`.

Iterator reacquisition no longer re-reads `LATEST` before the first sequence
checkpoint, which could skip records. For `TRIM_HORIZON`, `TRIM_HORIZON` is used
until a sequence checkpoint exists. For `LATEST`, the first acquisition may use
`LATEST` and durably persists `initialReadAt`; any reacquisition or restart
before the first sequence checkpoint uses `AT_TIMESTAMP(initialReadAt)`. Once a
sequence checkpoint exists, `AFTER_SEQUENCE_NUMBER` is used. `initialReadAt` is
a read boundary, not a processed-record checkpoint.

### Advisory lock liveness

The dedicated `pg.Client` session-level lock remains, with explicit liveness:
an error or `end` on the lock connection aborts the consumer immediately; a
bounded liveness query runs on the same dedicated connection at each
shard-refresh cycle and observes the existing lock via `pg_locks` rather than
reacquiring it; liveness failure stops all shard processing and prevents further
checkpoint advancement; release stays idempotent. The lock never borrows a
Prisma pool connection.

### Shutdown, exit codes, and systemd

`SIGTERM` and `SIGINT` during `GetRecords`, an empty-read sleep, a shard-refresh
sleep, backoff, or pagination produce a controlled shutdown. An `AbortError` is
logged as `consumer_stopped`, not `consumer_failed`.
`EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS` is now enforced: after the signal the
consumer is aborted and awaited only for that budget; exceeding it emits a
sanitized `shutdown_timeout` event and exits through the retryable path.

Exit codes (`lib/email/provider-event-consumer-cli.ts`):

| Code | Meaning | Restarted |
| --- | --- | --- |
| `0` | controlled stop, normal completion, or ingestion disabled | no |
| `78` | invalid or incomplete configuration | never |
| `77` | authentication or authorization failure | never |
| `75` | transient runtime failure | bounded |

`deploy/systemd/negotiations-email-provider-events.service` lists `78 77` in
`RestartPreventExitStatus`, bounds restarts with `StartLimitIntervalSec=300` and
`StartLimitBurst=5`, keeps `RestartSec=10s`, and sets `TimeoutStopSec=30s` so the
application shutdown budget fires first. Existing hardening directives are
retained. Provider-event units do not grant write access to
`/var/www/negotaitions/app`; all runtime state remains in PostgreSQL.

### Operational visibility

Bounded, PII-free events with stable codes: `provider_event_consumer_started`,
`provider_event_shard_discovered`, `provider_event_shard_retired`,
`provider_event_checkpoint_advanced`, `provider_event_poison_record_classified`,
`provider_event_transient_retry`, `provider_event_retry_exhausted`,
`provider_event_processor_retry`, `provider_event_processor_retry_exhausted`,
`provider_event_iterator_reacquired`, `provider_event_lock_lost`,
`provider_event_terminal_failure`, `provider_event_consumer_stopped`, plus the
CLI's `consumer_disabled`, `consumer_invalid_config`, `shutdown_requested`,
`shutdown_timeout`, `consumer_stopped`, `consumer_completed`, and
`consumer_failed`. Shard ids are length-bounded and errors are reduced to a
sanitized class label. Raw payloads, recipients, subjects, bodies, diagnostic
codes, credentials, and full provider responses are never logged.

### Event mappings

- `Send` -> `ACCEPTED`
- `Delivery` -> `DELIVERED`
- `DeliveryDelay` -> `DELAYED`
- `Bounce` -> `BOUNCED`
- `Complaint` -> `COMPLAINED`
- `Rendering Failure` / `RenderingFailure` -> `RENDERING_FAILED`
- unknown events -> `UNKNOWN` without incorrect message mutation

## Environment

Provider-event settings:

- `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED=false`
- `YANDEX_DATA_STREAMS_ENDPOINT`
- `YANDEX_DATA_STREAMS_REGION=ru-central1`
- `YANDEX_DATA_STREAMS_STREAM_NAME`
- `YANDEX_DATA_STREAMS_ACCESS_KEY_ID`
- `YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY`
- `EMAIL_PROVIDER_EVENT_INITIAL_POSITION=LATEST`
- `EMAIL_PROVIDER_EVENT_RECORD_LIMIT=100`
- `EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS=1000` (floored at 200 ms)
- `EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS=60`
- `EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS=2000`
- `EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES=262144`
- `EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS=15000`
- `EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY=2`
- `EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS=4`
- `EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES=5`

Data Streams credentials are separate from Postbox sending credentials.

### Final Finding Disposition

| Finding | Disposition |
| --- | --- |
| F-13 production root cause | Earlier production root cause was not conclusively proven; production-equivalent local proxy behavior was reproduced and production evidence remains an operational verification item. |
| F-14 production origin trust | Fixed: production `allowedOrigins` contains only `negotaitions.ru`; development-only origins are documented separately; no production local-origin override remains. |

## Systemd

Disabled-by-default templates:

- `deploy/systemd/negotiations-email-provider-events.service`
- `deploy/systemd/negotiations-email-provider-event-reconciliation.service`
- `deploy/systemd/negotiations-email-provider-event-reconciliation.timer`

Reconciliation supplements ingestion for unmatched provider events. It does not
replace the Data Streams consumer.

## Manual Yandex Prerequisites

1. Create/select a Data Streams stream.
2. Create a dedicated consumer service account/static key.
3. Assign least privilege, including `yds.viewer` or reviewed equivalent.
4. Create Postbox configuration.
5. Add enabled Data Streams subscription.
6. Enable only Send, Delivery, DeliveryDelay, Bounce, Complaint, Rendering
   Failure.
7. Do not enable open/click tracking.
8. Bind configuration to the reviewed sending identity.
9. Stage consumer env with ingestion disabled.
10. Install consumer and reconciliation units disabled.
11. Enable ingestion only for a controlled canary.
12. Verify Send and Delivery ingestion.
13. Verify checkpoint and event/failure ledgers.
14. Only then activate the normal email worker.

Rollback order: disable delivery worker timer, set
`EMAIL_DELIVERY_ENABLED=false`, stop the provider-event consumer, set
`EMAIL_PROVIDER_EVENT_INGESTION_ENABLED=false`, preserve checkpoints/event
ledger/failure ledger/suppressions, never delete or rewind checkpoints during
incident response, revoke compromised Data Streams credentials, and do not
revert to pre-remediation runtime after real reset-email traffic.

## Verification

Local, disposable-database only. No production resources, Postbox API, Data
Streams API, email sends, or Yandex control-plane APIs are part of this
implementation.

- `npm run test:unit` — full unit suite including the scheduler, pagination,
  checkpoint/failure-model, pacing, iterator-boundary, CLI exit-code,
  origin-allowlist, return-URL, and diagnostics drift tests.
- `npm run test:stage313c:provider-events` — provider-event unit suites plus the
  DB-backed provider-event remediation verifier.
- `npm run verify:stage313c:overlay` — production-overlay additive migration
  verification.
- `npm run test:stage313c:proxy` — proxy and login/logout browser suites,
  including the production-equivalent proxy harness.
- `lib/email/provider-event-consumer-lock.pg.test.ts` — advisory-lock contention
  and liveness against a real disposable PostgreSQL. Gated on the approved
  disposable-database environment and skipped otherwise.
