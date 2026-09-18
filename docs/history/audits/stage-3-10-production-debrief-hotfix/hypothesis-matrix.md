# Hypothesis matrix

| ID | Hypothesis | Explains | Contradicts | Evidence | Status |
|---|---|---|---|---|---|
| H1 | Post-tx reconciliation immediately CLOSED | immediate materials | updatedAt−endedAt 5–8ms; no leave; grace 30s | SQL + nginx | **REJECTED** |
| H2 | Concurrent FINISH / AUTO_TIMER race | closed despite occupants | duration 120s, ran ~10–11s; single POST /control | SQL timers + nginx | **REJECTED** |
| H3 | `countActiveSessionRoomConnections` returned 0 in real tx | CLOSED despite occupants | — | TZ mismatch proof; dual-TZ probe; retro count 1/3 | **CONFIRMED** (root mechanism) |
| H4 | Client mis-handles DEBRIEF_OPEN | materials redirect | DB already CLOSED; 409 before materials | nginx 409 then materials | **REJECTED** as primary |
| H5 | Explicit leave before debrief state | empty room close | no leave requests; disconnects much later EXPIRED | nginx | **REJECTED** |
| H6 | Legacy null lifecycle ambiguity | wrong CLOSED | pre-finish control-state 200; RUNNING→OPEN | access + nginx | **REJECTED** as primary |
| H7 | Grace / lastInvalidatedAt wrong | immediate CLOSED | requires DEBRIEF_OPEN first; delta 5–8ms | closeDebriefRoomIfEmpty guards | **REJECTED** |
| H8 | Standalone observer participant mismatch | undercount | event session had 3 matching rows and still CLOSED | SQL participant_match | **OPEN** separate defect |
| H3a | Postgres `NOW()` vs UTC wall-clock `expiresAt` under Europe/Moscow | H3 | MODULE_NOT_FOUND was only a failed Node diagnostic, not disproof | direct psql dual-TZ | **CONFIRMED** |

## Root mechanism (H3/H3a)

`expiresAt` written by Prisma as UTC wall-clock into `timestamp without time zone`.  
Predicate used `expiresAt > NOW()`. With TimeZone=`Europe/Moscow`, NOW() is ~+3h ahead of UTC wall values → all leases appear expired → `activeCount=0` → CLOSED.
