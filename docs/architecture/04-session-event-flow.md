# 04 Session And Event Flow

## Standalone Session Flow

1. Facilitator creates a session from case context.
2. Session participants and roles are assigned.
3. Participants enter a room-ready, pre-Preparation state (`PREPARATION`).
4. Facilitator explicitly starts Preparation, then drives the canonical
   preparation and negotiation transitions.
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
  or analysis finishes. `roomLifecycle=CLOSED` is terminal display authority:
  with `negotiationState=FINISHED`, the existing terminal display code
  `FINISHED` (`Completed` / `Завершено`) is emitted even if the coarse
  `Session.status` is stale. Explicit `OPEN` and `DEBRIEF_OPEN` always win over
  coarse status.
- Authoritative modern finish paths either persist `OPEN` as a recoverable
  finish-side-effect fence before canonical completion, or write
  `DEBRIEF_OPEN`/`CLOSED` in the canonical transaction. They therefore cannot
  legitimately leave a FINISHED row with `roomLifecycle=NULL`. Room access
  already derives such pre-lifecycle FINISHED history as CLOSED; shared display
  and Dashboard grouping use the same narrow compatibility rule without a
  migration-date heuristic.
- The Stage 3.10 lifecycle backfill synchronizes `status=COMPLETED` in the same
  update whenever it derives CLOSED for a FINISHED row. Existing historical
  rows are normalized only by the separate dry-run-default ops command; normal
  room completion is not broadened into a data-repair mechanism.
- Room-return eligibility uses that same canonical terminal derivation.
  `FINISHED + DEBRIEF_OPEN` remains returnable for standalone and Event-created
  Sessions, including an empty-room grace interval and a reconnect during that
  interval. `COMPLETED + CLOSED`, a deleted Session, `closedByEventAt`, or
  completed Event authority makes it non-returnable. Recording, transcription,
  and AI-analysis states never decide room eligibility. Existing participant,
  account, token, and room-access authorization still applies after lifecycle
  eligibility; return eligibility does not invent membership for users who were
  never authorized.
- A valid Event Observer who is not yet a `SessionParticipant` may make their
  first actual Session room entry while the Session is `DEBRIEF_OPEN`. That
  decision lives in `canCreateLateObserverParticipant`, which now admits
  `decideSessionRoomAccess` output `ALLOW_DEBRIEF` in addition to
  `ALLOW_ACTIVE_ROOM`. Event Lobby reuses the existing
  "Available to observe" / "Доступно для наблюдения" block; it does not add a
  Debrief-only panel. Those cards use the shared Session display status, so a
  joinable `DEBRIEF_OPEN` Session shows `Debrief` / `Дебриф`, not terminal
  `Completed` / `Завершено`. Direct `/room/[sessionId]` uses the same late-Observer
  creation gate. This is not public access: unauthenticated users, non-members,
  deleted Sessions, completed Events, and `CLOSED` rooms remain denied.
  Participant first-entry is unchanged. Room-entry permission remains distinct
  from AI publication grants.

Long-horizon cleanup for an empty `OPEN` Session or empty Event is separate
backlog work. Any future policy must be measured in hours or bounded by Event
lifetime; it must not reuse the short debrief grace.

## Dashboard Current And Upcoming Selection

- Dashboard current-activity selection is a presentation concern, independent
  from Event lobby and Session room entry authorization. Session candidates use
  terminal display compatibility: `FINISHED + CLOSED` and legacy
  `FINISHED + NULL` are history, while `FINISHED + DEBRIEF_OPEN` and normal
  nonterminal states may remain current. Deleted Sessions and Sessions owned by
  completed or cancelled Events are excluded.
- Current standalone and Event-created Sessions share one deterministic
  presentation priority: live negotiation, paused negotiation, active
  preparation, ready/preparation, then genuine Debrief. State ties use newest
  `createdAt` and stable ID ordering.
- A current Session takes precedence over Event activity. If there is no
  Session, non-deleted `DRAFT`, `LOBBY_OPEN`, and `SESSION_CREATED` Events are
  eligible; completed and cancelled Events are excluded. Unscheduled
  non-future activity may precede future activity, and future Events use nearest
  `scheduledAt` first.
- Event cards select their relevant current Session through the same
  presentation helper instead of using database relation order or the
  first-created Session.
- Dashboard activity lanes render Event-first hierarchy:
  `Event -> Session[]`, grouped only by canonical `Session.eventId`.
- A relevant active nested Session promotes its parent Event into the Active lane
  even when the Event `scheduledAt` is future. An Event is assigned to exactly
  one lifecycle lane, so this promotion excludes it from Future.
