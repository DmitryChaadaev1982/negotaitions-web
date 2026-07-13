# Recommended Target State Machine (Final Product Policy, Do Not Implement Here)

## Required durable model split

1. **Negotiation lifecycle** (`Session.negotiationState`):
   - `PREPARATION` (+ existing preparation sub-states)
   - `RUNNING`
   - `PAUSED`
   - `FINISHED`
2. **Room lifecycle** (separate durable concept; exact names follow repo conventions):
   - `OPEN`
   - `DEBRIEF_OPEN`
   - `CLOSED`
3. **Post-processing lifecycle** (independent):
   - recording/transcript/AI continue asynchronously and do not block materials.

## Authoritative active-connection predicate (target)

A connection counts as active only when all are true:

1. same target Session;
2. role in `FACILITATOR|PARTICIPANT|OBSERVER`;
3. `disconnectedAt IS NULL`;
4. `expiresAt > authoritative database/server time`;
5. not superseded/revoked;
6. membership and user access still valid;
7. Session not deleted;
8. room lifecycle not already `CLOSED`.

Not active:

- expired rows;
- explicitly disconnected rows;
- superseded stale tabs;
- revoked/deleted membership;
- Event-lobby presence;
- materials-page polling;
- webhook/server-worker activity;
- in-memory lease without valid durable row.

## Explicit operation split

### A) Finish one Session (Standalone or Event-linked)

- Apply one canonical backend session-completion flow.
- Set negotiation state to `FINISHED`.
- Request recording stop idempotently.
- If relevant active connections remain, room lifecycle -> `DEBRIEF_OPEN`.
- If none remain, room lifecycle -> `CLOSED`.
- Do not complete parent Event.
- Do not affect sibling sessions.

### B) Complete entire TrainingEvent (organizer-level hard-close)

- Authorize organizer and claim/create idempotent Event-completion operation.
- Set `TrainingEvent.status=COMPLETED`.
- Complete linked unfinished Sessions through canonical Session completion service in Event-completion mode.
- For linked active/paused recordings, create/reuse same idempotent recording-stop orchestration used by Session FINISH.
- For non-active recording states, apply valid transitions with no duplicate stop operation.
- Hard-close linked rooms and close event lobby interactivity.
- Keep per-session stop failures visible/retryable without rolling Event back.
- Continue webhook-authoritative recording finalization and independent post-processing.

## Access/redirect policy (superseding earlier terminal redirect guidance)

- `FINISHED + DEBRIEF_OPEN`: authorized room re-entry allowed.
- `FINISHED + CLOSED`: room redirects to materials.
- `Event COMPLETED`: event lobby non-interactive; linked rooms hard-closed; route to materials/results.

## Durable presence and expiry policy

- Per-connection durable ledger is required (PostgreSQL-backed for current scale).
- Duplicate-tab behavior preserves existing takeover semantics: newer tab may supersede older tab; superseded connection is not active.
- Explicit leave closes connection immediately and reevaluates occupancy immediately.
- Abrupt disconnect uses heartbeat TTL plus grace expiry.
- Reconnect within grace keeps room from premature closure.
- Last-disconnect closure must be server-side, durable, atomic, idempotent, restart-safe, and concurrent-safe.
- Expiry must be executed by server-side periodic maintenance that works with zero browser requests.
- Request-path/opportunistic cleanup cannot be sole closure mechanism.
- Debrief-expiry policy must not close `OPEN` negotiations merely due to transient connectivity loss.

## Server-authoritative finish/recording stop policy

- Finish operation must be atomic/idempotent using persisted operation identifier or equivalent CAS.
- Repeated FINISH returns already-finished result.
- Exactly one logical stop operation per recording.
- Stop orchestration is durable/retryable server-side.
- Client relay may remain fallback only.
- Redirect/unload cannot cancel server stop.
- Delayed webhook finalization must not block materials or redirect behavior.

## Reconnect vs close race policy

- While room is `DEBRIEF_OPEN`, valid reconnect may create/renew connection.
- Once atomic `DEBRIEF_OPEN -> CLOSED` commits, reconnect cannot reopen room.
- Request losing that race redirects to materials.
- `CLOSED` is terminal in Stage 3.10 (future administrative recovery is out of scope).

## Migration requirement

- Prisma migration is recommended and treated as required.
- Do not overload `Session.status` or `Session.negotiationState` with occupancy semantics.
- Rollout must be additive and compatibility-first:
  - additive schema migration;
  - compatibility app release (read/write new + tolerate legacy);
  - bounded rerunnable backfill;
  - optional later constraint tightening.
