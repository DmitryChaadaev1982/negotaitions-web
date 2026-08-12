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
  empty-room auto-close, after `DEBRIEF_AUTO_CLOSE_GRACE_MS` (authoritative
  default: 30,000 ms). Normal/manual negotiation finish always opens Debrief
  first, including when the room is already empty.
- Event owners may also use the Event lobby `Complete Session` action while a
  Session is `DEBRIEF_OPEN`. That route still calls the canonical complete API,
  but passes a debrief-close flag so `completeSessionCanonical(..., hardClose)`
  transitions the room to `CLOSED` without waiting for every debrief occupant to
  leave.
- `CLOSED`: room admission is denied and the backend supplies the canonical
  Event-lobby or materials redirect.
- Empty-Debrief timing starts at
  `max(negotiationEndedAt, last active-human room departure)`. This prevents a
  pre-Debrief disconnect from consuming the Debrief grace. A rejoin makes the
  pending close a no-op; a later departure starts the current empty period.
  Explicit disconnect, supersede, and revoke use their terminal timestamp;
  passive network loss uses the lease `expiresAt` boundary.
- Debrief occupancy is role-agnostic and reads authoritative active
  `SessionRoomConnection` leases for active human users. `FACILITATOR`,
  `PARTICIPANT`, and `OBSERVER` all count; `SessionParticipant.type` is not
  joined to lease role, so an in-place role transition cannot erase occupancy.
  Expired, disconnected, superseded, revoked, deleted-Session, inactive-user,
  and closed-room leases remain excluded.
- Explicit facilitator completion, Event hard-close, and empty-Debrief grace
  expiry use one idempotent final Session-close operation. It atomically writes
  `status=COMPLETED`, `endedAt`, `roomLifecycle=CLOSED`, `closeReason`, and
  `updatedAt`; Event authority alone writes `closedByEvent*`. Session
  completion never completes the owning `TrainingEvent`.
- Empty-Debrief finalization does not create a second provider recording stop.
  Recording stop intent is already owned by canonical negotiation completion.
- Session overview presentation distinguishes negotiation completion from final
  Session completion. `negotiationState=FINISHED` with
  `roomLifecycle=DEBRIEF_OPEN` displays `Debrief` / `Дебриф`, including while
  the room is empty within its grace window and while recording, transcription,
  or analysis finishes. The existing terminal display code `FINISHED`
  (`Completed` / `Завершено`) is emitted only for `status=COMPLETED` plus
  `roomLifecycle=CLOSED`; historical completed rows with a null lifecycle
  remain a compatibility exception. Dashboard active/archive grouping uses the
  same shared display derivation rather than `negotiationState` alone.
- Room-return eligibility uses that same canonical terminal derivation.
  `FINISHED + DEBRIEF_OPEN` remains returnable for standalone and Event-created
  Sessions, including an empty-room grace interval and a reconnect during that
  interval. `COMPLETED + CLOSED`, a deleted Session, `closedByEventAt`, or
  completed Event authority makes it non-returnable. Recording, transcription,
  and AI-analysis states never decide room eligibility. Existing participant,
  account, token, and room-access authorization still applies after lifecycle
  eligibility; this rule does not grant new access.

Long-horizon cleanup for an empty `OPEN` Session or empty Event is separate
backlog work. Any future policy must be measured in hours or bounded by Event
lifetime; it must not reuse the short debrief grace.

The approximately 120-second passive-disconnect lease expiry is independent
from the 30-second empty-Debrief grace: it determines when a network-lost room
lease stops counting as active. Recording server-stop terminal timeout is a
third independent mechanism (default 90 seconds), and stale recording
`STARTING` reconciliation has its own 90-second admission threshold. None of
these timers changes the Debrief grace.

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

## Stage 3.13E Control Contract

- Interactive facilitator writes on `control` and `duration` require all of:
  authenticated participant identity, active facilitator lease `connectionId`,
  expected negotiation state, and expected narrow `controlToken`.
- `controlToken` is derived only from control-relevant Session fields
  (negotiation/preparation timers, pause accumulators, facilitator/lifecycle
  invariants) and explicitly does not depend on broad fields such as
  `Session.updatedAt` or room-name metadata.
- A resume advances the running timer epoch at millisecond precision while
  whole elapsed pause seconds remain in the pause accumulator. This prevents a
  delayed command from an earlier running epoch from matching after a
  sub-second pause/resume cycle.
- The Session CAS and negotiation `SessionPauseInterval` creation/closure commit
  in the same transaction. Request-driven timer expiry first wins a Session CAS,
  and canonical completion side effects run only for that winner; later polling
  recovers a committed FINISHED/OPEN intermediate state idempotently.
- Preparation lifecycle is authoritative and non-bypassable:
  `PREPARATION -> START_PREPARATION -> (PAUSE/RESUME)* -> STOP_PREPARATION -> READY_TO_START`.
- Direct `START` from `PREPARATION` and direct `SKIP_PREPARATION` are invalid.
- Negotiation `FINISH` is valid only after negotiation start (`RUNNING`/`PAUSED`);
  pre-start finish requests are rejected.

## Stage 3.13E Wave 2 Acceptance Remediation Notes

- Interactive browser copy-link actions combine the current
  `window.location.origin` with canonical relative Event/Session invitation
  paths. Server-generated links without a browser context continue to use the
  configured canonical public origin.
- FINISHED presentation keeps a strict 2500 ms finish-line window derived from
  authoritative `negotiationEndedAt`/`serverNow`; subsequent polls may shorten
  but never re-extend the local deadline.
- Negotiation `PAUSED` remains the semantic state, while warning/critical tone
  is derived from authoritative `remainingSeconds` (`<=60` warning, `<=10`
  critical) without resuming countdown.
- Notifications control is part of the room media-control surface (provider
  parity for LiveKit and Voximplant), with explicit OFF/ON/BLOCKED behavior.

## Facilitator Authority Model

- `Session.facilitatorId` is the canonical facilitator owner identity.
- Event owner (`TrainingEvent.hostUserId`) keeps administrative event/session rights but does not auto-promote to session facilitator on room entry.
- Facilitator reassignment is explicit and centralized through session role-management actions, not through implicit participant upsert paths.
- Reassignment updates `Session.facilitatorId`, both participant capabilities,
  and both users' still-active Session-room lease roles transactionally. The
  promoted facilitator can use the existing connection without a hidden
  refresh, while the demoted facilitator loses strict control authority
  immediately. Expired/finalized leases remain terminal and fresh claims read
  the current participant type.

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
