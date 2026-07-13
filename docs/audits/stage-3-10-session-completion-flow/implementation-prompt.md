# Stage 3.10 Implementation Prompt (Executable)

## Model recommendation

- Use GPT-5.3 Codex (high reasoning mode) for implementation, migration safety checks, and test-fix loops.

## Branching and workspace

- New implementation branch: `feature/stage-3-10-session-completion-flow`
- Base branch: `deploy/yandex-poc`
- Do not create a new worktree unless local tooling constraints make in-place implementation impossible.
- This prompt describes future implementation only; do not execute implementation during docs-only audit update.

## Preflight and clean-tree requirements

Run before any code edits:

1. `git fetch --all --prune`
2. `git checkout deploy/yandex-poc`
3. `git pull --ff-only`
4. `git checkout -b feature/stage-3-10-session-completion-flow`
5. `git status --short`

Clean-tree requirement:

- Working tree must be clean before implementation starts.
- If tree is dirty, either stash/commit unrelated work first or stop and ask for direction.

## Architecture decisions (must implement)

1. Treat Prisma migration as required for durable target implementation.
2. Do not overload `Session.status` or `Session.negotiationState` with durable room occupancy semantics.
3. Introduce separate durable room lifecycle concept equivalent to:
   - `OPEN`
   - `DEBRIEF_OPEN`
   - `CLOSED`
4. Keep `Session.negotiationState` responsible for negotiation lifecycle.
5. Keep recording, transcript, and AI status lifecycles independent.
6. Prefer PostgreSQL-backed durable presence ledger for current scale; do not introduce Redis solely for this feature.

## Authoritative active-connection predicate (must use everywhere)

A connection is active for occupancy/last-disconnect only if all are true:

1. belongs to target Session;
2. role in `FACILITATOR|PARTICIPANT|OBSERVER`;
3. `disconnectedAt IS NULL`;
4. `expiresAt > authoritative database/server time`;
5. not superseded/revoked;
6. user + membership remain valid for room access;
7. Session is not deleted;
8. room lifecycle is not already `CLOSED`.

Do not count:

- expired rows;
- explicitly disconnected rows;
- superseded stale tabs;
- revoked/deleted members/users;
- Event-lobby-only presence;
- materials-page polling;
- webhook/worker activity;
- provider participants without valid app connection row;
- stale in-memory lease without valid durable row.

## Duplicate-tab policy (selected)

- Preserve current tested same-login takeover behavior (policy B).
- New connection may supersede previous connection in same logical context.
- Superseded connection must not count as active and must not renew.
- Supersession must be durable (not in-memory-only enforcement).

## Exact lifecycle policy

### Normal Session FINISH

- Apply canonical backend Session completion flow for all entry points.
- Set negotiation state to `FINISHED`.
- Trigger idempotent recording-stop orchestration.
- Room lifecycle:
  - active relevant connections remain -> `DEBRIEF_OPEN`;
  - none remain -> `CLOSED`.
- Materials remain accessible in all processing states.

### TrainingEvent COMPLETED (hard-close)

- Organizer-level hard-close action.
- Authorize organizer and claim/create idempotent Event completion operation.
- Set `TrainingEvent.status=COMPLETED`.
- Complete linked unfinished Sessions through canonical Session completion service (Event-completion mode).
- Do not bypass Session completion via ad hoc direct Session row mutations.
- For linked active/paused recordings, request same idempotent stop orchestration as normal Session FINISH.
- For `NOT_STARTED|PROCESSING|COMPLETED|FAILED|STOPPED` equivalent states, apply valid transitions and avoid duplicate stop operations.
- Exactly one logical recording-stop operation per recording.
- Hard-close linked rooms regardless of remaining room presence.
- Event lobby becomes unavailable for active participation.
- Connected clients must observe hard-close and navigate to materials/results context.
- Provider webhook finalization/transcription/enhancement/speaker-mapping/AI continue independently after room/lobby closure.
- Per-session stop failure must be visible/retryable, must not reopen Event, and must not roll Event back to active.
- Repeated Event completion requests must be idempotent.

