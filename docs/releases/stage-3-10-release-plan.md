# Stage 3.10 Release Plan

## Status

- Implementation: complete
- Local validation: complete
- Migration rehearsal: complete (local disposable DB)
- Provider canary: pending (manual)
- Multi-browser canary: pending (manual)
- Production deployment: pending

## Compatibility Decision

- Database migration is additive and nullable-first (`Session.roomLifecycle` remains nullable).
- New application is compatible with `roomLifecycle = NULL` before backfill completion.
- Old application remains compatible after migration because no existing columns are dropped/renamed/repurposed.
- Vox scenario rollout can safely happen either before or after app release for compatibility, but default operational order remains: app + migration first, then scenario rollout, to keep one rollback axis at a time.

## Exact Deployment Sequence (Production)

1. Confirm DB + server backup snapshots are complete.
2. Confirm rollback owner, on-call monitor, and deploy owner.
3. Stage/pull release code on server.
4. Apply Prisma migration.
5. Verify migration status.
6. Restart app service (`negotaitions-poc`).
7. Run HTTP/app smoke.
8. Run maintenance backfill dry-run.
9. Run first bounded backfill batch.
10. Verify lifecycle counters + invalid combinations.
11. Continue bounded backfill batches to completion.
12. Deploy Vox scenario manually (paste workflow), keep prior version ready.
13. Run disposable provider canary.
14. Copy systemd maintenance unit files, `daemon-reload`, keep timer disabled.
15. Run one-shot maintenance manually.
16. Inspect journal and command JSON.
17. Enable timer.
18. Run manual multi-browser/device canaries.
19. Complete post-deploy checklist and explicit go/no-go signoff.

## Stop/Go Criteria

- Stop if migration command returns non-zero or status is not "up to date".
- Stop if login, room access, completion endpoint, or materials redirect regress.
- Stop if backfill verification reports non-zero `finishedOpen`, `closedWithActiveConnection`, or `completedEventNonClosed`.
- Stop if provider canary misses stopped webhook or recording finalization transition.
- Stop if maintenance worker repeatedly fails or leaves unresolved stop operations.

## Production-safe Backfill Commands (Do Not Run Here)

All commands run from `/var/www/negotaitions/app` with production env loaded.

```bash
# Dry run (no writes)
npm run maintenance:stage310 -- --task backfill --dry-run --batch-size 200

# First bounded write batch
npm run maintenance:stage310 -- --task backfill --batch-size 200

# Continue with cursor (example cursor value from previous output)
npm run maintenance:stage310 -- --task backfill --batch-size 500 --cursor-after-id <last_session_id>

# Verification
npm run maintenance:stage310 -- --task verify-backfill

# Rerun after interruption (idempotent)
npm run maintenance:stage310 -- --task backfill --batch-size 500 --cursor-after-id <last_session_id>

# Abort/stop policy
# - Stop launching further batches
# - Keep application running (null lifecycle is compatible)
# - Resume later with --cursor-after-id from last successful batch
```

## Batch Sizing Policy

- Initial batch: `200`.
- Increase to `500` only after two successful batches and stable DB/app latency.
- Keep bounded mode; do not run unbounded loops.
- Continue app operation during backfill; startup does not depend on backfill completion.

## Locking Notes

- `ALTER TABLE ... ADD COLUMN` and `CREATE TABLE` are brief metadata locks.
- Index creation in this migration is non-concurrent and can take longer on large tables; run in low-traffic window.
- FK creation adds validation scans; monitor migration runtime and lock waits.
- No row-count assumptions are made in this document.

## Production Inspection Commands (Prepared, Not Executed)

```bash
# Active lock inspection during migration window
psql "$DATABASE_URL" -c "SELECT pid, locktype, relation::regclass, mode, granted FROM pg_locks WHERE NOT granted OR relation IS NOT NULL ORDER BY granted, relation::regclass::text;"

# Migration table status
psql "$DATABASE_URL" -c "SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY finished_at NULLS LAST;"
```
