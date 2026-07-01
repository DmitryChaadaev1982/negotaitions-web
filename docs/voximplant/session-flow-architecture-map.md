# Session/Event/Lobby Architecture Map (Stage 5.5A)

Scope: read-only architecture discovery for `exp/yandex-voximplant-main-room` vs baseline `exp/yandex-ai-local` (`31c4fe3`).

Constraints honored:
- No runtime fixes implemented.
- No Prisma schema/migration changes.
- No changes to recording-control routes.
- No changes to Yandex SpeechKit / AI pipeline.
- No debug panel removal.

## 1) High-level architecture overview

The product flow is split into three connected layers:

1. **Session/event domain layer (shared legacy core, still source of truth):**
   - Prisma models in `prisma/schema.prisma` hold state for sessions, participants, roles, events, and recording metadata.
   - Session state/timer transitions are in `lib/negotiation-control.ts`.
   - Event-to-session assignment is in `lib/create-event-session.ts` and `lib/event-state.ts`.
   - Role/sidebar materialization is in `lib/room-sidebar.ts`.

2. **Room orchestration/UI layer (provider-agnostic shell + provider adapters):**
   - `components/shared-room-shell.tsx` owns common room UX (state display, facilitator controls, sidebar, recording indicator, close overlay).
   - LiveKit adapter: `components/video-room-page.tsx`.
   - Voximplant adapter: `components/voximplant-negotiation-room-page.tsx` + `lib/voximplant/use-voximplant-room.ts`.

3. **Provider-specific transport/media layer (partially migrated):**
   - Main room can run Voximplant via `app/room/[sessionId]/page.tsx` + `getVideoProvider()`.
   - Event lobby video remains LiveKit (`components/event-lobby-video-room.tsx`, `app/api/events/[id]/livekit-token/route.ts`) in both current and baseline.
   - Recording control diverges by provider; Voximplant path is relayed through client conference messages, while LiveKit path is backend egress.

Net state: **core domain and control logic is mostly shared with baseline; media/provider integration is mixed (Voximplant in room, LiveKit in lobby).**

## 2) Current route map (`exp/yandex-voximplant-main-room`)

### Core user pages (flow-relevant)

- `app/(app)/events/new/page.tsx` - create event
- `app/(app)/events/[id]/edit/page.tsx` - edit event
- `app/events/join/[publicJoinCode]/page.tsx` - public event code entry
- `app/events/[id]/join/page.tsx` - event join page
- `app/events/[id]/lobby/page.tsx` - event lobby
- `app/(app)/sessions/new/page.tsx` - create standalone session
- `app/join/[joinToken]/page.tsx` - join-token entry -> binds to account path
- `app/room/[sessionId]/page.tsx` - room entry, provider switch (LiveKit or Voximplant)
- `app/(app)/sessions/[id]/materials/page.tsx` - materials/status polling page

### Core APIs (flow-relevant)

- Session control/state/timer:
  - `app/api/sessions/[sessionId]/control/route.ts`
  - `app/api/sessions/[sessionId]/control-state/route.ts`
  - `app/api/sessions/[sessionId]/duration/route.ts`
- Recording:
  - `app/api/sessions/[sessionId]/recording-control/route.ts`
  - `app/api/sessions/[sessionId]/recording/route.ts`
  - `app/api/sessions/[sessionId]/refresh-recording/route.ts`
  - `app/api/sessions/[sessionId]/recording/refresh-status/route.ts`
  - `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`
- Voximplant access:
  - `app/api/sessions/[sessionId]/voximplant/access/route.ts`
- Event/lobby:
  - `app/api/events/[id]/state/route.ts`
  - `app/api/events/[id]/participant/route.ts`
  - `app/api/events/[id]/host/route.ts`
  - `app/api/events/[id]/livekit-token/route.ts`
  - `app/api/events/[id]/heartbeat/route.ts`
  - `app/api/events/[id]/presence/heartbeat/route.ts`
  - `app/api/events/[id]/presence/leave/route.ts`
  - `app/api/events/[id]/complete/route.ts`
- Materials/status:
  - `app/api/sessions/[sessionId]/materials/status/route.ts`
  - `app/api/sessions/[sessionId]/materials/transcribe/route.ts`
  - `app/api/sessions/[sessionId]/materials/retranscribe/route.ts`
  - `app/api/sessions/[sessionId]/materials/enhance-transcript/route.ts`
  - `app/api/sessions/[sessionId]/analyze/route.ts`

