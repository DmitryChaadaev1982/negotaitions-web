# Stage 3.13B-H Email Foundation Hardening Verification

## 1. Starting Point

- Worktree: `C:\Projects\Negotiations AI\negotiations-web-stage-3-13b-email-foundation`
- Branch: `feat/stage-3-13b-email-provider-foundation`
- Starting SHA: `895e51135c53f3295bcfb1d60466807556c55465`
- Runtime base: `origin/deploy/yandex-poc`
- Runtime base SHA: `d53cb0db84d4fe6ccf0eea277af7b30085dfea04`
- `.env`: present, ignored, size/hash matched the authoritative local env file. No env content was printed.

## 2. Confirmed Defects

The hardening work treated all 12 findings as confirmed:

1. Post-claim completion updates were message-id-only and could be overwritten by stale workers.
2. Provider timeout/missing provider id was ordinary retryable failure and risked duplicate sends.
3. Provider events could downgrade stronger message states.
4. Unmatched provider events were marked processed and could not reconcile later.
5. Retry classification used arbitrary message text including digit matching.
6. Suppression was checked only at enqueue.
7. Active suppression rows were not uniquely constrained.
8. Provider message identity was not provider-qualified or relationally linked.
9. `enqueueEmail()` could not participate in an existing transaction.
10. Enqueue result flags were wrong for new suppressed and duplicate suppressed rows.
11. Admin API returned internal exception text and silently mapped invalid locale to English.
12. Isolated migration/runtime/retention proof was incomplete.

## 3. Final Corrections

- Worker claim fencing now uses `id + PROCESSING + claimToken` CAS for every post-claim message transition.
- Attempt allocation moved after claim ownership and suppression recheck, guarded by the claim token and current `attemptCount`.
- Provider ambiguous outcomes now become `ACCEPTANCE_UNKNOWN` with `TIMEOUT_UNKNOWN` attempt status and no automatic retry.
- Provider errors are classified from structured fields into stable normalized codes and generic messages.
- Suppression is evaluated at enqueue and again after claim immediately before provider send.
- Active suppression uniqueness is enforced with PostgreSQL partial unique indexes and idempotent creation.
- Provider events are deduplicated by create-first uniqueness handling, matched by provider-qualified message id, and related to `EmailMessage`.
- Provider event transitions use a centralized monotonic policy.
- Unmatched events remain reconcilable with a bounded window and a one-shot sweep.
- `enqueueEmail(input, db = prisma)` supports outer Prisma transactions.
- Admin API uses strict locale parsing, generic browser-safe errors, same-origin POST validation, and narrow rate limiting.

## 4. Schema and Migration

New migration: `20260804143000_stage_3_13b_email_hardening`.

Additive changes:

- `EmailMessageStatus.ACCEPTANCE_UNKNOWN`
- `EmailProviderEventProcessingStatus.UNMATCHED`
- `EmailMessage.lastProviderEventType`
- `EmailMessage.lastProviderEventTime`
- `EmailProviderEvent.processingResultCode`
- `EmailProviderEvent.processingResultMessage`
- `EmailProviderEvent.reconciliationAttempts`
- `EmailProviderEvent.nextReconcileAt`
- `EmailProviderEvent.reconciliationDeadlineAt`
- Relation: `EmailProviderEvent.emailMessageId -> EmailMessage.id` with `ON DELETE SET NULL`
- Unique: `EmailMessage(providerName, lastProviderMessageId)`
- Unique: `EmailDeliveryAttempt(provider, providerMessageId)`
- Indexes for provider-qualified lookup and reconciliation sweep
- Raw SQL partial unique indexes:
  - `EmailSuppression_active_global_unique`
  - `EmailSuppression_active_scoped_unique`

Additive safety conclusion: no existing columns are dropped, renamed, repurposed, or made required.

## 5. Worker Claim/Fencing Design

Claim:

1. Candidate statuses are only `PENDING` and `FAILED_RETRYABLE`.
2. Claim writes a random `claimToken`, `claimedAt`, `claimExpiresAt`, and `PROCESSING`.
3. Claim no longer increments `attemptCount`.
4. Stale recovery clears claim fields only for still-expired `PROCESSING` rows.

After claim:

1. Recheck suppression from the current database state.
2. If suppressed, transition by claim-token CAS, do not call provider, do not create an attempt, and do not increment `attemptCount`.
3. If not suppressed, allocate `attemptNumber = attemptCount + 1` in a transaction guarded by `id + PROCESSING + claimToken + attemptCount`.
4. Accepted, failure, and ambiguous transitions all update message state only through `id + PROCESSING + claimToken`.
5. CAS miss emits sanitized `claim_lost` and does not schedule a retry.

## 6. Acceptance Unknown Policy

`ACCEPTANCE_UNKNOWN` is used when provider acceptance cannot be ruled out:

- request timeout/abort after dispatch;
- connection loss after dispatch;
- SDK/server error after dispatch where acceptance is ambiguous;
- successful response without provider message id.

