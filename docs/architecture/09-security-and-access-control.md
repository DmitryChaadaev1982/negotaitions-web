# 09 Security And Access Control

## Access Foundations

- Account auth uses custom cookie session (`auth_session`) and `UserSession`.
- Route/API guards use `requireActiveUser`, `apiRequireActiveUser`, and role checks.
- Session/event runtime authorization resolves participant access by account or token-based paths where supported.

## Role-Based Controls

- Facilitator-only operations include negotiation control, recording control, transcription start, AI analysis run/share.
- Participant and observer views are constrained through serializer and response shaping.
- Admin diagnostics are separated from standard user surfaces.
- Event lobby remote media controls are owner-only and are authorized server-side
  with `resolveEventAccess(...).isEventOwner`. A participant/observer/facilitator
  who is not the Event owner can control only their own local media.
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
  user. Success updates the bcrypt hash, consumes the token, revokes siblings,
  deletes all account `UserSession` rows, and queues a security alert in one
  transaction.
- The reset page uses a no-referrer policy. Local message preview is
  development-only, fake-provider-only, exact-local-origin-only, and
  ACTIVE-admin-only.

See `account-security-email-flows.md` for the complete status, rate-limit,
suppression, notification, and local-preview contracts.

## Same-Login Lease Enforcement

- Session room and event lobby enforce a single active connection per `(session|event, user)` lease key when `connectionId` is provided.
- Lease claim/check is applied on control-state/sidebar/state polling and write paths (control/host/participant/heartbeat/media-status).
- Session Vox access also validates lease on `connectionId` and returns `409 STALE_CONNECTION` for superseded clients, preventing stale tabs from obtaining fresh Vox credentials.

## Security-Sensitive Areas

- Recording webhook signature validation.
- Storage key and download URL handling.
- Analysis visibility and private role data serialization.
- Session/event ownership and visibility filters.
- Password reset anti-enumeration, token lifecycle, and auth-session revocation.
- Trusted-proxy client IP identity for process-local password-reset limits.
- Login/logout Server Actions allow only the reviewed public/local origins in
  `next.config.ts` so Next's forwarded-host CSRF protection remains enabled
  behind nginx.
- Permanent Admin → Email journal authorization, masking, and audited reveal.
- Local fake-email preview authorization and production-denial guards.

## Source Notes

- `app/actions/events.ts`
- `app/actions/sessions.ts`
- `app/api/events/**`
- `app/api/sessions/**`
- `lib/auth/**`
- `lib/email/account-security.ts`
- `lib/email/local-preview.ts`
- `app/api/auth/forgot-password/route.ts`
- `app/api/admin/email-preview/route.ts`
- `docs/architecture/account-security-email-flows.md`
- `docs/audits/archive/old-root-reports/AUTH_ACCESS_AUDIT.md`
- `docs/audits/archive/old-root-reports/COOKIE_STORAGE_AUDIT.md`
