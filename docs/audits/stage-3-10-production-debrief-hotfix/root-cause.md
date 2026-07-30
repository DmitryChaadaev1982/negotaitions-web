# Root cause

## Statement

Production PostgreSQL `TimeZone=Europe/Moscow` caused Stage 3.10 occupancy SQL (`expiresAt > NOW()`) to treat valid Prisma UTC wall-clock leases as expired. `completeSessionCanonical` therefore selected `roomLifecycle=CLOSED` on facilitator FINISH even when durable connections existed, and clients immediately received control-state 409 → materials.

Confidence: **high** (direct psql dual-TZ proof + incident reconstruction + nginx timing).

## Direct psql proof (required)

1. `SHOW timezone` → `Europe/Moscow`
2. `information_schema`: `SessionRoomConnection.expiresAt` / `updatedAt` / related lifecycle timestamps are `timestamp without time zone` (no timestamptz columns in inspected set).
3. Live relative lease `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + 2 minutes`:

| TimeZone | `expiresAt > NOW()` | `expiresAt > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')` |
|---|---|---|
| UTC | true | true |
| Europe/Moscow | **false** | true |

4. Incident literals:

| comparison | result |
|---|---|
| `19:35:15.522 > 19:33:25.910` (UTC walls) | true |
| `19:35:15.522 > 22:33:25.910` (UTC wall vs MSK local wall) | false |

Note: an earlier Node `MODULE_NOT_FOUND` while probing Prisma from the server was a failed diagnostic command only. It does **not** affect this root-cause conclusion; the psql comparisons above are the confirming evidence.

## Why retrospective SQL looked “eligible”

Retrospective used `expiresAt > negotiationEndedAt` (both UTC wall-clock values) → true.  
Live finish used `expiresAt > NOW()` (timestamptz in session TZ) → false under Moscow.

## Fix

Introduce `lib/sql-utc-wall-clock.ts`:

- `sqlUtcWallClockNow()` → `(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`
- `sqlUtcWallClockOrDate(now?)` → Date binding or UTC wall SQL

Use only where raw SQL compares/writes Prisma UTC-convention `timestamp without time zone` columns in occupancy/close paths. Do not mechanically replace every `NOW()`.

## Long-term (out of scope)

Migrating DateTime columns to `@db.Timestamptz` requires compatibility analysis and data migration; track separately.

## Production canary confirmation

Root-cause fix validated in production canary on release `3a487713b521f785e6c81d15c776765e9f15cd61` (session `cms6njs0m000t6nm171at227c`): facilitator FINISH selected `DEBRIEF_OPEN` with live occupancy; grace closed after ~30s; server-side stop delivered via `voximplant_server_control`.

Verdict: **PASS** / **GO**. Evidence: [production-canary-result.md](./production-canary-result.md).