Semantics:

- attempt status: `TIMEOUT_UNKNOWN`;
- message status: `ACCEPTANCE_UNKNOWN`;
- claim released by CAS;
- no `nextAttemptAt`;
- normal worker sweep does not claim it;
- provider event reconciliation may resolve it later;
- manual/admin retry remains deferred to Stage 3.13E;
- current admin diagnostic UI does not include retry.

## 7. Structured Provider Error Policy

Provider classification uses structured properties: `name`, `code`, `$metadata.httpStatusCode`, `$retryable`, timeout/abort names, and request dispatch state. Persisted error values are stable normalized codes and generic messages.

Categories covered:

- `RETRYABLE_THROTTLE`
- `RETRYABLE_SERVER_ERROR`
- `RETRYABLE_NETWORK`
- `ACCEPTANCE_UNKNOWN`
- `INVALID_RECIPIENT`
- `INVALID_SENDER`
- `ACCESS_DENIED`
- `CONFIGURATION_ERROR`
- `VALIDATION_ERROR`
- `PROVIDER_FINAL_FAILURE`
- `UNKNOWN_PROVIDER_FAILURE`

No arbitrary raw SDK message or `message.includes("5")` matching is used.

## 8. Provider Event Transition Matrix

Policy summary:

- `ACCEPTED` -> `ACCEPTED_BY_PROVIDER`
- `DELAYED` -> `DELAYED`
- `DELIVERED` -> `DELIVERED`
- `BOUNCED` -> `BOUNCED`
- `COMPLAINED` -> `COMPLAINED`
- `REJECTED` / `RENDERING_FAILED` -> `FAILED_FINAL`
- `UNKNOWN` -> recorded and ignored

Ordering and conflicts:

- Older event than `lastProviderEventTime`: ignored.
- Weaker event than current state: ignored.
- `DELIVERED` followed by later `BOUNCED`: bounce applies.
- `DELIVERED` followed by later `COMPLAINED`: complaint applies and is terminal.
- `BOUNCED` followed by `DELIVERED`: delivered is ignored.
- `COMPLAINED`, `SUPPRESSED`, and `CANCELLED` are terminal for event transitions.
- `ACCEPTANCE_UNKNOWN` may be resolved by any known later provider event.

Ignored/conflicting events remain stored with processing result code/message.

## 9. Unmatched Event Reconciliation

Provider event ingestion creates the event first and then attempts processing.

- Event with no provider message id: `IGNORED`.
- Event with provider message id but no message: `UNMATCHED`.
- Unmatched events retain provider-qualified identity and schedule `nextReconcileAt`.
- Reconciliation is bounded by `reconciliationDeadlineAt`.
- The one-shot sweep is `npm run email:events:reconcile`.
- Expired unmatched events become `IGNORED` with `RECONCILIATION_EXPIRED`.
- Duplicate provider events return the existing event without reapplying transitions.

## 10. Suppression Uniqueness Model

Active suppression rules:

- one active global suppression per normalized recipient;
- one active category-scoped suppression per normalized recipient and category;
- inactive historical rows remain allowed.

Implementation:

- partial unique index for active global rows where `categoryScope IS NULL`;
- partial unique index for active scoped rows where `categoryScope IS NOT NULL`;
- `createActiveSuppression()` is idempotent and handles concurrent unique conflicts by returning the existing active row.

## 11. Transaction-Compatible Enqueue

`enqueueEmail(input, db = prisma)` now uses the supplied Prisma client for:

- suppression lookup;
- idempotency create;
- duplicate lookup.

Template loading/rendering remains outside the database. Future business flows can wrap business state change plus durable email enqueue in one transaction.

Result contract:

- new ordinary: `created=true`, `duplicate=false`, `suppressed=false`;
- duplicate ordinary: `created=false`, `duplicate=true`, `suppressed=false`;
- new suppressed: `created=true`, `duplicate=false`, `suppressed=true`;
- duplicate suppressed: `created=false`, `duplicate=true`, `suppressed=true`.

## 12. Admin API Hardening

The email foundation route keeps `apiRequireActiveAdminUser()`.

Additional protections:

- strict locale: only `ru` and `en`, invalid values return HTTP 400;
- no internal exception messages returned to browser;
- stable error code/message response;
- sanitized structured error logging;
- same-origin POST validation when `Origin` is present;
- narrow in-memory per-admin rate limit;
- recipient remains current active admin login email;
- request body accepts only locale;
- no recipient/sender/reply-to/template path/template variables in request;
- delivery remains enqueue-only.

## 13. Disposable Database Strategy

Selected strategy: local Docker PostgreSQL using existing local image `postgres:16-alpine`.

Safety:

- randomized database/container names containing `stage313b_verify`;
- host class: local;
- no production/server/dev DB reused;
- no connection strings or passwords recorded;
- containers removed after verification;
- temporary baseline archive/config deleted after verification.

## 14. Clean-Install Migration Result

Database: `stage313b_verify_clean_01662619`, local Docker PostgreSQL.

