# Stage 2 Design: Event/Lobby Vox Parity and Full Demo Flow

## 1. Current event lobby architecture

- `app/events/[id]/lobby/page.tsx` renders `EventLobbyView` after access checks.
- `components/event-lobby-view.tsx` bootstraps lobby state and media:
  - polls `/api/events/[id]/state`;
  - requests `/api/events/[id]/livekit-token`;
  - renders `EventLobbyVideoRoom` (LiveKit-only).
- `components/event-host-controls-panel.tsx` manages selected case, role assignments, and session creation through `/api/events/[id]/host`.
- Domain state is provided by `lib/event-state.ts` and consumed by lobby/session cards.

## 2. Current LiveKit dependency points

- `components/event-lobby-view.tsx` unconditionally calls `/api/events/[id]/livekit-token`.
- `components/event-lobby-view.tsx` unconditionally renders `EventLobbyVideoRoom`.
- `components/event-lobby-video-room.tsx` is LiveKit SDK-specific.
- `app/api/events/[id]/livekit-token/route.ts` is the only media access route for lobby.

## 3. Proposed Vox lobby provider architecture

- Introduce provider branching in lobby page/view:
  - `VIDEO_PROVIDER=voximplant` -> Vox lobby media path;
  - `VIDEO_PROVIDER=livekit` -> existing LiveKit lobby path (legacy fallback).
- Add a new provider endpoint:
  - `app/api/events/[id]/voximplant-access/route.ts`.
- Add a new Vox lobby media component:
  - `components/event-lobby-voximplant-room.tsx`.
- Keep event state, session creation, and assignment contracts provider-agnostic.

## 4. Event lobby identity model

- Authoritative identity in account mode remains `(eventId, userId)` -> single `EventParticipant`.
- `ensureUserEventParticipant` remains the resolver for authenticated users.
- Token-based event access remains supported as legacy compatibility, but account mode is target path.
- Lobby media identities are transport-specific and derived from resolved domain participant:
  - LiveKit identity: event participant id (legacy);
  - Vox identity: `VideoProviderIdentity.providerUsername` via existing Vox identity system.

## 5. Lobby duplicate/rejoin policy

- Add lobby connection lease semantics aligned with room policy:
  - key: `(eventId, userId)`;
  - newest `connectionId` becomes active;
  - stale connection receives `409` + `code: "STALE_CONNECTION"`.
- Apply to lobby state and host/participant mutation routes when `connectionId` is provided.
- UI behavior in stale tab:
  - show stale banner/read-only state;
  - stop media bootstrap retries;
  - prevent host/participant mutations from stale tab.

## 6. Vox access/context endpoint design

- New route: `POST /api/events/[id]/voximplant-access`.
- Request payload (additive):
  - optional `hostToken`, `participantToken` (legacy token mode);
  - optional `connectionId`, `claimLease`.
  - optional `oneTimeKey` for second-step handoff.
- Response mirrors session Vox handshake shape:
  - provider metadata;
  - conference name (event lobby room name);
  - user identity;
  - one-time-key credentials or one-time-key-required status.
- Route responsibilities:
  - resolve event access;
  - resolve authenticated participant identity;
  - enforce optional connection lease;
  - issue Vox browser credentials via existing identity/handoff helpers.

## 7. Event-state payload changes

- Keep existing event-state payload stable.
- No breaking changes to `EventStateResponse`.
- No schema/migration changes.
- Optional lease diagnostics are returned only on stale response paths (`409`) from API routes, not added to normal event-state payload.

## 8. Case selection and role assignment flow

- Keep existing host controls UX and API contract:
  - `PATCH /api/events/[id]/host` updates selected case + assignment draft;
  - `POST /api/events/[id]/host` creates session from draft.
- Preserve assignment visibility in participants list/session cards from `buildEventState`.
- Ensure stale host tabs cannot mutate assignments when lease validation fails.

## 9. Session creation from event flow

- Keep `createSessionFromEvent` and session linkage logic unchanged.
- Preserve role assignment mapping:
  - facilitator;
  - two participants (case roles);
  - observers.
- Preserve room/material URLs from existing account-mode session path.
- Keep event/session linkage and assignment pointers unchanged.

## 10. Lobby -> room transition

- From lobby assignment card/session cards:
  - users open `/room/[sessionId]` (account-mode URL).