## Supersession requirement

Supersede prior policy that all `FINISHED` sessions must immediately redirect away from room:

- `FINISHED + DEBRIEF_OPEN` => authorized re-entry allowed.
- `FINISHED + CLOSED` => redirect to materials.
- `Event COMPLETED` => lobby unavailable and linked rooms hard-closed.

## Durable presence and abrupt-disconnect policy

### Explicit leave

- closes specific connection immediately;
- no grace;
- occupancy reevaluation immediate.

### Abrupt disconnect / network loss / browser termination

- connection remains recoverable during grace;
- reconnect inside grace prevents premature closure;
- after expiry, server-side expiry worker marks stale and reevaluates occupancy.

### Restart behavior

- authoritative state reconstructed from durable PostgreSQL ledger;
- expired rows can still be processed after restart;
- in-memory maps never authoritative.

Initial timing policy (centralized/configurable):

- online threshold: ~30s;
- abrupt disconnect grace/expiry: ~120s;
- explicit leave: immediate.

## Server-side expiry execution ownership

Do not rely on disconnected browser callbacks, unload hooks, another participant request, room bootstrap, later room visit, or opportunistic request-path cleanup as sole expiry mechanism.

Required periodic expiry operation:

1. find active connection rows where `expiresAt < database/server now`;
2. mark them expired/disconnected idempotently;
3. recalculate active relevant occupancy for affected Sessions;
4. transition `DEBRIEF_OPEN -> CLOSED` when count reaches zero;
5. execute expiry + occupancy + close atomically or via safe CAS;
6. stay safe under concurrent workers;
7. stay safe after app/server restart;
8. never reopen `CLOSED`;
9. produce structured logs without participant PII;
10. support retries without duplicate transitions;
11. never stop/change recording solely because heartbeat expiry happened;
12. do not close `OPEN` negotiations from debrief-expiry rule (unless future abandonment policy is explicitly added).

## Scheduler/maintenance infrastructure inspection (required first step)

Before implementing expiry worker, inspect repository + ops docs and record findings in PR:

- app scheduler/background worker patterns;
- maintenance endpoints/scripts;
- queue worker infra;
- systemd timers/cron availability in deployment environment.

Current audit finding (to validate during implementation):

- repository has no existing periodic app-side scheduler/worker for room-connection expiry;
- deployment docs describe single-server VM with `negotaitions-poc` systemd service;
- systemd unit and timer definitions are outside repository.

If no existing suitable periodic mechanism is available:

- document alternatives;
- pick smallest reliable server-side mechanism for single-server deployment;
- include deployment/rollback instructions;
- request-path cleanup cannot be only solution.

Recommended default for current deployment:

- systemd timer invoking a maintenance command/endpoint for expiry sweep.

## Server-authoritative finish and recording stop

Required Session sequence:

`FINISH request`
-> atomic/idempotent server finish operation
-> durable/retryable stop command creation
-> room lifecycle transition
-> provider stop delivery
-> webhook-authoritative recording finalization
-> independent post-processing

Requirements:

- persisted finish operation identifier or equivalent CAS;
- repeated FINISH returns already-finished result;
- exactly one logical stop operation per recording;
- client relay fallback only;
- redirect/unload cannot cancel server stop;
- delayed webhook does not block materials/redirect;
- stop failures visible and retryable;
- do not change Voximplant scenario contract unless evidence proves unavoidable.

## Reconnect vs close race policy

- while room remains `DEBRIEF_OPEN`, valid reconnect may create/renew connection;
- once atomic transition to `CLOSED` commits, reconnect may not reopen room;
- requests losing race redirect to materials;
- `CLOSED` is terminal in Stage 3.10 (future administrative recovery out of scope).

## Administrative Session completion requirements

Entry points:

- Sessions overview;
- Session detail/management page;
- existing Event lobby host controls;
- Event session-management surfaces where appropriate.

Authorization:

- facilitator/session owner/authorized Event host only;
- participant/observer forbidden.

Visibility:

- non-finished, non-deleted sessions only.

UI constraints:

