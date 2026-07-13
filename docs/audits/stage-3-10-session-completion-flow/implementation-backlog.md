# Implementation Backlog (Final Priority Order)

## P0

- **P0-1: Durable room lifecycle state**
  - add durable room lifecycle concept equivalent to `OPEN|DEBRIEF_OPEN|CLOSED`;
  - keep negotiation lifecycle separate.
- **P0-2: Durable per-connection presence**
  - PostgreSQL-backed connection ledger (tab/device-level).
- **P0-3: Atomic last-disconnect closure**
  - server-side, durable, idempotent, concurrent-safe closure transition.
- **P0-4: Server-side stale connection expiry execution**
  - periodic server-side worker/timer/maintenance execution;
  - no request-only closure dependency;
  - expiry + occupancy reevaluation + close transition retry-safe.
- **P0-5: Atomic active-connection predicate**
  - single authoritative durable predicate;
  - server/database time authority (not browser time);
  - supports superseded/revoked connection exclusion.
- **P0-6: Server-authoritative and idempotent finish/recording-stop**
  - persisted finish operation id or CAS;
  - exactly one logical stop operation;
  - durable retry behavior with visible failure states.
- **P0-7: Event completion recording-stop parity**
  - Event completion must reuse canonical Session completion orchestration;
  - stop active/paused linked recordings with idempotent per-recording semantics;
  - partial failures visible/retryable per session.
- **P0-8: Safe additive migration + compatibility rollout**
  - additive migration first, compatibility release second;
  - bounded deterministic rerunnable backfill;
  - optional later non-null tightening only after verification.
- **P0-9: Unified room/rejoin/direct-URL guard**
  - one guard policy for room route, rejoin route, and action surfaces.
- **P0-10: Trap-free materials navigation**
  - consistent redirect outcomes for direct URL, refresh, and browser back.
- **P0-11: Rollback-safe expiry worker activation**
  - deployment ordering includes controlled worker enablement;
  - worker can be disabled before app rollback without data loss.

## P1

- **P1-1: Administrative Session completion from overview/detail/Event surfaces**
  - include confirmation copy and permission gating.
- **P1-2: Normal FINISHED debrief rejoin**
  - authorized re-entry when room lifecycle is `DEBRIEF_OPEN`.
- **P1-3: Event-vs-Standalone Session completion parity**
  - one canonical backend session completion flow for all entry points.
- **P1-4: Completed-Event lobby guard and action removal**
  - hide `Open lobby` when parent Event is `COMPLETED`;
  - prevent interactive lobby restoration via direct URL/history.
- **P1-5: Role-consistent navigation and messaging**
  - facilitator/participant/observer/event-host clarity across room/lobby/materials.

## P2

- **P2-1: AI publication status aggregation in Sessions overview**
  - one aggregate session-level state: none/partial/full;
  - final full state text: `AI-отчёт опубликован`;
  - no duplicate published rows.
- **P2-2: UI copy and alignment cleanup**
  - completion/debrief/processing wording harmonization.
- **P2-3: Telemetry and operator diagnostics**
  - finish->stop->webhook lag, stop retry outcomes, closure transitions.
- **P2-4: Runbook updates**
  - failure handling and recovery procedures.

## Sequencing note

- If AI status aggregation fix is trivial and low-risk, it may be included in the same controlled Stage 3.10 implementation stage instead of splitting a separate stage.
