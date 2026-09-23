# 09 Security And Access Control

## Access Foundations

- Account auth uses custom cookie session (`auth_session`) and `UserSession`.
- Admin is `User.globalRole === "ADMIN"` **or** email in `ADMIN_EMAILS`
  (`lib/auth/admin.ts` `isAdmin`). Legacy `User.role` is not authorization.
- Page guard `requireActiveUser` lets admins skip non-ACTIVE status redirects;
  `apiRequireActiveUser` returns 403 JSON for non-admin non-ACTIVE callers.
  `requireAdminUser` allows bootstrap-email admins who are not ACTIVE;
  `requireActiveAdminUser` / `apiRequireActiveAdminUser` require ACTIVE admin.
- Route/API guards use `requireActiveUser`, `apiRequireActiveUser`, and role checks.
- Session management pages use `requireActiveUser` plus
  `getCurrentUserSessionAccess` / `canManageSession`. The Session
  management presence stream
  (`GET /api/sessions/{sessionId}/presence/stream`) uses the same
  account-authenticated management contract (`apiRequireActiveUser` +
  `canManageSession`). It is not demo-user scoped (`demo@example.com`)
  and is not a generic “any authenticated user may stream any Session”
  route. Unauthenticated callers receive `401`; authenticated but
  unrelated callers receive `404` so Session existence stays hidden.
  Admin, Event host, Event facilitator, and Session facilitator follow
  `canManageSession` exactly.
- Post-session materials management (recording/transcript status,
  retranscription, enhancement, speaker mapping, manual attribution, and
  AI-analysis management) uses the same `canManageSession` contract through
  `authorizeSessionManagementAccess` / `authorizeSessionMaterialsAccess`.
  Owning a facilitator `SessionParticipant` row is not required. After
  `authorizeSessionMaterialsAccess` succeeds, `materials/status` must not
  return Forbidden merely because no facilitator `SessionParticipant`
  exists to project through. Participant membership may enrich the
  payload; it is not a second hidden gate for ADMIN. The
  management page may send another session's facilitator `participantId`;
  server-side cookie identity plus `canManageSession` is the authority.
  Ordinary Case owner, participant, or observer membership is not
  management authority. Session owner remains `Session.facilitatorId`.
  **Implementation:** `canManageSession` currently also returns true for a
  FACILITATOR `SessionParticipant` (account or join token) even when that
  identity is not `Session.facilitatorId`. Negotiation **control**
  additionally requires `participant.userId === session.facilitatorId`.
  That extra management grant is not a proven product requirement.
  See FIND-01. Manager-view materials projection currently loads the
  earliest FACILITATOR participant by `createdAt`; that row choice is
  also not a proven requirement. See FIND-02.
- Session/event runtime authorization resolves participant access by account or token-based paths where supported.
- New registration writes `UserConsent` records from
  `getCurrentLegalRelease()` (`TERMS_PRIVACY_ACK_V2`,
  `PERSONAL_DATA_PROCESSING_V2`, `TRAINING_SESSION_NOTICE_V2`, version
  `"2"`). Historical version `"1"` rows (`TERMS_PRIVACY_V1`,
  `MVP_DATA_LIMITATION_V1`, `EXTERNAL_INFRASTRUCTURE_V1`) are never
  rewritten. `consentType` is a free-form string; current identifiers did
  not require a schema migration. Existing authenticated users who lack
  the current release’s required records are redirected to `/legal-update`
  at authenticated user-entry navigation: the `app/(app)/` shell, after
  login, room layout, event lobby, authenticated event join, authenticated
  session join (before invite claim), and `/rejoin`. Public legal pages,
  `/support`, logout, anonymous token-based lobby, and provider
  callbacks/webhooks remain reachable without that gate. Invite tokens are
  never copied into the `/legal-update` URL; credential-bearing return
  paths fall back to `/dashboard`. The same sanitizer rejects those
  credentials as `returnTo` on public legal-document URLs; a token-bearing
  source falls back to `/dashboard` (app) or `/` (site) instead of
  embedding the secret.

