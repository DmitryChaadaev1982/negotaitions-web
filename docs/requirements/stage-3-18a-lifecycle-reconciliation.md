# Stage 3.18A Authoritative Requirement Manifest

## Authority and use

This is the authoritative, implementation-independent requirement/change-plan
manifest for Stage 3.18A — Lifecycle Reconciliation & Automatic Closure.

Approved decisions in this manifest are the product-planning authority for
this stage. Current architecture, privacy, access, database, and operations
documents remain the domain/safety authorities. The Checkpoint 0 forensic
audit (`docs/audits/stage-3-18a-lifecycle-reconciliation/architecture-audit.md`)
is supporting evidence. Historical Stage 3.10 docs cannot add, weaken, or
replace a requirement.

Do not silently weaken an `APPROVED` requirement. If implementation proves an
`APPROVED` requirement impossible or unsafe, set `DECISION_REQUIRED` and stop
for operator decision.

Checkpoint 0 is `PASS` / operator-accepted. Checkpoint 1 Session lifecycle
kernel is `PASS`. Checkpoint 2 Event Dashboard Active / Archive projection
is `PASS`. CU-E operational maintenance CLI runtime correction is `PASS`.
CU-K Session/Event presence display alignment is `PASS`. CU-J is
reconciled as no further implementation. CU-L must not be opened.

Operator acceptance:
- `LA-01` forensic empty-Debrief close = `PASS`
- `LA-02` leave → rejoin → leave → automatic close = `PASS`
- Presence acceptance = `PASS`
- Abrupt browser/tab close = `ACCEPTED_BY_DESIGN` (no CU-L)

Status values used in this stage:

- `APPROVED` — accepted stage scope
- `PROPOSED` — recommended by Checkpoint 0; not yet operator-accepted
- `OUT_OF_SCOPE` — forbidden or explicitly excluded
- `DECISION_REQUIRED` — operator judgment required before implementation
- `PASS` — finished review with evidence
- `DEFERRED` — later checkpoint; still expected unless superseded

Checkpoint authorization is separate from status. A later Change Unit may be
`APPROVED` stage scope and still `NOT_AUTHORIZED` for the current Cursor run.

Evidence types:

| Type | Meaning |
| --- | --- |
| `DOC` | Current-state architecture / this manifest / audit |
| `CODE` | Repository source inspection |
| `TEST` | Existing or later deterministic test evidence |
| `MANUAL` | Operator checkpoint |
| `PROD_RO` | Read-only production DB/journal evidence (not authorized in Checkpoint 0) |

## Stage identity

```
STAGE_ID = 3.18A
STAGE_NAME = Lifecycle Reconciliation & Automatic Closure
STAGE_KIND = product / lifecycle / reliability
PRODUCT_BEHAVIOR_CHANGE = SESSION_KERNEL_IN_CHECKPOINT_1

CHECKPOINT_0 = PASS
CHECKPOINT_1 = PASS
CHECKPOINT_2 = PASS
CHECKPOINT = FINAL
CHECKPOINT_KIND = RELEASE_CANDIDATE
CU_B = PASS
CU_C = PASS
CU_D = PASS
CU_E = PASS
CU_E_RUNTIME_CORRECTION = PASS
CU_F = PASS
CU_G = PASS
CU_H = PASS
CU_I = PASS
CU_J = PASS
CU_K = PASS
CU_L = MUST_NOT_OPEN
LA_01 = PASS
LA_02 = PASS
LA_03 = PASS_AUTOMATED_RELEASE_EVIDENCE
PRESENCE_ACCEPTANCE = PASS
ABRUPT_BROWSER_CLOSE = ACCEPTED_BY_DESIGN
FINALIZATION = PASS
L4 = PASS
RELEASE_CANDIDATE = PASS
S318A-D-001 = APPROVED
S318A-D-001_OPTION = Event-created Session abandoned timeout reference is floored by parent Event.scheduledAt even when early occupancy occurred.
IMPLEMENTATION_AUTHORIZED = COMPLETE
COMMIT_AUTHORIZED = YES_FEATURE_BRANCH
PUSH_AUTHORIZED = YES_FEATURE_BRANCH
DEPLOY_AUTHORIZED = NO
PRODUCTION_ACCESS = NO
SCHEMA_CHANGE = NO
ENV_CHANGE = NO
```

## Objective

