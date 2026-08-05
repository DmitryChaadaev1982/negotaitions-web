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
- Runtime start command pattern: `npm run start` / `next start -H 127.0.0.1`.
- Reverse proxy model: nginx in front of app service.
- Trusted client IP: after controlled nginx activation, overwrite
  `X-NegotAItions-Client-IP` from `$remote_addr` and set
  `TRUSTED_PROXY_ENABLED=true`. See
  `docs/audits/stage-3-13c-proxy-readiness/` and
  `deploy/nginx/trusted-client-ip-snippet.conf`.

### Future nginx activation (not executed in Stage 3.13C)

1. Backup current site files under `/etc/nginx/sites-available/`.
2. Patch **every** vhost that terminates TLS for the app with
   `deploy/nginx/trusted-client-ip-snippet.conf`.
3. `sudo nginx -t`.
4. Reload nginx (`reload`, not restart).
5. Verify localhost listeners and both IPv4 / IPv6 direct-access paths do not
   expose an alternate unauthenticated start surface.
6. Live spoof canary: forged forwarding headers must not create new identities.
7. Enabled-mode same-origin HTTPS test against the canonical origin.
8. Rollback trust first: set `TRUSTED_PROXY_ENABLED=false`, then restore nginx
   backups and reload.
9. Committed verifier: `npm run verify:stage313c:trusted-proxy`
   (live checks require explicit `TARGET_HOST`; never auto-modifies production).

## Secrets And Env

- `.env.production` is runtime secret material and must never be committed.
- Keep secret values in server-side secure storage and service environment wiring only.

## Stage 3.13C-F account-security deployment boundary

- Do not roll old and new app/worker versions together. Stop every old app,
  worker, timer, and ad-hoc email sweep before applying migrations or starting
  the new runtime.
- Apply and verify the additive migration overlay before new runtime start.
- Install `EMAIL_SENSITIVE_PAYLOAD_KEY` before the new runtime accepts ACTIVE
  password-reset requests.
- Keep delivery disabled while reviewing and applying bounded stale/legacy
  password-reset backlog quarantine.
- Keep the normal worker stopped for the canary. The canary must select exactly
  one eligible `EmailMessage` through the manual systemd unit.
- Do not enable the worker timer until that one message is accepted and the
  operational review passes.

After real remediated reset traffic starts, pre-remediation code is not a normal
safe rollback target. Disable delivery, set `TRUSTED_PROXY_ENABLED=false` when
proxy trust is implicated, keep old processes stopped, and forward-fix on the
remediated schema. Do not roll back additive migration history.

Production nginx verification and Postbox/DNS/credential activation are
controlled production actions outside local implementation and validation.

## Standard Validation Steps

Run from repository before deployment:

- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npm run test:unit`
- `npm run test:stage310` (provider-free Stage 3.10 foundation regression)

## Prisma Migration Paths

Use standard Prisma commands for clean databases, development databases, CI databases, and new environments:

- `npx prisma migrate deploy`
- `npx prisma migrate status`

The existing Yandex POC production database has two legitimate historical migration rows that predate the current squashed baseline and are archived outside `prisma/migrations`. For that database only, do not block on ordinary Prisma history divergence. Use the guarded production overlay documented in `docs/operations/prisma-production-history-repair-20260804.md`:

- `npm run prisma:production:status`
- `npm run prisma:production:deploy -- --confirm-legacy-production-history`
- `npm run prisma:production:status`

The overlay must refuse empty, development, or mismatched databases. Do not manually edit `_prisma_migrations` and do not use `prisma migrate resolve` for this repair.

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
