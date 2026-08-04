# Stage 3.13C Local Email Testing

This procedure uses a disposable local PostgreSQL database and the in-memory
fake provider. It does not require Postbox credentials and must not be used for
production.

## 1. Start a disposable database

Run in PowerShell:

```powershell
docker run --name negotaitions-stage313c-test `
  -e POSTGRES_USER=stage313c `
  -e POSTGRES_PASSWORD=stage313c-local-only `
  -e POSTGRES_DB=stage313c_local_test `
  -p 55433:5432 -d postgres:16-alpine

$env:DATABASE_URL = "postgresql://stage313c:stage313c-local-only@127.0.0.1:55433/stage313c_local_test"
npx prisma migrate deploy
npx prisma migrate status
```

The database name deliberately contains the Stage 3.13C test marker. Never
point the verification script or Playwright at the normal development or
production database.

## 2. Create the ignored local override

Create `.env.local` only in the Stage 3.13C worktree. Do not commit it.

```dotenv
DATABASE_URL=postgresql://stage313c:stage313c-local-only@127.0.0.1:55433/stage313c_local_test
EMAIL_DELIVERY_ENABLED=true
EMAIL_PROVIDER=fake
EMAIL_ADMIN_TEST_ENABLED=true
EMAIL_LOCAL_PREVIEW_ENABLED=true
EMAIL_CANONICAL_BASE_URL=https://local.negotaitions.ru
PASSWORD_RESET_TOKEN_TTL_MINUTES=30
PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS=60
PASSWORD_RESET_MAX_REQUESTS_PER_HOUR=5
```

For CLI processes, set the same sanitized values in the current PowerShell
session because Prisma and operational scripts load `.env`, not `.env.local`:

```powershell
$env:DATABASE_URL = "postgresql://stage313c:stage313c-local-only@127.0.0.1:55433/stage313c_local_test"
$env:EMAIL_DELIVERY_ENABLED = "true"
$env:EMAIL_PROVIDER = "fake"
$env:EMAIL_ADMIN_TEST_ENABLED = "true"
$env:EMAIL_LOCAL_PREVIEW_ENABLED = "true"
$env:EMAIL_CANONICAL_BASE_URL = "https://local.negotaitions.ru"
```

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

From a PowerShell session with the local variables above:

```powershell
npm run email:delivery:sweep -- --limit 20
```

The fake provider performs no network operation. The durable outbox and
attempt ledger remain the source of preview data. A hard-bounce, complaint, or
manual safety suppression must transition a SECURITY message to `SUPPRESSED`
without a provider attempt. A marketing unsubscribe must not suppress it.

## 6. Automated focused checks

Use one managed Playwright mode at a time:

```powershell
npm run email:templates:validate
npm run test:stage313c
npm run verify:stage313c:integration
```

`verify:stage313c:integration` refuses non-local or production-like database
names and prints sanitized counts only.

## 7. Cleanup

Stop the dev server and tunnel, then:

```powershell
Remove-Item .env.local -ErrorAction SilentlyContinue
docker rm -f negotaitions-stage313c-test
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:EMAIL_DELIVERY_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:EMAIL_PROVIDER -ErrorAction SilentlyContinue
Remove-Item Env:EMAIL_ADMIN_TEST_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:EMAIL_LOCAL_PREVIEW_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:EMAIL_CANONICAL_BASE_URL -ErrorAction SilentlyContinue
```

## Production prerequisites

Production activation is a later change. It requires reviewed deployment
configuration, migration approval, real provider credentials, worker
scheduling, sender/domain readiness, monitoring, and an explicit decision to
keep `EMAIL_LOCAL_PREVIEW_ENABLED=false`. None of those actions is part of
Stage 3.13C local verification.

