# Stage 3.13B Email Provider Foundation

Stage 3.13B adds the application foundation for durable operational email while keeping real production delivery disabled by default.

## Git Baseline

- Worktree: `C:\Projects\Negotiations AI\negotiations-web-stage-3-13b-email-foundation`
- Branch: `feat/stage-3-13b-email-provider-foundation`
- Runtime base: `origin/deploy/yandex-poc`
- Expected and verified runtime base SHA: `d53cb0db84d4fe6ccf0eea277af7b30085dfea04`
- Starting feature SHA: `0e86fb909037800518c43b11d16bea2bfe60968b`

## B0 Findings

- `User.email` is required and unique and is the login identifier.
- There is no existing outbound email provider, durable email outbox, forgot-password flow, email verification, or communication preference model.
- `EventInvite` and `SessionInvite` already exist as invitation/access records.
- `lib/invite-email.ts` only normalizes email addresses.
- There is no general background job queue. Stage 3.10 maintenance patterns are used as an operational reference, but email has separate models and services.

## Implemented Scope

- Additive Prisma email foundation models and enums.
- Repository-managed RU/EN templates with shared footers.
- Safe deterministic template renderer.
- Durable outbox enqueue service with DB-level idempotency.
- Suppression decision service.
- Bounded delivery worker with DB claim, processing lease, retry, and stale recovery.
- Disabled, fake, and Yandex Cloud Postbox SES-compatible provider adapters.
- Provider event normalization processor.
- Retention cleanup with dry-run support.
- Minimal active-admin self-test diagnostics panel and API.

## Explicitly Deferred

No Stage 3.13C/3.13D business triggers were implemented: forgot password, password reset, email verification, login email change, Event invitations, standalone Session invitations, reminders, result emails, campaigns, user preferences, unsubscribe UI, or production activation.

## Safety Notes

Production delivery remains disabled unless `EMAIL_DELIVERY_ENABLED=true` and a non-disabled provider with required credentials is configured. The admin self-test enqueues only to the current active admin login email and never sends inline from the HTTP request.

## Stage 3.13B-H Hardening

Stage 3.13B-H hardens claim fencing, ambiguous provider outcomes, suppression uniqueness, provider-event monotonicity/reconciliation, transaction-compatible enqueue, admin API validation, and isolated migration/runtime verification.

See `docs/implementation/stage-3-13b-hardening-verification.md` for the complete evidence record and merge-readiness decision.
