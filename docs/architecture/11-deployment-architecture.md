# 11 Deployment Architecture

## Current Target Runtime (Yandex POC)

- Provider: Yandex Cloud VM-based deployment.
- App service: `negotaitions-poc` (systemd service).
- Runtime command model: `npm run start` / `next start` after build.

## Canonical Server Paths

- Canonical app git working path: `/var/www/negotaitions/app-git`.
- Runtime path served by process manager: `/var/www/negotaitions/app` -> symlink to `app-git`.
- Artifact storage root: `/var/www/negotaitions-artifacts`.
- Secure backup root: `/var/www/negotaitions-secure-backups`.
  Host-local protected operational metadata root. Not a long-lived plaintext
  secret archive. See **Env backup and rollback policy** below.

## Runtime Secrets

- `.env.production` is runtime secret material and must not be committed.
- Secret values must remain outside repository docs and code.
- Stage 3.13C auth/email/provider-event runtime settings are defined by one
  typed registry. Admin diagnostics project from that registry, and an
  AST-based validation gate rejects unregistered or bypassing environment
  access. Registered secrets serialize only presence state with `value: null`.
- Registry deployment settings have no application defaults. The web
  `.env.production` and `/etc/negotaitions/env.production` must explicitly
  supply their applicable values. Shared identity, origin, and crypto
  values must remain aligned. `EMAIL_PROVIDER` and `EMAIL_DELIVERY_ENABLED`
  are process-local delivery gates and may differ as documented in
  `email-runtime-and-yandex-cloud.md`.
- If normal admin-health assembly fails, its outer route catch returns a
  literal environment-independent unavailable contract; it never resolves or
  serializes endpoint, webhook override, parser, or exception details.

## Env backup and rollback policy

Durable operational rule. Operator procedures live in
`docs/operations/deployment-runbook.md`.

- **Authoritative runtime env** is the live application `.env.production` and
  `/etc/negotaitions/env.production`. Those files are the normal secret
  recovery source.
- A **temporary plaintext env backup** may exist only while an env/config
  change is unvalidated, only under the **secure backup root**, mode `600`,
  with a restricted parent directory. Maximum: one in-flight app copy and one
  in-flight worker/system copy, or one timestamped pair for the same change.
  Delete immediately after successful validation. Absolute cap: 24 hours.
  Do not accumulate historical `.env` generations. Do not keep long-lived
  `.env.production.bak-*` next to the live app env.
- **CODE ROLLBACK != ENV ROLLBACK.** Default application rollback restores the
  accepted previous Git SHA / build and uses **current-env rollback** (the
  current valid production env). Historical env restore is exceptional and
  must be explicitly justified.
- **`.next` / build runtime snapshots** are not a durable rollback mechanism.
  Delete after successful deployment validation. Rebuild from the accepted
  Git SHA when rollback is required.
- **Non-secret deployment metadata** (SHA, branch, git status, timestamps,
  build/runtime/service status, rollback target, non-secret logs) may be
  retained under the secure backup root for up to 90 days or the last 3
  production deployments, whichever is smaller.
- **Managed DB backup** is a separate Yandex Managed PostgreSQL policy. Do not
  conflate it with env backup retention.
- Secret loss is recovered by restoring, re-issuing, or rotating through the
  corresponding provider / secret-management mechanism. This policy does not
  introduce Lockbox as a mandatory runtime dependency.

## Service Topology (Inferred)

- nginx reverse proxy fronts Node.js app runtime.
- nginx access logs use a centralized sanitized format
  (`deploy/nginx/sanitized-access-log.conf`): query strings, raw
  token-bearing pathname segments, `$request`, `$request_uri`, and
  Referer are not logged. Recording debug is fail-closed in production:
  `isRecordingDebugEnabled()` always returns false when
  `NODE_ENV=production`, regardless of `RECORDING_DEBUG_PANEL` or
  `NEXT_PUBLIC_RECORDING_DEBUG_PANEL`. The unauthenticated
  `/api/debug/recording/[sessionId]` surface is for controlled
  non-production diagnostics only. Keep `RECORDING_DEBUG_PANEL=false`
  in the application EnvironmentFile as defense in depth.
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
- `docs/voximplant/yandex-deployment-runbook.md` (historical; env-backup steps superseded)
- `docs/operations/deployment-runbook.md` (authoritative env backup retention
  and current-env rollback)
