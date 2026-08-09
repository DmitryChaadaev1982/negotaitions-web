# Stage 3.13C Local Email Testing

This procedure uses the canonical automated-test PostgreSQL database and the
in-memory fake provider. It does not require Postbox credentials and must not be
used for production.

## 1. Use the canonical test database

Use the existing E2E database for all automated PostgreSQL checks. Do not create
or start a Stage 3.13C-specific PostgreSQL container, database, or schema.

Set these values manually in the repository's ignored `.env`. Never print or
commit URLs with credentials:

```dotenv
DATABASE_URL=postgresql://<user>:<password>@localhost:5432/negotiations
E2E_DATABASE_URL=postgresql://<user>:<password>@localhost:5433/negotiations_e2e
```

`5432/negotiations` is for normal development only. Automated PostgreSQL,
integration, advisory-lock, and Playwright E2E tests use
`5433/negotiations_e2e`. Provider-event test runners inject
`DATABASE_URL=E2E_DATABASE_URL` only into their child process because the
production locking code reads `DATABASE_URL`.

## 2. Database safety

The E2E database must already have the current schema. These checks do not run
Prisma migrations, do not mutate schema, and do not reset databases. Test data
uses run-specific identifiers and cleanup deletes only rows created by the run.

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

Run the focused checks sequentially:

```powershell
npm run test:e2e:db:check
npm run test:stage313c:provider-events
npm run test:stage313c
```

The provider-event PostgreSQL lock test refuses a missing or unsafe
`E2E_DATABASE_URL`, including accidental `localhost:5432/negotiations`. Output
prints sanitized host, port, and database identity, plus test counters.

## 7. Cleanup

Retain both local databases. Do not drop or reset either database as part of
this procedure. Remove or rotate ignored `.env` values manually only when local
configuration changes.

## Production prerequisites

Production activation is a later change. It requires reviewed deployment
configuration, migration approval, real provider credentials, worker
scheduling, sender/domain readiness, monitoring, and an explicit decision to
keep `EMAIL_LOCAL_PREVIEW_ENABLED=false`. None of those actions is part of
Stage 3.13C local verification.
