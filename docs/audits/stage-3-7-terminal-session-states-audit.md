# Stage 3.7 Terminal Session States Audit

## 1. Executive summary

- Current state: the product already has strong lifecycle primitives (`NegotiationState`, `SessionStatus`, `TrainingEventStatus`, close flags, soft-delete), role-aware materials visibility, and server-side transition guards in core control APIs.
- Main inconsistencies:
  - FINISHED is treated as closed for controls, but `/room/[sessionId]` remains enterable and keeps media connectivity in debrief mode.
  - Event-linked materials UI still uses legacy "closed" semantics and can show organizer-closed badge for ordinary FINISHED sessions.
  - Delete behavior is only "soft hide session" and does not define archive vs artifact retention semantics explicitly in product language.
  - Event lobby/session labels and action wording are mostly consistent but still contain "Создать ещё одну сессию" variant and mixed materials/open-room naming.
- Risk level: **medium** (primarily UX/semantic and safety-of-navigation risk, not immediate data-corruption risk).
- Recommended direction:
  - Treat FINISHED as terminal for **live room entry/media/control** and route users to materials/debrief entrypoints.
  - Keep post-processing on materials/debrief pages; remove ambiguous room re-entry after FINISHED.
  - Keep delete as soft-delete for draft/prep, introduce archive semantics for finished sessions, keep artifact deletion as explicit admin cleanup.

## 2. Current state model

### Session lifecycle fields

From `prisma/schema.prisma` and runtime usage:

- `Session.status` (`DRAFT`, `READY`, `COMPLETED`) - coarse lifecycle/status display support.
- `Session.negotiationState` (`PREPARATION`, `PREPARATION_RUNNING`, `PREPARATION_PAUSED`, `READY_TO_START`, `RUNNING`, `PAUSED`, `FINISHED`) - detailed room/control lifecycle.
- `Session.deletedAt` - soft-delete marker.
- `Session.closedByEventAt`, `Session.closedByEventId`, `Session.closeReason` - explicit organizer/event closure metadata.
- Time/timer fields (`preparation*`, `timerStartedAt`, `pausedAt`, `totalPausedSeconds`, `negotiationStartedAt`, `negotiationEndedAt`) drive deterministic transition math.

### Event lifecycle fields

- `TrainingEvent.status` (`DRAFT`, `LOBBY_OPEN`, `SESSION_CREATED`, `COMPLETED`, `CANCELLED`).
- `TrainingEvent.deletedAt` soft-delete (used for cancellation/unavailability).
- `TrainingEvent.completedAt`, `completedBy`, `completionReason`.
- `EventParticipant.assignedSessionId`, `assignedSessionParticipantId` point to current assignment records.

### Recording/transcript/materials states

- `Recording.status`: `NOT_STARTED`, `STARTING`, `RECORDING`, `PAUSED`, `PROCESSING`, `COMPLETED`, `FAILED`, `STOPPED`.
- `Transcript.status`: `QUEUED`, `DOWNLOADING_RECORDING`, `COMPRESSING_AUDIO`, `TRANSCRIBING`, `COMPLETED`, `FAILED`.
- `AiAnalysis.status`: `QUEUED`, `ANALYZING`, `COMPLETED`, `FAILED`.
- `materials/status` computes `processing.shouldPoll` from these stages plus role/session-finished/share conditions.

### Authoritative fields by concern

- Room lifecycle authority: **`Session.negotiationState` + close flags (`closedByEventAt`/`closeReason`)**, wrapped by `buildSessionCloseState()`.
- Recording/post-processing authority: **`Recording.status`, `Transcript.status`, `AiAnalysis.status`** (plus speaker-mapping readiness and sharing visibility).

### Allowed transitions

`lib/negotiation-control.ts` + `app/api/sessions/[sessionId]/control/route.ts`:

