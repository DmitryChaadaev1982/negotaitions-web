# Account Security Email Flows

## Scope

Stage 3.13C adds account recovery and security notifications to the durable
Stage 3.13B outbox. HTTP requests enqueue `EmailMessage` rows and never call an
email provider. Event and negotiation Session state, room leases, participant
membership, and Voximplant state are outside this flow.

## Account status policy

- `ACTIVE`: a valid forgot-password request may create one reset token and
  enqueue `PASSWORD_RESET`.
- `BLOCKED` and `REJECTED`: no token is created. A bounded
  `ACCOUNT_RECOVERY_DENIED` message tells the recipient to contact security
  support without naming the internal status or rejection reason.
- `PENDING_APPROVAL`: no token and no account email are created.
- Unknown or any unrecognized status: no token and no account email are
  created.

Every syntactically valid forgot-password request receives HTTP 200 with the
same JSON shape and localization key. Account existence, status, enqueue
outcome, suppression, cooldown, and hourly-limit decisions are not public.
Malformed input may receive the common validation error.

## Token lifecycle

`PasswordResetToken` stores a unique SHA-256 hash of a random 32-byte opaque
token. The raw token exists only:

1. ephemerally while enqueueing (encrypted into `sensitivePayloadCiphertext`);
2. in memory during worker late-render / provider send;
3. in the browser as a URL fragment that is scrubbed immediately after load.

It is never stored in token rows, rendered email bodies at rest, JSON metadata,
audit records, provider metadata, or logs. Database-only readers cannot recover
an active token without the out-of-band `EMAIL_SENSITIVE_PAYLOAD_KEY`.

Defaults:

- lifetime: 30 minutes;
- normalized-email cooldown: 60 seconds;
- account maximum: 5 requests per hour;
- maximum active tokens per user: 1.

Creating an ACTIVE-user token first acquires the bounded user-scoped credential
dispatch fence, then locks `User`, revokes previous unused tokens, cancels their
claimable reset messages, creates the new hash-only row, and enqueues
`PASSWORD_RESET` in one serializable transaction. The partial unique index on
active tokens provides a second concurrency guard.

Reset validates token syntax, hashes the token, cheaply checks eligibility,
hashes the new password only after that gate, then acquires the credential
dispatch fence and claims the token in a serializable transaction while holding
`SELECT ... FOR UPDATE` on the `User` row. The claim increments
`User.credentialGeneration`, updates the bcrypt password hash, revokes sibling
tokens, deletes every `UserSession`, and enqueues exactly one
`PASSWORD_CHANGED`.

### H-01R — session creation linearization

Login and registration hash or verify the password **outside** any transaction
that locks `User` (bcrypt must not hold a DB lock). Every production session
creation call must supply the observed `credentialGeneration`; there is no
unguarded overload. Registration uses the generation returned by the committed
user/consent transaction, including bootstrap-admin ACTIVE registration. Then
`createUserSessionToken` / `createUserSession`:

1. begins a short Prisma transaction;
2. locks the target `User` with parameterized `SELECT ... FOR UPDATE`;
3. rechecks that `credentialGeneration` still matches;
4. inserts `UserSession` while the lock is held;
5. commits;
6. only then sets the auth cookie.

Password reset and authenticated password change serialize on the same `User`
row lock. Safe order A (login then reset) creates a session that reset deletes.
Safe order B (reset then login) makes session creation observe a generation
mismatch and insert nothing. A mixed old/new runtime is **not** safe for account
security activation.

### M-03R — reset dispatch fence

Password-reset provider dispatch and every reset-eligibility mutation share a PostgreSQL
**session advisory lock** keyed by a domain-separated SHA-256 of the user id
(`lib/auth/credential-dispatch-fence.ts`). The fence uses a dedicated `pg`
`Client` (not the Prisma pool) so it can span the bounded provider call and is
released on unlock, error, or connection/process death. Acquisition repeatedly
uses `pg_try_advisory_lock` with bounded backoff and a monotonic deadline
(`CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS`, default 5000 ms, allowed 50..30000).
Invalid configuration fails closed; timeout/abort never enters the operation.

Worker linearization point (Outcome A/B):

1. claim message;
2. acquire dispatch fence for `userId`;
3. revalidate token/user/generation eligibility;
4. decrypt + bind-check sensitive payload;
5. `provider.send`;
6. record provider outcome;
7. release fence.

Credential mutation acquires the same fence before token claim / password
update. New-token issuance/supersession, reset consumption, authenticated
password change, and administrator BLOCKED/REJECTED transitions all use this
boundary. There is no production user-deletion path. Holding a Prisma row lock
across the provider network call is forbidden.

