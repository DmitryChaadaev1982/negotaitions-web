# Email Delivery Worker Runbook

The Stage 3.13B worker is a bounded CLI sweep. It is not a request-time sender and is not installed as a production systemd unit in this stage.

## Commands

```shell
npm run email:delivery:sweep
npm run email:delivery:sweep -- --limit 10
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
4. Moves the row to `PROCESSING`, increments attempt count, and stores a claim lease.
5. Creates an `EmailDeliveryAttempt`.
6. Calls the provider adapter.
7. Records provider message id, retry, or final failure.

Two workers racing for the same row should result in one successful claim and one skipped candidate.

## Retry Defaults

- Maximum attempts: 5.
- Initial delay: 60 seconds.
- Exponential backoff with bounded jitter.
- Maximum delay: 12 hours.
- Stale processing lease: 600 seconds by default.

Provider authentication/configuration errors should become final failures and operational alerts. Network, timeout, rate, and 5xx-like failures may retry within bounds.

## Logging

Logs may include message id, provider, attempt number, status, redacted recipient, error category, and counts. Logs must not include subject/body, full recipient email, credentials, tokens, provider raw responses, transcript content, or AI output.

## Production Installation

Do not install in Stage 3.13B. Future deployment should use a timer or separate worker service with the same production env file pattern as the app, after secrets and provider readiness are confirmed.
