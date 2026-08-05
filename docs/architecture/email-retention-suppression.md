# Email Retention and Suppression Policy

## Retention Defaults

All values are configurable by env and validated:

- `EMAIL_CONTENT_RETENTION_DAYS=90`
- `EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS=365`
- `EMAIL_PROVIDER_ID_RETENTION_DAYS=365`
- `EMAIL_PROVIDER_EVENT_RETENTION_DAYS=730`
- `EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS=730`

Content retention minimizes rendered subject/body and recipient address only for terminal messages. It does not delete active or processing messages.

## Suppression Reasons

- `HARD_BOUNCE`
- `COMPLAINT`
- `MANUAL`
- `UNSUBSCRIBE`
- `TEMPORARY`

Hard bounce suppresses normal transactional, invitation, admin-test, product, and marketing email by default. Complaint suppresses product/marketing and normal operational categories by default. Security exceptions must be explicit and tested.

Unsubscribe is category-aware and primarily applies to future product/marketing communications. Stage 3.13B does not implement unsubscribe UI or marketing consent.

## Active Suppression

Active suppression records are not automatically deleted. Temporary suppressions may expire and be marked inactive. Manual lift requires audit data (`liftedAt`, `liftedByUserId`, and `liftReason` where available).

At most one active global suppression may exist per normalized recipient, and at most one active category-scoped suppression may exist per normalized recipient/category. PostgreSQL partial unique indexes enforce this because `categoryScope` is nullable:

- `EmailSuppression_active_global_unique` for active rows with `categoryScope IS NULL`.
- `EmailSuppression_active_scoped_unique` for active rows with `categoryScope IS NOT NULL`.

Suppression is evaluated twice: once during enqueue and again after worker claim immediately before provider send. If the worker-side check finds suppression, the message moves to `SUPPRESSED` by claim-token CAS, no provider call is made, and no delivery attempt is allocated.

## Provider Events

Hard bounce and complaint provider events create suppression records after event deduplication. Creation is idempotent so concurrent duplicate provider events cannot create duplicate active suppressions. Event ingestion treats provider payloads as untrusted metadata and stores only sanitized, bounded data.

## Cleanup

Retention cleanup supports dry-run and logs only counts. It is idempotent and bounded.

```shell
npm run email:retention:dry-run
npm run email:retention:cleanup
```

If retention rules conflict, content minimization should happen earlier while suppression/event semantics follow the longer retention window.

## Admin journal reveal

The permanent Admin → Email journal may reveal retained subject/text/HTML only
through an explicit ACTIVE-admin same-origin action. Password-reset retained
bodies redact `token=` values before display. Cleared content
(`contentClearedAt`) is reported as unavailable. Reveal writes
`AdminActionLog` with action `EMAIL_CONTENT_REVEALED` and metadata limited to
message id, request id, and outcome — never body, recipient, or token.
