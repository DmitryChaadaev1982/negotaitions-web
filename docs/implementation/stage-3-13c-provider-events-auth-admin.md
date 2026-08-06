# Stage 3.13C Provider Events, Auth, And Admin Diagnostics

Starting SHA: `4a29ccfebfd03a3d465e557ea7bff4384945a19a`

Branch: `feat/stage-3-13c-provider-event-ingestion`

Worktree: `C:\Projects\Negotiations AI\negotiations-web-stage-3-13c-provider-events`

## Scope

This implementation adds three production-readiness workstreams without
production access or activation:

1. disabled-by-default Yandex Cloud Postbox provider-event ingestion through
   Yandex Data Streams;
2. login/logout Server Actions proxy-origin regression fix;
3. runtime-derived admin configuration diagnostics.

## Auth Regression

Root cause: Next Server Actions reject forwarded requests when
`x-forwarded-host` and the browser `Origin` host do not match unless the origin
is explicitly allowed. With trusted-proxy/nginx headers present, login and
logout failed before application code ran, producing the generic Next.js server
error page.

Fix: `next.config.ts` declares the approved Server Action origins for production
and local production-like testing. Same-origin validation, trusted-proxy client
IP handling, session cookie security, account-status checks, and
anti-enumeration timing behavior remain enabled.

Regression coverage includes direct same-origin tests, trusted-proxy tests,
forged forwarding-header rejection, and a Chromium login -> logout -> login
flow with a deterministic ACTIVE user.

## Admin Diagnostics

The admin diagnostics table now shows a bounded server-derived
`AdminEnvDisplayItem` model with effective value, source, applicability,
required state, status, consumer, and explanation. The admin health API is
dynamic and no-store.

Secrets are never serialized to the client. Secret rows carry state only and set
`value=null`. Obsolete or unused raw env rows are removed, including stale public
env substitutes and raw transcript flags outside this runtime scope.

Defaulted values now report effective defaults instead of missing status,
including password-reset TTL/cooldown/hourly limit, Postbox region/endpoint, and
provider-event polling defaults. `TRUSTED_PROXY_ENABLED` is read dynamically
from runtime config and reports the effective value.

The coverage matrix is documented in
`docs/operations/admin-configuration-diagnostics.md`.

## Provider Event Ingestion

Migration: `20260806113000_add_email_provider_event_ingestion`

Additive schema:

- `EmailProviderStreamCheckpoint` stores provider, stream, shard, last handled
  sequence, arrival timestamp, last provider event id, and timestamps.
- `EmailProviderIngestionFailure` stores provider, stream, shard, sequence,
  arrival timestamp, deterministic payload SHA-256, bounded sanitized error
  code/message, status, and timestamps.

The consumer uses an injectable Kinesis-compatible adapter backed by
`@aws-sdk/client-kinesis` for Yandex Data Streams. Tests use in-memory adapters
and do not call Yandex Cloud. A dedicated PostgreSQL session advisory lock
enforces single-consumer operation.

Checkpoint semantics: a checkpoint advances only after
`processEmailProviderEvent()` succeeds or the record is durably classified in
the sanitized failure ledger. Replay after processing but before checkpoint is
accepted because provider-event processing is idempotent. Poison records are
idempotent by provider/stream/shard/sequence and must not block the shard.

Event mappings:

- `Send` -> `ACCEPTED`
- `Delivery` -> `DELIVERED`
- `DeliveryDelay` -> `DELAYED`
- `Bounce` -> `BOUNCED`
- `Complaint` -> `COMPLAINED`
- `Rendering Failure` / `RenderingFailure` -> `RENDERING_FAILED`
- unknown events -> `UNKNOWN` without incorrect message mutation

Permanent bounces use existing hard-bounce suppression. Transient bounces do not
create hard-bounce suppression. Complaints preserve complaint suppression.

## Environment

New provider-event settings:

- `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED=false`
- `YANDEX_DATA_STREAMS_ENDPOINT`
- `YANDEX_DATA_STREAMS_REGION=ru-central1`
- `YANDEX_DATA_STREAMS_STREAM_NAME`
- `YANDEX_DATA_STREAMS_ACCESS_KEY_ID`
- `YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY`
- `EMAIL_PROVIDER_EVENT_INITIAL_POSITION=LATEST`
- `EMAIL_PROVIDER_EVENT_RECORD_LIMIT=100`
- `EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS=1000`
- `EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS=60`
- `EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS=2000`
- `EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES=262144`
- `EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS=15000`

Data Streams credentials are separate from Postbox sending credentials.

## Systemd

Added disabled-by-default templates:

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

## Validation Status

Record exact command results in the final chat report after local gates finish.
No production resources, Postbox API, Data Streams API, email sends, or Yandex
control-plane APIs are part of this implementation.
