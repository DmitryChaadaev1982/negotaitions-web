# Stage 3.10 production debrief hotfix — incident summary

Date: 2026-07-30  
Branch: `fix/stage-3-10-production-debrief-hotfix`  
Worktree: `negotiations-web-stage310-production-debrief-hotfix`  
Base: `3647593a61f3f6d132183622708c1c34d43e0614` (`origin/deploy/yandex-poc`)

## Verdict

Facilitator FINISH immediately wrote `roomLifecycle=CLOSED` because the durable occupancy predicate compared Prisma UTC wall-clock `expiresAt` (`timestamp without time zone`) against PostgreSQL `NOW()` while the DB session TimeZone was `Europe/Moscow`. Live leases looked expired, `activeCount` became 0, finish chose CLOSED, control-state returned 409 `ROOM_CLOSED`, clients redirected to materials.

## Confirmed with direct psql

1. `SHOW timezone` → `Europe/Moscow`
2. Affected columns are `timestamp without time zone`
3. Live dual-TZ probe with a +2 minute UTC-wall lease:
   - UTC session: `expiresAt > NOW()` = true; `expiresAt > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')` = true
   - Europe/Moscow: `expiresAt > NOW()` = **false**; UTC-wall comparison = **true**

## Hotfix (minimal)

- Add `sqlUtcWallClockNow()` / `sqlUtcWallClockOrDate()` helper
- Use UTC wall-clock in occupancy count / close CAS / updatedAt raw SQL writes
- Keep grace-period logic and CLOSED terminal / EVENT hard-close unchanged
- Structured decision logs for canary
- Dual-TZ regression tests (UTC + Europe/Moscow)

## Not done without approval

- Production deploy
- Production DB writes
- Broad `NOW()` mechanical replace
- Migration of DateTime columns to `timestamptz`
