# Stage 3.13E Wave 1 High-Risk Review

## Review identity and scope

- Reviewed implementation SHA: `c99b27dafc47d30ec72bb2ea1f238e134cc1b51c`
- Architecture baseline SHA: `c7ca4994f973ffcb58263332c250b0b322af2de0`
- Branch: `feat/stage-3-13e-live-session-ux`
- Authoritative contract: `docs/architecture/stage-3-13e-live-session-ux.md`
- Scope: the complete Wave 1 diff, with deep review of Session control,
  control-state, duration, snapshot/CAS, auto-transition, response, timer,
  canonical completion, room access/lease, recording start/stop, pause
  intervals, and sound-preference authorization paths.

The approved Stage contract was reviewed without modification. The review
found no BLOCKER, five HIGH findings, and no deferred MEDIUM or LOW findings.

## BLOCKER findings

None.

## HIGH findings and remediation

### H-01 — Sub-second pause/resume permitted control-token ABA

**Before:** pause duration was floored into whole seconds. A sub-second
pause/resume restored the same RUNNING (or PREPARATION_RUNNING) snapshot,
including the original timer epoch and unchanged pause accumulator. A delayed
PAUSE carrying epoch A's token could therefore match epoch B.

**Impact:** a stale request could pause a later timer epoch and corrupt
interactive timing under realistic concurrent clicks/network delay.

**After:** RESUME and RESUME_PREPARATION preserve whole seconds in the
accumulator and shift the running timer epoch by the remaining milliseconds
(at least 1 ms for a zero-duration same-clock transition). The narrow token and
database predicate now distinguish every pause/resume epoch.

**Regression evidence:** unit coverage proves both timer variants and the
RUNNING A -> PAUSE -> RUNNING B token inequality.

### H-02 — Facilitator lease validation had a revocation/takeover TOCTOU race

**Before:** a serializable callback read the lease but did not lock the lease
row. A concurrent takeover/revocation could invalidate the lease after the
read while the stale transaction still attempted the Session CAS. Merely
placing independent reads in one callback did not establish the required
linearization point.

**Impact:** a superseded facilitator tab could credibly mutate control state or
durations after losing authority.

**After:** control and duration transactions lock and validate the exact
SessionRoomConnection row with `SELECT ... FOR UPDATE`, while joining the
current facilitator participant and active user. The query rejects absent,
expired, disconnected, revoked, superseded, role-mismatched, and competing
active leases. Lease invalidation updates the same row, so it linearizes before
or after the Session mutation. PostgreSQL `40001` conflicts exposed as Prisma
`P2010` raw-query errors are also retried, in addition to `P2034`.

Session facilitator/lifecycle fields remain in the Session CAS. Concurrent
facilitator reassignment or canonical close therefore conflicts; event access
is read in the serializable transaction and event completion updates its
Session close invariants.

**Regression evidence:** a separate PostgreSQL transaction invalidates the
lease while a control mutation is in flight; the request returns
`409 STALE_CONNECTION` and Session state remains unchanged.

### H-03 — SessionPauseInterval was not atomic with control state

**Before:** PAUSE/RESUME committed the Session CAS, then created/closed pause
intervals outside the transaction. Failure or overlap in that gap could leave a
PAUSED Session without an interval, a RUNNING Session with an open interval,
or interval work associated with a losing request.

**Impact:** persisted active-audio timing used by transcription/analysis could
diverge from authoritative negotiation state.

**After:** interval creation/closure runs only after the winning CAS and in the
same serializable transaction. PAUSE creates at most one open interval;
RESUME/FINISH close all open intervals. Preparation actions do not touch
negotiation intervals.

**Regression evidence:** the E2E test holds the interval insert lock and proves
the Session remains RUNNING until PAUSE state and its interval can commit
together.

### H-04 — Timer auto-finish used a stale expiry decision

**Before:** reconciliation decided expiry from one read, then called canonical
completion without conditionally claiming that exact snapshot. A concurrent
PAUSE or FINISH could win between those operations, yet the stale poller could
still finish the changed state and claim completion side effects.

**Impact:** a facilitator pause at the timer boundary could be overwritten by
a stale poller, and completion/provider stop intent could be attributed to a
losing transition.

**After:** timer expiry first performs the narrow Session snapshot CAS. Only
the CAS winner invokes canonical completion. A loser rereads and reconciles
the authoritative state.

**Regression evidence:** the E2E boundary race proves a concurrently committed
PAUSE wins cleanly and creates no stop operation.

### H-05 — FINISH could collapse legacy lifecycle and lacked committed-CAS recovery

**Before:** interactive FINISH first authored FINISHED, then invoked canonical
completion. If the prior `roomLifecycle` was null, legacy lifecycle derivation
interpreted the already-FINISHED intermediate state as CLOSED instead of
DEBRIEF_OPEN. If the process failed after CAS but before canonical completion,
later polling returned FINISHED without claiming recording-stop intent or
repairing room lifecycle.

**Impact:** facilitator FINISH could incorrectly hard-close a room or leave
required canonical completion/recording-stop work missing.

