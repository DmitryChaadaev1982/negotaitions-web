# Deployment Runbook

## Scope

This runbook captures current deployment/runtime expectations for the Yandex POC architecture. It does not introduce new deployment commands.

## Runtime Paths

- Canonical source path on server: `/var/www/negotaitions/app-git`.
- Runtime app path: `/var/www/negotaitions/app` (symlink to `app-git`).
- Artifact storage root: `/var/www/negotaitions-artifacts`.
- Secure env backup root: `/var/www/negotaitions-secure-backups`.

## Process Model

- Service name: `negotaitions-poc`.
- Runtime start command pattern: `npm run start` / `next start`.
- Reverse proxy model: nginx in front of app service.

## Secrets And Env

- `.env.production` is runtime secret material and must never be committed.
- Keep secret values in server-side secure storage and service environment wiring only.

## Standard Validation Steps

Run from repository before deployment:

- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npm run test:unit`
- `npm run test:stage310` (provider-free Stage 3.10 foundation regression)

## Post-Deploy Checks

- Verify service health via admin diagnostics and endpoint checks.
- Verify one room -> recording -> webhook completion cycle.
- Verify materials status progression for a completed session.
- For Stage 3.10 maintenance timer rollout: verify dry-run command first (`npm run maintenance:stage310 -- --task all --dry-run`) before enabling timer.

## Stage 3.10 Release Order (Exact)

1. Confirm backups and rollback owner.
2. Stage code at `/var/www/negotaitions/app`.
3. Apply migration (`npx prisma migrate deploy`).
4. Verify migration status (`npx prisma migrate status`).
5. Restart `negotaitions-poc`.
6. Run smoke (`npm run test:e2e:smoke` and browser smoke subset as applicable).
7. Run backfill dry-run + first bounded batch.
8. Verify counters (`npm run maintenance:stage310 -- --task verify-backfill`).
9. Continue bounded backfill with cursor resume.
10. Deploy Vox scenario manually and run disposable provider canary.
11. Install maintenance units disabled, run manual one-shot.
12. Enable timer only after one-shot review.

## Vox scenario rollout safety (manual, non-automatic)

The `neg-conf-main-room` scenario artifact is manually deployed. For Stage 3.10 A7 rollout, prepare and execute in this order:

1. repository scenario diff review (`docs/voximplant/neg-conf.main-room.scenario.js`);
2. local syntax/static checks of scenario source;
3. scenario drift check (`npm run vox:scenario:check`);
4. backup/export currently deployed scenario source/build marker;
5. paste/upload new scenario source;
6. verify rule binding still points to `neg-conf-main-room`;
7. run disposable canary conference;
8. verify start/pause/resume/finish + participant relay + build marker + stopped webhook + recording output + transcription pipeline;
9. keep rollback-ready previous scenario source/build marker.

Provider-dependent checks in this block remain manual canaries and must not be moved into default CI validation commands.

Do not treat this as automatic deploy from app code. Existing facilitator relay must remain compatible before and after app deployment.

## Source Notes

- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
- `docs/deployment/yandex-poc-server-parameters.md`
- `docs/operations/stage-3-10-maintenance-runbook.md`
- `docs/testing/stage-3-10-session-lifecycle-coverage-gaps.md`