- `PREPARATION -> START_PREPARATION -> PREPARATION_RUNNING`
- `PREPARATION_RUNNING <-> PREPARATION_PAUSED`
- `PREPARATION* -> STOP_PREPARATION/SKIP_PREPARATION -> READY_TO_START`
- `PREPARATION or READY_TO_START -> START -> RUNNING`
- `RUNNING <-> PAUSED`
- `PREPARATION* | READY_TO_START | RUNNING | PAUSED -> FINISH -> FINISHED`
- Auto transitions:
  - preparation timeout -> `READY_TO_START`
  - negotiation timeout -> `FINISHED`

### Blocked transitions and server-side guard coverage

- Invalid control transitions are rejected server-side via `assertTransition()` in `getControlUpdateData()`.
- Non-facilitator control is rejected (`403`) in `control/route.ts`.
- Duration updates are blocked outside pre-start states (`duration/route.ts`).
- AI analysis start is blocked unless transcript is complete and speaker mapping is confirmed.
- **Gap class**: terminal-state intent is not consistently enforced for room media entry/token issuance (`/api/livekit/token`, `/api/livekit/sidebar` do not deny FINISHED sessions).

## 3. Current workflows by route

### 3.1 Standalone session list (`/sessions`)

- Data source: `getSessionsForUser()` with `activeSessionWhere` (`deletedAt: null`).
- Row actions (`components/sessions-list-view.tsx`):
  - `Open room` shown when `session.status !== "FINISHED"`.
  - `Open materials` always shown.
  - Managers also get `Manage` + `Delete`.
- Session title link:
  - managers -> `/sessions/[id]`
  - non-managers -> `/room/[id]`
- Effect: finished sessions still navigable to materials and detail, not to room from list action.

### 3.2 Standalone session detail (`/sessions/[id]`)

- Access: manager-only.
- `Join video room` appears only when `isSessionActiveForRoom(...)` and facilitator participant exists.
- For FINISHED/closed/deleted, room action disappears.
- Role management hidden after `PREPARATION` (`canManageRolesBeforePreparation`).
- Post-processing panel is available on detail page for facilitator context.
- Delete button present if not already soft-deleted.

### 3.3 Materials page (`/sessions/[id]/materials`)

- Access: account-authorized, tokenless URL; user-session relation checked in `getAccountMaterialsData`.
- Open room button behavior:
  - shown when `canReturnToRoom` from `isSessionActiveForRoom`.
  - hidden on FINISHED/closed/deleted.
- Status badges:
  - standalone path can show FINISHED badge.
  - event-linked path keeps legacy closed semantics (`closedByEventLegacy`) and may show organizer-closed badge for FINISHED.
- Processing and debrief are central entry points; `SessionPostProcessingPanel` available here.
- `materials/status`:
  - participant/observer on finished sessions continue polling until shared analysis is published.

### 3.4 Room page (`/room/[sessionId]`)

- Entry:
  - account mode tokenless route, participant resolved server-side.
  - joinToken mode validates token ownership then redirects to tokenless room.
- **FINISHED behavior now**:
  - no redirect to materials.
  - room shell enters debrief mode (`closeMessageKey === "join.sessionFinishedMessage"`).
  - facilitator controls hidden when closed.
  - materials nav button hidden in debrief mode.
  - media area and control bar remain rendered; provider connections still established.
- Event-completed closures show blocking overlay instead of debrief mode.

### 3.5 Event lobby (`/events/[id]/lobby`)

- State from `/api/events/[id]/state`.
- Session cards derive `isActive` via `isSessionActiveForAssignment`.
- Actions:
  - active session -> open room + open materials.
  - finished session -> room URL null, materials remains.
- Assigned participant card:
  - if assigned active session -> go to room + materials.
  - if assigned finished session -> materials only.
- Event completed status shows `EventCompletedOverlay` with materials-oriented actions.
- Host controls support multiple sessions, including completed/finished history.

### 3.6 Event join/rejoin (`/events/[id]/join`, `/join/[joinToken]`, `/rejoin`)

- `/events/[id]/join`: completed/cancelled events render unavailable page (cannot join).
- `/join/[joinToken]`: binds token to authenticated account, then redirects to `/sessions/[id]/materials`.
- `/rejoin` (authenticated):
  - priority: active rooms -> active lobby -> latest finished materials.
