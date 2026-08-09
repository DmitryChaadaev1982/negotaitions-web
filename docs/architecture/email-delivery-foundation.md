# Email Delivery Foundation

## Goals

The email foundation supports durable account-security mail and prepares later
invitation flows without enabling real production sending.

Business code enqueues a durable `EmailMessage`; it does not call a provider. A worker claims eligible messages after the business transaction commits and sends through a narrow `EmailProvider` interface.

## Data Model

- `EmailMessage`: durable outbox record with type, category, status, recipient, rendered content, template version, idempotency key, provider state, claim lease, retry fields, and retention markers.
- `EmailDeliveryAttempt`: sanitized provider attempt ledger.
- `EmailSuppression`: active/lifted suppression policy records.
- `EmailProviderEvent`: provider-neutral event ledger with provider event
  deduplication and a nullable typed `suppressionDisposition` recording the
  parse-time suppression decision.
- `EmailProviderStreamCheckpoint`: per provider/stream/shard sequence checkpoint
  for live provider-event ingestion, plus a nullable `initialReadAt` durable
  initial-read boundary used before the first sequence checkpoint exists,
  revision CAS metadata, and last-writer generation/holder fields.
- `EmailProviderConsumerLease`: one durable owner row per provider/stream.
  Generation increments while the advisory lock is held, and checkpoint writes
  must match the current generation and holder.
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

- `disabled`: explicit no-send mode.
- `fake`: tests only.
- `yandex_postbox`: production adapter, inactive unless configured.

Postbox delivery also requires an explicit environment-owned sender allowlist.
Every `EMAIL_FROM_*` role must resolve to an address in that allowlist before a
provider client can be created. The verified production policy currently
allows the `no-reply`, `notifications`, and `invitations` addresses documented
in `email-runtime-and-yandex-cloud.md`.

The `fake` provider may be inspected through the Stage 3.13C local preview only
when the exact development guards in `account-security-email-flows.md` hold.

## Suppression

Hard bounce suppresses normal transactional, product, marketing, admin-test, and invitation email by default. Complaint suppresses the same categories by default. Security messages are not given a blanket bypass; exceptions must be explicit in code and tests.

Suppression is checked at enqueue and again after worker claim immediately before provider send. Active suppression uniqueness is enforced with PostgreSQL partial unique indexes: one active global row per normalized recipient and one active scoped row per normalized recipient/category.

Unsubscribe is only meaningful for product/marketing categories in Stage 3.13B. There is no unsubscribe UI yet.

## Provider Events

Provider events are normalized to `ACCEPTED`, `DELIVERED`, `DELAYED`, `BOUNCED`, `COMPLAINED`, `REJECTED`, `RENDERING_FAILED`, and `UNKNOWN`. The processor deduplicates by provider plus provider event id, locks the provider event and matched `EmailMessage` row in one transaction, evaluates the monotonic transition policy against the locked current message state, and commits any message transition, provider-event processing state, and required hard-bounce/complaint suppression atomically.

Message-state monotonicity and recipient suppression are independent decisions.
An older or weaker reviewed permanent bounce can be ignored for
`EmailMessage.status` while still creating `HARD_BOUNCE` suppression. Complaint
has deterministic precedence over hard bounce: an active `HARD_BOUNCE` row is
atomically upgraded to `COMPLAINT`, and a later bounce cannot downgrade it.
Duplicate/replayed processed or ignored events reconcile a missing or weaker
required suppression before they succeed, so checkpoint advancement never
acknowledges an event whose suppression invariant failed.

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

`bounceType` decides permanence and is evaluated before any subtype. Permanent
bounces request the existing hard-bounce suppression policy. Transient bounces
never create hard-bounce suppression, whatever the subtype, and a missing or
undetermined type creates no permanent suppression. Complaints request the
existing complaint suppression policy. Bounce is never inferred to Complaint.

The decision is made once at parse time and persisted in the typed nullable
`EmailProviderEvent.suppressionDisposition`, which reconciliation reads back. A
`BOUNCED` event is therefore never reconstructed as a hard bounce from its event
type alone, and a null disposition means "no permanent suppression". Provider
diagnostic text is not persisted: bounce metadata keeps only a bounded
classification and a diagnostic-code count.

The consumer schedules shards fairly. A manager loop owns discovery and refresh,
and each round gives every known open shard one bounded slice before any shard
receives a second, with bounded slice concurrency, so no shard can starve.
`ListShards` pagination is followed to exhaustion and fails closed rather than
returning a partial list.

Within a shard, records are processed in sequence order. The checkpoint advances
only when `processEmailProviderEvent()` succeeds, or when the record is
deterministically classified as a poison record and the
`EmailProviderIngestionFailure` row and checkpoint commit in one transaction. A
processor, database, or unexpected failure never advances the checkpoint and
never acknowledges the record, so it stays replayable. Crashing after event
processing but before the checkpoint update is acceptable because provider event
processing is idempotent; checkpoint advancement before processing is forbidden.
Every checkpoint or `initialReadAt` mutation verifies the current durable lease
generation/holder and compares the previously loaded checkpoint revision before
incrementing it, so a stale owner or stale same-generation slice cannot regress
an opaque provider sequence string.

Iterator acquisition uses `AFTER_SEQUENCE_NUMBER` once a sequence checkpoint
exists. Before that it uses `TRIM_HORIZON` when configured, and for `LATEST` it
persists a durable `initialReadAt` boundary on first acquisition so a
reacquisition or restart resumes at `AT_TIMESTAMP` rather than skipping the
initial window. `initialReadAt` is a read boundary, not a processed-record
checkpoint.

A PostgreSQL session advisory lock on a dedicated connection enforces
single-consumer operation across healthy processes. While holding it, the
consumer increments the durable `EmailProviderConsumerLease` generation and
stores a random holder id. Lock contention fails closed, an error on the lock
connection stops the consumer immediately, and a bounded liveness probe on that
same connection runs each shard-refresh cycle. If an old in-flight processor
finishes after ownership changes, the checkpoint fence rejects the write.
`GetRecords` is paced per shard within the documented Data Streams rate limit;
transient stream errors use bounded exponential backoff with jitter and a
bounded consecutive-failure limit; `SIGTERM`/`SIGINT` produces a controlled
shutdown within an enforced budget.

## Retention

Retention windows are required environment configuration:

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
- Normal worker and retention services remain static systemd oneshots. Their
  timers are installed disabled by default and become persistable only after the
  provider/outbox production canary or retention dry-run prerequisites pass and
  explicit activation approval is recorded.
- `email:events:consume` runs the disabled-by-default Data Streams consumer.
  It refuses to run when `EMAIL_PROVIDER_EVENT_INGESTION_ENABLED=false`.
- `email:events:reconcile` remains a bounded unmatched-event reconciliation
  sweep. It does not replace live ingestion and does not consume Data Streams.

## Observability

Logs and `ExternalServiceEvent` records may contain message ids, provider, attempt number, status, redacted recipient, error category, and counts. They must not contain body, full subject, credentials, tokens, raw recipient email, transcript, or raw provider responses.