Global lock order is:

1. credential-dispatch fence;
2. database transaction;
3. `User`;
4. `PasswordResetToken`;
5. `UserSession`;
6. `EmailMessage` (and then its attempt row).

No code may wait for the fence while holding one of those row locks. A worker
may claim and commit an `EmailMessage` before waiting for the fence, but it
holds no row lock during acquisition.

Invalid, expired, reused, revoked, and newly inactive accounts receive the same
safe failure.

## Browser fragment boundary

The reset client copies `window.location.hash` only into ephemeral memory,
immediately removes the complete live fragment with `history.replaceState`,
and only then parses the copy. Exactly one `token` field is accepted; duplicate,
empty, malformed, or unrelated fragment fields fail. The fragment is never
restored, so refresh and copied current URLs contain no token. Any query-string
`token` key, including an empty or duplicate value, is rejected server-side.

Authenticated password change uses the same bcrypt policy and transactional
`PASSWORD_CHANGED` notification. It revokes outstanding reset tokens and all
other account sessions while preserving the current authenticated session.
There is no administrator-initiated password-change path.

## Abuse controls

Durable token/outbox timestamps enforce per-account cooldown and hourly limits.
A process-local limiter also keeps one-hour SHA-256 normalized-email buckets
and HMAC-SHA-256 client-IP fingerprint buckets. Raw IP addresses are not stored.

Client IP identity comes only from `lib/auth/client-ip.ts`:

- `TRUSTED_PROXY_ENABLED=false` (local default): stable unknown bucket.
- `TRUSTED_PROXY_ENABLED=true`: only nginx-overwritten `X-NegotAItions-Client-IP`.
- Browser-controlled `X-Forwarded-For` / `X-Real-IP` / `Forwarded` /
  `CF-Connecting-IP` / `True-Client-IP` are never trusted.

The HMAC uses `AUTH_SECRET`, with a process-random local fallback. Buckets are
pruned after one hour.

The process-local layer is intentionally single-instance only. It is not a
distributed rate limiter and Stage 3.13C-P does not add Redis or infrastructure.
Durable per-account checks continue to work across instances; unknown-address
and per-IP limits remain process-local residual risk.

## Suppression

Suppression is checked in `enqueueEmail` and again after worker claim.
`HARD_BOUNCE`, `COMPLAINT`, `MANUAL`, and applicable temporary safety
suppressions block SECURITY messages. Product/marketing `UNSUBSCRIBE` does not
block SECURITY or ordinary transactional mail. A suppressed reset message
never reaches the provider, while the public request response remains generic.

## Pending approval

After a pending registration commits, the application selects database users
whose `globalRole` is `ADMIN` and whose status is `ACTIVE`. It enqueues one
`ADMIN_PENDING_APPROVAL` per recipient with idempotency
`admin-pending-approval:<new-user-id>:<admin-id>`. Enqueue failures are isolated
from registration and recorded without recipient or applicant details.

## Local preview boundary

The recent-message preview is available only when all conditions hold:

- `NODE_ENV` is not `production`;
- `EMAIL_PROVIDER=fake`;
- `EMAIL_LOCAL_PREVIEW_ENABLED=true`;
- canonical email origin is exactly `https://local.negotaitions.ru`;
- requester is an authenticated ACTIVE administrator.

Unavailable configurations return 404 before authentication. List results are
limited to 20 allowlisted Stage 3.13C message types, mask recipients, and omit
bodies. A same-origin POST with a listed message id is required to reveal
rendered content. Responses use `Cache-Control: no-store`.

After Stage 3.13C acceptance the local flags remain `false`. The permanent
Admin → Email journal replaces day-to-day operational inspection.

## Permanent Admin → Email journal

Route: `/admin/email` (RU nav label «Почта», EN «Email»).

Authorization: authenticated ACTIVE `ADMIN` only (`requireActiveAdminUser` /
`apiRequireActiveAdminUser`).

Data source: durable `EmailMessage` + `EmailDeliveryAttempt` rows. No parallel
history store. Provider-event statuses such as `DELIVERED` / `BOUNCED` /
`COMPLAINED` are reserved for future ingestion and are not fabricated.

List responses mask recipients, omit bodies, and never expose reset tokens or
raw provider payloads. Content reveal is a separate same-origin ACTIVE-admin
POST that writes `AdminActionLog` action `EMAIL_CONTENT_REVEALED` without body,
recipient, or token metadata. Password-reset retained content redacts token
query values before display.
