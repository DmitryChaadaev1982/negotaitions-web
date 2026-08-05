# Stage 3.13C Local Email Testing

This procedure uses one approved persistent local PostgreSQL test database, one
verifier-owned schema, and the in-memory fake provider. It does not require
Postbox credentials and must not be used for production.

## 1. Approve the persistent test database

Provisioning the PostgreSQL instance is outside the verifier. Reuse the
approved local test instance; do not create a database or container per run.
The database name must be test-like and must not contain a production marker.

Set these values manually in the repository's ignored `.env`. Never print or
commit the URL, and do not create `.env.local` for the verifier:

```dotenv
STAGE313C_TEST_DATABASE_URL=<approved-local-test-url>
STAGE313C_TEST_DATABASE_APPROVED=true
STAGE313C_TEST_SCHEMA=stage3_13c_final_remediation
```

The five PostgreSQL verifier commands load `.env` with the project env loader.
They never fall back to runtime `DATABASE_URL`. The wrapper derives a
process-local schema-scoped URL only for migration and child-verifier
processes; it does not edit `.env`.

## 2. Verifier schema lifecycle

Each command acquires one bounded database advisory lock, proves that any
existing `stage3_13c_final_remediation` schema carries the verifier ownership
marker, drops and recreates only that schema, applies the required migrations,
runs with an explicit search path, proves row and advisory-lock cleanup, and
releases the coordination lock. `public`, other schemas, shared rows,
extensions, roles, and the database itself are never destructive targets.

## 3. Start the application and local HTTPS route

Terminal 1:

```powershell
npm run dev
```

The application listens on `http://127.0.0.1:3000`.

Terminal 2, using the existing local reverse-tunnel host:

```powershell
ssh -N -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  -o ServerAliveCountMax=2 `
  -R 127.0.0.1:3300:127.0.0.1:3000 deploy@172.29.172.1
```

Open `https://local.negotaitions.ru`. Authenticate as an ACTIVE local
administrator and open `/admin`. The panel labelled
`LOCAL TEST ONLY — fake email preview` must be visible.

## 4. Exercise account recovery

Use distinct local fixture addresses; do not use real recipients.

1. ACTIVE: submit `/forgot-password`. Confirm the generic success text, reveal
   the latest `PASSWORD_RESET` in `/admin`, open its local reset link, choose a
   new password, then sign in again. Confirm the old password and old browser
   sessions no longer authenticate and one `PASSWORD_CHANGED` appears.
2. BLOCKED: submit the same form. Confirm the same public success text, no reset
   token/link, and one `ACCOUNT_RECOVERY_DENIED`.
3. REJECTED: repeat the BLOCKED check.
4. PENDING_APPROVAL: confirm the same public success text and no user email.
5. Unknown valid address: confirm the same public success text and no user
   email.
6. Repeat an address inside 60 seconds and more than five times in one hour.
   The public response must remain unchanged and no extra token should appear.

The list masks recipients. Message bodies and reset links are returned only
after the explicit Reveal action. Never paste a revealed link into logs or a
completion report.

## 5. Run a fake delivery sweep

For a separately configured local application session using the fake provider:

```powershell
npm run email:delivery:sweep -- --limit 20
```

The fake provider performs no network operation. The durable outbox and
attempt ledger remain the source of preview data. A hard-bounce, complaint, or
manual safety suppression must transition a SECURITY message to `SUPPRESSED`
without a provider attempt. A marketing unsubscribe must not suppress it.

## 6. Automated focused checks

Run the schema safety unit test, then the PostgreSQL verifiers sequentially:

```powershell
npm run test:stage313c:test-database-harness
npm run verify:stage313c:integration
npm run verify:stage313c:overlay
npm run verify:stage313c:remediation
npm run verify:stage313c:high-remediation-r2
npm run verify:stage313c:final-remediation
```

Every command refuses missing approval, an incorrect schema, a non-local or
production-like target, a base URL containing a schema override, or a child
URL not derived by the wrapper. Output is restricted to test names, counters,
opaque IDs, the approved schema name, and migration identifiers.

## 7. Cleanup

Retain the persistent test database. It is acceptable to retain the empty,
marked verifier schema for reuse. Do not drop the database. Remove or rotate
the three ignored `.env` values manually only when the approval is withdrawn.

## Production prerequisites

Production activation is a later change. It requires reviewed deployment
configuration, migration approval, real provider credentials, worker
scheduling, sender/domain readiness, monitoring, and an explicit decision to
keep `EMAIL_LOCAL_PREVIEW_ENABLED=false`. None of those actions is part of
Stage 3.13C local verification.