- `/api/rejoin/validate` + `lib/rejoin/validate.ts`:
  - closed/finished session contexts return materials target.
  - unauthenticated callers get `loginRequired` fallback (no token-based runtime restore).

### 3.7 Delete/archive flows

- Session delete (`deleteSession`) = soft-delete (`deletedAt = now`), then revalidate/redirect.
- No cascade cleanup of recording/transcript/analysis artifacts.
- Event cancel (`cancelTrainingEvent`) = `status=CANCELLED` + `deletedAt=now`.
- Event complete (`completeTrainingEvent`) = `status=COMPLETED`; active linked sessions are forced to `FINISHED`, `closeReason=EVENT_COMPLETED`, `closedByEventAt` set, recording stop attempted.
- No explicit "archive session" primitive separate from delete/cancel/complete.

## 4. Current components and APIs

| Screen/API | File | State checks | Current behavior | Issues |
|---|---|---|---|---|
| Session delete action | `app/actions/sessions.ts` | manager access + active session filter | soft-delete only (`deletedAt`) | no product-level distinction draft-delete vs archive |
| Event cancel action | `app/actions/events.ts` | owner/admin/host token | sets `CANCELLED` + `deletedAt` | semantically closer to event hard close; no archive layer |
| Session control API | `app/api/sessions/[sessionId]/control/route.ts` | facilitator-only, transition assertions, close-state check | valid transitions enforced; finish/auto-finish handled | closed error code text is generic (`sessionClosedByEvent`) even for FINISHED path |
| Session control-state API | `app/api/sessions/[sessionId]/control-state/route.ts` | participant resolve + lease + auto transitions | returns close state and control state | still supports room polling after FINISHED |
| Room shell | `components/shared-room-shell.tsx` | `sessionCloseState` + `closeMessageKey` | FINISHED -> debrief mode in room; event close -> overlay | FINISHED still keeps live room/media frame active |
| LiveKit token API | `app/api/livekit/token/route.ts` | auth + ownership checks | issues token if participant valid | no explicit terminal-state block for FINISHED |
| LiveKit sidebar API | `app/api/livekit/sidebar/route.ts` | auth + ownership + lease | returns sidebar for room | no explicit terminal-state block for FINISHED |
| Session detail | `components/session-detail-view.tsx` | `isSessionActiveForRoom`, state flags | hide room button on FINISHED/closed/deleted | good guard; still separate from room-route hard block |
| Sessions list | `components/sessions-list-view.tsx` | `status !== FINISHED` for room action | hides room action for finished rows | relies on display status; semantic coupling to UI-only status |
| Materials UI resolver | `lib/session-materials-ui-state.ts` | event vs standalone branches | event sessions preserve legacy closed semantics | FINISHED event sessions can show organizer-closed badge |
| Event state mapper | `lib/event-state.ts` | `isSessionActiveForAssignment` | finished sessions get materials links, no roomUrl | consistent for cards; still label/action text drift |
| Event host controls | `components/event-host-controls-panel.tsx` | `session.isActive` | active: open room + finish early; finished: materials | create-session labels differ (`createAnotherSession`) |
| Rejoin targets | `lib/rejoin/account.ts` | finished/closed filters | active rooms prioritized; finished -> materials fallback | behavior is good; naming/routing policy still fragmented |

## 5. Problems found

### Terminal-state inconsistencies

1. FINISHED is treated terminal for controls but not for room entry/media session establishment.
   - `/room/[sessionId]` does not redirect away after FINISHED.
   - LiveKit/Vox room bootstrap still runs and tokens/sidebar are still retrievable.
2. Room debrief mode and materials route are both valid post-finish entry points, causing split terminal UX.

### Stale or misleading actions

1. Event host controls still use "Создать ещё одну сессию" depending on existing session count.
2. Event-linked materials badges can show organizer-closed semantics for normal FINISHED sessions (`closedByEventLegacy` path), which is misleading.
3. Mixed wording around materials actions (`open materials`, `session materials`, `materials`) across lobby/sessions/overlay.

