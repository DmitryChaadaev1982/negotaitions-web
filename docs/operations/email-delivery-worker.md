# Email Delivery Worker Runbook

The Stage 3.13B worker is a bounded CLI sweep. It is not a request-time sender and is not installed as a production systemd unit in this stage.

## Commands

```shell
npm run email:delivery:sweep
npm run email:delivery:sweep -- --limit 10
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

## Retry Defaults

- Maximum attempts: 5.
- Initial delay: 60 seconds.
- Exponential backoff with bounded jitter.
- Maximum delay: 12 hours.
- Stale processing lease: 600 seconds by default.
- Provider request timeout: 30 seconds by default.
- Provider timeout safety margin: 30 seconds by default.

Provider request timeout must stay shorter than the processing lease minus the safety margin. Invalid timeout/lease configuration fails validation before delivery can activate.

Provider authentication/configuration errors become final failures and operational alerts. Throttle, pre-dispatch network, and pre-dispatch server failures may retry within bounds. Once a request has been dispatched and acceptance cannot be ruled out, the message becomes `ACCEPTANCE_UNKNOWN`, the claim is released, and the normal worker will not retry it automatically.

## Acceptance Unknown

`ACCEPTANCE_UNKNOWN` requires operator review or a later provider event. Stage 3.13B-H intentionally does not add a retry button or manual resend endpoint. Future manual handling is deferred to Stage 3.13E.

## Provider Event Reconciliation

Unmatched provider events stay `UNMATCHED` until the reconciliation sweep finds a provider-qualified message id match or the bounded reconciliation window expires.

```shell
npm run email:events:reconcile
```

Expired unmatched events become `IGNORED` with a stable processing result. The sweep is bounded and idempotent.

## Logging

Logs may include message id, provider, attempt number, status, redacted recipient, error category, and counts. Logs must not include subject/body, full recipient email, credentials, tokens, provider raw responses, transcript content, or AI output.

## Production Installation

Do not install in Stage 3.13B. Future deployment should use a timer or separate worker service with the same production env file pattern as the app, after secrets and provider readiness are confirmed.
