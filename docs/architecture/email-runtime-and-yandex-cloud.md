# Email Runtime and Yandex Cloud

## Scope and configuration policy

The email runtime uses a durable database outbox and separate operational
processes. Deployment choices are explicit environment configuration; runtime
parsers validate and normalize values but do not invent production addresses,
origins, endpoints, regions, provider choices, feature flags, or tuning values.

The typed registry classifies settings as:

- `deployment`: must be supplied by the applicable environment;
- `intrinsic`: an implementation/runtime invariant may have a code fallback;
- `test_scaffolding`: allowed only in test bootstrap and rejected from the
  production runtime registry.

`NODE_ENV=development` is the only intrinsic registry fallback. Email, Postbox,
Data Streams, authentication, provider-selection, timeout, retry, and retention
settings are deployment configuration.

## Runtime architecture

### Web application

The web application validates the email runtime, renders approved templates,
selects sender and reply-to roles, and creates durable `EmailMessage` rows. It
does not send directly during a business transaction. Account-security flows
use the canonical email origin, persist sanitized rendered content, and protect
password-reset payloads with the dedicated configured encryption key.

### Durable outbox

`EmailMessage` is the source of truth for queued mail. It stores the selected
From and Reply-To addresses at enqueue time, so changing later environment
configuration does not silently rewrite an already-journaled message. Enqueue
stamps `providerName` from the producing process; claim selection does not
filter on that field. Claim tokens, leases, attempt counters, suppression
checks, and idempotency keys protect concurrent delivery.

### Delivery worker

`negotiations-email-worker.timer` starts the oneshot delivery worker. The worker
loads `/etc/negotaitions/env.production`, claims eligible messages, rechecks
suppression and password-reset authorization, and sends through the provider
selected from process-local `EMAIL_PROVIDER` / `EMAIL_DELIVERY_ENABLED`. On
provider acceptance it overwrites `EmailMessage.providerName` and records the
same name on `EmailDeliveryAttempt.provider`. A Postbox request is permitted
only when delivery is enabled, the provider is `yandex_postbox`, all provider
settings and credentials are present, and every configured sender role is in
the explicit Postbox sender allowlist.

### Provider-event consumer

`negotiations-email-provider-events.service` consumes Postbox events from
Yandex Data Streams. It uses a durable single-consumer lease, per-shard
checkpoints, bounded polling/backoff, and poison-record handling. It is
independent of the delivery worker and remains inactive unless provider-event
ingestion is explicitly enabled.

### Reconciliation

`negotiations-email-provider-event-reconciliation.timer` retries matching
already-ingested unmatched events to outbox messages within the configured
window. Reconciliation does not read Data Streams and does not replace the
consumer.

### Retention

`negotiations-email-retention.timer` applies the configured content, attempt,
provider-id, provider-event, and bounce/complaint retention windows. Cleanup is
bounded and idempotent.

## Environment ownership

Environment files are deployment inputs and are never committed.

- Authoritative local environment: the machine-local EO overlay TYPED_IMPORT
  source reference. Do not commit that path or copy `.env` wholesale.
- Production web application: deployment-managed `.env.production`.
- Production email worker, provider-event consumer, reconciliation, retention,
  and canary units: `/etc/negotaitions/env.production`.

Shared identity, origin, and crypto values must agree across the application
and operational service environments. `EMAIL_PROVIDER` and
`EMAIL_DELIVERY_ENABLED` are process-local delivery gates: the Next.js
process may keep them `disabled` / `false` while the dedicated worker
enables Postbox delivery. That split is the outbox delivery fence, not a
requirement that both files match. Admin diagnostics inspect only the web
application's process environment; they cannot attest to a different
systemd process environment.

