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
- Registry deployment settings have no application defaults. The web
  `.env.production` and `/etc/negotaitions/env.production` must explicitly
  supply their applicable values and remain aligned as documented in
  `email-runtime-and-yandex-cloud.md`.
- If normal admin-health assembly fails, its outer route catch returns a
  literal environment-independent unavailable contract; it never resolves or
  serializes endpoint, webhook override, parser, or exception details.

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
- Runtime permission normalization uses an explicit reviewed allowlist that
  includes transitive operational-script dependencies such as recording-attempt
  fencing, exact-attempt recording reconciliation/policy, and the pure
  legacy-session terminal normalization CLI guard.
- This document does not introduce new deploy commands; it captures current documented model only.

### Recording attempt fencing rollout order

RC4 is already active in Voximplant with build marker
`main-room-recording-reconciliation-2026-08-12-rc4`. The remaining rollout is:

1. Preserve/export the active RC4 source/build and require zero active provider
   or application processing work.
2. Apply the additive nullable `Recording.recordingAttemptId` migration and its
   unique index through the guarded production overlay.
3. Deploy the application that persists attempt identity before dispatch,
   accepts legacy RC2 callbacks only for legacy NULL-attempt rows, and supports
   RC3/RC4 exact-attempt control.
4. Confirm the existing scenario build marker and exact-attempt registration/status
   telemetry before relying on reconciliation.

Do not upload Voximplant again in this rollout. RC4 retains the legacy RC2
message, callback, and server-stop path used by application `601704...`, so a
quiescent application rollback may leave RC4 active. Rollback keeps the
nullable column/index; historical NULL-attempt rows remain legacy-only. Exact
preflight predicates and rollback steps are in
`docs/operations/deployment-runbook.md`.

## Constraints

- No Prisma schema/migration changes are part of architecture-doc updates alone.
- Production nginx/systemd edits remain a controlled activation step documented in
  `docs/operations/deployment-runbook.md` and
  `docs/audits/stage-3-13c-proxy-readiness/`.
- Application start command binds `127.0.0.1` via `next start -H 127.0.0.1`.
- Next Server Actions behind nginx require the approved origin allowlist in
  `next.config.ts`; this fixes login/logout forwarded-host validation without
  weakening same-origin checks.
- Browser-interactive Event/Session copy-link actions use the actual page
  origin and canonical relative paths, so the same build works behind local,
  production, or future domains. Server/email links remain bound to explicitly
  configured canonical origins because no browser authority exists there.

## Source Notes

- `docs/deployment/yandex-poc-server-parameters.md`
- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md`