Reconstruct the complete current Session/Event lifecycle implementation,
define one authoritative target lifecycle contract, identify
race/regression risks, decompose into Change Units, and produce a
validation plan. Do not implement the lifecycle fix in Checkpoint 0.

## Explicit non-scope

| ID | Requirement | Status |
| --- | --- | --- |
| S318A-NS-001 | `NO_EVENT_AUTO_CLOSE`. Do not server-close an Event because time elapsed. | `OUT_OF_SCOPE` |
| S318A-NS-002 | `NO_EVENT_EXPIRY`. Do not add an Event expiry timer. | `OUT_OF_SCOPE` |
| S318A-NS-003 | `NO_PAST_EVENT_JOIN_BLOCK`. Do not deny Lobby entry or 404 because `scheduledAt < now`. | `OUT_OF_SCOPE` |
| S318A-NS-004 | `NO_EVENT_PAST_GRACE` / `EVENT_PAST_GRACE_MS`. | `OUT_OF_SCOPE` |
| S318A-NS-005 | Do not delete Session data on automatic close. | `OUT_OF_SCOPE` |
| S318A-NS-006 | Do not apply the 60-second Debrief grace to `PREPARATION` / `RUNNING` / `PAUSED` or equivalent active negotiation. | `OUT_OF_SCOPE` |
| S318A-NS-007 | Do not invent a nullable Session `emptySince` / occupancy-generation column. | `OUT_OF_SCOPE` |
| S318A-NS-008 | Do not invent a Session `scheduledAt` field. Session has none. | `OUT_OF_SCOPE` |
| S318A-NS-009 | Do not create a second Session-close writer beside `finalizeSessionCanonicalClose`. | `OUT_OF_SCOPE` |
| S318A-NS-010 | Do not route empty-Debrief or Debrief-max close through `completeSessionCanonical` (those paths must not claim a second recording stop). Abandoned non-Debrief close is the accepted exception: it uses `completeSessionCanonical` so the first recording-stop intent happens exactly once (`S318A-S5`). | `OUT_OF_SCOPE` |
| S318A-NS-011 | Do not add a new daemon/runtime model. Extend the existing Stage 3.10 maintenance timer / request fallbacks. | `OUT_OF_SCOPE` |
| S318A-NS-012 | Do not silently redefine manual Event completion. | `OUT_OF_SCOPE` |
| S318A-NS-013 | Do not access production or change ENV/schema/product behavior in Checkpoint 0. | `OUT_OF_SCOPE` |
| S318A-NS-014 | Do not treat presence heartbeat/lease timing as the business auto-close timeout. | `OUT_OF_SCOPE` |
| S318A-NS-015 | Do not add forgotten-Event archive mutation, Event deletion, or join expiration. | `OUT_OF_SCOPE` |

## Approved Session contract

| ID | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| S318A-S1 | A `DEBRIEF_OPEN` Session that remains empty of Session-room occupancy for `SESSION_DEBRIEF_EMPTY_CLOSE_MS` (target default 60,000) after canonical last-room-presence loss must close through the canonical Session finalizer. `FACILITATOR`, `PARTICIPANT`, and `OBSERVER` count. Event Lobby presence does not. | `APPROVED` | Operator packet; current code uses 30,000 (`DEBRIEF_AUTO_CLOSE_GRACE_MS`) |
| S318A-S2 | Leave → grace A; rejoin before expiry invalidates A; later leave starts grace B from the new final leave. An obsolete A callback/reconciler must not close the newer occupied generation. Mandatory regression. | `APPROVED` | Operator packet; current rejoin E2E exists but backdates timestamps |
| S318A-S3 | A Debrief may remain open at most `SESSION_DEBRIEF_MAX_DURATION_MS` (target default 7,200,000) from `Session.negotiationEndedAt`, regardless of occupancy. Occupied users must observe the same canonical session-ended transition as manual complete. Effective deadline is the earliest of empty-since+60s and debrief-opened+2h. | `APPROVED` | Operator packet; **no current 2h closer** |
| S318A-S4 | Any other non-terminal empty Session may be auto-closed after `SESSION_ABANDONED_CLOSE_MS` (target default 10,800,000). The 60s Debrief grace must not be reused. If nobody ever entered, the reference must not close a future Event child before `max(Session.createdAt, parent Event.scheduledAt)`. | `APPROVED` | Operator packet; **no current OPEN closer** — this supersedes the Stage 3.10 “empty OPEN never auto-closes” rule for the **hours-scale** case only |
| S318A-S5 | Reasons that decide *when* may differ; the operation that *closes* must be one canonical domain boundary: `finalizeSessionCanonicalClose`. Preserve post-processing / history. Do not delete Session data. | `APPROVED` | `lib/session-room-occupancy.ts`; `lib/session-completion.ts` |