| Ownership | Variables |
| --- | --- |
| Shared app and worker identity/crypto | `EMAIL_CANONICAL_BASE_URL`, `EMAIL_OPERATOR_NAME`, all `EMAIL_FROM_*`, all `EMAIL_REPLY_TO_*`, `EMAIL_SENSITIVE_PAYLOAD_KEY` |
| Process-local delivery gates | `EMAIL_PROVIDER`, `EMAIL_DELIVERY_ENABLED`. The web application may be `disabled` / `false` while the worker is `yandex_postbox` / `true`. |
| Delivery worker required when Postbox delivery is active | `YANDEX_POSTBOX_REGION`, `YANDEX_POSTBOX_ENDPOINT`, `YANDEX_POSTBOX_ALLOWED_SENDERS`, `YANDEX_POSTBOX_ACCESS_KEY_ID`, `YANDEX_POSTBOX_SECRET_ACCESS_KEY`; configuration set is optional but must be explicit when used |
| Worker/retry/timeout/retention and provider-event settings | Required in the process that runs the corresponding worker. Shared only when that process actually uses them. |
| Provider-event consumer required when ingestion is active | `YANDEX_DATA_STREAMS_ENDPOINT`, `YANDEX_DATA_STREAMS_REGION`, `YANDEX_DATA_STREAMS_STREAM_NAME`, `YANDEX_DATA_STREAMS_ACCESS_KEY_ID`, `YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY`, and all `EMAIL_PROVIDER_EVENT_*` consumer controls |
| App-only presentation/queue semantics | No separate hidden defaults. The canonical origin, operator identity, sender roles, and reply-to roles are shared contract values. |

Secret values are never shown in documentation or diagnostics. Diagnostics
report only configured/missing state for secrets.

## Yandex Cloud Postbox

Verified production control-plane facts:

| Property | Value |
| --- | --- |
| Domain | `negotaitions.ru` |
| Postbox address ID | `egt3ahavqd0dmtfh7tfe` |
| Status | Active |
| Allowed senders | `no-reply@negotaitions.ru`, `notifications@negotaitions.ru`, `invitations@negotaitions.ru` |
| Configuration name | `negotiations-production-events` |
| Endpoint | `https://postbox.cloud.yandex.net` |
| Region | `ru-central1` |
| DKIM | Success |

No sender outside those three addresses is assumed to be allowed.

## Yandex Data Streams and YDB

| Property | Value |
| --- | --- |
| Stream | `negotiations-postbox-events-prod` |
| YDB database | `negotiations-events-ydb` |
| Shards | 1 |
| Retention | 24 hours |
| Status | Active |
| Consumer purpose | Ingest Postbox send, delivery, delay, bounce, complaint, rejection, and rendering-failure events into the durable email journal |

## Environment-variable mapping

### Delivery and identity

| Variable | Purpose | Applicability |
| --- | --- | --- |
| `EMAIL_PROVIDER` | Selects `disabled`, `fake`, or `yandex_postbox` | Always explicit |
| `EMAIL_DELIVERY_ENABLED` | Enables provider delivery | Always explicit |
| `EMAIL_CANONICAL_BASE_URL` | Exact origin used in email links | Always explicit |
| `EMAIL_OPERATOR_NAME` | Operator identity in email footers | Always explicit |
| `EMAIL_FROM_NO_REPLY` | Address for the `no-reply` sender role | Always explicit |
| `EMAIL_FROM_NOTIFICATIONS` | Address for the `notifications` sender role | Always explicit |
| `EMAIL_FROM_INVITATIONS` | Address for the `invitations` sender role | Always explicit |
| `EMAIL_REPLY_TO_SUPPORT` | Support Reply-To role | Always explicit |
| `EMAIL_REPLY_TO_SECURITY` | Security Reply-To role | Always explicit |
| `EMAIL_REPLY_TO_BUSINESS` | Business Reply-To role | Always explicit |

The verified-compatible deployment maps each role to its matching address:
`no-reply`, `notifications`, and `invitations`. Adding another From address
requires separate Yandex Postbox sender verification and an explicit allowlist
update.

### Postbox

| Variable | Purpose | Applicability |
| --- | --- | --- |
| `YANDEX_POSTBOX_REGION` | SES signing region | Required for enabled Postbox delivery |
| `YANDEX_POSTBOX_ENDPOINT` | SES-compatible API endpoint | Required for enabled Postbox delivery |
| `YANDEX_POSTBOX_ALLOWED_SENDERS` | Comma-separated control-plane-verified sender allowlist | Required for enabled Postbox delivery |
| `YANDEX_POSTBOX_CONFIGURATION_SET` | Optional Postbox event configuration name | Optional; `negotiations-production-events` in verified production |
| `YANDEX_POSTBOX_ACCESS_KEY_ID` | Postbox credential identifier | Required secret for enabled Postbox delivery |
| `YANDEX_POSTBOX_SECRET_ACCESS_KEY` | Postbox credential secret | Required secret for enabled Postbox delivery |

### Provider events

