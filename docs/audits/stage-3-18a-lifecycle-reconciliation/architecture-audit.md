# Stage 3.18A Checkpoint 0 — Architecture / Forensic Audit

This file is a **historical audit of current implementation**. It is not
canonical current-state architecture and must not be read as if the Stage
3.18A target contract is already implemented.

Authoritative current-state docs remain `docs/architecture/04-session-event-flow.md`
and `docs/architecture/02-domain-model.md`. The planning authority for this
stage is `docs/requirements/stage-3-18a-lifecycle-reconciliation.md`.

```
CHECKPOINT = 0
AUDIT_KIND = READ_ONLY
PRODUCT_BEHAVIOR_CHANGE = NO
SCHEMA_CHANGE = NO
ENV_CHANGE = NO
PRODUCTION_ACCESS = NO
```

## 1. Audit verdict

```
AUDIT_VERDICT = PASS
PRODUCTION_RO_FORENSIC_REQUIRED = YES
PRODUCTION_RO_BLOCKING = NO
LOCAL_ANALOG_INSPECTION = NOT_AVAILABLE
```

Checkpoint 0 reconstructed the current lifecycle, occupancy, finalizer, Event
projection, timings, and eval gaps from source. The known rejoin/stuck-Debrief
**defect class** is identified from code. Production read-only evidence is
needed only to confirm which hole hit `cmsqjupj00021pbm1o8oaek0e`, not to
design the Change Units.

No STOP-condition blocker fired:

| STOP condition | Result |
| --- | --- |
| Target Session semantics conflict with a hard product invariant | **No blocker.** S4 approved-hours-scale auto-close of empty non-Debrief Sessions **supersedes** the Stage 3.10 sentence that empty `OPEN` never auto-closes. The 60-second Debrief grace must still never apply to active negotiation. |
| Safe auto-close requires an unanticipated DB migration | **No.** Existing timestamps are sufficient. Do not add a nullable `emptySince` / generation column. |
| No authoritative occupancy signal | **No.** Active `SessionRoomConnection` leases are the Session occupancy authority. |
| No reusable canonical finalizer | **No.** `finalizeSessionCanonicalClose` is the atomic closer. |
| Periodic reconciler needs a new service/runtime | **No.** `deploy/systemd/negotiations-stage310-maintenance.timer` already exists (install is disabled-first). |
| Event archive projection is inseparably tied to access denial | **No.** Joinability is Event status / auth, not Dashboard lane. |
| Production forensic required to identify the rejoin defect | **Defect class identified from source.** Production RO is confirmatory. |

## 2. Current lifecycle map

### 2.1 Session persisted states

| Axis | Values | Authority |
| --- | --- | --- |
| `Session.status` | `DRAFT`, `READY`, `COMPLETED` | Coarse status. Terminal display does not trust this alone. |
| `Session.negotiationState` | `PREPARATION` → `PREPARATION_RUNNING` / `PREPARATION_PAUSED` → `READY_TO_START` → `RUNNING` / `PAUSED` → `FINISHED` | Negotiation control CAS. |
| `Session.roomLifecycle` | `OPEN`, `DEBRIEF_OPEN`, `CLOSED`, or `NULL` (legacy) | Room admission / display / auto-close eligibility. |
| `Session.negotiationEndedAt` | set on canonical negotiation FINISH | **Canonical Debrief-open timestamp.** |
| `Session.endedAt` | coalesced on final close | Final Session close clock. |
| `Session.closeReason` | `string?` | `DEBRIEF_EMPTY_TIMEOUT`, `FACILITATOR_SESSION_COMPLETE`, `EVENT_COMPLETED`. |
| `Session.closedByEventAt` / `closedByEventId` | Event authority only | Session close never completes the Event. |

Current room contract (`docs/architecture/04-session-event-flow.md`):

- `OPEN`: admission allowed. **Zero occupancy never auto-closes `OPEN`.**
- `DEBRIEF_OPEN`: only state eligible for empty-room auto-close after
  `DEBRIEF_AUTO_CLOSE_GRACE_MS` (default **30,000 ms**).
- `CLOSED`: admission denied; backend supplies Event-lobby or materials redirect.

