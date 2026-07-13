# Race Condition Analysis (Current Risk + Final Mitigation Direction)

## 1) Duplicate FINISH from multi-tab/multi-client

- Current risk: high.
- Existing behavior: submit-disable mostly client-side.
- Mitigation: persisted finish operation id/CAS, repeated FINISH idempotent response, exactly one logical stop operation.

## 2) FINISH vs browser unload/navigation

- Current risk: high.
- Existing behavior: Vox stop may depend on client callback.
- Mitigation: server-authoritative durable stop pipeline; unload cannot cancel stop; client relay fallback only.

## 3) Event completion vs recording stop orchestration

- Current risk: high.
- Existing behavior: event completion and per-session stop paths can diverge.
- Mitigation:
  - Event completion reuses canonical Session completion orchestration;
  - active/paused recordings receive idempotent stop request;
  - non-active recording states avoid duplicate/invalid stop ops;
  - per-session failures visible/retryable without rolling Event back.

## 4) Last-two disconnects simultaneously

- Current risk: high.
- Existing behavior: no durable atomic last-disconnect closure.
- Mitigation: durable active-connection predicate + atomic/CAS `DEBRIEF_OPEN -> CLOSED`.

## 5) Expiry worker absent when no clients remain

- Current risk: high.
- Existing behavior: request-path/opportunistic cleanup can miss abandoned rooms.
- Mitigation: server-side periodic expiry worker independent of browser traffic.

## 6) Concurrent expiry workers

- Current risk: high.
- Existing behavior: undefined in current model.
- Mitigation: idempotent row updates + transactional/CAS close transition + retry-safe execution.

## 7) Reconnect around expiry boundary

- Current risk: medium-high.
- Existing behavior: threshold inference only.
- Mitigation:
  - grace window around ~120s;
  - reconnect before close commit may renew connection;
  - reconnect after committed `CLOSED` must redirect to materials.

## 8) Server restart before/after expiry

- Current risk: medium-high.
- Existing behavior: in-memory lease reset loses authority.
- Mitigation: PostgreSQL durable ledger + restart-safe expiry processing.

## 9) Active-connection misclassification

- Current risk: medium-high.
- Existing behavior: `lastSeenAt` heuristics and in-memory lease can over/under count.
- Mitigation: one authoritative predicate over durable rows using database/server time (not browser time).

## 10) OPEN-room false closure from disconnect expiry

- Current risk: medium-high.
- Existing behavior: no durable room lifecycle split yet.
- Mitigation: debrief expiry rules apply to `DEBRIEF_OPEN`; do not auto-close `OPEN` negotiations unless a separate abandonment policy is added.

## 11) Delayed webhook finalization after hard-close

- Current risk: medium.
- Existing behavior: finalization can lag after finish.
- Mitigation: room/lobby closure independent from post-processing; delayed webhook does not block materials.

## 12) Sessions overview AI publication duplication

- Current risk: medium.
- Existing behavior: duplicate shared labels can render.
- Mitigation: one aggregate session-level publication state; no repeated identical published rows.

## 13) Unsafe first migration constraints

- Current risk: high (deployment/rollback risk).
- Existing behavior: durable lifecycle schema not yet introduced.
- Mitigation:
  - additive first migration only;
  - compatibility app release before strict constraints;
  - bounded rerunnable backfill;
  - optional later non-null tightening after verification only.