| Variable | Purpose | Applicability |
| --- | --- | --- |
| `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED` | Enables live Data Streams consumption | Always explicit |
| `YANDEX_DATA_STREAMS_ENDPOINT` | Kinesis-compatible HTTPS endpoint | Required when ingestion is enabled |
| `YANDEX_DATA_STREAMS_REGION` | Data Streams signing/path region | Required when ingestion is enabled |
| `YANDEX_DATA_STREAMS_STREAM_NAME` | Stream leaf or full Yandex stream path | Required when ingestion is enabled |
| `YANDEX_DATA_STREAMS_ACCESS_KEY_ID` | Dedicated consumer credential identifier | Required secret when ingestion is enabled |
| `YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY` | Dedicated consumer credential secret | Required secret when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_INITIAL_POSITION` | `LATEST` or `TRIM_HORIZON` initial-read policy | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_RECORD_LIMIT` | Records requested per poll | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS` | Per-shard poll pacing | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS` | Shard discovery/liveness interval | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS` | Transient failure backoff base | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES` | Poison-record size bound | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS` | Controlled shutdown budget | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY` | Concurrent fair shard slices | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS` | Polls per fair shard slice | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES` | Failure exhaustion bound | Required when ingestion is enabled |
| `EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS` | Unmatched-event matching window | Always explicit |
| `EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS` | Reconciliation retry delay | Always explicit |

## Sender and template matrix

Russian and English variants use identical metadata.

| Email type / template | Category | Runtime enabled | Sender key | Effective From | Allowed by current Postbox policy |
| --- | --- | --- | --- | --- | --- |
| `SYSTEM_TEST` / `system-test` | `ADMIN_TEST` | yes | `no-reply` | `no-reply@negotaitions.ru` | yes |
| `PASSWORD_RESET` / `password-reset` | `SECURITY` | yes | `no-reply` | `no-reply@negotaitions.ru` | yes |
| `ACCOUNT_RECOVERY_DENIED` / `account-recovery-denied` | `SECURITY` | yes | `no-reply` | `no-reply@negotaitions.ru` | yes |
| `PASSWORD_CHANGED` / `password-changed` | `SECURITY` | yes | `no-reply` | `no-reply@negotaitions.ru` | yes |
| `ADMIN_PENDING_APPROVAL` / `admin-pending-approval` | `TRANSACTIONAL` | yes | `notifications` | `notifications@negotaitions.ru` | yes |
| `EVENT_INVITATION` / `event-invitation` | `INVITATION` | no | `invitations` | `invitations@negotaitions.ru` | yes |
| `SESSION_INVITATION` / `session-invitation` | `INVITATION` | no | `invitations` | `invitations@negotaitions.ru` | yes |

At the time of the observed failure, the confirmed Postbox policy allowed only
`no-reply@negotaitions.ru`, while `ADMIN_PENDING_APPROVAL` resolved to
`notifications@negotaitions.ru`. That incompatibility is a direct explanation
candidate for `PROVIDER_VALIDATION_ERROR`. The control-plane policy has since
been updated to allow all three documented senders; runtime env must still
declare the same three-address allowlist explicitly.

## Operational verification

1. In Administration -> Administrative diagnostics -> Environment
   configuration, confirm each applicable setting reports source
   `environment`, required/applicable state is correct, and secrets show only
   presence.
2. Confirm `negotiations-email-worker.timer` and its latest oneshot service
   result are healthy.
3. Select one eligible non-sensitive journal message and run the bounded
   Postbox canary procedure.
4. Require an accepted response with a provider message ID. Absence of a
   provider message ID is not delivery success.
5. Confirm the corresponding provider event arrives in
   `negotiations-postbox-events-prod` and is persisted by the consumer.
6. Confirm reconciliation has no overdue unmatched event for the provider
   message ID and that journal state advances monotonically.
7. Run retention in dry-run mode before activating the retention timer.

## Fail-closed rules

- A missing applicable required environment value raises a bounded
  configuration error; no operational code default is substituted.
- A sender role not present in `YANDEX_POSTBOX_ALLOWED_SENDERS` blocks Postbox
  configuration before a provider request.
- `EMAIL_DELIVERY_ENABLED=true` with `EMAIL_PROVIDER=disabled` is invalid.
- Postbox credentials are required only for enabled Postbox delivery.
- Postbox endpoint, region, allowlist, and credentials are all required for
  enabled Postbox delivery.
- Data Streams endpoint, region, stream, credentials, and consumer controls are
  required only when provider-event ingestion is enabled.
- Secret values are presence-only in diagnostics and must never be logged,
  documented, or serialized.