## Approved Event contract

| ID | Requirement | Status | Current code |
| --- | --- | --- | --- |
| S318A-E1 | No automatic Event closure / expiry / time-based archive mutation. | `APPROVED` | Already satisfied |
| S318A-E2 | A past Event remains joinable under existing authorization. `scheduledAt < now` must not 404 or disable Lobby. | `APPROVED` | Already satisfied (`joinTrainingEvent` / access ignore the clock) |
| S318A-E3 | Dashboard Upcoming / Current / Past is derived presentation only. Current = lobby presence **or** active/non-terminal child Session. Past = past `scheduledAt` **and** no lobby presence **and** no active/non-terminal child. Past may become Current if someone later enters Lobby. Archive display must not imply access denial. | `APPROVED` | **Satisfied in CP2.** `classifyEventDashboardLane` is the single Active XOR Archive projection. Archive is a dashboard presentation lane and does not by itself prohibit joining a non-terminal Event. |

## Decision required

| ID | Question | Recommendation | Status |
| --- | --- | --- | --- |
| S318A-D-001 | If a future Event child Session **had real occupancy** during early setup, then everyone left, does abandoned close fire at `lastLeave + 3h` (even days before `Event.scheduledAt`) or wait until `max(lastLeave, Event.scheduledAt) + 3h`? | Approved operator option: floor **both** never-entered and early-occupied Event-created Sessions by `parent Event.scheduledAt`. | `APPROVED` |
| S318A-D-002 | Rename `DEBRIEF_AUTO_CLOSE_GRACE_MS` to `SESSION_DEBRIEF_EMPTY_CLOSE_MS` immediately, or keep the old name as a compatibility alias for one release? | Canonical variable wins when set. Legacy alias supplies a value only when the canonical variable is absent. Invalid canonical values fail closed to the default and do not fall through to the alias. | `APPROVED` |

## Proposed configuration (do not add ENV in Checkpoint 0)

Inspected convention: business Debrief grace already lives in `lib/env.ts`
(`getDebriefAutoCloseGraceMs`). The reviewed deployment registry is
`lib/config/server-runtime-settings.ts`. `DEBRIEF_AUTO_CLOSE_GRACE_MS` is
**not** in `.env.example` and **not** in the runtime-settings registry.

Recommended canonical names (implementation CU only):

| Name | Default | Class |
| --- | --- | --- |
| `SESSION_DEBRIEF_EMPTY_CLOSE_MS` | 60000 | `BUSINESS_TIMEOUT` |
| `SESSION_DEBRIEF_MAX_DURATION_MS` | 7200000 | `BUSINESS_TIMEOUT` |
| `SESSION_ABANDONED_CLOSE_MS` | 10800000 | `BUSINESS_TIMEOUT` |
| `SESSION_LIFECYCLE_RECONCILE_INTERVAL_MS` | document-only / systemd 1 min | `SCHEDULER_CADENCE` — **not** a business timeout |
| `DEBRIEF_AUTO_CLOSE_GRACE_MS` | alias → empty-close | Compatibility |

Register the three business timeouts in `lib/env.ts` **and**
`server-runtime-settings.ts` (feature area Session lifecycle). Do not treat
lease/heartbeat/poll constants as business timeouts.

## CIA

```
CHANGE: one Session auto-close policy (60s empty Debrief, 2h Debrief max,
        3h abandoned non-Debrief) evaluated by primary+fallback invokers
        against the same dueAt, written only by finalizeSessionCanonicalClose;
        generation-safe occupancy/rejoin; derived Event Current/Past
        presentation. Checkpoint 0 is docs/audit only.
INVARIANTS: no Event auto-close/expiry/join-block; past Event remains
            joinable; Event completion stays explicit; Session data is not
            deleted; 60s grace never closes active negotiation; empty-Debrief
            does not re-stop recording; historical CLOSED/deleted rows no-op;
            FACILITATOR/PARTICIPANT/OBSERVER occupy; Event lobby does not;
            first fenced closer wins
IMPACT: server/domain, API (complete/control-state/leave/event-state),
        polling/reconcile, projections (Dashboard), lifecycle, ENV
        (later CU), historical data (compatibility), tests/evals.
        No DB/schema/migration anticipated. Client observes the same
        ROOM_CLOSED / materials redirect. Provider recording stop unchanged
        for automatic close.
UNITS: CU-A .. CU-J (refined below)
KERNEL: CU-B + CU-C + CU-D + CU-E + CU-I
EVAL: STATE, TRANSITION, MOUNTED_TRANSITION, HISTORICAL_READ,
      HISTORICAL_FIRST_MUTATION, INTERACTION; MANUAL/PROD_RO confirmatory
STRATEGY: B — stabilize high-risk Session policy/occupancy/finalizer/
          reconciler first; Dashboard projection and diagnostics after
VALIDATION_PLAN: Checkpoint 0 = L1 docs + registry check. Implementation
                 kernel = L1 policy units then L2 presence/finish subset.
                 L3 at Session-policy checkpoint. L4 at final code package.
                 CU-G may L1/L2 separately. Do not run live providers.
```

