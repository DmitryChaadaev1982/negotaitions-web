# Stage 3.13C Account Security Email

## Implemented scope

- Localized forgot-password and reset-password routes.
- Hash-only, expiring, revocable, single-use reset tokens.
- Anti-enumerating ACTIVE/BLOCKED/REJECTED/PENDING/unknown request policy.
- Transactional `PASSWORD_RESET`, `ACCOUNT_RECOVERY_DENIED`, and
  `PASSWORD_CHANGED` outbox integration.
- Authentication-session revocation after reset and sibling-session revocation
  after authenticated password change.
- ACTIVE-admin notifications for pending registrations.
- Guarded local fake-message preview.
- Additive clean-install migration and production-history overlay inclusion.

Event invitations, Session invitations, reminders, results mail, campaigns,
preferences, provider-event ingestion, Yandex resource changes, real provider
activation, and production deployment remain deferred.

## Runtime changes

`lib/auth/account-security.ts` owns durable request/reset transactions.
`lib/email/account-security.ts` owns allowlisted template variables, canonical
links, message types/categories, and idempotency keys. Public request handling
is `POST /api/auth/forgot-password`; password completion uses a Next server
action.

The reset page declares `Referrer-Policy: no-referrer`, is force-dynamic, uses
only repository application resources, and never sends a token to analytics.
Provider delivery stays in the existing worker.

## Schema and migration

Migration `20260804170000_stage_3_13c_account_security_email` creates
`PasswordResetToken` with:

- `id`, `userId`, unique `tokenHash`;
- `expiresAt`, `usedAt`, `revokedAt`, `createdAt`;
- cascade deletion with `User`;
- indexes for hash lookup, user invalidation, expiry, and creation time;
- a PostgreSQL partial unique index allowing at most one unused/unrevoked token
  per user.

No existing table, column, enum value, legacy-history archive, or negotiation
domain record is removed or rewritten.

## Email templates

The repository-managed RU/EN templates enabled at runtime are:

- `password-reset`;
- `account-recovery-denied`;
- `password-changed`;
- `admin-pending-approval`.

The renderer retains strict missing/unknown variable checks, URL validation,
HTML escaping, deterministic versions, and shared operational footers.
Event/Session invitation templates remain disabled.

## Security and operational decisions

- Raw reset tokens are never stored in token rows, logs, audit metadata,
  provider metadata, or reports.
- Valid public requests always return the same status and response shape.
- The minimum password policy remains eight characters and bcrypt cost 12.
- SECURITY mail respects hard-bounce, complaint, manual, and temporary safety
  suppressions; marketing unsubscribe does not suppress SECURITY mail.
- Local preview is a 404 unless every local guard passes and then still
  requires an ACTIVE administrator.
- Preview list results are bounded, recipient-masked, body-free, and reveal
  content only through a same-origin POST.
- Per-IP abuse protection is process-local and therefore not distributed. This
  is a documented limitation; no Redis or new infrastructure is introduced.

## Verification entrypoints

```text
npm run email:templates:validate
npx prisma validate
npx prisma generate
npm run test:unit
npm run test:stage313c
npm run verify:stage313c:integration
```

The integration verifier refuses non-local/production-like database targets.
The focused Playwright suite covers public response parity, database effects,
browser reset/login/session behavior, registration notification recipient
selection, and local preview authorization/list/reveal boundaries.

Production is not activated by this implementation. The migration, provider,
worker, and local-preview configuration require separate deployment approval.
