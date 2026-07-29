# Production evidence

Host: `deploy@130.193.62.91` (`negotaitions-app-poc`)  
Commit: `3647593a61f3f6d132183622708c1c34d43e0614`  
Read-only only.

## Incident sessions

| sessionId | type | negotiationEndedAt (UTC wall) | updatedAt − endedAt | final lifecycle |
|---|---|---|---|---|
| `cms6hej6n0000p6m1oc03bdjw` | standalone | 2026-07-29 19:33:25.910 | ~8 ms | CLOSED |
| `cms6hlu4o0012p6m1jyil4qvj` | event | 2026-07-29 19:38:32.375 | ~5 ms | CLOSED |

Same-write CLOSED (not grace auto-close). No leave endpoints around finish. Nginx: POST `/control` 200 → immediate control-state 409 (~97 bytes) → materials within ~2s.

## Timezone / type evidence

```
SHOW timezone → Europe/Moscow

SessionRoomConnection.expiresAt     timestamp without time zone
SessionRoomConnection.disconnectedAt timestamp without time zone
SessionRoomConnection.updatedAt     timestamp without time zone
Session.updatedAt / negotiationEndedAt timestamp without time zone
(all inspected DateTime columns: timestamp without time zone)
```

## Dual-TZ live lease probe (production DB)

Lease constructed as `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '2 minutes'`.

| session TimeZone | expires > NOW() | expires > UTC wall-clock |
|---|---|---|
| UTC | true | true |
| Europe/Moscow | **false** | true |

## Incident literal reconstruction

Facilitator `expiresAt` = `2026-07-29 19:35:15.522`  
Finish UTC wall = `2026-07-29 19:33:25.910`  
MSK local wall at finish ≈ `2026-07-29 22:33:25.910`

| comparison | result |
|---|---|
| expiresAt > finish UTC wall | true (would_count_at_finish) |
| expiresAt > MSK local wall | false (matches buggy NOW() predicate) |

Proper retrospective occupancy at finish: standalone activeCount≥1, event activeCount=3.

## Recording stop (historical)

Both stop ops `DELIVERED` via `voximplant_webhook_reconciliation` ~62–92s later.  
`transportAcceptedAt` / control channel / nonce rows empty — expected given prior secret mismatch (now MATCH; new session still needs canary).

## Journald

No historical `activeCount` / lifecycle decision logs at incident time (instrumentation added in hotfix).