There is **no** occupied-Debrief hard maximum and **no** abandoned-`OPEN`
closer in runtime.

### 2.2 Event persisted states / dashboard projection

`TrainingEventStatus`: `DRAFT | LOBBY_OPEN | SESSION_CREATED | COMPLETED | CANCELLED`.

`TrainingEvent.scheduledAt` is persist/display/sort. It does **not** deny
lobby/join and does **not** mutate Event terminal.

Dashboard lanes today (`app/(app)/dashboard/page.tsx`):

| Lane | Current rule |
| --- | --- |
| Current / Active | Eligible Event (`not deleted`, not `COMPLETED`/`CANCELLED`) that is **not future**, **or** has a nested Session in `RUNNING` / `PAUSED` / `PREPARATION_*` / `READY_TO_START` / `PREPARATION`. Past idle Events stay Current. Lobby presence is **not** read. |
| Future / Upcoming | `scheduledAt > now` and no “relevant” nested Session. `DEBRIEF_OPEN` does **not** promote a future Event. |
| Archive | Event `COMPLETED` / `CANCELLED`, **or** any Event that already has a canonically completed child Session. A live Event with one completed child can appear in **both** Active and Archive. Cancelled Events are soft-deleted and usually drop out of lists. |

`getEventsForUser` already computes `participantsInLobby` from presence
buckets. Dashboard lane selection ignores that field.

### 2.3 Presence model

| Surface | Authority | Counts as Session occupancy? |
| --- | --- | --- |
| Session room | Active `SessionRoomConnection` lease: no `disconnectedAt` / `supersededAt` / `revokedAt`, `expiresAt > UTC now`, Session not deleted, room not `CLOSED`, User `ACTIVE` | **Yes.** Row count, not distinct users. Role-agnostic. |
| Event lobby heartbeat | `EventParticipant.lastSeenAt` | **No.** |
| Event lobby in-memory lease | `claimEventLobbyConnectionLease` | **No.** |
| `SessionParticipant.lastSeenAt` | Presentation | **No.** |
| Provider / LiveKit / Voximplant media | Media tiles | **No.** |
| Room assignment | `EventParticipant.assignedSessionId` | **No.** |

Lease TTL is `PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS` = **120,000 ms**.
Heartbeat renews `expiresAt` every **15,000 ms**. Control-state polling does
**not** renew the lease.

Explicit leave writes `disconnectedAt = now`, `disconnectedReason = EXPLICIT_LEAVE`
before navigation. Refresh / tab close / crash / network loss are passive
(`LEASE_EXPIRY`) and stay live until `expiresAt`.

Rejoin / duplicate tab: `claimSessionRoomConnectionLease` supersedes other
non-terminal rows for that user and inserts `leaseVersion + 1`. Claim does
**not** call occupancy reconciliation.

## 3. AUTO_CLOSE_MECHANISM_MATRIX

Shared empty-Debrief kernel:

- Gate: `closeDebriefRoomIfEmpty` → `evaluateDebriefAutoCloseEligibility`
- Finalizer: `finalizeSessionCanonicalClose({ authority: "DEBRIEF_EMPTY_TIMEOUT" })`
- Empty-since: `max(negotiationEndedAt, lastInvalidatedAt)`
- Grace: `getDebriefAutoCloseGraceMs()` default **30,000**
- Occupancy: canonical lease predicate above

`lastInvalidatedAt` (`sqlLastInvalidatedConnectionTimestampForSession`):

- `EXPIRED` disconnect → `expiresAt`
- other disconnect → `disconnectedAt`
- still-unmarked live/expired row (`supersededAt` and `revokedAt` null) → `expiresAt`
- also `GREATEST` with `supersededAt` / `revokedAt`
- session-global `MAX` over every connection of every `ACTIVE` user

### Mechanisms that can close a Session

