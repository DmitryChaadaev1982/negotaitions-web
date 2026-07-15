# Stage 3.10 Rollback Plan

## Rollback Triggers

- Login or room access regressions.
- Provider token issuance failures.
- Unexpected room closure or reconnect failures.
- Event completion regression.
- Recording stop/finalization regression.
- Missing webhook above agreed threshold.
- Maintenance worker repeated failures.
- Invalid backfill derivation counters.
- Elevated HTTP 5xx.
- Materials page inaccessible for completed sessions.

## Application Rollback

1. Stop timer execution first (`systemctl stop negotiations-stage310-maintenance.timer`).
2. Disable timer (`systemctl disable negotiations-stage310-maintenance.timer`).
3. Restore prior application commit/build artifact.
4. Restart `negotaitions-poc`.
5. Verify old app behavior on additive schema.

Notes:

- Do not drop Stage 3.10 schema objects during emergency rollback.
- Old app ignores additive tables/nullable column safely.

## Scenario Rollback

1. Restore prior scenario source/version in Voximplant Console.
2. Confirm rule binding still points to expected scenario name.
3. Run basic join/start/stop canary.
4. Confirm stopped webhook and materials progression.

## Timer Rollback

1. `systemctl stop negotiations-stage310-maintenance.timer`
2. `systemctl disable negotiations-stage310-maintenance.timer`
3. Keep service unit present until verification is complete.
4. Remove units only after stable rollback verification.

## Database Rollback Policy

- No destructive rollback of additive schema.
- No dropping new tables/columns during incident response.
- No destructive reversal of completed backfill.
- Keep lifecycle/connection/operation history for diagnosis.
- If cleanup is ever required, perform later via reviewed migration only.
