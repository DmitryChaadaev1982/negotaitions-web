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

## Post-Deploy Checks

- Verify service health via admin diagnostics and endpoint checks.
- Verify one room -> recording -> webhook completion cycle.
- Verify materials status progression for a completed session.

## Source Notes

- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
- `docs/deployment/yandex-poc-server-parameters.md`