## Role-Based Controls

- Facilitator-only operations include negotiation control, recording control, transcription start, AI analysis run/share.
- Account preference writes are self-only; `sessionSoundEnabled` is read/updated
  via authenticated current-user routes/actions without cross-user targeting.
- Participant and observer views are constrained through serializer and response shaping.
- Participant and Observer are distinct privacy projections: an Observer must
  not receive participant-private recommendations or facilitator-private
  analysis. Published AI delivery also requires a non-revoked server-side
  recipient grant bound to the current account/session membership and its
  stored maximum projection (`PARTICIPANT` or `OBSERVER`); current role or
  session-wide share flags never authorize Observer access. Eligibility for a
  grant is historical Session room-shell entry (`SessionRoomConnection`
  claim after authorized `/room` bootstrap), not active presence at Publish
  and not confirmed live media. Event Lobby presence does not qualify.
  First room entry while a publication is active materializes a current-epoch
  grant. The authoritative publication contract is in
  `08-ai-analysis-and-debrief.md`.
- AI Publish, Unshare, and late-entry grant materialization lock the canonical
  `AiAnalysis` row in serializable transactions and use one bounded retry for
  PostgreSQL serialization conflicts. This prevents a successful Unshare from
  leaving a concurrently-created, unseen active recipient grant.
- AI completion-time personal-feedback validation locks current
  `SessionParticipant` rows in stable primary-key order (`id ASC`). Multi-row
  participant role changes use the same order, preventing a cycle while
  preserving the short, run-token-fenced privacy transaction.
- Admin diagnostics are separated from standard user surfaces.
- Event lobby remote media controls are owner-only and are authorized server-side
  with `resolveEventAccess(...).isEventOwner`. A participant/observer/facilitator
  who is not the Event owner can control only their own local media.
- Late Observer Session membership is created only for authenticated Event
  members through `canCreateLateObserverParticipant`. That helper now follows
  `decideSessionRoomAccess` for `DEBRIEF_OPEN` (`ALLOW_DEBRIEF`) as well as
  active rooms (`ALLOW_ACTIVE_ROOM`). Direct `/room/[sessionId]` uses the same
  gate. Non-members, completed Events, deleted Sessions, and `CLOSED` rooms
  remain denied. Participant first-entry is not broadened. Room entry does not
  by itself grant a revoked AI publication.
- Remote media commands verify that the target belongs to the current Event and
  is actively in the Event lobby according to the server Event-state model.
  Generic online presence is not sufficient: targets in a Session, temporarily
  away, offline, invited-never-connected, or unknown-location states are rejected
  with a controlled non-actionable response.
- Pending Event lobby media commands are invalidated when the target leaves the
  lobby surface. Target clients can only acknowledge commands addressed to their
  own current Event participant, and command delivery is filtered to lobby
  presence.

## Tokenized Runtime Paths

- Event host/participant token paths remain in event lobby flows.
- Session join token remains in guest-compatible materials/join flows.
- Account mode paths avoid exposing join token where account identity is authoritative.
- Account password recovery uses a separate random one-time token. Only its
  SHA-256 hash is stored in `PasswordResetToken`; it is not a Session/Event join
  credential and cannot modify negotiation-domain access.

## Account recovery

- Forgot-password uses a generic public response for ACTIVE, BLOCKED, REJECTED,
  PENDING_APPROVAL, unknown, suppressed, and rate-limited valid addresses.
- Only ACTIVE users receive a reset token. BLOCKED and REJECTED users receive a
  bounded support-contact message without an internal status or rejection
  detail. Pending and unknown users receive no message.
- Reset requires an unexpired, unused, unrevoked token linked to a still-ACTIVE
  user. Success stores a new Argon2id password hash, consumes the token,
  revokes siblings, deletes all account `UserSession` rows, and queues a
  security alert in one transaction.
