# UI Control Inventory (Current vs Final Target)

## Room-internal negotiation controls

### Current audited behavior

- Component: `FacilitatorRoomControls`.
- Visible only to facilitator (`controlState.canControl`).
- Uses `POST /api/sessions/[sessionId]/control`.
- Duplicate FINISH handling is mostly client-side; explicit server FINISH idempotency path is not formalized.

### Final target decision

- Keep one canonical backend completion action for in-room FINISH.
- Repeated FINISH requests must return already-finished/idempotent result.
- Client submit-disable remains UX aid, not the source of correctness.

## Recording stop orchestration UX

### Current audited behavior

- Voximplant stop is relayed from `VoximplantNegotiationRoomPage` after FINISH callback.
- Client has per-tab duplicate suppression (`stopInFlightRef`).

### Final target decision

- Client relay may remain fallback only.
- Server-side finish operation must own durable/retryable stop command dispatch.
- Redirect/unload must not cancel stop orchestration.
- Recording stop failures must stay visible and retryable.

## Debrief and leave controls

### Current audited behavior

- Leave is per-user connection leave; it does not directly finish session.
- Debrief mode remains available for already connected users after finish.

### Final target decision

- If session is `FINISHED` and room lifecycle is `DEBRIEF_OPEN`, authorized users may re-enter room.
- If room lifecycle is `CLOSED`, room entry redirects to materials.
- Explicit leave closes that connection immediately.

## Administrative completion entry points (new product requirement)

Required UI entry points (future implementation):

- Sessions overview;
- Session detail/management page;
- existing Event lobby host controls;
- Event session-management surfaces where appropriate.

Authorization:

- facilitator/session owner/authorized Event host only;
- participant and observer completion is forbidden.

Visibility:

- show completion only for non-finished, non-deleted sessions.

Confirmation copy must state:

- active negotiations will end;
- active recording will be stopped;
- existing recording/materials remain available;
- session is not deleted.

## Sessions overview action layout requirement

- Do not add a new table column.
- Do not widen/break Sessions overview layout.
- Keep completion in existing Actions area or compact overflow menu.
- Preserve semantic separation between Complete and Delete.

Recommended action grouping:

- Primary: Open materials, Manage.
- Overflow/destructive: Complete session, Delete.

## Sessions overview AI analysis column gap

### Current audited behavior

- Component: `components/sessions-list-view.tsx` (`AiStatusCell`).
- Data source: `lib/session-overview-stats.ts` returns session-level `aiStage`, `speakerMappingStage`, `aiVisibility`.
- Current defect evidence:
  - duplicated shared publication labels are rendered in `AiStatusCell` (`sessions.aiStatusShared` and `sessions.analysisSharedBadge`);
  - no single aggregate publication state exists for recipient completion coverage.

### Final target decision

- Render one session-level aggregate publication status only.
- Never render repeated identical published rows/badges.
- Keep speaker mapping line independent:
  - `Требуется сопоставление говорящих`
  - `Сопоставление подтверждено`
- Final full published status text:
  - `AI-отчёт опубликован`

## Sessions overview "Open lobby" for completed Event gap

### Current audited behavior

- Component: `components/sessions-list-view.tsx`.
- `Open lobby` action is shown when `eventLobbyUrl` exists; no explicit `eventStatus !== COMPLETED` predicate.

### Final target decision

- Hide `Open lobby` for sessions linked to `TrainingEvent.status=COMPLETED`.
- Primary action becomes session materials/results.
- Avoid disabled dead-end button unless existing pattern strictly requires it.

## Event lobby completed-state guard gap

### Current audited behavior

- Route: `app/events/[id]/lobby/page.tsx` mounts `EventLobbyView`.
- Guard is primarily state-driven in `components/event-lobby-view.tsx` (`isEventCompleted` -> `EventCompletedOverlay`).

### Final target decision

- Add/keep server or route-level completed-event guard so direct URLs, back navigation, and stale links cannot restore interactive lobby behavior.
- Completed Event view may remain available as read-only results context.

## Active connection semantics in UI policy

- UI should treat active occupancy as server-authoritative durable predicate output, not local browser clock or `lastSeenAt` alone.
- Superseded tab takeover must be durable; an old superseded tab must not renew itself as active.
