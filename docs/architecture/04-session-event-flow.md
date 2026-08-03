# 04 Session And Event Flow

## Standalone Session Flow

1. Facilitator creates a session from case context.
2. Session participants and roles are assigned.
3. Participants enter room (`/room/[sessionId]` or join flow).
4. Facilitator drives preparation and negotiation state transitions.
5. Recording lifecycle is tied to negotiation control flow.
6. Materials API exposes recording/transcript/analysis progression.

## Event-Based Flow

1. Event is created and opened in lobby mode.
2. Participants join event lobby.
3. Host creates assignment draft and selects case.
4. Session is created from event assignment.
5. Assigned users move from lobby to room.
6. Session completion can return users to lobby or materials.

## Room Lifecycle Semantics (Stage 3.10)

- `OPEN`: negotiation-room admission is allowed by the canonical
  `roomAccessDecision`. Zero occupancy never completes or closes an `OPEN`
  Session automatically.
- `DEBRIEF_OPEN`: negotiation is finished, recording stop has already been
  requested by canonical completion, and existing participants may use the
  debrief/materials flow. This is the only lifecycle state eligible for
  empty-room auto-close, after `DEBRIEF_AUTO_CLOSE_GRACE_MS`.
- Event owners may also use the Event lobby `Complete Session` action while a
  Session is `DEBRIEF_OPEN`. That route still calls the canonical complete API,
  but passes a debrief-close flag so `completeSessionCanonical(..., hardClose)`
  transitions the room to `CLOSED` without waiting for every debrief occupant to
  leave.
- `CLOSED`: room admission is denied and the backend supplies the canonical
  Event-lobby or materials redirect.
- Closing an empty `DEBRIEF_OPEN` room is a lifecycle-only transition. It does
  not create or request a second provider recording stop.

Long-horizon cleanup for an empty `OPEN` Session or empty Event is separate
backlog work. Any future policy must be measured in hours or bounded by Event
lifetime; it must not reuse the short debrief grace.

## Leave And Presence Semantics

- Explicit leave is persisted before provider teardown and before navigation.
  If persistence fails or times out, the UI keeps the user in place and exposes
  the failure instead of silently treating the leave as complete.
- Refresh, tab close, browser crash, and network loss are passive disconnects.
  They remain lease-based and do not use the explicit-leave endpoint.
- Rejoin/same-user takeover supersedes the older lease; logical presence and
  Event `In Sessions` counts deduplicate the user.

## Canonical Room Actions

- Participant and observer actions are derived from `roomAccessDecision`: enter
  or rejoin an active room, return to debrief, or view materials.
- Facilitator actions use the same access decision for room/debrief/materials
  destination; administrative finish remains a separate authority-checked
  action.
- Materials-destination buttons are labelled generically (`View materials` /
  `Просмотреть материалы`) because recording, transcript, enhancement, speaker
  mapping, and publication state may be available independently of AI analysis.

## Facilitator Authority Model

- `Session.facilitatorId` is the canonical facilitator owner identity.
- Event owner (`TrainingEvent.hostUserId`) keeps administrative event/session rights but does not auto-promote to session facilitator on room entry.
- Facilitator reassignment is explicit and centralized through session role-management actions, not through implicit participant upsert paths.
- Reassignment updates `Session.facilitatorId` and participant capabilities deterministically; it does not rely on runtime read-time type demotion.

## Event Presence DTO

- Event participant presence is derived event-wide from lobby heartbeat evidence
  plus canonical `SessionRoomConnection` rows, including terminal
  `disconnectedAt`, `supersededAt`, `revokedAt`, and expired `expiresAt`
  timestamps.
- Canonical statuses:
  - `IN_LOBBY`
  - `IN_SESSION`
  - `TEMPORARILY_AWAY`
  - `OFFLINE`
  - `INVITED_NOT_CONNECTED`
- Resolver precedence is active lobby, active Session, recent terminal
  Event/Session evidence, offline history, then invited-never-connected. If
  lobby and Session evidence overlap briefly, the newest active surface wins so
  the UI never displays two active locations.
- `TEMPORARILY_AWAY` uses the existing
  `PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS` grace window and is emitted on
  the next Event-state refresh after active presence is lost; it does not wait
  for the grace window to expire.
- UI traffic-light presentation maps directly to this DTO and must not be used
  as a lease/access authority.

## Stale-Tab Completion Redirect

- Room pages continue canonical control-state polling even after local stale/superseded connection detection.
- Global room/event closure redirect decisions (`ROOM_CLOSED`, `EVENT_CLOSED`) take precedence over stale-tab banner rendering.
- Redirect targets come from backend `redirectTo` decisions to avoid role/client divergence and loop-prone client heuristics.

## State Authorities

- Session/event source of truth: database state.
- Room views poll control and sidebar/materials APIs.
- Event assignment and participant linkage are persisted server-side.
- Negotiation `PAUSED` state controls timer/recording-analysis boundaries, not room-media connectivity.
- `micAllowed` is a speaking-policy signal. In `PAUSED`, microphones remain allowed for all in-room roles (`PARTICIPANT`, `FACILITATOR`, `OBSERVER`).
- Pause interval orchestration is idempotent:
  - repeated `PAUSE` while already paused does not create duplicate open intervals;
  - repeated `RESUME` while already running is treated as no-op;
  - `FINISH` closes all remaining open pause intervals.

## Key Control Endpoints

- Session control: `app/api/sessions/[sessionId]/control/route.ts`.
- Session control state: `app/api/sessions/[sessionId]/control-state/route.ts`.
- Session media status publish: `app/api/sessions/[sessionId]/media-status/route.ts`.
- Event host control: `app/api/events/[id]/host/route.ts`.
- Event state: `app/api/events/[id]/state/route.ts`.
- Event lobby media status publish: `app/api/events/[id]/media-status/route.ts`.
- Event lobby media control commands: `app/api/events/[id]/media-control/route.ts`.

## Source Notes

- `app/actions/sessions.ts`
- `app/actions/events.ts`
- `app/api/sessions/[sessionId]/control/route.ts`
- `app/api/sessions/[sessionId]/control-state/route.ts`
- `app/api/events/[id]/host/route.ts`
- `app/api/events/[id]/state/route.ts`
- `docs/architecture/session-flow-gap-analysis.md`