| ID | File / function | Trigger | Eligibility | Occupancy | Reference | Timeout | Source | Side | Class | Mutation | Canonical finalizer | Race protection | Tests | Overlap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | `lib/session-room-occupancy.ts` `closeDebriefRoomIfEmpty` | Invoked by M2–M5 | `DEBRIEF_OPEN` + `negotiationEndedAt` + 0 active leases + grace elapsed | Active leases | `max(negotiationEndedAt, lastInvalidatedAt)` | 30s default | `DEBRIEF_AUTO_CLOSE_GRACE_MS` | Server | **Primary closer** | `COMPLETED` + `CLOSED` + `DEBRIEF_EMPTY_TIMEOUT` | **YES** `finalizeSessionCanonicalClose` | Same predicates in `UPDATE … WHERE` | `lib/session-room-occupancy.test.ts`; E2E `tests/e2e/voximplant-room-presence.spec.ts` | M2–M5 |
| M2 | `presence/leave` → `disconnectSessionRoomConnectionLease*` → `reconcileSessionAfterOccupancyChange` | Explicit Leave | Same as M1; first leave is almost always inside grace | Writes `disconnectedAt=now` | `disconnectedAt` | 30s after last leave if already Debrief | M1 | Client initiates, server decides | **Primary 30s start** | Lease disconnect; maybe M1 | YES if close happens | `updateMany` only on still-active matching `connectionId` | Presence E2E; `lib/client/explicit-room-leave.test.ts` | M3–M5 later |
| M3 | `GET …/control-state` → `triggerStage310ExpiryReconciliation` → `runSessionConnectionExpirySweep` | Room tab 1s poll | Expired leases + all `DEBRIEF_OPEN`+`FINISHED` (limit 200) | Sweep stamps `EXPIRED` then M1 | Lease `expiresAt` for passive loss | 120s lease + 30s grace + ≤2.5s throttle | Presence lease + M1 + 2500ms trigger | Client poll / server sweep | Fallback | Lease expiry + maybe M1 | YES via M1 | In-process mutex + 2.5s throttle (per Node process) | Presence E2E | M4/M5/M7 |
| M4 | `GET …/events/[id]/state` → same sweep | Lobby visible 3s / hidden 10s | Same as M3 | Same | Same | Same | Same | Client poll / server sweep | Fallback when host watches lobby | Same | YES via M1 | Same | `lib/event-state-polling.test.ts`; presence/debrief transport E2E | M3/M5 |
| M5 | `scripts/ops/stage-3-10-maintenance.ts` + systemd timer `OnUnitActiveSec=1min` | Cron / ops | Same sweep, limit default 500 | Same | Same | 120+30, quantized ~60–70s | systemd cadence | Server process | Fallback when no pollers | Same | YES via M1 | Idempotent `updateMany` + M1 SQL | Runbook; `lib/stage-3-10-maintenance.test.ts` is backfill utils, **not** the sweep | M3/M4 |
| M9 | `POST …/complete` → `completeSessionCanonical({ hardClose: true })` | Facilitator / host / manager Complete Session | `canManageSession` or Event `hostToken` | Ignored | Immediate | 0 | Manual | Server | Primary admin close | `COMPLETED` + `CLOSED` + `FACILITATOR_SESSION_COMPLETE` | **YES** | `roomLifecycle IS NULL OR <> CLOSED` | `session-finish-canonical.spec.ts`; management UI; event-completion | M1 no-ops after |
| M10 | `completeTrainingEvent` | Complete Event | Event manager | Ignored | Immediate | 0 | Manual | Server | Event-driven child close | Event `COMPLETED`; each child `EVENT_COMPLETED` | **YES** | Per-session close; Event update is a separate write | `tests/e2e/event-completion.spec.ts` | M9 if already closed |

`closeDebriefForAll` is parsed by the complete route and **ignored**. The
route always `hardClose: true`.

### Mechanisms that open Debrief but do not final-close

| ID | File / function | Trigger | Mutation | Canonical closer? |
| --- | --- | --- | --- | --- |
| M6 | `control` `FINISH` → `completeSessionCanonical({ mode: ROOM_FACILITATOR_FINISH })` | Facilitator Finish | `FINISHED` + `DEBRIEF_OPEN`; recording stop claim. Always opens Debrief, including empty room. | **NO** |
| M7 | `reconcileSessionControlAutoTransitions` `AUTO_TIMER_FINISH` | `RUNNING` and remaining seconds ≤ 0 on control/control-state | Same as M6. Timeout is `Session.durationSeconds` (default 900s), **not** 30/180. | **NO** |
| M8 | Same reconciler `RECOVER_FINISH_SIDE_EFFECTS` | `FINISHED` + `OPEN` fence | Advances to `DEBRIEF_OPEN` | **NO** |

