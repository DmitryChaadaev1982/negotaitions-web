# Stage 3.10 Audit Bundle (Final Target Alignment)

This folder contains the Stage 3.10 docs-only audit artifacts and finalized target decisions.

Implementation progress for the active execution branch is tracked in:

- `docs/audits/stage-3-10-session-completion-flow/implementation-status.md`

## Scope

- Session completion and leave behavior;
- room/debrief lifecycle behavior;
- recording stop/finalization ordering;
- presence, rejoin, and last-disconnect closure semantics;
- room/materials/event-lobby access guards and redirects;
- Event-vs-Standalone completion semantics;
- AI report status rendering in Sessions overview;
- current test coverage and required future coverage.

## Current-vs-target interpretation rule

Each artifact now separates:

- **Current audited behavior** (what the code does today); and
- **Target product decision** (what Stage 3.10 implementation must deliver).

Current-behavior evidence remains informational and is not rewritten unless needed for clarity.

## Final architectural decisions captured in this bundle

- Durable room lifecycle is a separate concept from `Session.status` and `Session.negotiationState`.
- Target durable room lifecycle model: `OPEN` -> `DEBRIEF_OPEN` -> `CLOSED` (exact names to be chosen during implementation by repository conventions).
- `Session.negotiationState` remains negotiation-only (`PREPARATION`, `RUNNING`, `PAUSED`, `FINISHED` lineage).
- Recording, transcript, and AI analysis statuses remain independent from room closure.
- A Prisma migration is recommended and treated as required for target durable behavior.
- Durable per-connection presence should be PostgreSQL-backed for current deployment scale.
- Session FINISH and Event COMPLETED are distinct operations with distinct closure semantics.

## Final technical clarifications added

- Server-side expiry worker execution is required for abrupt disconnect cleanup when no browser requests continue.
- Event completion must reuse canonical Session completion orchestration, including idempotent per-recording stop behavior.
- Migration must be additive/compatibility-first with bounded rerunnable backfill before any constraint tightening.
- Active room occupancy must use one authoritative durable active-connection predicate with database/server time.

## Explicit supersession note

Stage 3.10 supersedes any prior recommendation that every `FINISHED` session must immediately redirect away from room access.

Final policy:

- normal Session `FINISHED` + room `DEBRIEF_OPEN` => authorized re-entry is allowed;
- normal Session `FINISHED` + room `CLOSED` => redirect to materials;
- Event `COMPLETED` => Event lobby unavailable for active participation and linked rooms hard-closed.

## Scope constraints followed

- No application, test, Prisma, env, or package code changes;
- no commits, deployments, or service restarts;
- no provider calls intentionally triggered by this docs update.
