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

## Logging

Logs may include message id, provider, attempt number, status, redacted recipient, error category, and counts. Logs must not include subject/body, full recipient email, credentials, tokens, provider raw responses, transcript content, or AI output.

## Production Installation

Do not install or activate it in Stage 3.13C-F. Committed systemd templates use
`/etc/negotaitions/env.production`; worker/retention timers and manual
canary/quarantine units remain disabled. The normal worker must remain stopped
during the isolated canary.

The local fake-provider procedure is documented in
`stage-3-13c-local-email-testing.md`. The preview must remain disabled in
production.