### Not Session auto-close

| ID | What | Why |
| --- | --- | --- |
| N1 | Heartbeat `touchSessionRoomConnectionLease` | Renews lease only |
| N2 | `FINISH_LINE_DURATION_MS` 2500 | UI badge |
| N3 | `PRESENCE_ONLINE_THRESHOLD_MS` 30s / Event `TEMPORARILY_AWAY` | Presentation |
| N4 | Event lobby in-memory lease | Lobby stale-tab, not Session occupancy |
| N5 | Recording stop 90s, AI lease 180s, systemd `TimeoutStartSec=180` | Independent |
| N6 | Room-lifecycle backfill / normalize CLI | Historical repair |
| N7 | Client `setTimeout` Session closer | **Does not exist** |

## 4. Current timing inventory

| Name | Value / default | File | ENV or constant | Class | Production meaning |
| --- | --- | --- | --- | --- | --- |
| `DEBRIEF_AUTO_CLOSE_GRACE_MS` / `getDebriefAutoCloseGraceMs()` | **30000**, floor 5000 | `lib/env.ts` | ENV, **not** in `.env.example`, **not** in `server-runtime-settings.ts` | **BUSINESS_TIMEOUT** | Empty-Debrief grace |
| `PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS` | 120000 | `lib/presence.ts` | Constant | **PRESENCE_LEASE** | Session lease TTL; Event away window |
| `LEASE_EXPIRY_GRACE_MS` | alias of 120000 | `lib/session-room-connection-lease.ts` | Constant | **PRESENCE_LEASE** | `expiresAt = now + 120s` |
| `PRESENCE_HEARTBEAT_INTERVAL_MS` | 15000 | `lib/presence.ts` | Constant | **SCHEDULER_CADENCE** | Lease renew |
| `PRESENCE_ONLINE_THRESHOLD_MS` | 30000 | `lib/presence.ts` | Constant | **UI_PRESENTATION_DELAY** | Roster traffic light |
| `EVENT_LOBBY_POLL_INTERVAL_MS` | 3000 | `lib/event-state-polling.ts` | Constant | **SCHEDULER_CADENCE** | Can trigger M4 |
| `EVENT_LOBBY_HIDDEN_POLL_INTERVAL_MS` | 10000 | same | Constant | **SCHEDULER_CADENCE** | Hidden-tab lobby |
| Room control-state interval | 1000 | Voximplant + LiveKit room pages | Constant | **SCHEDULER_CADENCE** | Can trigger M3/M7 |
| Sweep throttle | 2500 | `lib/stage-3-10-maintenance-trigger.ts` | Constant | **SCHEDULER_CADENCE** | In-process |
| systemd `OnUnitActiveSec` | 1min + 0–10s | `negotiations-stage310-maintenance.timer` | Unit | **SCHEDULER_CADENCE** | Primary periodic opportunity |
| systemd `TimeoutStartSec` | 180 | `.service` | Unit | **UNRELATED** | Process watchdog |
| `FINISH_LINE_DURATION_MS` | 2500 | `lib/live-session-presentation.ts` | Constant | **UI_PRESENTATION_DELAY** | Finish-line badge |
| `DEFAULT_NEGOTIATION_DURATION_SECONDS` | 900 | `lib/negotiation-duration.ts` | Constant / Session field | **BUSINESS_TIMEOUT** | Negotiation timer (M7), not room close |
| `AI_ANALYSIS_LEASE_DURATION_MS` | 180000 | `lib/ai/analysis-operation.ts` | ENV | **UNRELATED** | AI job lease |
| Recording stop / stale STARTING | 90s | env / materials | ENV / constant | **UNRELATED** | Recording |

### Why operators see ~30s vs ~180s

There is **no** 180,000 ms Session-close constant.

- **~30s:** last occupant hits explicit Leave (M2). Occupancy drops immediately.
  Someone still polling room (1s) or Event lobby (3s) runs M3/M4. At T+30s M1
  closes.