### Invalid transition protection status

- Core control transition validation is robust server-side.
- Main gap is not transition mutation but terminal-state room-runtime guarding (token/sidebar/room entry policy).

### Ambiguous delete/archive behavior

1. `deleteSession` is soft-delete only; artifacts remain.
2. No explicit archive semantics for finished sessions.
3. No explicit end-user semantics for artifact cleanup; currently implied retention.
4. Event participant assignment pointers are not explicitly nulled on soft-delete (reliant on active-assignment filtering in reads).

### Event vs standalone differences

1. Materials UI state diverges: standalone FINISHED shows finished badge; event-linked FINISHED can map to closed badge due legacy compatibility branch.
2. Route posture differs: room supports finished debrief mode globally, while list/detail/lobby generally steer finished sessions to materials.

### Post-processing entry points

- Available from room debrief, session detail, and materials page.
- This is functionally rich but increases navigation ambiguity; users may not have one canonical terminal destination.

## 6. Target product rules

1. **FINISHED is terminal for live room media/control**
   - No new room media session should be established for FINISHED sessions.
   - Existing in-room users at the moment of finish can be shown terminal UI and then routed to materials/debrief.

2. **After FINISHED**
   - Facilitator sees debrief/materials/post-processing actions.
   - Participant/observer sees materials/results according to sharing rules.
   - Live control surfaces are hidden/disabled (already mostly true).

3. **Room re-entry policy (recommended)**
   - **Recommend server redirect** from `/room/[sessionId]` to `/sessions/[id]/materials` when session is FINISHED (or event-closed), instead of reopening live room shell.
   - Keep debrief UI on materials page as canonical post-session surface.

4. **Event lobby session card rules**
   - `PREPARATION/RUNNING/PAUSED` -> Open room.
   - `FINISHED` -> Open materials / View debrief.
   - Never present room-entry action for terminal sessions.

5. **Button naming**
   - Use `Создать сессию` consistently (no "ещё одну") for host create-session actions.

6. **Delete/archive semantics**
   - Draft/prep session without recording can be deleted (soft-delete from user view).
   - Finished sessions should be archived/hidden by default, not user-hard-deleted.
   - Recording/transcript/analysis artifact deletion should be explicit admin cleanup flow.

7. **Role assignment lock**
   - Keep role assignment UI editable only in `PREPARATION` (already implemented in detail UI).

8. **API terminal-state guards**
   - Add terminal-state checks to room runtime APIs (`livekit/token`, `livekit/sidebar`, provider access endpoints) to align with finished-room policy.

## 7. Recommended implementation phases

### Phase 1 (minimum, UI/navigation consistency)

- Normalize terminal navigation:
  - FINISHED room re-entry -> materials.
  - remove/replace room actions in terminal states where still shown.
- Event lobby host label cleanup:
  - `Создать ещё одну сессию` -> `Создать сессию`.
- Align event-linked materials badge semantics with standalone FINISHED behavior (no false organizer-closed badge for normal FINISHED).

### Phase 2 (API/action guard hardening)

- Enforce terminal-state runtime guards in room-entry APIs/actions:
  - deny issuing fresh room tokens/access for FINISHED sessions (or return deterministic redirect target payload).
- Standardize close/error reason payloads for terminal states.

### Phase 3 (archive/delete product decision + implementation)

- Introduce explicit archive semantics and user-facing language.
- Keep artifacts by default; define optional admin cleanup path.
- Clarify assignment-pointer behavior under archive/delete and event completion.

### Phase 4 (test stabilization)

- Add deterministic unit/API tests for terminal-room redirects/guards.
- Add e2e coverage for finished-state navigation parity across standalone/event-linked flows.

## 8. Files to change later

Phase-1/2 likely touch points:

