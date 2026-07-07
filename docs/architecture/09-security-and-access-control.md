# 09 Security And Access Control

## Access Foundations

- Account auth uses custom cookie session (`auth_session`) and `UserSession`.
- Route/API guards use `requireActiveUser`, `apiRequireActiveUser`, and role checks.
- Session/event runtime authorization resolves participant access by account or token-based paths where supported.

## Role-Based Controls

- Facilitator-only operations include negotiation control, recording control, transcription start, AI analysis run/share.
- Participant and observer views are constrained through serializer and response shaping.
- Admin diagnostics are separated from standard user surfaces.

## Tokenized Runtime Paths

- Event host/participant token paths remain in event lobby flows.
- Session join token remains in guest-compatible materials/join flows.
- Account mode paths avoid exposing join token where account identity is authoritative.

## Security-Sensitive Areas

- Recording webhook signature validation.
- Storage key and download URL handling.
- Analysis visibility and private role data serialization.
- Session/event ownership and visibility filters.

## Source Notes

- `app/actions/events.ts`
- `app/actions/sessions.ts`
- `app/api/events/**`
- `app/api/sessions/**`
- `lib/auth/**`
- `docs/audits/archive/old-root-reports/AUTH_ACCESS_AUDIT.md`
- `docs/audits/archive/old-root-reports/COOKIE_STORAGE_AUDIT.md`