- **~150s typical passive disconnect with a poller:** no leave POST. Lease
  stays active until `expiresAt` (~120s after last heartbeat) then +30s grace.
- **~180s with no pollers:** 120s lease + 30s grace, seen on the next **60s**
  systemd tick after grace, **or** operators adding the 30s UI-offline
  threshold to 120+30. If the timer is disabled and nobody is polling, close
  never happens.

`TimeoutStartSec=180` and `AI_ANALYSIS_LEASE_DURATION_MS=180000` are unrelated.

## 5. Known rejoin defect

### Observed

- Production problem: `cmsqjupj00021pbm1o8oaek0e` — everyone left, one person
  re-entered and left again, Session stayed `DEBRIEF_OPEN`.
- Production control: `cmsqjm5fl0000pbm1giebwr83` — everyone left, nobody
  re-entered, auto-close succeeded.
- Local analog: `cmsvr387i0000ucuait5zl6wf` — not inspected (this worktree has
  no `node_modules` / Postgres client). Do not write/repair that row.

### What source proves

Intended contract (`04-session-event-flow.md`): rejoin makes the pending close
a no-op; a later departure starts the current empty period.

Implementation:

1. Leave writes `disconnectedAt` and reconciles **immediately**. That
   evaluation is almost always `grace_period_active`. **No T+grace timer is
   scheduled.**
2. Rejoin (`claimSessionRoomConnectionLease`) creates a live lease and
   supersedes the old one. **Claim does not reconcile and does not persist a
   grace generation.** Occupancy > 0 makes M1 a no-op.
3. Second leave again evaluates immediately inside the new 30s window.
   Close depends on a **later** M3/M4/M5 sweep.
4. After the last occupant leaves the room, Session `/control-state` pollers
   stop. Event lobby M4 helps only if someone remains in lobby. The systemd
   timer is installed **disabled-first**.
5. Rejoin/leave E2E tests **backdate** `disconnectedAt` / `negotiationEndedAt`
   to 31–45s ago, then re-POST leave. That hides the “no finishing evaluator”
   hole.

This explains the control vs defect pair without production access:

- Control: last leave while a lobby/room poller still exists → M4/M3 fires at
  T+30s → close.
- Rejoin: occupant returns (often leaving lobby), then leaves and nobody
  remains polling → grace B starts and never finishes.

Secondary holes (evidential until production rows are read):

- Second leave used a stale/`SUPERSEDED` `connectionId` and did not
  terminalize the rejoin lease.
- A leftover tab still heartbeats or control-state auto-claims
  (`version === 0` → `claimSessionRoomConnectionLease`) and keeps occupancy.
- `lastInvalidatedAt` is a global `MAX` and can include a live `expiresAt`
  while that row is still unmarked. While that row is unexpired, occupancy
  is also > 0; the dangerous case is leftover/auto-claim, not the MAX math
  alone after a correct second leave.

**Likely defect boundary:** post-grace close is opportunistic, not
generation-scheduled; empty-since is derived, not a fenced generation. The
mandatory regression is S03–S05: obsolete grace must not close a newer
occupied generation, and a new leave must start a new dueAt that a later
same-policy reconciler can actually fire.

### What remains evidential

See §10. Production RO is confirmatory.

## 6. Canonical finalizer

**Candidate:** `finalizeSessionCanonicalClose` in `lib/session-room-occupancy.ts`.

Not `completeSessionCanonical`. That function is the negotiation-finish +
recording-stop orchestrator. It opens Debrief unless `hardClose`, and only
then delegates to `finalizeSessionCanonicalClose`. Empty-Debrief must not go
through it: it always claims a recording stop, which would violate “empty
Debrief does not create a second provider stop.”

| Caller | Authority |
| --- | --- |
| `closeDebriefRoomIfEmpty` | `DEBRIEF_EMPTY_TIMEOUT` |
| `completeSessionCanonical` if `hardClose` / `EVENT_COMPLETION` | `FACILITATOR_SESSION_COMPLETE` or `EVENT_COMPLETION` |

No other runtime writer of the close tuple
(`status=COMPLETED`, `endedAt` coalesce, `roomLifecycle=CLOSED`,
`closeReason`, Event `closedByEvent*` only for Event authority).

Gaps to extend, not replace:

- No `DEBRIEF_MAX_DURATION` authority.
- No `SESSION_ABANDONED_TIMEOUT` authority.
- Empty-Debrief `WHERE` is the only automatic fence. New reasons need their
  own eligibility predicates in the same `UPDATE`.
- `reconcileSessionAfterOccupancyChange.sessionCompleted` is always `false`.

## 7. Target Session policy (design, not implemented)

One policy function must compute `{ eligible, reason, dueAt }` from the same
inputs wherever it is invoked.

```
debriefOpenedAt = Session.negotiationEndedAt

emptySinceAt =
  max(debriefOpenedAt, lastCurrentGenerationDepartureAt)
  // lastCurrentGenerationDepartureAt ignores live expiresAt
  // and ignores superseded/obsolete generations

SESSION_DEBRIEF_EMPTY_CLOSE_MS = 60_000
SESSION_DEBRIEF_MAX_DURATION_MS = 7_200_000
SESSION_ABANDONED_CLOSE_MS = 10_800_000

if roomLifecycle == DEBRIEF_OPEN and debriefOpenedAt:
  emptyDueAt = emptySinceAt + SESSION_DEBRIEF_EMPTY_CLOSE_MS
              if occupancy == 0 else never
  maxDueAt   = debriefOpenedAt + SESSION_DEBRIEF_MAX_DURATION_MS
               // occupancy ignored
  dueAt = earliest of { emptyDueAt, maxDueAt }
  reason = DEBRIEF_EMPTY_TIMEOUT | DEBRIEF_MAX_DURATION

else if Session is non-terminal and not deleted
     and roomLifecycle != DEBRIEF_OPEN
     and Event is not COMPLETED/CANCELLED:
  abandonedEmptySince =
    lastValidOccupancyLossAt ?? Session.createdAt
  eligibleReferenceAt = max(
    abandonedEmptySince,
    Session.createdAt,
    parent TrainingEvent.scheduledAt if eventId and never entered
  )
  dueAt = eligibleReferenceAt + SESSION_ABANDONED_CLOSE_MS
  reason = SESSION_ABANDONED_TIMEOUT
  // 60s Debrief grace MUST NOT be used here

First successful fenced finalizeSessionCanonicalClose wins.
Later invocations are idempotent no-ops.
```

Session has **no** `scheduledAt`. Do not add one. Standalone never-entered
reference is `createdAt`. Event-created never-entered reference is
`max(createdAt, TrainingEvent.scheduledAt)`.

`PAUSED` / `RUNNING` / `PREPARATION*` empty for 60s must remain open (S08).

Occupied Debrief at 2h must use the same client-observable close as manual
complete (`COMPLETED` + `CLOSED` + canonical redirect), not a client-only
timeout.

## 8. Target Event policy (design, not implemented)

```
NO_EVENT_AUTO_CLOSE
NO_EVENT_EXPIRY
NO_PAST_EVENT_JOIN_BLOCK
NO_EVENT_PAST_GRACE
```

Current access already matches. Dashboard lanes do **not**.

TARGET presentation (not persisted status):

- **Upcoming:** `scheduledAt` in the future and no stronger current activity.
- **Current:** active Event lobby presence **or** an active/non-terminal child
  Session.
- **Past:** `scheduledAt` in the past **and** no lobby presence **and** no
  active/non-terminal child. Past may become Current if someone later enters
  the lobby.

Durable lobby signal for SSR: `EventParticipant.lastSeenAt` (already loaded).
Do not use in-memory lobby leases for Dashboard.

Manual Event completion remains an explicit separate action.

## 9. Forensic

### Local analog `cmsvr387i0000ucuait5zl6wf`

```
LOCAL_ANALOG_INSPECTION = NOT_AVAILABLE
```

This worktree has no `node_modules` and no local Postgres client. No row was
read or written.

### Production RO required

```
PRODUCTION_RO_FORENSIC_REQUIRED = YES
PRODUCTION_RO_BLOCKING = NO
```

Compare problem `cmsqjupj00021pbm1o8oaek0e` with control
`cmsqjm5fl0000pbm1giebwr83`. Bounded read-only query plan for later operator
authorization:

