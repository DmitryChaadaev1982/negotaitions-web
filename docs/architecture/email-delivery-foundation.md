# Email Delivery Foundation

## Goals

The email foundation prepares NegotAItions for future security and invitation flows without enabling real production sending in Stage 3.13B.

Business code enqueues a durable `EmailMessage`; it does not call a provider. A worker claims eligible messages after the business transaction commits and sends through a narrow `EmailProvider` interface.

## Data Model

- `EmailMessage`: durable outbox record with type, category, status, recipient, rendered content, template version, idempotency key, provider state, claim lease, retry fields, and retention markers.
- `EmailDeliveryAttempt`: sanitized provider attempt ledger.
- `EmailSuppression`: active/lifted suppression policy records.
- `EmailProviderEvent`: provider-neutral event ledger with provider event deduplication.

`User`, `Event`, and `Session` business semantics are not changed.

## Lifecycle

Eligible states are `PENDING` and `FAILED_RETRYABLE`. The worker moves a row to `PROCESSING` using conditional `updateMany`, increments `attemptCount`, and stores a claim lease. A second worker cannot claim the same row if the first claim succeeds.

Terminal states are `DELIVERED`, `BOUNCED`, `COMPLAINED`, `SUPPRESSED`, `FAILED_FINAL`, and `CANCELLED`. `ACCEPTED_BY_PROVIDER` may later move to `DELIVERED`, `DELAYED`, `BOUNCED`, or `COMPLAINED` from provider events.

Provider timeout with unknown outcome is recorded as `TIMEOUT_UNKNOWN` on the attempt and `FAILED_RETRYABLE` on the message only within bounded retry policy. This must be revisited before high-volume production activation because at-least-once delivery can produce duplicates if provider acceptance was ambiguous.

## Idempotency

`EmailMessage.idempotencyKey` is unique at the database level. Re-enqueueing the same logical email returns the existing message instead of creating a second outbox record.

Future conventions:

- Password reset request: account id plus reset request nonce.
- Password changed: user id plus password change event id.
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

## Suppression

Hard bounce suppresses normal transactional, product, marketing, admin-test, and invitation email by default. Complaint suppresses the same categories by default. Security messages are not given a blanket bypass; exceptions must be explicit in code and tests.

Unsubscribe is only meaningful for product/marketing categories in Stage 3.13B. There is no unsubscribe UI yet.

## Provider Events

Provider events are normalized to `ACCEPTED`, `DELIVERED`, `DELAYED`, `BOUNCED`, `COMPLAINED`, `REJECTED`, `RENDERING_FAILED`, and `UNKNOWN`. The processor deduplicates by provider plus provider event id, locates a message by provider message id, updates state, and creates suppression records for hard bounce and complaint.

No public webhook route is added in Stage 3.13B. Yandex Cloud Postbox event ingestion is deferred until the real Data Streams/EventRouter path is configured.

## Retention

Defaults are env-controlled:

- Subject/body/recipient content: 90 days for terminal messages.
- Delivery attempts: 365 days.
- Provider message ids: 365 days.
- Provider events: 730 days.
- Bounce/complaint-related semantics: 730 days.
- Active suppression: retained until expiry or explicit lift.

Cleanup is bounded, idempotent, and supports dry-run.

## Observability

Logs and `ExternalServiceEvent` records may contain message ids, provider, attempt number, status, redacted recipient, error category, and counts. They must not contain body, full subject, credentials, tokens, raw recipient email, transcript, or raw provider responses.
