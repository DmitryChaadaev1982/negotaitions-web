# Root Cause Classification and Final Resolution Direction

## Selected root causes

- `SESSION_STATUS_TOO_COARSE`
  - `Session.status` is coarse and cannot encode durable room occupancy semantics.
- `ROOM_LIFECYCLE_NOT_DURABLE`
  - room closure/debrief state is derived, not represented as durable lifecycle.
- `NEGOTIATION_AND_ROOM_SEMANTICS_CONFLATED`
  - `FINISHED` is negotiation terminal but has been used as proxy for room closure.
- `CLIENT_RELAY_STOP_DEPENDENCY`
  - recording stop can depend on client availability after finish.
- `FINISH_STOP_ORCHESTRATION_GAP`
  - no explicit atomic/idempotent finish operation contract with durable stop retry path.
- `NO_DURABLE_PER_CONNECTION_PRESENCE`
  - process-local lease state cannot guarantee restart-safe occupancy truth.
- `NO_SERVER_SIDE_EXPIRY_EXECUTION`
  - no guaranteed periodic stale-connection expiry path independent of browser traffic.
- `LAST_DISCONNECT_NOT_ATOMIC`
  - no authoritative, concurrent-safe last-disconnect close transition.
- `ACTIVE_CONNECTION_PREDICATE_NOT_UNIFIED`
  - occupancy rules are not yet one explicit durable predicate across leave/expiry/guard flows.
- `GUARD_LAYER_FRAGMENTATION`
  - route/rejoin/in-room/session-list guards diverge in edge states.
- `SESSION_FINISH_VS_EVENT_COMPLETE_NOT_EXPLICIT`
  - hard-close event semantics and normal session completion semantics are not clearly separated in all guards/actions.
- `SESSIONS_AI_PUBLICATION_STATUS_NOT_AGGREGATED`
  - sessions overview AI publication view lacks one aggregate session-level status and can show duplicate published labels.
- `COMPLETED_EVENT_LOBBY_ACTION_LEAK`
  - sessions overview can expose lobby action for completed event sessions.
- `INSUFFICIENT_TEST_COVERAGE`
  - limited targeted coverage for duplicate finish, durable closure, and guard parity edge-cases.

## Final resolution policy mapped to causes

- Add separate durable room lifecycle (`OPEN`, `DEBRIEF_OPEN`, `CLOSED`; exact names in implementation).
- Keep `Session.negotiationState` negotiation-only.
- Use PostgreSQL-backed durable per-connection ledger and atomic last-disconnect closure.
- Implement server-authoritative finish idempotency with durable/retryable recording-stop orchestration.
- Use unified guard matrix for room/rejoin/direct-url/session-list/event-lobby paths.
- Distinguish normal Session FINISH from Event COMPLETED hard-close behavior.
- Aggregate AI publication status at session level in Sessions overview.
- Hide `Open lobby` for sessions with parent Event `COMPLETED`.

## Superseded guidance

Any prior recommendation that all `FINISHED` sessions must immediately redirect away from room access is superseded by the finalized debrief policy:

- `FINISHED + DEBRIEF_OPEN` allows authorized re-entry;
- `FINISHED + CLOSED` redirects to materials;
- `Event COMPLETED` keeps lobby non-interactive and linked rooms hard-closed.