## 3) Old baseline route map (`exp/yandex-ai-local @ 31c4fe3`)

### Core user pages (flow-relevant)

Same event/session/join/lobby/materials pages as current, **except no Voximplant-specific pages**.

- `app/room/[sessionId]/page.tsx` renders LiveKit room path only.

### Core APIs (flow-relevant)

Most session/event/materials routes match current, **except Voximplant-specific endpoints are absent**:

- Not present in baseline:
  - `app/api/sessions/[sessionId]/voximplant/access/route.ts`
  - `app/api/sessions/[sessionId]/voximplant/recording-status/route.ts`
  - `app/api/debug/recording/[sessionId]/route.ts`
  - `app/(app)/admin/voximplant-recording/page.tsx`
  - `app/voximplant-test/page.tsx` and related `app/api/voximplant-test/**`

Lobby remains LiveKit in baseline and remains LiveKit in current.

## 4) Session lifecycle diagram (Mermaid)

```mermaid
flowchart TD
  A[Session created<br/>status=DRAFT] --> B[Participant access<br/>joinToken/account bind]
  B --> C[Room load<br/>app/room/[sessionId]]
  C --> D[Control state poll<br/>GET control-state]
  D --> E[PREPARATION]
  E --> F[PREPARATION_RUNNING]
  F --> G[PREPARATION_PAUSED]
  G --> F
  F --> H[READY_TO_START]
  E --> H
  H --> I[RUNNING]
  I --> J[PAUSED]
  J --> I
  I --> K[FINISHED]
  F --> K
  G --> K
  H --> K

  D --> L[Auto-finish checks in control-state route]
  L --> H
  L --> K
```

## 5) Event/Lobby/Join lifecycle diagram (Mermaid)

```mermaid
flowchart TD
  A[Create event<br/>actions/events.createTrainingEvent] --> B[Event status LOBBY_OPEN]
  B --> C[Public join code<br/>events/join/[publicJoinCode]]
  C --> D[Event join page<br/>events/[id]/join]
  D --> E[joinTrainingEvent -> EventParticipant]
  E --> F[Event lobby<br/>events/[id]/lobby]
  F --> G[Event state polling<br/>GET events/[id]/state]
  F --> H[Lobby media token<br/>GET events/[id]/livekit-token]
  H --> I[EventLobbyVideoRoom<br/>LiveKit]
  F --> J[Host controls panel]
  J --> K[Host API events/[id]/host]
  K --> L[createSessionFromEvent]
  L --> M[Session + SessionParticipants + role assignments]
  M --> N[Participant gets roomUrl/materialsUrl]
  N --> O[Room entry<br/>room/[sessionId]]
```

## 6) Recording lifecycle diagram (Mermaid)

**Status: WORKING - do not change without reason.**

```mermaid
flowchart TD
  A[Facilitator START/FINISH in FacilitatorRoomControls] --> B[POST sessions/[id]/control]
  B --> C{Provider}
  C -->|LiveKit path| D[Server egress helpers<br/>start/finish recording]
  C -->|Voximplant path| E[Shared shell callback<br/>onNegotiationStarted/Finished]
  E --> F[Voximplant page relayVoximplantRecording]
  F --> G[POST sessions/[id]/recording-control]
  G --> H[Client sendConferenceMessage scenarioMessage]
  H --> I[VoxEngine scenario]
  I --> J[Webhook/status refresh -> Recording row updates]
  D --> J
```

## 7) Important files table

