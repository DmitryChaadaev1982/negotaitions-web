# 04 Session And Event Flow

## Standalone Session Flow

1. Facilitator creates a session from case context.
   Successful Standalone create lands on the management page
   (`/sessions/{id}`). It does not redirect directly to `/room/{id}`.
   The facilitator later enters the video room through the explicit
   management-page room action (`/room/{id}`).
2. Session participants and roles are assigned.
3. Participants enter a room-ready, pre-Preparation state (`PREPARATION`).
4. Facilitator explicitly starts Preparation, then drives the canonical
   preparation and negotiation transitions.
   Standalone Sessions (`Session.eventId == null`) additionally require role
   readiness before `START_PREPARATION`: every assignable SessionRole slot is
   occupied, and every negotiation `PARTICIPANT` has a valid assignable
   `sessionRoleId`. `FACILITATOR` and `OBSERVER` are excluded and do not need
   case roles. Roles filtered out by `isAssignableCaseRole` are not required
   slots. Zero assignable roles satisfies the requirement. Event-created
   Sessions keep their existing readiness contract. The same
   `areStandalonePreparationRolesReady` predicate is used by the session
   control API guard and the room Start Preparation control. This does not
   add a persisted status or change the negotiation lifecycle state machine.
5. Recording lifecycle is tied to negotiation control flow.
6. Materials API exposes recording/transcript/analysis progression.

## Event-Based Flow

1. Event is created and opened in lobby mode.
2. Participants join event lobby.
3. Host creates assignment draft and selects case.
4. Session is created from event assignment and remains in the Event/lobby
   flow. Event Session create does not redirect through Standalone
   `/sessions/{id}` management.
5. Assigned users later enter the room through the Event room URL
   (`/room/{id}` from lobby/Event state). That room-entry path is unchanged.
6. Session completion can return users to lobby or materials.

An authorized manager may still open an Event-created Session at
`/sessions/{id}`. That is the same `canManageSession` management surface;
it does not become the normal Event create/lobby/room navigation.

## Room Lifecycle Semantics (Stage 3.18A kernel)

- `OPEN`: negotiation-room admission is allowed by the canonical
  `roomAccessDecision`. The 60-second empty-Debrief timeout never closes
  `OPEN` / `PREPARATION` / `RUNNING` / `PAUSED`. A non-terminal empty Session
  may later close through the hours-scale abandoned policy below.
- `DEBRIEF_OPEN`: negotiation is finished, recording stop has already been
  requested by canonical completion, and existing participants may use the
  debrief/materials flow. Effective automatic close is the earliest of:
  empty-Debrief (`SESSION_DEBRIEF_EMPTY_CLOSE_MS`, default 60,000) and the
  Debrief hard maximum (`SESSION_DEBRIEF_MAX_DURATION_MS`, default 7,200,000
  from `Session.negotiationEndedAt`). Occupied Debrief survives the empty
  grace but not the 2h hard maximum. Normal/manual negotiation finish always
  opens Debrief first, including when the room is already empty.
- Event owners may also use the Event lobby `Complete Session` action while a
  Session is `DEBRIEF_OPEN`. That route still calls the canonical complete API,
  but passes a debrief-close flag so `completeSessionCanonical(..., hardClose)`
  transitions the room to `CLOSED` without waiting for every debrief occupant to
  leave.
- `CLOSED`: room admission is denied and the backend supplies the canonical
  Event-lobby or materials redirect. Occupied Debrief hard-close uses this
  same CLOSED propagation; there is no client-only timeout UI.
- Empty-Debrief `emptySinceAt` is
  `max(negotiationEndedAt, lastCurrentGenerationDepartureAt)`. Only the
  current valid `SessionRoomConnection` lease generation per user counts.
  Superseded/obsolete generations are ignored. Live `expiresAt` is ignored.
  A rejoin invalidates the previous empty deadline; a later leave starts a
  new one. Explicit disconnect, revoke, and marked expiry use their terminal
  timestamp; passive network loss uses the lease `expiresAt` boundary only
  after that lease is no longer valid.
- Abandoned non-Debrief Sessions use `SESSION_ABANDONED_CLOSE_MS` (default
  10,800,000). Never-entered standalone reference is `Session.createdAt`.
  Previously occupied reference is the last current-generation departure.
  Event-created Sessions floor that reference by parent
  `TrainingEvent.scheduledAt` even when early occupancy occurred
  (`S318A-D-001`). Session has no `scheduledAt` field.