- Room provider remains controlled by `VIDEO_PROVIDER`:
  - Vox path uses existing Stage 1 room implementation;
  - LiveKit remains fallback path.
- Ensure no LiveKit token dependency in Vox lobby target path.

## 11. Return-to-lobby flow

- Preserve/ensure event lobby navigation via existing room shell links:
  - header back-to-lobby button;
  - session-closed overlay return-to-lobby button.
- Keep `sidebar.event.lobbyUrl` usage intact.
- No new product flows beyond target demo path.

## 12. Materials navigation/status flow

- Keep current materials navigation from lobby/session/room.
- Preserve existing transcript/transcription/AI status flow endpoints and contracts.
- If transcript quality improvement refresh issue is small/safe client state-only, apply minimal refresh fix; otherwise document as Stage 3 backlog.
- Do not modify Yandex SpeechKit/Yandex AI/DeepSeek internals.

## 13. Stage 1 layout debt fix plan (vertical blank space)

- Adjust room layout container sizing to reduce unnecessary vertical gaps between media area and bottom controls:
  - remove extra vertical spacing in main media wrapper;
  - ensure video layout uses available height tightly;
  - keep controls visually close to active video content.
- Maintain Stage 1 role-zoned layout:
  - observers row remains compact and top-positioned;
  - participant A/B and facilitator center remain intact;
  - responsiveness preserved.

## 14. Exact files to change

- `docs/voximplant/stage-2-event-lobby-vox-design.md` (new)
- `docs/voximplant/stage-2-event-lobby-vox-implementation-report.md` (new/update)
- `app/events/[id]/lobby/page.tsx`
- `components/event-lobby-view.tsx`
- `components/event-lobby-video-room.tsx` (legacy fallback only; minimal/no change expected)
- `components/event-lobby-voximplant-room.tsx` (new)
- `app/api/events/[id]/voximplant-access/route.ts` (new)
- `app/api/events/[id]/state/route.ts`
- `app/api/events/[id]/host/route.ts`
- `app/api/events/[id]/participant/route.ts`
- `app/api/events/[id]/livekit-token/route.ts`
- `lib/validations/event.ts`
- `lib/event-state.ts` (if additive shaping is needed)
- `lib/event-lobby-connection-lease.ts` (new)
- `components/voximplant-video-layout.tsx`
- `components/shared-room-shell.tsx` (only if needed for spacing fix)
- `tests/e2e/event-flow.spec.ts`
- `tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts`
- `tests/e2e/voximplant-event-lobby.spec.ts` (new)

## 15. Tests to add/update

- Provider path tests:
  - Vox mode lobby path does not require LiveKit token endpoint.
  - Vox access endpoint handshake works in account mode.
  - LiveKit lobby route remains isolated fallback.
- Join/account mode tests:
  - unauthenticated join redirects to login with returnUrl;
  - authenticated join is deterministic;
  - repeated join does not duplicate `EventParticipant`.
- Lobby role/session tests:
  - facilitator selects case and assigns roles/observers;
  - event state reflects assignments;
  - session creation preserves facilitator/participants/observers.
- Transition/navigation tests:
  - assigned users get room URL and can enter room;
  - return to lobby navigation remains available.
- Materials access tests:
  - facilitator/participants access materials per existing policy;
  - observer policy unchanged.
- Stage 1 layout debt:
  - no excessive blank vertical gap between media and controls;
  - observers row compact in empty/one-observer states.

## 16. Manual user steps

1. Confirm `VIDEO_PROVIDER=voximplant`.
2. In PowerShell, set `DATABASE_URL` before Playwright.
3. Ensure local Postgres is running.
4. Start dev server.
5. If webhook smoke is needed, run `cloudflared tunnel --url http://localhost:3000`.
6. Update admin recording webhook override if tunnel URL changed.
7. Open/create event as facilitator.
8. Join as 2 participants + 2 observers.
9. Verify Vox lobby opens (not LiveKit) in Vox mode.
10. Select case.
11. Assign participant A, participant B, facilitator, and observers.
12. Create/start session from event.
13. Enter Vox room.
14. Verify Stage 1 room layout still works.
15. Verify vertical blank space between media and controls is fixed.
16. Start preparation.
17. Start negotiation.
18. Pause.
19. Resume.
20. Finish.
21. Verify recording/transcription/materials flow remains reachable.
22. Return to event lobby.