## Change Units

Expected conceptual CUs were refined from source. Abandoned eligibility (old
CU-F) is part of the single policy unit. Historical compatibility is tested
with the finalizer, not a separate writer.

| ID | Change Unit | Risk | Coupling | Checkpoint | Implementation authorization | Status |
| --- | --- | --- | --- | --- | --- | --- |
| CU-A | Lifecycle inventory / forensic / this manifest | LOW | n/a | 0 | `AUTHORIZED` (docs only) | `PASS` |
| CU-B | Canonical lifecycle policy + ENV configuration | HIGH | CU-C, CU-D, CU-E | 1 | `AUTHORIZED` | `PASS` |
| CU-C | Occupancy / rejoin generation semantics (empty-since excludes live `expiresAt`; current-generation departure only) | HIGH | CU-B, CU-I | 1 | `AUTHORIZED` | `PASS` |
| CU-D | Extend `finalizeSessionCanonicalClose` authorities (`DEBRIEF_MAX_DURATION`, `SESSION_ABANDONED_TIMEOUT`) with fenced `WHERE` | HIGH | CU-B, CU-I | 1 | `AUTHORIZED` | `PASS` |
| CU-E | Primary + fallback reconciliation wiring to the **same** policy/dueAt/finalizer (existing systemd sweep + leave + control-state + event-state) | HIGH | CU-B, CU-D | 1 | `AUTHORIZED` | `PASS`; operational CLI runtime correction (raw tsx / env bootstrap before Prisma; Next `server-only` wrappers retained) |
| CU-F | Abandoned Session eligibility / reference (never-entered vs last leave; Event `scheduledAt` floor) | HIGH | merged into CU-B | 1 | `AUTHORIZED` | `PASS`; `S318A-D-001` approved |
| CU-G | Event dashboard / archive derived projection (Current/Past; lobby presence) | MEDIUM | low with kernel; regression overlap after child close | 2 | `AUTHORIZED` | `PASS` |
| CU-H | Historical compatibility (CLOSED / `FINISHED+NULL` / deleted / Event-closed no-op; no backfill) | HIGH | CU-D | 1 | `AUTHORIZED` | `PASS` |
| CU-I | Concurrency / idempotency / currentness (SQL fence; obsolete grace loses) | HIGH | CU-C, CU-D, CU-E | 1 | `AUTHORIZED` | `PASS` |
| CU-J | Observability / close-reason diagnostics | LOW | after kernel | 2 | `NOT_AUTHORIZED` | `PASS` / `NO_FURTHER_IMPLEMENTATION_REQUIRED` — CP1 kernel already logs automatic reason, dueAt/evaluatedAt, close/lost-race, quiet periodic no-op, and one sweep summary |
| CU-K | Session & Event presence display alignment | MEDIUM | read-model only; kernel read-only reuse | 3 | `AUTHORIZED` | `PASS` |

```
HIGH_RISK_KERNEL = CU-B + CU-C + CU-D + CU-E + CU-I
                   (CU-F is specified inside CU-B; CU-H is validated with CU-D)
```

## Change graph

```
CU-A (Checkpoint 0)
  → operator review
  → [S318A-D-001 decision]
  → KERNEL BATCH: CU-B/F + CU-C + CU-D + CU-E + CU-I + CU-H tests
  → CU-G (Dashboard) and CU-J (diagnostics) in parallel after kernel
  → architecture current-state doc update only when behavior lands
```

