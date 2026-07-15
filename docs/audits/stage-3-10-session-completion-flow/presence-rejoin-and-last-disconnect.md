# Presence, Rejoin, and Last-Disconnect (Current vs Final Target)

## Current audited behavior

1. Presence is partially durable: `lastSeenAt` persists, active lease arbitration is in-memory.
2. Current model mixes user-level and connection-level semantics.
3. Multiple tabs are allowed; stale-tab handling exists, but not with durable per-connection rows.
4. Disconnect is inferred by heartbeat silence, not immediate durable connection close.
5. Last-disconnect does not currently produce an authoritative durable room close transition.
6. Rejoin after `FINISHED` often routes to materials rather than debrief room re-entry.

## Final target decisions

1. **Durable connection ledger is required** for room occupancy and last-disconnect closure.
2. **Each browser tab/device is one connection** with its own lifecycle.
3. **Relevant occupancy roles** for debrief-open evaluation:
   - `FACILITATOR`
   - `PARTICIPANT`
   - `OBSERVER`
4. **Explicit leave** closes that connection immediately (no grace wait).
5. **Abrupt disconnect** uses heartbeat TTL plus grace-expiry evaluation.
6. **Reconnect/refresh inside grace** must not close the room.
7. **Last-disconnect closure must be**:
   - server-side,
   - durable,
   - atomic,
   - idempotent,
   - safe under simultaneous disconnects,
   - safe after process restart.
8. **Storage choice for current scale**: PostgreSQL-backed ledger is preferred over introducing Redis solely for this feature.
9. **Initial timing policy for implementation validation**:
   - online heartbeat threshold: approximately 30 seconds;
   - abrupt-disconnect grace expiry: approximately 120 seconds.
10. **Exact threshold values must be centralized/configurable** (single source), not duplicated across components.

## Explicit leave vs abrupt disconnect vs restart

### A) Explicit leave

- The specific connection closes immediately.
- No grace period is required.
- Occupancy reevaluates immediately.

### B) Abrupt disconnect / browser termination / network loss

- Connection remains recoverable during grace.
- Reconnect within grace prevents premature room closure.
- After expiry, server-side expiry worker marks stale and reevaluates occupancy.

### C) Application restart

- Connection truth is reconstructed from durable PostgreSQL connection ledger.
- Expired rows remain cleanable after restart.
- In-memory lease maps are never authoritative occupancy source.

## Server-side expiry execution requirement (target)

The durable design must not rely on disconnected browser callbacks, unload events, another participant request, later room revisit, or opportunistic request-path cleanup as the sole expiry mechanism.

Required server-side operation:

1. find active connection rows with `expiresAt < database/server now`;
2. mark those rows expired/disconnected idempotently;
3. recalculate relevant active connection counts per affected session;
4. transition room `DEBRIEF_OPEN -> CLOSED` when active count is zero;
5. execute expiry + occupancy check + close transition atomically or with safe CAS;
6. remain safe under concurrent workers and retries;
7. remain safe across application/server restarts;
8. never reopen a committed `CLOSED` room;
9. emit structured operational logs without participant PII;
10. never stop/change recording solely due to heartbeat expiry;
11. never close `OPEN` negotiation room from debrief-expiry policy (unless future abandonment policy is explicitly introduced).

## Conceptual durable connection model (for implementation stage)

Equivalent to a model like `SessionRoomConnection` with fields such as:

- `connectionId`
- `sessionId`
- `userId`
- `sessionParticipantId`
- `role`
- `connectedAt`
- `lastSeenAt`
- `disconnectedAt`
- `expiresAt`

Exact Prisma names are implementation-stage decisions and must follow repository conventions.

## Duplicate-tab policy (target decision)

- Preserve existing tested same-login takeover behavior (policy B):
  - newest connection may supersede previous connection for same logical participant context;
  - superseded connection must not count as active;
  - superseded connection cannot renew itself;
  - supersession must be durable (not in-memory only).

## Checkpoint B implementation update

- Rejoin in `FINISHED + DEBRIEF_OPEN` is now explicitly allowed by canonical room-access decision (`ALLOW_DEBRIEF`).
- `DEBRIEF_OPEN` reconnect can still claim durable connection lease while room remains open.
- `CLOSED` / `EVENT_COMPLETED` now reject renew/claim surfaces with stable close metadata (`ROOM_CLOSED` / `EVENT_CLOSED`) and redirect destination.
- Race behavior preserved:
  - reconnect can win only while `DEBRIEF_OPEN` still exists;
  - if close commits first, reconnect receives closed redirect result;
  - if reconnect claim commits first, atomic close sees active connection and skips closure;
  - `CLOSED` remains terminal (no reopen transition in this checkpoint).

## Reconnect vs close race evidence (DB-backed)

Validated through durable lease + canonical close tests (`tests/e2e/voximplant-room-presence.spec.ts`, `tests/e2e/session-finish-canonical.spec.ts`, `lib/session-room-lifecycle.test.ts`):

- Ordering A (reconnect claim commits first):
  - reconnect claim persists active connection;
  - close CAS sees active occupancy and does not hard-close to `CLOSED`;
  - room can remain `DEBRIEF_OPEN`.
- Ordering B (close CAS commits first):
  - room closes terminally;
  - subsequent reconnect claim path receives closed/event-closed denial and redirect metadata;
  - no credential or lease renewal for stale/superseded connection.

Additional verified outcomes:

- stale tab cannot reclaim `CLOSED`;
- newest-tab takeover remains valid in `DEBRIEF_OPEN`;
- expired/disconnected/revoked connection rows do not block closure;
- provider access calls are guarded after close and do not issue new credentials;
- terminal `CLOSED` does not transition back to `DEBRIEF_OPEN`.