| File path | Current/Baseline | Purpose | Key exports/components | Risk level |
|---|---|---|---|---|
| `prisma/schema.prisma` | Both | Canonical data model for sessions/events/participants/recordings | `Session`, `SessionParticipant`, `SessionRole`, `TrainingEvent`, `EventParticipant`, `Recording` | High |
| `app/room/[sessionId]/page.tsx` | Both (branched behavior in current) | Room entry, auth and provider routing | `RoomPage` (default export) | High |
| `components/shared-room-shell.tsx` | Both | Provider-agnostic room UX/control shell | `SharedRoomShell` | High |
| `components/facilitator-room-controls.tsx` | Both | Facilitator actions and consent-gated START | `FacilitatorRoomControls` | High |
| `lib/negotiation-control.ts` | Both | State machine, transition/update data, timer math | `buildControlState`, `getControlUpdateData`, `computeRemainingSeconds`, `computePreparationRemainingSeconds` | High |
| `app/api/sessions/[sessionId]/control/route.ts` | Both | Apply facilitator actions to session state | `POST` | High |
| `app/api/sessions/[sessionId]/control-state/route.ts` | Both | Pollable control snapshot + auto-finish checks | `GET` | High |
| `app/api/sessions/[sessionId]/duration/route.ts` | Both | Update prep/negotiation durations | `PATCH` | Medium |
| `components/video-room-page.tsx` | Both | LiveKit adapter to shared shell | `VideoRoomPage` | High |
| `components/structured-video-layout.tsx` | Both | Baseline room tile layout for LiveKit | `StructuredVideoLayout` | Medium |
| `components/voximplant-negotiation-room-page.tsx` | Current only | Voximplant adapter and recording relay callbacks | `VoximplantNegotiationRoomPage`, `relayVoximplantRecording` (internal callback) | High |
| `lib/voximplant/use-voximplant-room.ts` | Current only | Voximplant SDK/connect/media/message abstraction | `useVoximplantRoom` | High |
| `components/voximplant-video-layout.tsx` | Current only | Voximplant tile rendering and identity labeling | `VoximplantVideoLayout` | High |
| `app/api/sessions/[sessionId]/voximplant/access/route.ts` | Current only | Voximplant access provisioning/identity mapping | `POST` | High |
| `app/api/sessions/[sessionId]/recording-control/route.ts` | Both (provider-specific branches in current) | Recording control dispatch by provider | `POST` | High |
| `components/event-lobby-view.tsx` | Both | Lobby state polling + token refresh + host controls | `EventLobbyView` | High |
| `components/event-lobby-video-room.tsx` | Both | Lobby media room (still LiveKit) | `EventLobbyVideoRoom` | High |
| `components/event-host-controls-panel.tsx` | Both | Event host case/assignment/session creation actions | `EventHostControlsPanel` | High |
| `lib/create-event-session.ts` | Both | Event assignment draft -> session/participant records | `createSessionFromEvent` | High |
| `lib/event-state.ts` | Both | Build lobby state payload from DB | `buildEventStateResponse` | High |
| `app/actions/events.ts` | Both | Event create/update/join/complete actions | `createTrainingEvent`, `updateTrainingEvent`, `joinTrainingEvent`, `completeTrainingEventFromList` | High |
| `app/actions/sessions.ts` | Both | Standalone session creation and participant management | `createSession` (+ participant/role helpers) | High |
| `lib/room-sidebar.ts` | Both | Role/briefing source for room sidebar display | `getRoomSidebarData`, `getRoomSidebarDataByParticipantId` | High |
| `components/session-materials-dashboard.tsx` | Both | Materials status polling, transcription/analysis UX | `SessionMaterialsDashboard` | Medium |
| `app/api/events/[id]/state/route.ts` | Both | Event lobby state API | `GET` | High |
| `app/api/events/[id]/host/route.ts` | Both | Host updates and session creation from lobby | `POST` | High |
| `tests/e2e/session-lifecycle.spec.ts` | Both | Session control/timer/recording/transcription flow validation | Playwright spec | Medium |
| `tests/e2e/event-flow.spec.ts` | Both | Event join/lobby/session linking validation | Playwright spec | Medium |
| `tests/e2e/phase-6-11b-session-role-assignment.spec.ts` | Both | Role assignment and access boundaries | Playwright spec | Medium |
| `tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts` | Both | Event->session regression coverage | Playwright spec | Medium |
| `tests/e2e/voximplant-recording-debug.spec.ts` | Current only | Voximplant recording debug endpoint behavior | Playwright spec | Low |

## Source of truth mapping (baseline and current continuity)

- **Where session status is stored:** `Session.status` + `Session.negotiationState` in Prisma (`prisma/schema.prisma`), transitions via `lib/negotiation-control.ts` and session control APIs.
- **Where negotiation start time is stored:** `Session.negotiationStartedAt` and `Session.timerStartedAt` (Prisma), set in `getStartNegotiationUpdateData()` from `lib/negotiation-control.ts`.
- **Where roles are assigned:** event-driven assignment in `lib/create-event-session.ts`; standalone/session management in session actions/API.
- **Where roles are displayed:** room sidebar projection in `lib/room-sidebar.ts`, rendered by `RoomSidebar` section inside `components/shared-room-shell.tsx`.
- **Where timer starts/stops:** timer fields and math in `lib/negotiation-control.ts`; periodic enforcement/auto-finish in `app/api/sessions/[sessionId]/control-state/route.ts`.
- **How facilitator controls are enabled:** `controlState.canControl` based on `ParticipantType.FACILITATOR` in `buildControlState()`, consumed in `SharedRoomShell` and `FacilitatorRoomControls`.
- **How participants move event/lobby -> room:** event join creates `EventParticipant`; host creates session from assignment; `EventStateResponse` carries `roomUrl`/`materialsUrl`; user navigates into `/room/[sessionId]`.
- **How old LiveKit room layout worked:** `VideoRoomPage` + `StructuredVideoLayout` + LiveKit components.
- **How old e2e tests verified flow:** Playwright specs under `tests/e2e` covering session lifecycle, event lifecycle, role/access regressions, privacy/security, materials/transcription.

