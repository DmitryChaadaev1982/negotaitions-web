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

Required UI entry points (implemented in Checkpoint C):

- Sessions overview (`components/sessions-list-view.tsx`);
- Session detail/management page (`components/session-detail-view.tsx`);
- Event lobby host controls (`components/event-host-controls-panel.tsx`);
- Session action component reused across surfaces (`components/complete-session-button.tsx`).

Authorization:

- facilitator/session owner/authorized Event host only;
- participant and observer completion forbidden by server route authorization (`/api/sessions/[sessionId]/complete`);
- non-member access returns stable non-disclosing `Not found`.

Visibility:

- show completion only for non-finished sessions on management surfaces.

Confirmation copy implemented:

- active negotiation ends;
- debrief may remain open while participants are still connected;
- recording stop is requested canonically and warnings are shown without rollback;
- materials remain available and the session is not deleted.

## Sessions overview action layout requirement

- No new Sessions column was added.
- Actions remain in existing compact actions group.
- Complete and Delete stay separate controls and labels.

Recommended action grouping:

- Primary: Open materials, Manage.
- Overflow/destructive: Complete session, Delete.

## Sessions overview AI analysis column gap

### Current behavior after Checkpoint C

- Component: `components/sessions-list-view.tsx` (`AiStatusCell`).
- Data source now includes aggregate publication state from `lib/ai-publication-aggregate.ts` via `lib/session-overview-stats.ts`.
- One publication status is rendered per session (`AI report partially published` / `AI report published`).
- Speaker mapping badges remain independent (`required` / `confirmed`) and are rendered separately from publication status.
- Aggregation identity policy now prefers stable recipient identity (`SessionParticipant.id` -> `userId` scoped to session), with conservative legacy name fallback only when unique among required recipients.

### Final target decision

- Render one session-level aggregate publication status only.
- Never render repeated identical published rows/badges.
- Keep speaker mapping line independent:
  - `Требуется сопоставление говорящих`
  - `Сопоставление подтверждено`
- Final full published status text:
  - `AI-отчёт опубликован`

## Sessions overview "Open lobby" for completed Event gap

### Current behavior after Checkpoint C

- Component: `components/sessions-list-view.tsx`.
- `Open lobby` action is now hidden when `eventStatus === COMPLETED`.

### Final target decision

- Hide `Open lobby` for sessions linked to `TrainingEvent.status=COMPLETED`.
- Primary action becomes session materials/results.
- Avoid disabled dead-end button unless existing pattern strictly requires it.

### Checkpoint C final evidence

- Browser automation: `tests/e2e/session-completion-management-ui.spec.ts` verifies:
  - Complete action visibility for eligible unfinished session;
  - Complete and Delete as separate controls;
  - completed-event row hides `Open lobby`, while active event retains `Open lobby`;
  - aggregate AI publication badge renders once per session;
  - speaker-mapping badge remains independently visible.

## Event lobby completed-state guard

### Current behavior

- Route: `app/events/[id]/lobby/page.tsx` keeps completed-event guard.
- `components/event-lobby-view.tsx` renders completion overlay and removes interactive lobby controls for completed events.

### Final target decision

- Add/keep server or route-level completed-event guard so direct URLs, back navigation, and stale links cannot restore interactive lobby behavior.
- Completed Event view may remain available as read-only results context.

## Active connection semantics in UI policy

- UI should treat active occupancy as server-authoritative durable predicate output, not local browser clock or `lastSeenAt` alone.
- Superseded tab takeover must be durable; an old superseded tab must not renew itself as active.
