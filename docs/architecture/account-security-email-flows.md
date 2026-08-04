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
token. The raw token exists only while constructing the one-time reset URL and
in the retained rendered email body. It is never stored in the token row,
metadata, audit records, provider metadata, or logs.

Defaults:

- lifetime: 30 minutes;
- normalized-email cooldown: 60 seconds;
- account maximum: 5 requests per hour;
- maximum active tokens per user: 1.

Creating an ACTIVE-user token revokes previous unused tokens, creates the new
hash-only row, and enqueues `PASSWORD_RESET` in one serializable transaction.
The partial unique index on active tokens provides a second concurrency guard.

Reset hashes the submitted token before lookup. The row must be unexpired,
unused, unrevoked, and linked to a user that is still `ACTIVE`. A successful
transaction claims the token, updates the bcrypt password hash, revokes sibling
tokens, deletes every `UserSession` for the account, and enqueues exactly one
`PASSWORD_CHANGED`. Invalid, expired, reused, revoked, and newly inactive
accounts receive the same safe failure.

Authenticated password change uses the same bcrypt policy and transactional
`PASSWORD_CHANGED` notification. It revokes outstanding reset tokens and all
other account sessions while preserving the current authenticated session.
There is no administrator-initiated password-change path.

## Abuse controls

Durable token/outbox timestamps enforce per-account cooldown and hourly limits.
A process-local limiter also keeps one-hour SHA-256 normalized-email buckets
and HMAC-SHA-256 IP-fingerprint buckets. Raw IP addresses are not stored. The
HMAC uses `AUTH_SECRET`, with a process-random local fallback. Buckets are
pruned after one hour.

The process-local layer is intentionally single-instance only. It is not a
distributed rate limiter and Stage 3.13C does not add Redis or infrastructure.
Durable per-account checks continue to work across instances; unknown-address
and per-IP limits do not.

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