```sql
-- 1. Session lifecycle
SELECT id, status, "negotiationState", "roomLifecycle", "closeReason",
       "createdAt", "updatedAt", "startedAt", "endedAt", "deletedAt",
       "negotiationStartedAt", "negotiationEndedAt",
       "eventId", "createdFromEventAt", "closedByEventAt", "closedByEventId"
FROM "Session"
WHERE id IN (
  'cmsqjupj00021pbm1o8oaek0e',
  'cmsqjm5fl0000pbm1giebwr83'
);

-- 2. Parent Event (if any)
SELECT e.id, e.status, e."scheduledAt", e."completedAt", e."deletedAt",
       e."completionReason"
FROM "TrainingEvent" e
JOIN "Session" s ON s."eventId" = e.id
WHERE s.id IN (
  'cmsqjupj00021pbm1o8oaek0e',
  'cmsqjm5fl0000pbm1giebwr83'
);

-- 3. Connection generations / leave / expiry
SELECT id, "sessionId", "userId", role, "connectionId", "leaseVersion",
       "createdAt", "updatedAt", "expiresAt",
       "disconnectedAt", "disconnectedReason",
       "supersededAt", "supersededByConnectionId", "revokedAt"
FROM "SessionRoomConnection"
WHERE "sessionId" IN (
  'cmsqjupj00021pbm1o8oaek0e',
  'cmsqjm5fl0000pbm1giebwr83'
)
ORDER BY "sessionId", "createdAt", "leaseVersion";

-- 4. Do not SELECT emails, notes, tokens, or recording blobs.
```

Journal grep (no secrets), same session IDs:

- `debrief_auto_close_decision`
- `connection_disconnected` / `connection_disconnect_skipped`
- `debrief_reconciliation_after_expiry`
- `room_closed_after_expiry` / `room_closure_skipped_after_expiry`
- `canonical_session_finish_decision`

Ops check (not a DB write): whether
`negotiations-stage310-maintenance.timer` was enabled at the incident time.

## 10. Regression impact map

| Surface | Effect of this stage | Existing guards |
| --- | --- | --- |
| Room presence / leases | Generation-safe empty-since; do not change lease TTL | Presence E2E; lease tests |
| Event lobby presence | Must remain non-occupancy for Session close | `event lobby presence does not prevent debrief close` |
| Debrief grace | 30s → 60s business timeout | Occupancy unit + presence E2E (will need retarget) |
| Finish-line UX | Unchanged 2500 ms | Live presentation tests |
| Manual / admin complete | Still `finalizeSessionCanonicalClose` | `session-finish-canonical.spec.ts` |
| Event complete | Unchanged Event authority | `event-completion.spec.ts` |
| Session management | Complete Session still hard-closes | management UI E2E |
| Dashboard Active/Archive | TARGET derived Past/Current (CU-G) | `dashboard-activity-selection.test.ts`; 3.13E dashboard E2E |
| Event hierarchy | Child terminal must not keep Event Current | overview-status / dashboard tests |
| Room rejoin / duplicate tabs | Obsolete grace must lose | Presence E2E S03–S16 |
| Voximplant lifecycle | No second recording stop on auto-close | Presence E2E “no second recording-stop” |
| LiveKit paths | Same occupancy/finalizer if still mounted | Room page still polls control-state |
| Recording / transcription / AI / materials | Preserve post-processing; do not delete Session | finish-canonical; materials historical tests |
| Historical Sessions/Events | Terminal rows no-op | lifecycle / display / normalize tests |
| Standalone vs Event-created | Same Session policy; Event schedule floors never-entered children only | Presence standalone+event-created cases |

## 11. Characterization evidence used

Existing tests already pin **current** 30s behavior. No new characterization
tests were added.

- `lib/session-room-occupancy.test.ts` — 15s remaining / 31s elapsed / occupied
  / OPEN never / already-empty uses Debrief open as floor
- `lib/sql-utc-wall-clock.pg.test.ts` — 29s → 1000 ms remaining
- `tests/e2e/voximplant-room-presence.spec.ts` — 29s open / 31s close

This worktree currently has no `node_modules`, so those tests were **not
re-executed** in Checkpoint 0. Source inspection is the evidence for this
audit.