- no new Sessions column;
- no table widening/breakage;
- complete action in existing Actions area/overflow;
- preserve complete vs delete semantic separation.

## AI report status aggregation requirements

- one session-level aggregate publication status;
- no repeated identical published rows;
- full RU state: `AI-отчёт опубликован`;
- speaker mapping statuses remain independent.

## Completed Event lobby behavior requirements

- hide `Open lobby` for sessions linked to completed Event;
- route/server-level completed-event guard for direct lobby URL;
- browser back/stale links must not restore interactive lobby;
- read-only completed context may remain available.

## Internal checkpoints (single stage, controlled)

- **A:** schema + backend state machine + durable presence + idempotency.
- **B:** guards/rejoin/redirects.
- **C:** administrative completion + Sessions/Event UI fixes.
- **D:** tests/docs/gates.

### Checkpoint A internal order (mandatory)

- **A1.** Finalize schema and safe additive migration.
- **A2.** Add compatibility reads/writes.
- **A3.** Add canonical Session finish operation.
- **A4.** Add Event completion orchestration.
- **A5.** Add durable connection operations.
- **A6.** Add atomic last-disconnect closure.
- **A7.** Add server-side expiry execution.
- **A8.** Add bounded backfill and verification.
- **A9.** Validate restart, concurrency, and rollback behavior.

## Safe additive Prisma migration strategy (mandatory)

### Phase 1 — additive schema

1. add room-lifecycle fields as nullable initially or safe tolerable default;
2. add durable connection-ledger model/table;
3. add required indexes and uniqueness constraints;
4. do not drop/rename/repurpose existing Session/SessionParticipant/Recording/Event fields in first migration;
5. do not add mandatory non-null field old app cannot write;
6. old app must continue running between migration and new app deploy.

### Phase 2 — compatibility release

1. new app reads legacy + new state;
2. new app writes new lifecycle state;
3. legacy rows remain interpretable via explicit derivation/backfill policy;
4. guards and finish operations tolerate partial backfill.

### Phase 3 — bounded backfill

1. run in bounded batches;
2. deterministic and rerunnable;
3. never infer `DEBRIEF_OPEN` from `FINISHED` alone without durable connection evidence;
4. conservative historical derivation rules (documented and verifiable);
5. record backfill counts per derived state;
6. verify no unresolved rows before tightening constraints.

### Phase 4 — optional later tightening

- only after compatibility rollout + verified backfill may non-null tightening be considered;
- never combine blindly into first production migration.

## Required connection-ledger constraints/indexes

- unique `connectionId`;
- index on `sessionId`;
- index supporting active lookup by `sessionId`;
- index on `expiresAt` for expiry scans;
- index on `sessionId + disconnectedAt` or equivalent;
- FK policies aligned with existing deletion semantics;
- protection against duplicate insertion of same logical connection.

Implementation must inspect real PostgreSQL query plans before finalizing composite indexes.

## Database/server time authority

- use database/server current time for `expiresAt` comparisons;
- browser timestamps are non-authoritative;
- document timezone/timestamp conventions used by project.

## Deployment ordering (mandatory)

1. create backup/checkpoint per runbook;
2. deploy additive migration;
3. verify schema + indexes;
4. deploy compatibility app;
5. verify new writes + legacy reads;
6. run bounded backfill;
7. verify lifecycle counts and invalid rows;
8. enable periodic expiry operation;
9. run canary;
10. only later consider non-null tightening.

## Rollback policy (mandatory)

- app rollback must remain possible while additive schema remains present;
- rollback must not require dropping new table immediately;
- do not destroy historical lifecycle/connection data;
- old app must safely ignore additive schema;
- include explicit procedure to disable expiry worker before app rollback;
- do not mark production migration rolled back after successful schema change unless Prisma/PostgreSQL practice for exact action is proven safe.

## Expected code paths (audit-based)