**After:** the winning interactive/auto FINISH CAS normalizes a null lifecycle
to OPEN. Reconciliation detects a non-event FINISHED/OPEN intermediate state
and idempotently re-enters canonical facilitator completion, which derives
DEBRIEF_OPEN/CLOSED from occupancy and claims/delivers the unique stop intent.
Event-completed and organizer hard-close states are explicitly excluded.

**Regression evidence:** canonical finish tests require DEBRIEF_OPEN with an
active occupant, preserve administrative/event hard-close behavior, and prove
polling repairs a committed FINISH CAS while creating exactly one stop
operation.

## MEDIUM findings

None.

## LOW findings

None.

## Deferred-item mapping

| ID | Severity | Area | Finding | Evidence | Why safe to defer | Recommended remediation | Target Wave |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | No deferred findings | — | — | — | — |

## Independent review conclusions

### Narrow control-snapshot CAS

The canonical representation has explicit stable key order, ISO date/null
encoding, enum/string and numeric separation, and SHA-256 base64url output. It
contains control timers, pause accumulators, facilitator ownership, deletion,
event-close, close-reason, and room-lifecycle invariants, while excluding broad
metadata and `updatedAt`. The same snapshot builds the `updateMany` predicate,
including nullable timestamps. Zero-row updates do not execute transition side
effects and return a bounded authoritative conflict payload. H-01 closes the
negotiation and preparation ABA cases.

### Lease and room-access authority

`connectionId` is mandatory. H-02 gives lease invalidation and Session mutation
a coherent linearization point. PostgreSQL row locking prevents an invalidator
from passing the mutation; if invalidation wins, lock recheck or serializable
retry observes stale authority. Participant/user/facilitator and canonical
Session access invariants are protected by joined row locks, serializable reads,
and the Session CAS.

### START side-effect ordering

Only the START CAS winner reaches LiveKit recording lifecycle work; no-op,
stale-lease, and control-conflict requests return first. Provider start runs
after the Session commit, so an external failure can leave RUNNING with a
persisted FAILED/warning recording state. This failure model predates Wave 1
and is recoverable through the existing facilitator-authorized
`recording-control` start path; Wave 1 neither duplicated nor worsened it.
Provider work cannot be made atomic with the database CAS, and no architecture
redesign was introduced in this remediation.

### Pause/resume and preparation

The winning CAS owns pause timestamp/accumulator changes and negotiation
interval work atomically. Duplicate/no-op and losing requests cannot create or
close intervals. Preparation pause/resume and STOP_PREPARATION never write
negotiation intervals; STOP_PREPARATION from paused state finalizes preparation
pause accounting.

### Auto-expiry and canonical completion

Preparation expiry already uses narrow CAS. H-04 applies the same winner rule
to negotiation expiry. H-05 makes the post-CAS completion phase recoverable and
idempotent. Stop operation uniqueness prevents duplicate recording-stop intent.
Administrative completion and event hard close retain their broader,
authority-checked idempotent behavior and CLOSED semantics.

### Duration route

Writes are limited to pre-preparation states, require current facilitator and
strict active lease authority, and use the same expected state/token and
snapshot predicate. Duration fields participate in the token and predicate, so
partial/stale writes cannot cross preparation start.

### Control response foundation

GET/POST responses are built from the authoritative post-reconciliation row.
The returned token corresponds to that row; `serverNow`, ended timestamps, and
final remaining values are coherent. Conflict responses provide authoritative
bounded control state. No sensitive snapshot fields or raw state are exposed.

### Sound preference security sanity

The reviewed preference path requires authentication, targets only the current
user, validates the bounded boolean payload, and the non-null default preserves
existing users. No BLOCKER/HIGH issue was found.

## Test evidence

- Focused control/snapshot unit tests: 16 passed.
- Focused canonical Session finish tests: 12 passed.
- Focused Vox room presence/lease tests: 22 passed.
- `npm run validate:fast`: passed.
- `npm run validate:deploy`: passed, including production build.
- `npm run test:stage310`: passed (102 unit tests and 41 Playwright tests).
- `npm run test:e2e:smoke`: passed (13 Playwright tests plus database safety
  preflight).
- `npm run test:e2e:smoke:browser`: passed (8 Playwright tests plus database
  safety preflight).
- `git diff --check`: passed before commit; the complete post-commit range is
  checked in the final review handoff.
- The full observer layout matrix was not run because no room geometry changed;
  the mandatory `test:stage310` command includes its ordinary observer-smoke
  subset.

## Residual risk

External recording start remains intentionally post-commit and therefore
cannot share database atomicity; failure is visible and recoverable through the
existing recording-control path. External stop delivery remains an idempotent,
durable operation with retry policy. No unresolved Wave 1 BLOCKER/HIGH,
MEDIUM, or LOW finding remains.

## Final review verdict

The five production-safety defects found in the reviewed Wave 1 implementation
are remediated within the approved architecture. Subject to the mandatory gates
listed in the final execution record, the verdict is `APPROVED_FOR_WAVE_2`.

Reviewed implementation SHA:
c99b27dafc47d30ec72bb2ea1f238e134cc1b51c

Remediation commit:
SELF (the single remediation commit containing this document; exact SHA is recorded in the final report)

BLOCKER count:
0

HIGH count:
5

MEDIUM count:
0

LOW count:
0

Final verdict:
APPROVED_FOR_WAVE_2
