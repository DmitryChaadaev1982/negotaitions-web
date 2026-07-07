# 11 Deployment Architecture

## Current Target Runtime (Yandex POC)

- Provider: Yandex Cloud VM-based deployment.
- App service: `negotaitions-poc` (systemd service).
- Runtime command model: `npm run start` / `next start` after build.

## Canonical Server Paths

- Canonical app git working path: `/var/www/negotaitions/app-git`.
- Runtime path served by process manager: `/var/www/negotaitions/app` -> symlink to `app-git`.
- Artifact storage root: `/var/www/negotaitions-artifacts`.
- Secure env backup root: `/var/www/negotaitions-secure-backups`.

## Runtime Secrets

- `.env.production` is runtime secret material and must not be committed.
- Secret values must remain outside repository docs and code.

## Service Topology (Inferred)

- nginx reverse proxy fronts Node.js app runtime.
- systemd unit starts single app process for POC stability.
- App process uses PostgreSQL, object storage, Voximplant APIs, and Yandex APIs.

## Build/Deploy Model

- Build and dependency install happen on deployment host workflow.
- This document does not introduce new deploy commands; it captures current documented model only.

## Constraints

- No Prisma schema/migration changes are part of architecture-doc updates.
- No nginx/systemd config edits are part of this documentation consolidation.

## Source Notes

- `docs/deployment/yandex-poc-server-parameters.md`
- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