- `app/api/sessions/[sessionId]/control/route.ts`
- `app/api/sessions/[sessionId]/recording-control/route.ts`
- `app/api/sessions/[sessionId]/heartbeat/route.ts`
- `app/room/[sessionId]/page.tsx`
- `app/events/[id]/lobby/page.tsx`
- `lib/session-close-state.ts`
- `lib/session-overview-shared.ts`
- `lib/rejoin/validate.ts`
- `lib/session-overview-stats.ts`
- `components/sessions-list-view.tsx`
- `components/event-lobby-view.tsx`
- durable replacement for `lib/session-room-connection-lease.ts`
- selected maintenance command/endpoint + scheduler integration path

## Unit/API/E2E test matrix (minimum)

### Session finish and debrief

- duplicate FINISH idempotency;
- finish-stop retry visibility;
- normal FINISH with remaining users => `DEBRIEF_OPEN` re-entry;
- FINISH with no users => `CLOSED` redirect.

### Expiry worker and occupancy closure

- last tab closed abruptly, no further requests, server-side expiry closes room;
- worker retries are idempotent;
- two concurrent workers safe;
- restart before/after expiry safe;
- reconnect within grace preserved;
- reconnect racing closure commit;
- `OPEN` negotiation not closed by debrief expiry rule.

### Active-connection predicate

- valid facilitator/participant/observer counted;
- event-lobby presence not counted;
- materials polling not counted;
- expired/disconnected/superseded not counted;
- revoked membership/deleted session/user not counted;
- server/db time used for expiry comparisons.

### Event completion semantics

- one active recording;
- multiple active/paused recordings;
- session with no recording;
- mix of already-finished and active sessions;
- repeated Event completion idempotency;
- Event completion racing Session FINISH;
- partial stop failure visibility/retry;
- delayed webhook after Event hard-close;
- direct lobby URL after completion blocked;
- connected clients observe hard-close;
- materials remain accessible while finalization continues.

### UI semantics

- admin completion entry points and role gating;
- completed-event lobby action hidden in sessions overview;
- AI aggregate publication status none/partial/full and no duplicate published rows.

## Pre-production validation (mandatory)

- migration on production-like DB copy;
- old app compatibility after additive migration;
- new app behavior on partially backfilled data;
- rerunnable bounded backfill;
- app rollback with additive schema present;
- index usage for active and expiry queries;
- no long unbounded lock during backfill.

## Docs to update during implementation

- Stage 3.10 audit bundle;
- product docs for completion semantics;
- operations runbook for expiry worker, stop retry, and rollback.

## Local vs server responsibility split

- Local/client: UX, fallback relay, navigation rendering.
- Server: lifecycle authority, idempotency, durable closure, expiry execution, recording-stop orchestration.
- Webhook/provider callback: recording finalization authority.

## Mandatory gates (strictly sequential)

1. `npm run validate:fast`
2. `npm run validate:deploy`
3. `npm run test:e2e:smoke`
4. `npm run test:e2e:smoke:browser`

Proceed only when prior gate passes.

## Manual multi-browser validation plan

- facilitator/participant/observer contexts;
- explicit leave and abrupt disconnect paths;
- reconnect inside/outside grace;
- duplicate-tab takeover behavior;
- event completion hard-close observations;
- direct URL/back/refresh parity for room/lobby/materials.

## Commit / push / merge instructions (implementation stage)

1. commit by checkpoint (`A`, `B`, `C`, `D`);
2. push `feature/stage-3-10-session-completion-flow`;
3. one PR to `deploy/yandex-poc`;
4. keep as one controlled feature stage.

## Server deploy / canary / rollback plan

Deploy:

1. additive migration;
2. compatibility app deploy;
3. bounded backfill;
4. enable expiry worker in controlled rollout;
5. canary and monitor structured metrics/logs.

Rollback:

1. disable expiry worker first;
2. disable new feature paths if applicable;
3. roll app back while additive schema remains;
4. preserve lifecycle/connection data and logs.

## Final response checklist (implementation stage completion)

Include:

- scheduler mechanism selected and justified;
- additive migration and compatibility proof;
- canonical Session/Event orchestration proof;
- active-connection predicate implementation proof;
- expiry worker concurrency/restart/race proof;
- required test evidence and gate outputs;
- canary and rollback readiness.