- Authenticated self-service password change verifies the current password,
  stores a new Argon2id hash, records the previous verifier in
  `PasswordHistory`, increments `credentialGeneration` once, revokes
  outstanding reset tokens, deletes other `UserSession` rows, keeps the
  current session, and queues `PASSWORD_CHANGED` in that same transaction.
  New passwords are 10 to 128 Unicode code points, with no composition rules.
  A whole-password common-password denylist rejects exact normalized matches.
  The new secret must differ from the current credential and the previous
  five retired secrets. Registration, authenticated self-change, and email
  reset show one checklist for those length bounds, confirmation match, the
  common-password rule, and the previous-password rule. Length and match
  update as the user types and count Unicode code points. The common-password
  and previous-password items stay unchecked until the server accepts the
  submitted password or rejects it as common or reused. The browser does not
  receive the denylist or password history. A rejection is a localized safe
  error with no history slot or hash detail. Existing bcrypt cost-10 and cost-12 hashes still
  verify at login; login does not apply the new-password policy. New hashes
  are Argon2id (`m=19456,t=4,p=1`, 32-byte tag, 16-byte salt, PHC `v=19`).
  After a successful session commit, an eligible bcrypt or non-target
  Argon2id verifier is replaced in place by a compare-and-set on the verified
  hash and `credentialGeneration`. That upgrade does not increment
  generation, revoke sessions, write history, or queue `PASSWORD_CHANGED`.
  A bcrypt candidate longer than 72 UTF-8 bytes is not upgraded, because
  bcrypt did not prove the suffix. Nullable `User.passwordChangeRequiredAt`
  is stored and not enforced. There is no administrator password reset.
  Administrator BLOCKED and REJECTED transitions do not delete `UserSession`
  rows. Those three behaviors are deferred, not current enforcement.

  Credential authorities stay separate. An authenticated session, proof of
  the current password, and a valid reset token do not substitute for one
  another. Facilitator or admin authorization does not become password-reset
  authority. Seed does not become either. The mutation owner is
  `lib/auth/credential-mutation.ts`. Policy, hashing, history, and session
  revocation owners are `lib/auth/password-policy.ts`,
  `lib/auth/password-policy-constants.ts`,
  `lib/auth/common-password-blocklist.ts`, `lib/auth/crypto.ts`,
  `lib/auth/password-rehash.ts`, `lib/auth/password-history.ts`, and
  `lib/auth/session-revocation.ts`.
- The reset page uses a no-referrer policy. Local message preview is
  development-only, fake-provider-only, exact-local-origin-only, and
  ACTIVE-admin-only.

See `account-security-email-flows.md` for the complete status, rate-limit,
suppression, notification, and local-preview contracts.

## Same-Login Lease Enforcement

- Session room and event lobby enforce a single active connection per `(session|event, user)` lease key when `connectionId` is provided.
- Lease claim/check is applied on control-state/sidebar/state polling and write paths (control/host/participant/heartbeat/media-status).
- Interactive session control mutations additionally require expected
  negotiation state plus expected narrow `controlToken`, so stale tabs cannot
  replay transitions after unrelated writes.
- Session `control` and `duration` mutations lock and revalidate the exact
  active facilitator lease in the same serializable transaction as the Session
  CAS. Takeover, disconnect, revocation, facilitator reassignment, and account
  deactivation therefore linearize before or after the mutation; serialization
  conflicts are retried against fresh authority.
- Facilitator reassignment updates canonical Session/participant authority and
  rebinds the roles on both users' still-active `SessionRoomConnection` leases
  in the same transaction. The promoted user's open lease becomes
  `FACILITATOR`; the demoted user's open lease receives its selected fallback
  role. Finalized or expired leases are not revived, and later claims continue
  to derive their role from the current `SessionParticipant`.
- Session Vox access also validates lease on `connectionId` and returns `409 STALE_CONNECTION` for superseded clients, preventing stale tabs from obtaining fresh Vox credentials.

## Security-Sensitive Areas

