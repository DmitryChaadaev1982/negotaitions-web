# Gap Analysis vs Final Product Intent

## 1) Server-side abrupt-disconnect expiry execution

- Current gap:
  - no explicit periodic server-side expiry execution mechanism is documented;
  - request-opportunistic cleanup can be insufficient when all browsers are gone.
- Target requirement:
  - expiry worker runs server-side independent of browser requests;
  - marks expired active rows idempotently;
  - reevaluates occupancy and atomically closes `DEBRIEF_OPEN -> CLOSED` when needed.

## 2) Authoritative active-connection predicate

- Current gap:
  - mixed use of `lastSeenAt` heuristics and in-memory lease semantics.
- Target requirement:
  - one exact durable predicate (session, role, disconnected null, expiresAt > db time, not superseded/revoked, valid membership/user, session not deleted, room not closed).

## 3) Session FINISH vs Event COMPLETED orchestration parity

- Current gap:
  - event completion can diverge from canonical per-session finish orchestration.
- Target requirement:
  - Event completion must batch through canonical Session completion service, not ad hoc Session row mutation.

## 4) Event completion recording-stop semantics

- Current gap:
  - hard-close semantics documented, but recording stop behavior per linked session state not fully explicit.
- Target requirement:
  - active/paused recording => idempotent stop orchestration;
  - non-active states => valid transitions without duplicate stop op;
  - exactly one logical stop operation per recording;
  - per-session stop failures visible/retryable without reopening Event.

## 5) Additive safe migration and compatibility rollout

- Current gap:
  - migration is required but phased production-safe constraints are underspecified.
- Target requirement:
  - additive schema first;
  - compatibility app release second;
  - bounded rerunnable backfill third;
  - optional non-null tightening later only after verification.
  - backfill must be conservative and must not infer `DEBRIEF_OPEN` from `FINISHED` without durable active connection evidence.
  - time comparisons must use database/server time authority.

## 6) Reconnect vs close race semantics

- Current gap:
  - race outcomes between reconnect, explicit leave, and expiry close are not fully codified.
- Target requirement:
  - reconnect allowed while `DEBRIEF_OPEN`;
  - once `CLOSED` commit wins, reconnect cannot reopen room and must redirect.

## 7) Completed Event lobby access leakage

- Current evidence:
  - `components/sessions-list-view.tsx` may show `Open lobby` without explicit completed-event predicate.
- Target requirement:
  - hide action for completed events and enforce route/server completed-event guard.

## 8) AI publication status aggregation

- Current evidence:
  - `components/sessions-list-view.tsx` can render duplicate shared publication labels.
- Target requirement:
  - one aggregate publication status per session with independent speaker-mapping state.

## Key code paths likely to change in implementation stage

- `app/api/sessions/[sessionId]/control/route.ts`
- `app/api/sessions/[sessionId]/recording-control/route.ts`
- `app/room/[sessionId]/page.tsx`
- `app/events/[id]/lobby/page.tsx`
- `lib/session-close-state.ts`
- `lib/session-overview-shared.ts`
- `lib/rejoin/validate.ts`
- `lib/session-overview-stats.ts`
- durable replacement for `lib/session-room-connection-lease.ts`
- scheduler/maintenance entrypoint chosen for expiry worker execution
