# 11 Deployment Architecture

## Current Target Runtime (Yandex POC)

- Provider: Yandex Cloud VM-based deployment.
- App service: `negotaitions-poc` (systemd service).
- Runtime command model: `npm run start` / `next start` after build.
- Stage 3.10 maintenance is a separate oneshot systemd unit
  (`negotiations-stage310-maintenance.service`) on a 15s timer. It runs
  `npm run maintenance:stage310 -- --task all` via raw `tsx`, not the
  Next bundler. Production injects `/etc/negotaitions/env.production`
  and `NODE_ENV=production`; the CLI must not load local Next `.env*`
  in that mode. Local/non-production runs load project `.env*` from cwd
  before Prisma or required config is constructed.
- The application service and the Stage 3.10 maintenance oneshot are separate
  processes that both run transcript-enhancement provider work, so global
  provider concurrency cannot be process-local. Both acquire leases from the
  same `TranscriptEnhancementProviderSlot` inventory in PostgreSQL (hard caps:
  10 slots globally, 8 per job; configuration may lower either value and can
  never raise it), which is the single cross-process admission authority.
  A killed process does not leak capacity: its slot leases expire after the
  provider timeout plus slack. Set enhancement concurrency and retry env values
  consistently in both independent production env files, because neither
  process is authoritative on its own.
- Stage 3.18A automatic-close values must be identical in both independent
  production env files. The application service reads
  `/var/www/negotaitions/app/.env.production`. The maintenance unit reads
  `/etc/negotaitions/env.production`. Set
  `SESSION_DEBRIEF_EMPTY_CLOSE_MS=60000`,
  `SESSION_DEBRIEF_MAX_DURATION_MS=7200000`, and
  `SESSION_ABANDONED_CLOSE_MS=10800000` in both. Do not treat repository
  validation as timer enablement.

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
  Recording/audio objects live in the dedicated bucket
  `negotiations-recordings-dev-bucket`. Bucket-wide 90-day object expiration
  is an operator Yandex Object Storage lifecycle configuration, not an
  application deploy step. Do not introduce `recordings/raw/`, change Vox
  `recordNamePrefix`, or migrate historical objects as part of deploy.
- Email provider-event ingestion is a separate disabled-by-default systemd
  service (`negotiations-email-provider-events.service`) with its own Data
  Streams credentials and PostgreSQL advisory single-consumer lock. It has no
  dependency on the email delivery worker.

## Build/Deploy Model

- Build and dependency install happen on deployment host workflow.
- Canonical production sequence after a reviewed checkout:
  `npm ci` → repository-installed Prisma migrate deploy (Yandex POC uses
  the guarded production overlay) → `npm run prisma:generate` →
  `npm run build` → runtime-permission apply/check → service restart.
  Do not run `npx prisma generate` or a raw `prisma generate`.
- Runtime permission normalization uses an explicit reviewed allowlist that
  includes transitive operational-script dependencies such as recording-attempt
  fencing, exact-attempt recording reconciliation/policy, the generic
  enhancement provider-call observation seam, and the pure
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
- Historical DB-only Prisma migrations are accepted only when explicitly
  archived under `prisma/legacy-production-history` with verified
  checksum, successful-row, and trusted schema-effect evidence. Unknown
  successful `_prisma_migrations` rows still fail closed
  (`REFUSE_UNKNOWN_LEGACY_DIVERGENCE`). The archive manifest and archive
  directories must match `LEGACY_PRODUCTION_MIGRATIONS` exactly; an extra
  file under the archive directory is not authority. Every archived entry
  that requires schema-effect authority must declare an explicit
  `schemaEffectId`; missing, empty, or unknown ids are refused and are
  never defaulted from the migration name. The current archived
  production evidence is the June pre-squash pair plus
  `20260810120000_add_ai_analysis_progress`. Admission also requires the
  leftover `public."AiAnalysis"."progressJson"` JSONB nullable column and
  the trusted leftover two-pass/diarization columns for the June pair.
  Each expected schema/table/column fact requires exactly one matching
  `information_schema` observation: zero matches refuse missing, and
  identical or conflicting duplicates refuse ambiguous. First-match
  selection is not authority. Code/manifest own this truth; this
  document is not a second allowlist.
- The additive `20260916090000_add_transcript_enhancement_provider_slots`
  migration must be applied on any database the new client reads, including the
  local development database, before the application serves transcript
  enhancement. It creates `TranscriptEnhancementProviderSlot` and seeds the
  fixed inventory of 10 slot rows; provider admission fails closed without it.
  Production apply uses the guarded overlay after exact pending-set equality
  against `EXPECTED_RELEASE_PENDING_MIGRATIONS` (currently only
  `20260916090000_add_transcript_enhancement_provider_slots`). Pre-deploy
  pending must be exactly that set and the current release migration must
  not already have a history row (`PRE_DEPLOY_ALLOW`). After apply,
  `POST_DEPLOY_SAFE` requires empty pending, a successful-row predicate
  match (`finished_at` set, `rolled_back_at` null, valid
  `applied_steps_count`, logs free of failure/P30xx evidence), a DB
  checksum that exactly matches the current active migration artifact
  read from `prisma/migrations/<name>/migration.sql`, and
  no unrelated history divergence. Name presence is not authority. The
  migration is never applied by a
  validation or UAT command. First-deploy order: pre-migration checks that
  do not query the new table; guarded overlay status; apply the admitted
  migration; verify migration state; **POST-MIGRATION ONLY** inspect
  provider-slot rows/leases; then continue normal readiness. On first deploy,
  do not query `TranscriptEnhancementProviderSlot` before the migration creates
  it.
- Enhancement quiescence for a deployment hold is decided by current D1 state —
  `executionStatus`, `publicationEligible`, `runId` currentness, and
  `leaseExpiresAt` — plus unexpired `TranscriptEnhancementProviderSlot` leases.
  Elapsed wall time is not authority: the deprecated
  `TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS` (default `7000`) never makes an eligible
  job with a valid lease quiescent. Predicates are in
  `docs/operations/deployment-runbook.md`.
- The Stage 3.15A additive `AiAnalysis.inputFingerprint` migration must be
  applied on any database the new client reads, including local. Production
  apply uses the guarded overlay
  (`npm run prisma:production:status` /
  `npm run prisma:production:deploy -- --confirm-legacy-production-history`)
  after the migration is explicitly allowlisted as
  `20260819120000_add_ai_analysis_input_fingerprint`. The column is nullable
  with no backfill. Apply schema before starting the new application process.
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

## Operational CLI runtime

The Stage 3.10 maintenance CLI is an intentional non-Next runtime. The
entrypoint (`scripts/ops/stage-3-10-maintenance.ts`) calls
`bootstrapOperationalEnv()` before dynamically importing
`lib/stage-3-10-maintenance.ts`. Next-only `import "server-only"`
boundaries stay on application wrappers. Enabling the production timer
uses the same command; do not add a `node -e` wrapper or Next module
resolution shim.

## Source Notes

- `docs/deployment/yandex-poc-server-parameters.md`
- `docs/deployment/yandex-poc-runtime-audit.md`
- `docs/voximplant/yandex-deployment-runbook.md` (historical; env-backup steps superseded)
- `docs/operations/deployment-runbook.md` (authoritative env backup retention
  and current-env rollback)
- `docs/architecture/10-data-storage-and-retention.md` (recording bucket
  lifecycle is operator Object Storage configuration, not a deploy script)
- `scripts/ops/stage-3-10-maintenance.ts`
- `deploy/systemd/negotiations-stage310-maintenance.service`
- `deploy/systemd/negotiations-stage310-maintenance.timer`