- Recording webhook signature validation.
- Storage key and download URL handling.
- Analysis visibility and private role data serialization.
- Session/event ownership and visibility filters.
- Password reset anti-enumeration, token lifecycle, and auth-session revocation.
- Trusted-proxy client IP identity for process-local password-reset limits.
- Login/logout Server Actions allow only `negotaitions.ru` in production.
  Development-only local origins are exact and bounded, and there is no
  production local-origin override, so Next's forwarded-host CSRF protection
  remains enabled behind nginx.
- Permanent Admin → Email journal authorization, masking, and audited reveal.
- Local fake-email preview authorization and production-denial guards.

## Automated PostgreSQL Test Topology

- Normal development uses `DATABASE_URL` on `localhost:5432/negotiations`.
- Automated PostgreSQL, provider-event advisory-lock, integration, and
  Playwright E2E tests use `E2E_DATABASE_URL` on
  `localhost:5433/negotiations_e2e`.
- Provider-event lock tests inject `DATABASE_URL=E2E_DATABASE_URL` only for the
  child process under test because production lock acquisition reads
  `DATABASE_URL`. The tests refuse the development database and use
  run-specific durable lease identifiers while exercising the production
  session advisory-lock key with separate PostgreSQL connections.

## Development seed

`prisma/seed.ts` (`npm run db:seed` and `npm run seed`) provisions the demo
facilitator and refreshes that user's demo cases. Its authority is initial
demo data.

- The seed guard authorizes the host, port, and database that `pg` would use.
  A query string or URL fragment is refused, because `pg` can replace the
  host and port from query parameters. Process environment mode and
  `E2E_ALLOW_REMOTE_DATABASE` are not inputs.
- A target is accepted only when it is a PostgreSQL URI on a local host
  (`localhost`, `127.0.0.1`, `::1`, or `0.0.0.0`) whose database name contains
  the disposable marker `e2e`, `test`, or `testing`, and neither the host nor
  the database name is production-like. Those marker and production patterns
  are the same rules as E2E target safety. Remote hosts are refused.
  Keyword/value DSNs and unparseable URLs are refused.
- The canonical development database name `negotiations` is refused, including
  preserved `localhost:5432/negotiations`.
- A new demo user is checked with `assertNewPasswordPolicy` and stored with
  `hashPassword` (current Argon2id). An existing `demo@example.com` row keeps
  `passwordHash`, `credentialGeneration`, and the other account-security
  columns. The fixture password is `DEMO_SEED_PASSWORD` in
  `prisma/seed-demo.ts`. Seed logs the masked target and whether that user was
  created or already present. It does not log the fixture password, a
  verifier, or the connection string.

Tools that can mutate persistent state validate the target they will write.
`NODE_ENV` is not that authorization. This seed guard is the current
example. Other scripts are not required to copy
`lib/db/seed-target-safety.ts`.

## Source Notes

- `app/actions/events.ts`
- `app/actions/sessions.ts`
- `app/api/events/**`
- `app/api/sessions/**`
- `lib/auth/**`
- `lib/consent/user-consent.ts`
- `lib/legal/release.ts`
- `lib/legal/status.ts`
- `lib/legal/accept-release.ts`
- `lib/legal/require-current-release.ts`
- `lib/legal/legal-update-return-url.ts`
- `lib/legal/legal-document-return.ts`
- `lib/legal/legal-update-draft.ts`
- `lib/access-control.ts` (`canManageSession`, `getCurrentUserSessionAccess`)
- `lib/session-management-auth.ts`
- `lib/auth/admin.ts`
- `lib/auth/session.ts`
- `components/legal-document-header.tsx`
- `app/(app)/layout.tsx`
- `app/room/layout.tsx`
- `app/legal-update/page.tsx`
- `app/actions/legal-release.ts`
- `docs/operations/personal-data-erasure-runbook.md`
- `lib/email/account-security.ts`
- `lib/email/local-preview.ts`
- `app/api/auth/forgot-password/route.ts`
- `app/api/admin/email-preview/route.ts`
- `docs/architecture/account-security-email-flows.md`
- `prisma/seed.ts`
- `prisma/seed-demo.ts`
- `lib/db/seed-target-safety.ts`

Historical auth/cookie audits live under `docs/history/` and are not
current-state authority.