- Historical/terminal/deleted Sessions and Event-closed Sessions are
  automatic no-ops. A completed, cancelled, or deleted parent Event is an
  automatic-close fence for every child, including `DEBRIEF_OPEN`: the
  child is ineligible and emits no automatic reason. The same fence is
  re-checked in the automatic `UPDATE` so a stale due evaluation cannot
  close after the parent became terminal. This does not invent Event
  auto-close and does not change explicit `EVENT_COMPLETION`. Past Event
  join remains unchanged.
- Debrief occupancy is role-agnostic and reads authoritative active
  `SessionRoomConnection` leases for active human users. `FACILITATOR`,
  `PARTICIPANT`, and `OBSERVER` all count; `SessionParticipant.type` is not
  joined to lease role, so an in-place role transition cannot erase occupancy.
  Expired, disconnected, superseded, revoked, deleted-Session, inactive-user,
  and closed-room leases remain excluded.
- Explicit facilitator completion, Event hard-close, empty-Debrief, Debrief
  hard-maximum, and abandoned-Session close use one idempotent final
  Session-close operation (`finalizeSessionCanonicalClose`). It atomically
  writes `status=COMPLETED`, `endedAt`, `roomLifecycle=CLOSED`, `closeReason`,
  and `updatedAt`; Event authority alone writes `closedByEvent*`. Session
  completion never completes the owning `TrainingEvent`. Automatic reasons are
  `DEBRIEF_EMPTY_TIMEOUT`, `DEBRIEF_MAX_DURATION`, and
  `SESSION_ABANDONED_TIMEOUT`. Claim/rejoin (`claimSessionRoomConnectionLease`)
  and the automatic finalizer serialize on the Session row
  (`SELECT ... FOR UPDATE` / `UPDATE`). `NOT EXISTS` emptiness is evaluated
  only while that lock is held, so a concurrent connection INSERT cannot
  admit a user into a Session that is simultaneously closing. First
  successful fenced update wins; later closers are no-ops.
- Automatic Debrief empty/max close writes only through
  `finalizeSessionCanonicalClose` and does not create a second recording stop.
  Abandoned automatic close (`SESSION_ABANDONED_TIMEOUT`) is state-aware: if
  negotiation is still pre-finish (`PREPARATION`, `READY_TO_START`, `RUNNING`,
  `PAUSED`, and the other non-FINISHED states), it reuses
  `completeSessionCanonical` with automatic authority and `hardClose` so the
  first canonical finish / recording-stop intent happens exactly once, then
  the shared final Session writer closes the room. If canonical finish already
  happened, automatic close must not repeat the stop. Lifecycle reconciliation
  never calls a recording provider directly. Abandoned RUNNING/PAUSED rows
  therefore use the same terminal recording/post-processing contract as
  forced canonical completion: one stop intent when a stoppable recording
  exists, `negotiationEndedAt` populated, and existing transcription/AI
  currentness eligibility. No transcript/material deletion, AI publication,
  or historical rewrite.
- One deterministic server policy (`evaluateSessionLifecyclePolicy`) answers
  eligibility, reason, `referenceAt`, `dueAt`, and why-not-due. Primary
  evaluation is the Stage 3.10 systemd maintenance timer (15s cadence).
  That timer invokes the same raw `tsx` CLI as
  `npm run maintenance:stage310 -- --task all`. The operational entrypoint
  is a non-Next runtime: it bootstraps documented env first, then
  dynamically loads maintenance. Application `import "server-only"`
  wrappers stay on Next server consumers; the CLI imports the
  runtime-neutral parsers/stores.
  The primary sweeper selects a bounded conservative superset of
  policy-due Sessions: empty/abandoned pages skip currently occupied
  rows, terminal/deleted parent-Event children, Event-closed rows, and
  rows whose shared current-generation departure/reference is still
  inside the timeout so a sticky not-due prefix cannot starve later due
  work. Policy plus the fenced writer remain authoritative. Leave, control-state polling, and
  Event-state sweeps are fallbacks that consume the same policy.
  Scheduler cadence is not a business timeout. Lifecycle correctness does
  not depend on systemd `Persistent=true`; `dueAt` is reconstructed from
  current DB state on every sweep, including the first sweep after process
  or server return. `OnBootSec=15s` only makes that first evaluation
  prompt after the timer is activated.
- Periodic 15s evaluation is quiet for ordinary `occupied` / `not_due`
  no-ops. Actionable per-session lines remain `closed` (INFO), `lost_race`
  (WARN), and sweep failures (ERROR), plus one bounded sweep summary
  (`scanned` / `evaluated` / `due` / `closed` / `lostRace` / `failures`).
  Direct transition callers such as explicit leave may still emit bounded
  transition diagnostics. Logs never include tokens, notes, transcripts,
  role instructions, or provider payloads.