**WHY KEEP TOGETHER (kernel):** one dueAt, one occupancy clock, one SQL
finalizer, and every invoker. Splitting these re-creates the 30/60/180
split.

**WHY SPLIT CU-G:** Event access already matches TARGET. Dashboard is
presentation. It can ship after the Session closer exists so “child became
terminal → Event may become Past” is testable, but it does not share the
close writer.

**WHY SPLIT CU-J:** logging after the contract is stable.

## High-risk kernel

Proved from source, not assumed:

1. **Occupancy / rejoin generation (CU-C)** — empty-since is a derived global
   `MAX`; claim does not fence a generation; leave-time reconcile cannot
   finish a grace.
2. **Canonical finalizer (CU-D)** — only safe closer; new reasons must use
   the same `UPDATE` fence.
3. **Concurrency / idempotency (CU-I)** — first successful fenced update
   wins; obsolete grace must lose to a newer generation.
4. **Reconciler (CU-E)** — all invokers must evaluate the same dueAt. The
   existing systemd timer is the periodic primary; request paths stay
   fallback. Do not add a second timeout number.

## Eval matrix

Eval class key: `STATE` / `TRANSITION` / `MOUNTED_TRANSITION` /
`HISTORICAL_READ` / `HISTORICAL_FIRST_MUTATION` / `INTERACTION` /
`MANUAL_PRODUCTION`.

Registry IDs are **proposed** for implementation. Do not add them until the
invariant is introduced. Adjacent existing registry entry:
`EVAL-ROOM-FINISH-CANONICAL`.

### Session

| ID | Scenario | Class | Coverage | Existing evidence |
| --- | --- | --- | --- | --- |
| S01 | Debrief empty 59s → remains open | `TRANSITION` | `PARTIAL` | Current tests assert **29s open / 30s grace**. Target 59s is GAP until CU-B. |
| S02 | Debrief empty ≥60s → closes | `TRANSITION` | `PARTIAL` | Current **31s** close + `DEBRIEF_EMPTY_TIMEOUT`. |
| S03 | Leave → rejoin before grace → old deadline invalid | `TRANSITION` | `EXISTING` | `voximplant-room-presence.spec.ts` reconnect-before-deadline |
| S04 | Leave → rejoin → leave → **new** 60s deadline | `TRANSITION` | `PARTIAL` | Same E2E exists but **backdates** timestamps; does not prove a live finishing reconciler |
| S05 | Obsolete grace races rejoin → occupied/new generation wins | `TRANSITION` | `PARTIAL` | Occupied-wins + leave-vs-claim; no concurrent obsolete-finalizer vs `leaseVersion` |
| S06 | Debrief occupied until 2h → forced canonical close | `TRANSITION` | `GAP` | Inverse exists (occupied stays open) |
| S07 | Empty-close vs 2h limit → earliest reason wins | `TRANSITION` | `GAP` | |
| S08 | Active negotiation empty 60s → **not** closed | `TRANSITION` | `EXISTING` | Occupancy unit + presence E2E OPEN/pre-Debrief |
| S09 | Active negotiation empty 3h → closed | `TRANSITION` | `GAP` | S08 currently **forbids** this |
| S10 | Never-entered standalone +3h → closed | `TRANSITION` | `GAP` | Reference = `createdAt` |
| S11 | Future Event child created early → **not** prematurely closed | `TRANSITION` | `GAP` | |
| S12 | Parent Event time passes + unused Session +3h → closes | `TRANSITION` | `GAP` | |
| S13 | Facilitator-only Debrief → occupied | `STATE` | `EXISTING` | Role-agnostic presence E2E |
| S14 | Observer-only Debrief → occupied | `STATE` | `EXISTING` | Same |
| S15 | Event Lobby-only presence → child Session still empty | `STATE` | `EXISTING` | Lobby does not prevent Debrief close |
| S16 | Duplicate tabs / superseded lease | `TRANSITION` | `EXISTING` | Presence takeover / stale-tab E2E |
| S17 | Network loss then reconnect | `MOUNTED_TRANSITION` | `PARTIAL` | Lease-based loss exists; not a one-shot Debrief-grace cancel |
| S18 | Manual close races auto-close → one terminal transition | `TRANSITION` | `PARTIAL` | Sequential idempotency only |
| S19 | Two reconcilers race → one finalizer | `TRANSITION` | `GAP` | |
| S20 | Historical terminal Session → no mutation | `HISTORICAL_READ` | `PARTIAL` | Display/access; reconciler no-op GAP |
| S21 | Deleted / cancelled Session → no inappropriate mutation | `HISTORICAL_READ` | `PARTIAL` | Access + SQL `deletedAt IS NULL`; reconciler test GAP |