- Dashboard grouping is lifecycle-driven only; management/ownership never
  creates a separate user-facing lane. Owner identity is presentation metadata:
  self-owned cards use an explicit localized self label/accent, while access
  remains governed by the existing Event and Session authorization decisions.
- Parent Event cards route their primary action to the Event lobby. Nested
  Session cards own room-entry actions, preserving the Event-to-lobby and
  Session-to-room hierarchy.
- Standalone Sessions (no `eventId`) render in a separate standalone group and
  are never heuristically attached to Events.
- Child Sessions remain authorization-scoped: grouping is applied only after
  existing Event/Session visibility filters and does not broaden access.
- Completed/materials-only history remains in the archive and is never a
  current-card fallback. If neither a current Session nor an eligible Event
  exists, the current card renders the no-active-rooms empty state.
- Archive rendering uses the same Event->Session hierarchy shape plus a
  standalone Session group, while preserving canonical completion
  classification inputs.
- Whether a displayed Event or Session can actually be entered remains governed
  independently by the existing Event-access and Session-room-access logic;
  Dashboard selection does not grant or redefine access.

## Object Pictogram Presentation Semantics

- Approved runtime assets live under `public/icons/objects/{light,dark}` for
  `event`, `room`, and `case` semantics.
- `components/object-pictogram.tsx` is the single reusable presentation
  primitive for object identity pictograms.
- The pictogram component is visual-only: no lifecycle logic, no data loading,
  and no navigation rules.
- Dashboard parent Event cards use larger Event pictograms; nested/standalone
  Session cards use smaller Room pictograms to preserve hierarchy readability.
- Cases, Events, and Sessions list pages, plus Case/Event/Session create and
  edit/detail headers, use the large canonical entity pictogram in the page
  header only. Dense Cases table rows do not repeat the pictogram; compact row
  layout and in-viewport management actions take precedence over visual
  consistency with the header.

## Legacy Terminal Metadata Normalization

`npx tsx scripts/ops/normalize-legacy-session-terminal-state.ts` is read-only
by default. It reports bounded samples and two candidate counts:

- Category A: non-deleted `FINISHED + CLOSED + status<>COMPLETED`;
- Category B: non-deleted `FINISHED + roomLifecycle=NULL` with authoritative
  `negotiationEndedAt`.

Category B needs no calendar cutoff: every modern interactive FINISH writes
`OPEN` as its recoverable intermediate fence before canonical completion, and
all other canonical finish paths assign `DEBRIEF_OPEN` or `CLOSED` in their
transaction. The existing room-access compatibility already treats
`FINISHED + NULL` as CLOSED.

Writes require `--apply` plus both `--expected-category-a` and
`--expected-category-b`. Apply mode rechecks counts in a serializable
transaction, never selects deleted/DEBRIEF_OPEN/non-FINISHED rows, synchronizes
only `status=COMPLETED` for Category A, and assigns only
`status=COMPLETED, roomLifecycle=CLOSED` for Category B. It preserves
`endedAt`, `updatedAt`, and all other selected historical metadata, verifies
that preservation after the update, and emits before/after values for
separately reviewed rollback. Preserving `updatedAt` prevents historical repair
from reordering the account rejoin/materials target selected by
`lib/rejoin/account.ts` and the user-facing Event list's latest-activity value,
which includes `Session.updatedAt` in `lib/event-overview-stats.ts`.

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
- Authorized Event Observers who are not yet Session members may first enter a
  `DEBRIEF_OPEN` room through the same late-Observer creation policy used by
  Lobby "Available to observe" and the direct account room path.
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
- Preparation and negotiation both support pause/resume. Normal room UX must not
  expose `SKIP_PREPARATION`; any early-finish control must invoke the canonical
  `STOP_PREPARATION` or `FINISH` action rather than implementing an alternate
  lifecycle transition.
- The facilitator early-finish confirmation is a client-side safety wrapper
  only. Opening or cancelling it never pauses, resumes, freezes, or otherwise
  mutates the phase; confirming dispatches the existing canonical
  `STOP_PREPARATION` or `FINISH` request once with the normal lease/CAS fields.
- Negotiation `FINISH` is valid only after negotiation start (`RUNNING`/`PAUSED`);
  pre-start finish requests are rejected.
- Participant Notes, including the account Materials view, keeps a local
  current draft separate from its saved baseline. A successful Notes action
  advances only that baseline to the returned persisted notes; a newer local
  edit remains visible and dirty, and a failed action cannot report saved
  state.

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
- Multi-row role assignment and facilitator reassignment lock affected
  `SessionParticipant` rows by stable primary key (`id ASC`) and apply their
  participant-row writes in that same order. This matches AI completion-time
  roster validation without expanding either transaction boundary.

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