- Stage 3.18A production deploy must set the three canonical business
  timeouts explicitly in **both** independent runtime env files:
  application `/var/www/negotaitions/app/.env.production` (request-driven
  Next/`negotaitions-poc` reconciliation) and maintenance
  `/etc/negotaitions/env.production` (`negotiations-stage310-maintenance.service`).
  Required values:
  `SESSION_DEBRIEF_EMPTY_CLOSE_MS=60000`,
  `SESSION_DEBRIEF_MAX_DURATION_MS=7200000`,
  `SESSION_ABANDONED_CLOSE_MS=10800000`. Canonical wins over the legacy
  alias. If either file still has only `DEBRIEF_AUTO_CLOSE_GRACE_MS=30000`
  and the canonical empty-close variable is absent, that consumer would
  intentionally retain 30 seconds. Do not treat local/example comments as
  a live env change. Do not redesign the two-file env layout in this stage.
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

Event access, join, later Session create/start, and manual completion remain
independent of Dashboard lanes: there is no Event auto-close, expiry,
past-join block, or past-grace. A past non-terminal Event may create another
Session through the existing Event host POST (`createSessionFromEvent`). That
write may set `SESSION_CREATED` as the ordinary create-session mutation; it
does not complete, cancel, or expire the Event because `scheduledAt` is past
or the Dashboard lane is ARCHIVE. Archive is a dashboard presentation lane
and does not by itself prohibit joining or reusing a non-terminal Event.
UPCOMING / CURRENT / PAST are not persisted Event statuses.

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
- Event Active / Archive is one pure derived classifier
  (`classifyEventDashboardLane`) with injected `now`. Precedence:
  1. explicit terminal Event (`COMPLETED` / `CANCELLED`) → ARCHIVE;
  2. non-terminal Event with current lobby presence or an operable child
     Session → ACTIVE;
  3. non-terminal Event whose `scheduledAt` is null or `>= now` → ACTIVE;
  4. otherwise past idle non-terminal → ARCHIVE.
  Every Dashboard Event is ACTIVE XOR ARCHIVE. Classification never writes
  Event status, `completedAt`, or `closedAt`.
- Current child-Session activity reuses the Dashboard operable-child read
  predicate (`isActiveOperableDashboardChildSession`): not deleted and not
  canonically completed. `OPEN` and `DEBRIEF_OPEN` count; `CLOSED`,
  `FINISHED + NULL`, deleted, and other terminal history do not. Having any
  child, or only a completed child, is not current activity.
- Current Event Lobby presence is the existing `participantsInLobby` count
  from lobby heartbeat/lease buckets (`derivePresenceBuckets` /
  `LOBBY_ONLINE_THRESHOLD_MS`). Stale lobby rows and
  `SessionRoomConnection` occupancy are not Lobby presence.
- A relevant operable nested Session or live Lobby occupant promotes its
  parent Event into the Active lane even when `scheduledAt` is past or
  future. Inside Active, idle upcoming Events may still render in the
  Future subsection; that is grouping, not a second lane.
- Dashboard grouping is lifecycle-driven only; management/ownership never
  creates a separate user-facing lane. Owner identity is presentation metadata:
  self-owned cards use an explicit localized self label/accent, while access
  remains governed by the existing Event and Session authorization decisions.
- Parent Event cards route their primary action to the Event lobby. Nested
  Session cards own room-entry actions, preserving the Event-to-lobby and
  Session-to-room hierarchy. Archive listing does not remove that lobby
  action for a derived-past non-terminal Event.
- Standalone Sessions (no `eventId`) render in a separate standalone group and
  are never heuristically attached to Events.
- Child Sessions remain authorization-scoped: grouping is applied only after
  existing Event/Session visibility filters and does not broaden access.
- Completed/materials-only history remains in the archive and is never a
  current-card fallback. If neither a current Session nor an Active-lane
  Event exists, the current card renders the no-active-rooms empty state.
- Archive rendering uses the same Event->Session hierarchy shape plus a
  standalone Session group. Archive may include past idle non-terminal
  Events as well as explicit `COMPLETED` / `CANCELLED` Events.
  Archive is a dashboard presentation lane and does not by itself prohibit
  joining a non-terminal Event.
- Whether a displayed Event or Session can actually be entered remains governed
  independently by the existing Event-access and Session-room-access logic;
  Dashboard selection does not grant or redefine access. There is no
  `scheduledAt < now` or `dashboardLane == ARCHIVE` deny rule.

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
from the 60-second empty-Debrief business timeout: it determines when a
network-lost room lease stops counting as active. Recording server-stop
terminal timeout is a third independent mechanism (default 90 seconds), and
stale recording `STARTING` reconciliation has its own 90-second admission
threshold. Presence heartbeat, control-state poll, and the 15-second
reconciliation cadence are not business timeouts.