S20/S21 also need `HISTORICAL_FIRST_MUTATION` once the new reconciler first
touches historical shapes (must no-op).

### Event

| ID | Scenario | Class | Coverage | Existing evidence |
| --- | --- | --- | --- | --- |
| E01 | Future idle Event → Upcoming | `STATE` | `COVERED` | `classifyEventDashboardLane`; `EVAL-S318A-EVENT-DASH-LANE` |
| E02 | Past idle Event → Archive/Past | `STATE` | `COVERED` | Classifier + Dashboard partition |
| E03 | Past Event + lobby occupant → Current | `STATE` | `COVERED` | Uses existing `participantsInLobby` |
| E04 | Past Event + active child Session → Current | `STATE` | `COVERED` | Operable-child predicate |
| E05 | Occupant leaves / child terminal → Past again | `TRANSITION` | `COVERED` | Unit + Dashboard reload E2E |
| E06 | Past Event remains joinable | `STATE` | `COVERED` | Access unit + Archive Open lobby E2E |
| E07 | Past Event can later create/use Session if auth allows | `INTERACTION` | `COVERED` | Host POST `/api/events/[id]/host` → `createSessionFromEvent`; ARCHIVE → ACTIVE → ARCHIVE after child complete |
| E08 | Historical terminal child does **not** make Event Current | `STATE` | `COVERED` | CLOSED / FINISHED+NULL / deleted |
| E09 | Manual Event completion unchanged | `TRANSITION` | `COVERED` | Classifier terminal precedence + existing `event-completion.spec.ts` |
| E10 | Archive display does not imply access denial | `INTERACTION` | `COVERED` | Non-terminal Archive card keeps Open lobby |
| E11 | Event appears in exactly one lane | `STATE` | `COVERED` | `partitionDashboardEventsByLane` + E2E |
| E12 | Past Event + DEBRIEF_OPEN child → ACTIVE | `STATE` | `COVERED` | Operable-child includes DEBRIEF_OPEN |
| E13 | That child canonical-closes → ARCHIVE if no Lobby | `TRANSITION` | `COVERED` | Unit + E2E |
| E14 | COMPLETED/CANCELLED + apparent activity → ARCHIVE | `STATE` | `COVERED` | Terminal precedence |
| E15 | Future Event with completed historical child only → ACTIVE | `STATE` | `COVERED` | Upcoming, not child activity |

## Validation plan

### Checkpoint 0 (this packet)

```
PLANNED_VALIDATION_LEVEL = L1_DOCS
ACTUAL_VALIDATION_LEVEL = L1_DOCS
```

Required:

- `git diff --check`
- `npm run eval:registry:check`

Focused characterization: existing occupancy/display units. Do **not** run
broad L3/L4. Do **not** run live providers. Do **not** add tests that encode
the 60s/2h/3h **target** against current 30s product behavior.

This worktree currently has no `node_modules`. Occupancy units were inspected,
not re-executed. Registry check is a standalone Node script.

### After implementation authorization (not this run)

| Boundary | Level | Evals |
| --- | --- | --- |
| CU-B policy units | L1 | S01/S02/S07/S08/S10/S11 clock math |
| CU-C generation | L1 then L2 | S03/S04/S05/S13/S14/S16 |
| CU-D/E/I kernel | L2 | S02/S06/S09/S18/S19 + `EVAL-ROOM-FINISH-CANONICAL` |
| Session-policy checkpoint | L3 `validate:fast` + focused presence/finish | |
| CU-G | L1 units + L2 dashboard/event subset + targeted Playwright | E01–E15 |
| Final code package | L4 | `validate:fast`, `validate:build`, smoke, browser smoke |
| Production RO | `MANUAL_PRODUCTION` | confirmatory forensic |

## Proposed checkpoint plan

| CP | Content | STOP |
| --- | --- | --- |
| **0** | This audit + manifest + CIA | **STOP for operator review.** Implementation not authorized. |
| **1** | Kernel CU-B/C/D/E/I/H (+ CU-F inside B) after `S318A-D-001` | STOP if kernel evals fail or a migration becomes necessary |
| **2** | CU-G Dashboard lane projection + E07 reuse evidence | Operator visual acceptance for lane changes. CU-J reconciled as no further implementation. Architecture `04` / code-map updated. |
| **3** | Remaining presentation polish only if operator requests it | CU-J implementation is not required |
| **4** | L4 package / feature-branch release candidate | Feature commit/push authorized after L4. Production deploy remains a later authorized step. |

