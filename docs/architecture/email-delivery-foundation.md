# Email Delivery Foundation

## Goals

The email foundation supports durable account-security mail and prepares later
invitation flows without enabling real production sending.

Business code enqueues a durable `EmailMessage`; it does not call a provider. A worker claims eligible messages after the business transaction commits and sends through a narrow `EmailProvider` interface.

## Data Model

- `EmailMessage`: durable outbox record with type, category, status, recipient, rendered content, template version, idempotency key, provider state, claim lease, retry fields, and retention markers.
- `EmailDeliveryAttempt`: sanitized provider attempt ledger.
- `EmailSuppression`: active/lifted suppression policy records.
- `EmailProviderEvent`: provider-neutral event ledger with provider event deduplication.
- `EmailProviderStreamCheckpoint`: per provider/stream/shard sequence checkpoint
  for live provider-event ingestion.
- `EmailProviderIngestionFailure`: sanitized poison-record ledger keyed by
  provider/stream/shard/sequence. It stores payload SHA-256 and bounded error
  disposition only, never raw payload or recipient/body data.
- `PasswordResetToken`: hash-only, expiring, revocable account-recovery token
  used by Stage 3.13C.

`User`, `Event`, and `Session` business semantics are not changed.

## Lifecycle

Eligible states are `PENDING` and `FAILED_RETRYABLE`. The worker moves a row to `PROCESSING` using conditional `updateMany` and stores a random claim token plus lease. Attempt allocation happens only after suppression is rechecked and only while `id + PROCESSING + claimToken` is still owned. A second worker cannot claim the same row if the first claim succeeds, and a stale worker cannot complete over a newer claim.

For `PASSWORD_RESET`, after claim and suppression recheck the worker acquires
the credential dispatch fence (session advisory lock on a dedicated `pg`
connection), revalidates token/user/generation eligibility, decrypts the
AAD-bound sensitive payload, validates the raw-token hash against
`PasswordResetToken`, validates that `recipientEmail` normalizes to the
authenticated canonical `recipientEmailNormalized`, and passes only that
canonical value to `provider.send`. Malformed, internationalized (unsupported),
noncanonical normalized, or mismatched associations terminalize without a
provider call and clear the ciphertext. The two recipient fields remain for
indexed lookup plus nullable content retention; they are not independent
delivery authorities.

Credential mutations acquire the same fence so dispatch cannot race
password/token/status invalidation (M-03R). Fence acquisition itself is bounded
with try-lock backoff, and the provider call has its own configured timeout.
Connection/process death remains the final release guarantee.

Terminal states are `DELIVERED`, `BOUNCED`, `COMPLAINED`, `SUPPRESSED`, `FAILED_FINAL`, and `CANCELLED`. `ACCEPTED_BY_PROVIDER` may later move to `DELIVERED`, `DELAYED`, `BOUNCED`, or `COMPLAINED` from provider events.

Provider timeout or connection loss after request dispatch is recorded as
`TIMEOUT_UNKNOWN` on the attempt and `ACCEPTANCE_UNKNOWN` on the message. In
the same claim-owned finalization transaction, password-reset ciphertext,
nonce, and late-rendered bodies are cleared. It is not retried by the normal
worker sweep because provider acceptance may already have happened. Later
provider events may reconcile it; `ACCEPTED_BY_PROVIDER` still does not mean
end-user `DELIVERED`.

## Idempotency

`EmailMessage.idempotencyKey` is unique at the database level. Re-enqueueing the same logical email returns the existing message instead of creating a second outbox record. The returned suppression flag reflects the persisted message status, not the current request's suppression check.

Idempotency conventions:

- Password reset request: reset-token record id.
- Password changed after reset: reset-token record id.
- Authenticated password changed: user id plus password-change hash.
- Pending approval: new user id plus active admin recipient id.
- Account approval: target user id plus approval action id.
- Event invitation: event id plus invite id plus template version.
- Session invitation: session id plus invite id plus template version.
- Reminder offset: event/session id plus reminder offset plus recipient id/email.
- Results published: session/event id plus publication event id plus recipient id/email.

## Provider Adapter

The selected production transport is Yandex Cloud Postbox via the AWS SES v2 compatible API. Application services import only `EmailProvider`; provider-specific credentials and response fields stay inside `YandexPostboxEmailProvider`.

Providers:

- `disabled`: default no-send mode.
- `fake`: tests only.
- `yandex_postbox`: production adapter, inactive unless configured.