## Leave And Presence Semantics

- Explicit leave is persisted before provider teardown and before navigation.
  If persistence fails or times out, the UI keeps the user in place and exposes
  the failure instead of silently treating the leave as complete.
- Refresh, tab close, browser crash, and network loss are passive disconnects.
  They remain lease-based and do not use the explicit-leave endpoint.
  Stage 3.18A records this as `ACCEPTED_BY_DESIGN`: the Session room lease
  stays the 120-second reconnect/network-loss window; Event Lobby freshness
  stays 12 seconds; no `pagehide` / `sendBeacon` fast path is required; no
  new status is added; CU-L must not be opened.
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
  state. Negotiation-participant preparation notes become read-only after
  `negotiationState === FINISHED`; they remain visible to authorized viewers
  through `resolveDebriefVisibleNotes` (own notes for a negotiation
  participant; all participant preparation notes for facilitator and
  authorized session observer). Facilitator and observer own notes stay
  editable. The same lock is enforced by the notes persist helper.

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

## Session Current Presence

- The Session management presence stream
  (`GET /api/sessions/{sessionId}/presence/stream`) is an
  account-authenticated management surface. It uses `apiRequireActiveUser`
  plus `getCurrentUserSessionAccess` / `canManageSession` — the same
  management contract as `/sessions/{id}`. It is not scoped to
  `demo@example.com` and is not joinToken-only. Unauthorized callers fail
  closed: unauthenticated `401`, authenticated but unrelated `404`
  (information hiding). A fresh Standalone Session with no
  `SessionRoomConnection` rows is a valid authorized stream: `200`
  `text/event-stream` with Offline snapshots.
- User-facing Session Online means the person has at least one current valid
  `SessionRoomConnection` lease on an operable Session. This is the same live
  lease concept used for lifecycle occupancy: not disconnected, not
  superseded, not revoked, `expiresAt` still in the future, user `ACTIVE`,
  and the Session is not deleted or `CLOSED` / canonically completed.
- Count unique logical users, not connection rows. Duplicate tabs stay
  Online 1. `FACILITATOR`, `PARTICIPANT`, and `OBSERVER` count equally.
- `SessionParticipant.lastSeenAt` is a recent heartbeat/activity signal. It
  is not authoritative room occupancy and must not label a person Online.
- Explicit Leave writes the lease disconnected and the next list/stream read
  must show Offline immediately, even when `lastSeenAt` is still inside the
  30-second heartbeat window. Browser close without Leave may remain Online
  until the lease is no longer live.
- Shared read helpers live in `lib/session-current-presence.ts`. They do not
  import the automatic-close policy or change lease write paths.

## Event Presence DTO

- Event participant presence is derived event-wide from two separate
  authorities: current Event Lobby heartbeat evidence
  (`EventParticipant.lastSeenAt` + lobby threshold) and current valid
  `SessionRoomConnection` leases on operable child Sessions.
- Canonical statuses:
  - `IN_LOBBY`
  - `IN_SESSION`
  - `TEMPORARILY_AWAY`
  - `OFFLINE`
  - `INVITED_NOT_CONNECTED`
- Location precedence is `IN_SESSION` > `IN_LOBBY` > Offline. A still-fresh
  Lobby heartbeat after the person has entered a Session must not keep them
  displayed in Lobby. The UI never claims the same person is in Lobby and in
  Session at once. If multiple operable child leases exist for one user, the
  existing newest-active-session selection is preserved.
- Event Online is the unique union of current Lobby users and current room
  users. Overlap counts once and renders as Session.
- Historical / closed / deleted child Sessions do not create current
  `IN_SESSION`. `SessionParticipant.lastSeenAt` is not an Event location
  authority.
- `TEMPORARILY_AWAY` remains the existing short-window Offline presentation
  after a recent terminal. It is not Online.
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
- `lib/session-lifecycle-policy.ts`
- `lib/session-lifecycle-candidate-selection.ts`
- `lib/session-lifecycle-sql.ts`
- `lib/session-completion.ts`
- `lib/session-completion-core.ts`
- `lib/session-lifecycle-observability.ts`
- `lib/config/session-lifecycle-settings.ts`
- `lib/session-room-occupancy.ts`
- `lib/session-room-connection-lease.ts`
- `lib/session-empty-room-reconciliation.ts`
- `lib/stage-3-10-maintenance.ts`
- `scripts/ops/stage-3-10-maintenance.ts`
- `docs/architecture/session-flow-gap-analysis.md`