Optional confirmatory production RO may run between CP0 and CP1 without
blocking CP1 design.

## Forensic (checkpoint record)

```
PRODUCTION_PROBLEM = cmsqjupj00021pbm1o8oaek0e
PRODUCTION_CONTROL = cmsqjm5fl0000pbm1giebwr83
LOCAL_ANALOG = cmsvr387i0000ucuait5zl6wf
PRODUCTION_RO_FORENSIC_REQUIRED = YES
PRODUCTION_RO_BLOCKING = NO
LOCAL_ANALOG_INSPECTION = NOT_AVAILABLE
```

Exact production SQL is in the audit §9. Do not run it in this checkpoint.

## Final accepted state

```
CP0 = PASS
CP1 = PASS
CP2 = PASS
CU_E_RUNTIME_CORRECTION = PASS
CU_K = PASS
LA_01 = PASS
LA_02 = PASS
LA_03 = PASS_AUTOMATED_RELEASE_EVIDENCE
PRESENCE_ACCEPTANCE = PASS
ABRUPT_BROWSER_CLOSE = ACCEPTED_BY_DESIGN
CU_L = MUST_NOT_OPEN
FINALIZATION = PASS
L4 = PASS
RELEASE_CANDIDATE = PASS
```

### LA-01 forensic empty-Debrief close

Exact production forensic PASS:

- effective `SESSION_DEBRIEF_EMPTY_CLOSE_MS` = 60000
- empty at `2026-08-24T14:30:53.517Z`
- due `2026-08-24T14:31:53.517Z`
- canonical close `2026-08-24T14:32:17.034Z`
- `closeReason` = `DEBRIEF_EMPTY_TIMEOUT`

### LA-02 rejoin then automatic close

Manual PASS on Event-child and standalone Sessions:

leave → rejoin → leave → automatic close.

### LA-03 Event Archive reuse

Automated release evidence is the managed production-path E2E
`tests/e2e/event-archive-reuse.spec.ts` (`G-REUSE`):

past idle nonterminal Event → Archive → Open lobby → real host POST
`/api/events/[id]/host` (`createSessionFromEvent`) → Active → complete
child + empty Lobby → Archive again.

A new manual operator test is not required when that managed E2E passes.

### Abrupt browser/tab close — ACCEPTED_BY_DESIGN

- Explicit Leave = immediate disconnect.
- Abrupt Session browser disappearance = `SessionRoomConnection` lease expiry.
- Session room lease remains the 120-second reconnect/network-loss safety window.
- Event Lobby presence threshold remains 12 seconds.
- No `pagehide` / `sendBeacon` fast path is required.
- No new status is introduced.
- CU-L MUST NOT be opened.

### Production activation requirements

Do not change live env files in this Cursor pass. At Stage 3.18A
deployment, set the same three canonical values in **both** independent
runtime env files:

```
SESSION_DEBRIEF_EMPTY_CLOSE_MS=60000
SESSION_DEBRIEF_MAX_DURATION_MS=7200000
SESSION_ABANDONED_CLOSE_MS=10800000
```

| RUNTIME | ENV_SOURCE | NEEDS_THREE_STAGE318A_VALUES | WHY |
| --- | --- | --- | --- |
| Next / application service `negotaitions-poc` | `/var/www/negotaitions/app/.env.production` | YES | Request-driven leave / control-state / Event-state fallbacks load application env. Historical systemd evidence: `EnvironmentFile=.../.env.production`. |
| `negotiations-stage310-maintenance.service` | `/etc/negotaitions/env.production` | YES | Periodic 15s sweeper. Repository unit: `EnvironmentFile=/etc/negotaitions/env.production` and `Environment=NODE_ENV=production`. Production CLI must not load the application `.env.production`. |

These files can drift. Do not redesign env architecture in Stage 3.18A.
The bounded operational update is: write the three named values into both
files, then restart `negotaitions-poc` and start/enable the Stage 3.10
timer only after the later authorized deploy step. Canonical wins over
`DEBRIEF_AUTO_CLOSE_GRACE_MS`. If only the legacy
`DEBRIEF_AUTO_CLOSE_GRACE_MS=30000` alias is present, compatibility would
intentionally retain 30 seconds.

