# Domain State Model (Current vs Final Target)

## 1) Negotiation lifecycle (Session negotiation only)

### Current audited behavior

- `Session.negotiationState` is the active negotiation control state.
- Current values include preparation/running/paused/finished variants.
- `FINISHED` is terminal for negotiation progression.

### Final target decision

- Keep `Session.negotiationState` responsible for negotiation progression only.
- Do not overload it with durable room occupancy semantics.
- Canonical negotiation progression remains:
  - `PREPARATION` (and existing preparation sub-states),
  - `RUNNING`,
  - `PAUSED`,
  - `FINISHED`.

## 2) Room/debrief lifecycle (separate durable concept)

### Current audited behavior

- Room closure is currently derived (`buildSessionCloseState(...)`) rather than represented as a durable standalone lifecycle.
- Route and UI guards infer closure from negotiation/event fields.

### Final target decision

- Introduce a separate durable room lifecycle concept (exact naming to follow repository conventions).
- Target lifecycle model:
  - `OPEN`
  - `DEBRIEF_OPEN`
  - `CLOSED`
- This lifecycle is separate from both `Session.status` and `Session.negotiationState`.
- A Prisma migration is recommended and treated as required for target durable correctness.
- Migration rollout must be additive and compatibility-safe before any later non-null tightening.

## 3) Presence and connection lifecycle

### Current audited behavior

- Presence combines durable `SessionParticipant.lastSeenAt` with in-memory tab lease arbitration.
- No durable per-connection ledger exists today.
- Status thresholds are currently derived as `ONLINE` (about 30s), `RECENTLY_DISCONNECTED` (about 120s), `OFFLINE`.

### Final target decision

- Use durable per-connection tracking (PostgreSQL-backed) for session room occupancy.
- Each browser tab/device is a separate connection.
- Relevant room occupancy roles for debrief are:
  - `FACILITATOR`
  - `PARTICIPANT`
  - `OBSERVER`
- Explicit leave closes a connection immediately.
- Abrupt disconnect uses heartbeat TTL + grace expiry.
- Reconnect within grace must not close room.
- Last-disconnect closure must be server-side, durable, atomic, idempotent, concurrent-safe, and restart-safe.
- Do not use `SessionParticipant.lastSeenAt` as sole occupancy truth once durable connection ledger is introduced.
- Debrief-expiry closure applies to `DEBRIEF_OPEN`; it must not close `OPEN` negotiations by itself.

### Authoritative active-connection predicate (target)

For occupancy and last-disconnect decisions, a connection counts as active only when all are true:

1. belongs to target Session;
2. role is one of `FACILITATOR|PARTICIPANT|OBSERVER`;
3. `disconnectedAt IS NULL`;
4. `expiresAt > database/server current time`;
5. not superseded/revoked;
6. user and membership remain valid for room access;
7. Session is not deleted;
8. room lifecycle is not already `CLOSED`.

Not active:

- expired rows;
- explicitly disconnected rows;
- superseded stale tabs;
- revoked/deleted membership or user access;
- Event-lobby-only presence;
- materials-page polling;
- webhook/worker activity;
- provider-only participants without valid app connection correlation;
- in-memory lease state without valid durable ledger row.

## 4) Session completion lifecycle

### Current audited behavior

- Session finish writes `negotiationState=FINISHED`.
- Room treatment after finish is mixed across guard layers.

### Final target decision

- Normal Session FINISH operation:
  - `negotiationState` -> `FINISHED`;
  - idempotent recording stop request is initiated;
  - room lifecycle -> `DEBRIEF_OPEN` if relevant connections remain;
  - room lifecycle -> `CLOSED` if no relevant connections remain;
  - materials remain accessible throughout processing states.
- Repeated FINISH returns already-finished/idempotent result.

## 5) TrainingEvent completion lifecycle (stronger hard-close)

### Current audited behavior

- Event completion sets `TrainingEvent.status=COMPLETED` and force-finishes active sessions.

### Final target decision

- Event completion is not the same action as normal Session finish.
- Completing a TrainingEvent:
  - sets Event to `COMPLETED`;
  - claims idempotent Event-completion operation;
  - makes Event lobby unavailable for active participation;
  - completes linked unfinished Sessions through canonical Session completion service (batch-safe Event-completion mode);
  - hard-closes linked rooms per event-completion semantics;
  - prevents future direct lobby URL from reopening interactive lobby;
  - routes users to event results/session materials.
  - for linked recordings in active/paused states, requests same idempotent stop orchestration as normal Session FINISH;
  - for non-active recording states, follows valid transition rules with no duplicate stop operation;
  - keeps per-session stop failures visible/retryable without reopening or rolling back Event state.

## 6) Recording / transcript / AI lifecycle independence

### Current audited behavior

- Recording/transcript/AI have independent status fields and processing pipelines.
- Materials are available even while processing is ongoing.

### Final target decision

- Preserve lifecycle independence:
  - Recording status is provider/webhook-authoritative.
  - Transcript and AI continue independently after finish.
- Room closure/redirection must not block on delayed webhook finalization.
- No-recording sessions must still complete successfully and render valid no-recording/no-analysis materials state.
- Event hard-close does not block on webhook/transcript/AI completion; post-processing continues independently.

## 7) Session.status scope

### Current audited behavior

- `Session.status` is coarse metadata (`DRAFT|READY|COMPLETED`) and not reliable room authority.

### Final target decision

- Keep `Session.status` for coarse lifecycle metadata.
- Do not use `Session.status` as durable room occupancy/closure authority.
