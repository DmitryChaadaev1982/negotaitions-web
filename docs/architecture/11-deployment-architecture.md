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
- Stage 3.13C auth/email/provider-event runtime settings are defined by one
  typed registry. Admin diagnostics project from that registry, and an
  AST-based validation gate rejects unregistered or bypassing environment
  access. Registered secrets serialize only presence state with `value: null`.

## Service Topology (Inferred)

- nginx reverse proxy fronts Node.js app runtime.
- systemd unit starts single app process for POC stability.
- App process uses PostgreSQL, object storage, Voximplant APIs, and Yandex APIs.
- Email provider-event ingestion is a separate disabled-by-default systemd
  service (`negotiations-email-provider-events.service`) with its own Data
  Streams credentials and PostgreSQL advisory single-consumer lock. It has no
  dependency on the email delivery worker.

## Build/Deploy Model

- Build and dependency install happen on deployment host workflow.
- This document does not introduce new deploy commands; it captures current documented model only.

## Constraints

- No Prisma schema/migration changes are part of architecture-doc updates alone.
- Production nginx/systemd edits remain a controlled activation step documented in
  `docs/operations/deployment-runbook.md` and
  `docs/audits/stage-3-13c-proxy-readiness/`.
- Application start command binds `127.0.0.1` via `next start -H 127.0.0.1`.
- Next Server Actions behind nginx require the approved origin allowlist in
  `next.config.ts`; this fixes login/logout forwarded-host validation without
  weakening same-origin checks.

## Source Notes

- `docs/deployment/yandex-poc-server-parameters.md`
- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