## 8) Unknowns / ambiguous points

1. **Provider split by surface remains intentional or transitional?**
   - Main room can be Voximplant, but event lobby media still depends on LiveKit.

2. **Role label mapping parity in Voximplant tiles is incomplete.**
   - `components/voximplant-video-layout.tsx` contains TODO-level identity/role mapping concerns that can explain strange role display.

3. **Timer UX issue appears not purely backend.**
   - Timer state math exists in `lib/negotiation-control.ts`; likely drift is in client polling/render cadence or provider adapter integration.

4. **Facilitator control completeness likely adapter-layer dependent.**
   - Control-state API and action matrix are complete; perceived incompleteness may be from provider-specific slot wiring and conditional UI branches.

5. **Baseline path mismatch in initial task input.**
   - Analysis used the available baseline worktree at `31c4fe3`; confirm if there is any other baseline copy with local deltas.

## 9) Recommended next audit step

Run a focused **“UI parity diff audit”** on room and lobby surfaces only (no backend schema or recording changes):

1. Compare `VideoRoomPage`+`StructuredVideoLayout` behavior vs `VoximplantNegotiationRoomPage`+`VoximplantVideoLayout` for:
   - timer visibility/update cadence,
   - role badge/name rendering,
   - facilitator action affordances.
2. Trace state propagation path end-to-end:
   - `control-state` payload -> provider adapter state -> shared shell display.
3. For lobby migration planning:
   - decide whether to keep lobby on LiveKit short-term (explicitly documented mixed-provider architecture) or design a full Voximplant lobby adapter path.

---

## Files inspected (representative)

Current branch (`negotiations-web-yandex-ai`):
- `app/room/[sessionId]/page.tsx`
- `components/shared-room-shell.tsx`
- `components/video-room-page.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `components/voximplant-video-layout.tsx`
- `components/facilitator-room-controls.tsx`
- `components/event-lobby-view.tsx`
- `components/event-lobby-video-room.tsx`
- `components/event-host-controls-panel.tsx`
- `components/session-materials-dashboard.tsx`
- `lib/negotiation-control.ts`
- `lib/room-sidebar.ts`
- `lib/create-event-session.ts`
- `lib/event-state.ts`
- `app/actions/events.ts`
- `app/actions/sessions.ts`
- `app/api/sessions/[sessionId]/control/route.ts`
- `app/api/sessions/[sessionId]/control-state/route.ts`
- `app/api/sessions/[sessionId]/duration/route.ts`
- `app/api/sessions/[sessionId]/recording-control/route.ts`
- `app/api/sessions/[sessionId]/voximplant/access/route.ts`
- `app/api/events/[id]/state/route.ts`
- `app/api/events/[id]/host/route.ts`
- `app/api/events/[id]/livekit-token/route.ts`
- `app/api/sessions/[sessionId]/materials/status/route.ts`
- `prisma/schema.prisma`
- `tests/e2e/event-flow.spec.ts`
- `tests/e2e/session-lifecycle.spec.ts`
- `tests/e2e/phase-6-11b-session-role-assignment.spec.ts`
- `tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts`
- `tests/e2e/current-product-workflow.spec.ts`
- `tests/e2e/voximplant-recording-debug.spec.ts`

Baseline comparison (`negotiations-web-yandex-baseline-audit`, commit `31c4fe3`):
- Matching room/session/event/lobby/materials/API/e2e files above, with emphasis on:
  - `app/room/[sessionId]/page.tsx`
  - `components/video-room-page.tsx`
  - `components/event-lobby-video-room.tsx`
  - `app/api/sessions/[sessionId]/control/route.ts`
  - `app/api/sessions/[sessionId]/control-state/route.ts`
  - `app/api/sessions/[sessionId]/recording-control/route.ts`
  - same e2e coverage suite (without Voximplant debug spec).