- `app/room/[sessionId]/page.tsx`
- `components/shared-room-shell.tsx`
- `components/video-room-page.tsx`
- `components/voximplant-negotiation-room-page.tsx`
- `app/api/livekit/token/route.ts`
- `app/api/livekit/sidebar/route.ts`
- Vox room access endpoints (`app/api/sessions/[sessionId]/voximplant/access/route.ts`, `app/api/events/[id]/voximplant-access/route.ts`) if parity needed
- `lib/session-materials-ui-state.ts`
- `components/account-session-materials-view.tsx`
- `components/event-host-controls-panel.tsx`
- i18n dictionaries:
  - `lib/i18n/dictionaries/ru.ts`
  - `lib/i18n/dictionaries/en.ts`
- (optional policy harmonization) `lib/rejoin/account.ts`, `lib/rejoin/validate.ts`

## 9. Test plan

### Deterministic unit/API

- `lib/session-materials-ui-state.test.ts`
  - add FINISHED event-session badge parity assertions.
- New/extended API tests:
  - room runtime API terminal guards (`livekit/token`, `livekit/sidebar`, provider access).
  - `/room/[sessionId]` finished redirect behavior (server/page-level).
- Keep control transition tests (`lib/negotiation-control.test.ts`, session control route tests) as baseline regression safety.

### Playwright/browser e2e

- Extend:
  - `tests/e2e/session-navigation.spec.ts`
  - `tests/e2e/session-lifecycle.spec.ts`
  - `tests/e2e/event-completion.spec.ts`
  - `tests/e2e/phase-6-12-event-session-e2e-regression.spec.ts`
- New cases:
  - facilitator/participant/observer direct `/room/[id]` after FINISHED -> materials.
  - event lobby finished cards show materials-only action.
  - no stale "open room" action in terminal states.
  - create-session label consistency in RU locale.

### Manual checks

- Standalone and event-linked parity under both providers (LiveKit/Voximplant).
- Rejoin behavior from stale tabs and post-finish transitions.
- Soft-delete and event-complete UX consistency (list visibility, detail accessibility, materials access).

## 10. Implementation prompt for Phase 1

Use this prompt as-is for the implementation chat:

---

Implement **Stage 3.7 Phase 1** (terminal-state UI/navigation consistency only) on top of branch `<new-implementation-branch>`.

### Scope

- Do not change DB schema.
- Do not refactor unrelated code.
- Keep changes minimal and targeted.
- Focus only on terminal-state UX/navigation consistency.

### Goals

1. **FINISHED room re-entry policy**
   - When a session is terminal (`negotiationState=FINISHED` or organizer/event-closed), opening `/room/[sessionId]` should not continue into live room runtime.
   - Redirect to `/sessions/[id]/materials` (account mode).
   - Preserve existing auth/access rules.

2. **Hide/replace invalid room actions after FINISHED**
   - Ensure no UI path still suggests opening a live room for terminal sessions.
   - Keep materials/debrief actions visible.

3. **Event lobby label cleanup**
   - Replace `events.createAnotherSession` usage in host controls with consistent `events.createSession` label (RU: `Создать сессию`).

4. **Event-linked materials badge parity**
   - For event-linked sessions that are normally FINISHED (not organizer-closed), show finished semantics instead of organizer-closed badge.
   - Keep organizer/event-close badge only for true organizer/event closure.

### Files to update (expected)

- `app/room/[sessionId]/page.tsx`
- `components/event-host-controls-panel.tsx`
- `lib/session-materials-ui-state.ts`
- `components/account-session-materials-view.tsx` (only if needed by UI-state change)
- `lib/i18n/dictionaries/ru.ts`, `lib/i18n/dictionaries/en.ts` (only if key usage/labels need alignment)

### Acceptance criteria

- Direct `/room/[sessionId]` open for FINISHED session lands on `/sessions/[id]/materials`.
- No "open room" action is rendered for terminal sessions in audited routes.
- Event host controls no longer show "Создать ещё одну сессию"; always "Создать сессию".
- Event-linked FINISHED session shows finished badge semantics (not organizer-closed unless actually organizer/event-closed).
- Existing control transitions, recording/transcription/analysis behavior remain unchanged.

### Validation

- Run targeted tests for session navigation and event completion flows.
- Add/adjust tests for the new redirect and label behavior where missing.
- Provide a concise change summary and risk notes.

---
