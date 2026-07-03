# Duel Flow UX Improvements Audit

## 1) Current facilitator role resolution paths

- Session creation (`app/actions/sessions.ts`) sets `Session.facilitatorId` and creates one `SessionParticipant` as `FACILITATOR`.
- Account room entry (`lib/room-participant-resolver.ts`) resolves/creates the caller participant row.
- Room auth/control/sidebar (`app/api/sessions/[sessionId]/voximplant/access/route.ts`, `app/api/sessions/[sessionId]/control-state/route.ts`, `app/api/sessions/[sessionId]/control/route.ts`, `app/api/livekit/sidebar/route.ts`) depend on resolved participant type.
- Sidebar roster projection is built in `lib/room-sidebar.ts`.

## 2) Where admin currently becomes facilitator

- Main problematic path was in `ensureAccountRoomParticipant()` (`lib/room-participant-resolver.ts`): `adminUser` previously implied `shouldEnterAsFacilitator`.
- This allowed admin joins to auto-create `FACILITATOR` rows in standalone sessions owned by another user.

## 3) Proposed safe facilitator invariant

- Canonical facilitator is resolved from explicit session owner (`Session.facilitatorId`) and existing participant rows.
- Duplicate `FACILITATOR` rows are treated as observers unless they are canonical.
- Admin does not auto-upgrade to facilitator in standalone sessions owned by someone else.
- Event-created assignments remain explicit and unchanged.

Implemented helper:
- `lib/session-facilitator.ts`:
  - `resolveCanonicalFacilitatorParticipantId(...)`
  - `resolveSessionParticipantType(...)`

## 4) Current session management page block order (before fixes)

Before:
1. Session details
2. Negotiation settings
3. Post-session processing
4. Session link
5. Add participant
6. Role management
7. Participants

Targeted UX reorder applied in `components/session-detail-view.tsx` to:
1. Session details (now includes session link)
2. Negotiation settings
3. Add participant
4. Role management
5. Participants
6. Post-session processing

## 5) Current lobby/session media indicator components

- Session room Vox tiles: `components/voximplant-video-layout.tsx`.
- Event lobby Vox tiles: `components/event-lobby-voximplant-room.tsx`.
- Shared tile extracted to `components/voximplant-participant-tile.tsx` to align border/mic-badge visual conventions.

## 6) Current top navigation structure

- Main header nav: `components/app-header-nav.tsx`.
- Old layout had flat links.
- Updated to grouped visual sections:
  - Negotiation trainings (cases/events/sessions)
  - Administration (diagnostics/users/counters/log)

## 7) Current admin diagnostics/env display structure

- Data source: `app/api/admin/health/route.ts` + `lib/services/admin-health.ts`.
- Previous UI mostly showed configured/missing booleans.
- Added grouped env display model:
  - `lib/services/admin-env-display.ts`
  - grouped env categories with masked secret values and full non-secret values.

## 8) Current disclaimer/legal text locations

Updated user-visible legal/disclaimer pages:
- `app/ai-processing-notice/page.tsx`
- `app/data-processing-consent/page.tsx`
- `app/privacy/page.tsx`
- plus registration consent copy in i18n:
  - `lib/i18n/dictionaries/en.ts`
  - `lib/i18n/dictionaries/ru.ts`

## 9) Current admin service checks/counters/log pages

- Diagnostics page: `app/(app)/admin/page.tsx` (`AdminDiagnosticsView`).
- Added dedicated admin pages:
  - `app/(app)/admin/counters/page.tsx`
  - `app/(app)/admin/log/page.tsx`
- Added service check endpoint:
  - `app/api/admin/check-voximplant/route.ts`
- Usage summary source remains `lib/services/usage-counters.ts` (with explicit not-available fallback for currently untracked provider counters).

## 10) Minimal fix plan and risk assessment

### Plan applied

1. Add canonical facilitator resolver helper.
2. Remove admin->facilitator fallback for standalone room entry.
3. Normalize effective facilitator type across participant resolution/sidebar/voximplant access.
4. Reorder session detail blocks and compact session-link area.
5. Align lobby tile visuals and mic-state rendering with session room tile conventions.
6. Group top nav and admin sections.
7. Add grouped admin env diagnostics with masking.
8. Update RF storage/processing disclaimer text RU/EN.
9. Add collapsible panels in lobby/admin diagnostics and add Voximplant service check.
10. Add regression tests for facilitator/media/admin-env masking behavior.

### Risk assessment

- **Facilitator/session ownership risk:** medium. Mitigated via centralized helper and focused changes in room resolution + sidebar payload.
- **Lobby media rendering risk:** low/medium. Visual-only and state-label alignment; no Vox lifecycle rewrite.
- **Admin diagnostics risk:** low. Read-only display + config-level check; no destructive APIs.
- **Event flow regression risk:** low. Event assignment logic not rewritten; regression test added.
- **Protected areas untouched:** Prisma schema/migrations, Vox scenario/rule contracts, recording webhook contract, recording dispatch contract, Yandex generation/transcription internals.