Stage 3.10 maintenance timer target:

```
OnBootSec=15s
OnUnitActiveSec=15s
RandomizedDelaySec=2s
Persistent=true
```

Repository validation must not enable the production timer.

## Authorization

```
PRODUCT_IMPLEMENTATION = STAGE_3_18A_COMPLETE
COMMIT = AUTHORIZED_FEATURE_BRANCH
PUSH = AUTHORIZED_FEATURE_BRANCH
DEPLOY = NOT_AUTHORIZED
PRODUCTION_DB = NOT_AUTHORIZED
ACTUAL_ENV_FILE = NOT_CHANGED
SCHEMA_CHANGE = NOT_AUTHORIZED
```

## Checkpoint 2 CIA

```
CHANGE: derived Event Dashboard ACTIVE/ARCHIVE lane from explicit terminal
        status, current lobby presence, operable child Session, and
        scheduledAt vs injected now. Presentation only.
INVARIANTS: no Event auto-close/expiry/join-block; past non-terminal remains
            joinable; explicit COMPLETED/CANCELLED stay ARCHIVE; one Event
            in exactly one lane; Session kernel unchanged; no migration/ENV
IMPACT: server/domain (read helper), projections (Dashboard), client
        (archive empty-state / non-terminal archive navigation), tests/evals
UNITS: CU-G
KERNEL: none (medium projection). Session kernel is read-only reuse.
EVAL: E01-E15 STATE/TRANSITION; INTERACTION for archive joinability
STRATEGY: A — one classifier + all Dashboard consumers in one batch
VALIDATION_PLAN: L1 classifier/selector/access; L2 event/dashboard cluster;
                 targeted Playwright; eval:registry:check; git diff --check;
                 validate:fast. No L4.
```

## Checkpoint 2 reuse-evidence CIA

```
CHANGE: production-path evidence that a derived-ARCHIVE non-terminal Event
        can create/start a later Session via existing host POST, then return
        to ARCHIVE after that child becomes terminal. No classifier/kernel
        redesign.
INVARIANTS: no Event auto-close/expiry/join-block; scheduledAt < now and
            ARCHIVE lane are not access predicates; Event.status is not
            mutated merely because the Event is historical; existing
            createSessionFromEvent may set SESSION_CREATED; auth unchanged
IMPACT: tests/evals, requirements coverage, architecture reuse wording
UNITS: CU-G evidence closeout (E07); CU-J read-only reconciliation
KERNEL: none
EVAL: E07 INTERACTION via EVAL-S318A-EVENT-DASH-LANE-JOINABLE and
      EVAL-S318A-EVENT-DASH-LANE-REVERSIBLE
STRATEGY: A — extend existing lane/joinability evidence
VALIDATION_PLAN: focused reuse E2E + dashboard/completion regression;
                 eval:registry:check; git diff --check; validate:fast. No L4.
```

## Checkpoint 3 CIA

```
CHANGE: Session/Event user-facing current presence reads live
        SessionRoomConnection leases (and Event Lobby heartbeat), not
        SessionParticipant.lastSeenAt. Event location is Room > Lobby > Offline.
INVARIANTS: no 60s/2h/3h close change; no lease write/fencing change; no Event
            auto-close; no past-join change; no migration/ENV; lastSeenAt remains
            a heartbeat field
IMPACT: server/domain (read helpers), API (session presence GET/SSE),
        projections (session list/overview, event overview/state), client
        (sessions list, participants table, Event lobby location), tests/evals
UNITS: CU-K
KERNEL: none (read/projection). Session lifecycle kernel is unchanged.
EVAL: P01-P10, E-P01-E-P12, UI-P1/UI-P2,
      EVAL-S318A-SESSION-PRESENCE-DISPLAY,
      EVAL-S318A-EVENT-PRESENCE-LOCATION
STRATEGY: A — one shared read model + all current-presence consumers
VALIDATION_PLAN: L1 helper/list/location tests; L2 overview/event/dashboard
                 cluster; targeted Playwright; eval:registry:check;
                 git diff --check; validate:fast. No L4.
```

## STOP

```
STOP = YES
NEXT = FEATURE_COMMIT_AND_PUSH_THEN_DEFER_PRODUCTION_DEPLOY
```

Feature-branch commit and push are authorized only after finalization
gates pass. Production deploy is not part of this Cursor pass.
CU-J needs no further implementation for Stage 3.18A.
CU-L must not be opened.