Commands:

- `npx prisma migrate deploy`: exit 0, full current chain applied from empty.
- `npx prisma validate`: exit 0.
- `npx prisma generate`: exit 0.
- schema index verification: exit 0, matched 4 required hardening indexes.
- FK verification: exit 0, provider-event FK present.

## 15. Baseline-Upgrade Migration Result

Database: `stage313b_verify_upgrade_42892345`, local Docker PostgreSQL.

Commands:

- baseline `npx prisma migrate deploy` from extracted `d53cb0db84d4fe6ccf0eea277af7b30085dfea04`: exit 0, 5 baseline migrations applied.
- current `npx prisma migrate deploy`: exit 0, Stage 3.13B foundation and hardening migrations applied.
- schema index verification: exit 0, matched 4 required hardening indexes.
- FK verification: exit 0, provider-event FK present.
- table verification: exit 0, required old and email tables present.

Initial baseline retry note: one earlier attempt failed before DB mutation because Prisma could not resolve dependencies from the temporary extracted config location. It was rerun with a temporary repo-local config and passed; temporary files were deleted.

## 16. Isolated Runtime Results

Database: `stage313b_verify_runtime_84883952`, local Docker PostgreSQL.

Command:

- `npx prisma migrate deploy`: exit 0.
- `npx tsx scripts/verify-stage-3-13b-email-hardening.ts`: exit 0.

Verified steps:

- ordinary enqueue and duplicate semantics passed;
- new suppressed and duplicate suppressed semantics passed;
- delivery disabled sweep did not call provider or mutate state;
- fake provider accepted one message and stored provider-qualified id;
- two concurrent sweeps produced one provider send and one attempt;
- stale claim owner could not overwrite newer claim;
- suppression after claim prevented provider send and attempt allocation;
- ambiguous provider outcome moved to `ACCEPTANCE_UNKNOWN` and was not retried;
- out-of-order provider events ignored weaker states and later complaint became terminal;
- unmatched event later matched and applied;
- reconciliation expiry moved unmatched event to ignored without infinite retry;
- retention dry-run twice and cleanup twice succeeded idempotently.

## 17. Retention Results

Runtime verifier created disposable old email fixtures only.

- Dry-run 1: found retention candidates.
- Dry-run 2: found the same candidates.
- Cleanup 1: cleared content, cleared provider id, deleted old attempt/event, deactivated expired suppression.
- Cleanup 2: zero remaining cleanup work.
- Audit state retained: message status and suppression history remain; subject/body/recipient/provider id minimized.

## 18. Focused Tests

Added/updated:

- provider timeout vs lease config validation;
- structured provider error classification;
- monotonic provider event transition matrix;
- isolated runtime verification script for claim fencing, claim loss, stale claim recovery, no automatic retry, suppression recheck, provider-qualified ids, dedup/reconciliation, and retention.

## 19. Mandatory Gate Results

- `npm run email:templates:validate`: exit 0, templates valid.
- `npx prisma validate`: exit 0.
- `npx prisma generate`: exit 0.
- focused `node --import ./scripts/test-unit-env-bootstrap.mjs --import tsx --test "lib/email/*.test.ts"`: exit 0, 8 passed.
- `npm run test:unit`: exit 0, 737 passed.
- `npm run validate:fast`: first run exit 1 due new `prefer-const` lint error; fixed. Rerun exit 0, Playwright list found 686 tests in 47 files.
- `npm run validate:deploy`: exit 0, build completed.
- `npm run test:e2e:smoke`: exit 0, 12 passed.
- `npm run test:e2e:smoke:browser`: first run exit 1 due parallel port `3100` in use; rerun exit 0, 5 passed.
- `npm run test:stage310`: exit 0, 102 unit tests passed and 37 Playwright tests passed.
- isolated clean-install migration verification: exit 0.
- isolated baseline-upgrade migration verification: exit 0.
- isolated runtime email verification: exit 0.

Prohibited `npm run test:e2e:observer:layout` was not run.

## 20. Security Review

Checklist:

- no credentials added;
- no `.env` added;
- no connection strings recorded in docs;
- no real email address added;
- no raw provider errors persisted;
- no raw provider response persisted;
- no full recipient email logged by worker or verification docs;
- no body or subject logged;
- no arbitrary recipient API;
- no dynamic template path API;
- no bearer invitation/reset token introduced;
- no automatic retry from `ACCEPTANCE_UNKNOWN`;
- no stale worker overwrite;
- no provider event downgrade;
- no duplicate active suppression model;
- no unsafe DB target used.

## 21. Known Limitations

- Yandex Postbox real provider event ingestion remains disabled until infrastructure is configured.
- No public webhook was added.
- Manual/admin retry for `ACCEPTANCE_UNKNOWN` is deferred to Stage 3.13E.
- In-memory admin route rate limiting is process-local and intentionally narrow for this diagnostic endpoint.

## 22. Merge Readiness

Decision: `MERGE_READY`.
