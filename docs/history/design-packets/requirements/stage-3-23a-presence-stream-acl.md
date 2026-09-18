# Stage 3.23A — Session Management Presence Stream ACL

## Authority

This is the authoritative requirement/change-plan manifest for Stage 3.23A
CP1 (minimal ACL fix + focused regression + operator checkpoint).
Architecture, privacy, access, database, operations, and existing validation
ladder documents remain the domain/safety authorities.

Status values: `APPROVED`, `IMPLEMENTED`, `DEFERRED`, `OUT_OF_SCOPE`, `PASS`,
`READY`.

```
STAGE_ID = 3.23A
STAGE_NAME = Session Management Presence Stream ACL
STAGE_KIND = access / session management
PRODUCT_BEHAVIOR_CHANGE = MANAGEMENT_STREAM_ACL_ONLY
CHECKPOINT = CP1 Operator Checkpoint
CP1 = READY (stop before broad validation)
```

## Change Impact Analysis (CP1)

```
CHANGE: Replace demo-only ACL on GET /api/sessions/{id}/presence/stream
        with apiRequireActiveUser + getCurrentUserSessionAccess +
        canManageSession.
INVARIANTS: Standalone create → /sessions/{id} then explicit /room/{id};
            Event create stays Event/lobby → room; presence remains current
            valid SessionRoomConnection leases; no access widening; no
            client reconnect loop; no DB/ENV/dependency change.
IMPACT: API, roles/access, tests, current-state architecture docs
UNITS: CU-ACL stream auth; CU-TEST focused handshake/nav/presence;
       CU-DOCS current-contract notes
KERNEL: CU-ACL
EVAL: EVAL-S323A-PRESENCE-STREAM-MANAGEMENT-ACL;
      EVAL-S318A-SESSION-PRESENCE-DISPLAY;
      EVAL-S318A-EVENT-PRESENCE-LOCATION
STRATEGY: A — one ACL surface; split would hide the management contract
VALIDATION_PLAN: L1 focused only. validate:fast / validate:build /
                 validate:deploy / L4 NOT_RUN until operator checkpoint.
```

## Access contract

| Caller | Response |
| --- | --- |
| Authorized `canManageSession` user | `200` `text/event-stream` + current snapshot |
| Unauthenticated | `401` |
| Authenticated unrelated / non-manager | `404` Session not found |

Authorized users are exactly those who may open `/sessions/{id}`:
admin, Event host, Event facilitator, Session facilitator / facilitator
participant. Not demo@example.com. Not every authenticated user.

## Navigation invariants

- Standalone: create → `/sessions/{id}` → explicit `/room/{id}`
- Event: Event/lobby → Event `roomUrl`
- Do not unify those flows

## Requirements

| ID | Requirement | Status |
| --- | --- | --- |
| S323A-A01 | Stream uses account API auth + `canManageSession` | IMPLEMENTED |
| S323A-A02 | Demo facilitator ACL removed from the stream | IMPLEMENTED |
| S323A-A03 | Unauthenticated fails closed (`401`) | IMPLEMENTED |
| S323A-A04 | Unrelated authenticated user remains denied (`404`) | IMPLEMENTED |
| S323A-A05 | Fresh Standalone with no lease is `200` Offline | IMPLEMENTED |
| S323A-N01 | Standalone create stays on `/sessions/{id}` | UNCHANGED |
| S323A-N02 | Event create/room entry stays in Event flow | UNCHANGED |
| S323A-P01 | Presence remains valid `SessionRoomConnection` leases | UNCHANGED |