The `fake` provider may be inspected through the Stage 3.13C local preview only
when the exact development guards in `account-security-email-flows.md` hold.

## Suppression

Hard bounce suppresses normal transactional, product, marketing, admin-test, and invitation email by default. Complaint suppresses the same categories by default. Security messages are not given a blanket bypass; exceptions must be explicit in code and tests.

Suppression is checked at enqueue and again after worker claim immediately before provider send. Active suppression uniqueness is enforced with PostgreSQL partial unique indexes: one active global row per normalized recipient and one active scoped row per normalized recipient/category.

Unsubscribe is only meaningful for product/marketing categories in Stage 3.13B. There is no unsubscribe UI yet.

## Provider Events

Provider events are normalized to `ACCEPTED`, `DELIVERED`, `DELAYED`, `BOUNCED`, `COMPLAINED`, `REJECTED`, `RENDERING_FAILED`, and `UNKNOWN`. The processor deduplicates by provider plus provider event id, locates a message by provider plus provider message id, applies a monotonic transition policy, and creates suppression records for hard bounce and complaint.

Unmatched events are stored as `UNMATCHED` and reconciled by `npm run email:events:reconcile` until a bounded deadline. Ignored events retain a stable processing result code/message for audit.

Stage 3.13C adds a disabled-by-default Yandex Data Streams consumer; it does not
add a public webhook route. Yandex Postbox events are parsed by
`lib/email/yandex-postbox-provider-event-parser.ts` and then handed to the
provider-neutral `processEmailProviderEvent()` path.

Mappings:

- `Send` -> `ACCEPTED`
- `Delivery` -> `DELIVERED`
- `DeliveryDelay` -> `DELAYED`
- `Bounce` -> `BOUNCED`
- `Complaint` -> `COMPLAINED`
- `Rendering Failure` / `RenderingFailure` -> `RENDERING_FAILED`
- unsupported events -> `UNKNOWN`, recorded/ignored without mutating message
  state.

Permanent bounces request the existing hard-bounce suppression policy.
Transient bounces explicitly do not create hard-bounce suppression. Complaints
request the existing complaint suppression policy. Bounce is never inferred to
Complaint.

The consumer enumerates shards, starts at `AFTER_SEQUENCE_NUMBER` when a
checkpoint exists, and otherwise uses the configured `LATEST` or `TRIM_HORIZON`
initial position. It processes records in shard sequence order and advances the
checkpoint only after `processEmailProviderEvent()` succeeds or after the record
is durably classified in `EmailProviderIngestionFailure`. Crashing after event
processing but before checkpoint update is acceptable because provider event
processing is idempotent; checkpoint advancement before processing is forbidden.

A PostgreSQL session advisory lock on a dedicated connection enforces
single-consumer operation across processes. Lock contention fails closed. The
consumer supports bounded retries for transient stream errors, iterator
reacquisition, shard refresh, SIGTERM/SIGINT abort, and conservative
single-process operation.

## Retention

Defaults are env-controlled:

- Subject/body/recipient content: 90 days for terminal messages.
- Delivery attempts: 365 days.
- Provider message ids: 365 days.
- Provider events: 730 days.
- Bounce/complaint-related semantics: 730 days.
- Active suppression: retained until expiry or explicit lift.

Cleanup is bounded, idempotent, and supports dry-run.

## Controlled operations

- `email:delivery:canary` requires one strict `--message-id`, refuses disabled
  delivery or an ineligible row, scopes recovery/claim/send to that row, and
  has no general-sweep fallback.
- `email:backlog:quarantine` is dry-run by default, requires `--apply` to
  mutate, uses a strict 1..500 batch, handles password-reset messages only,
  never creates a provider, and clears sensitive fields on cancellation.
- Normal worker and retention timers plus the manual canary systemd unit remain
  disabled repository templates; this stage does not install or enable them.
- `email:events:consume` runs the disabled-by-default Data Streams consumer.
  It refuses to run when `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED=false`.
- `email:events:reconcile` remains a bounded unmatched-event reconciliation
  sweep. It does not replace live ingestion and does not consume Data Streams.

## Observability

Logs and `ExternalServiceEvent` records may contain message ids, provider, attempt number, status, redacted recipient, error category, and counts. They must not contain body, full subject, credentials, tokens, raw recipient email, transcript, or raw provider responses.
