# 11 Deployment Architecture

## Current Target Runtime (Yandex POC)

- Provider: Yandex Cloud VM-based deployment.
- App service: `negotaitions-poc` (systemd service).
- Runtime command model: `npm run start` / `next start` after build.
- Session-lifecycle maintenance is a separate oneshot systemd unit
  (`negotiations-stage310-maintenance.service`) on a 15s timer. It runs
  `npm run maintenance:stage310 -- --task all` via raw `tsx`, not the
  Next bundler. Production injects `/etc/negotaitions/env.production`
  and `NODE_ENV=production`; the CLI must not load local Next `.env*`
  in that mode. Local/non-production runs load project `.env*` from cwd
  before Prisma or required config is constructed.
- The application service and the `negotiations-stage310-maintenance`
  oneshot are separate processes that both run transcript-enhancement
  provider work, so global provider concurrency cannot be process-local.
  Both acquire leases from the same `TranscriptEnhancementProviderSlot`
  inventory in PostgreSQL (hard caps:
  10 slots globally, 8 per job; configuration may lower either value and can
  never raise it), which is the single cross-process admission authority.
  A killed process does not leak capacity: its slot leases expire after the
  provider timeout plus slack. Set enhancement concurrency and retry env values
  consistently in both independent production env files, because neither
  process is authoritative on its own.
- Automatic-close values must be identical in both independent
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
- Auth/email/provider-event runtime settings are defined by one
  typed registry. Admin diagnostics project from that registry, and an
  AST-based validation gate rejects unregistered or bypassing environment
  access. Registered secrets serialize only presence state with `value: null`.
- Registry deployment settings have no application defaults. The web
  `.env.production` and `/etc/negotaitions/env.production` must explicitly
  supply their applicable values. Shared identity, origin, and crypto
  values must remain aligned. `EMAIL_PROVIDER` and `EMAIL_DELIVERY_ENABLED`
  are process-local delivery gates and may differ as documented in
  `email-runtime-and-yandex-cloud.md`.
- Production environment files are authoritative. A release classifies each
  required key as `KEEP`, `ADD`, `CHANGE`, or `RETIRE` and applies that
  delta. `.env.example`, a developer `.env`, and a machine snapshot do not
  replace production config. Development defaults, test configuration,
  production runtime config, secrets, and provider credentials stay
  separate. Local web-process email can stay safe with
  `EMAIL_DELIVERY_ENABLED=false` and `EMAIL_PROVIDER=disabled`.
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

## Database release governance

Operator procedure: `docs/operations/deployment-runbook.md`. Executable
guard: `lib/prisma-production-migration-overlay.ts` and
`scripts/ops/prisma-production-migration-overlay.ts`. This section states
the invariants. It does not add a second migrator.

**Database identity** is established before mutation: the host, port, and
database name of the `DATABASE_URL` the command will use. The overlay
refuses a missing URL without printing it (`REFUSE_DATABASE_URL_MISSING`)
and refuses a database with no Prisma history
(`REFUSE_EMPTY_OR_NO_HISTORY`). It has no separate production-name
allowlist. Connecting to the wrong URL is an operator error the history
guard does not fully replace.

**Backup** is required before a material database deployment, and the
backup must be verified (for a custom-format dump, a readable restore
list). Yandex Managed PostgreSQL backup is the production mechanism. The
overlay does not create or check that backup. An empty local `.dump`
placeholder is not a backup.

**History classification** uses these names. The overlay codes are the
implementation:

| Class | Meaning in this repository |
| --- | --- |
| `APPLIED_EXPECTED` | Active-chain migrations already present as successful history rows |
| `PENDING_EXPECTED` | Actual pending equals `EXPECTED_RELEASE_PENDING_MIGRATIONS` and those names have no history row yet (`PRE_DEPLOY_ALLOW`) |
| `LEGITIMATE_LEGACY_VARIANT` | Admitted lineage `LEGACY_PROGRESS_APPLIED` or `LEGACY_PROGRESS_NEVER_APPLIED`. The June pre-squash pair is required on every admitted lineage. A known archive file is not automatically a required row |
| `UNKNOWN_DIVERGENCE` | Unrecognized migration-history or schema-lineage divergence. Overlay code `REFUSE_UNKNOWN_LEGACY_DIVERGENCE` (history rows outside the admitted lineage, duplicate history rows, or an undeclared legacy archive). Related lineage inconsistency is `REFUSE_LEGACY_LINEAGE_INCONSISTENT`. Stop normal deployment; recovery is separate |

Other overlay `REFUSE_*` codes also stop normal deployment. They are not
`UNKNOWN_DIVERGENCE`. Implemented examples include an unexpected or missing
pending set (`REFUSE_UNEXPECTED_PENDING_MIGRATIONS`,
`REFUSE_MISSING_EXPECTED_PENDING`), a checksum or artifact mismatch
(`REFUSE_RELEASE_MIGRATION_CHECKSUM_MISMATCH`,
`REFUSE_LEGACY_CHECKSUM_MISMATCH`, `REFUSE_ARCHIVE_HASH_MISMATCH`), missing
required context (`REFUSE_DATABASE_URL_MISSING`,
`REFUSE_EMPTY_OR_NO_HISTORY`), and an invalid release state
(`REFUSE_DEPLOY_CONFIRMATION_REQUIRED`,
`REFUSE_RELEASE_MIGRATION_INCONSISTENT`). Stop for that code. The overlay
source is the code list; this paragraph is not a second taxonomy.

**Exact pending set and checksum.** Each authorized migration release
records the migration name, the raw `migration.sql` bytes, their SHA256,
the expected schema effect, and the exact pending set. `POST_DEPLOY_SAFE`
requires empty pending, the successful-row predicate (`finished_at` set,
`rolled_back_at` null, valid `applied_steps_count`, logs free of
failure/P30xx evidence), and a database checksum equal to the active
artifact. Name presence is not authority.

**Clean database and production-lineage rehearsal.** A clean database
proves the active chain with repository-installed Prisma `migrate deploy`.
When production lineage risk is material, also rehearse on a disposable
clone that carries realistic production history, using the guarded overlay.
A clean database can miss legacy-history failures. Leave the preserved
reference database unchanged. A trivial migration with no lineage risk does
not require the clone.

**Normal command.** New, empty, CI, and other non-legacy databases use
`npx --no-install prisma migrate deploy`. The Yandex POC production
database uses `npm run prisma:production:status` and
`npm run prisma:production:deploy -- --confirm-legacy-production-history`.
That overlay then runs repository-installed Prisma `migrate deploy` for the
admitted set. Routine production deployment does not use `prisma migrate
reset`, `prisma db push`, ad-hoc `prisma migrate resolve`, manual
`_prisma_migrations` edits, or arbitrary SQL lineage repair.

**Normal deployment versus recovery.** Normal deployment has a known
target, a known candidate, a known migration and environment delta, and an
expected state. Unexpected history, schema divergence, candidate mismatch,
authority mismatch, partial apply, or unknown state stops that path.
Recovery is a separate task with its own evidence, scope, authority,
validation, and recovery procedure.

### Current release evidence

This subsection is the current pending migration, not a permanent allowlist.
When `EXPECTED_RELEASE_PENDING_MIGRATIONS` changes, update or archive it.

`EXPECTED_RELEASE_PENDING_MIGRATIONS` is exactly
`20260923065420_add_password_history_and_password_change_required_at`.
Raw `prisma/migrations/20260923065420_add_password_history_and_password_change_required_at/migration.sql`
SHA256:

`bd71842795ec8e21b7de943a3f18b3dbf4a9e41e3d4c0d9b495708129bb9e885`

Schema effect: create `PasswordHistory` and add nullable
`User.passwordChangeRequiredAt`. No backfill. No change to
`User.passwordHash`. `passwordChangeRequiredAt` stays unenforced. That hash
identifies this artifact only.

### Recording attempt fencing

Current architecture: `Recording.recordingAttemptId` is the persisted attempt
identity. Completed migration
`20260812111000_add_recording_attempt_fencing` added the nullable column and
unique index. RC4 is the active Voximplant scenario, build marker
`main-room-recording-reconciliation-2026-08-12-rc4`. The application persists
attempt identity before dispatch, accepts legacy RC2 callbacks only for
legacy NULL-attempt rows, and uses RC3/RC4 exact-attempt control. RC4 retains
the legacy RC2 message, callback, and server-stop path used by application
`601704...`. A quiescent application rollback of that release may leave RC4
active and leaves the nullable column and index in place. Historical
NULL-attempt rows remain legacy-only.

Historical note: that August 2026 rollout is completed. The point-in-time
procedure, including its then-remaining order, is in
[`docs/history/remediation/implementation/stage-3-13e-debrief-recording-reconciliation.md`](../history/remediation/implementation/stage-3-13e-debrief-recording-reconciliation.md).
The Stage 3.13E example in
[`docs/operations/deployment-runbook.md`](../operations/deployment-runbook.md)
preserves the same completed order. Neither document is a current rollout.

## Constraints

- No Prisma schema/migration changes are part of architecture-doc updates alone.
- Historical DB-only Prisma migrations are accepted only when they belong to
  an explicitly admitted production lineage. Known artifacts under
  `prisma/legacy-production-history` are not automatically required rows on
  every lineage. Each admitted lineage needs positive history and trusted
  schema-effect evidence. Unknown successful `_prisma_migrations` rows and
  unknown lineage combinations still fail closed
  (`REFUSE_UNKNOWN_LEGACY_DIVERGENCE`, `REFUSE_LEGACY_LINEAGE_INCONSISTENT`).
  The archive manifest and archive directories must match
  `LEGACY_PRODUCTION_MIGRATIONS` exactly; an extra file under the archive
  directory is not authority. Every archived entry that requires
  schema-effect authority must declare an explicit `schemaEffectId` and a
  `lineageAdmission`; missing, empty, or unknown ids are refused and are
  never defaulted from the migration name. The current known archive is the
  June pre-squash pair, required on every admitted lineage, plus
  `20260810120000_add_ai_analysis_progress` as a lineage variant. Variant
  `LEGACY_PROGRESS_APPLIED` requires that successful row and the leftover
  `public."AiAnalysis"."progressJson"` JSONB nullable column. Variant
  `LEGACY_PROGRESS_NEVER_APPLIED` requires the row and leftover column both
  to be absent. Both variants also require the trusted leftover
  two-pass/diarization columns for the June pair. Each expected
  schema/table/column fact requires exactly one matching
  `information_schema` observation: zero matches refuse missing, and
  identical or conflicting duplicates refuse ambiguous. First-match
  selection is not authority. Code/manifest own this truth; this
  document is not a second allowlist.
- The additive `20260916090000_add_transcript_enhancement_provider_slots`
  migration creates `TranscriptEnhancementProviderSlot` and seeds the fixed
  inventory of 10 slot rows. Databases that serve transcript enhancement must
  already have it applied. It is not the current release-pending migration.
  The current release preflight compares pending migrations with
  `EXPECTED_RELEASE_PENDING_MIGRATIONS`, which is exactly
  `20260923065420_add_password_history_and_password_change_required_at`.
  The raw artifact SHA256 for that file is recorded under **Current release
  evidence** above and is not a checksum for later migrations.
  Pre-deploy pending must be exactly that password-security migration, and
  that migration must not already have a history row (`PRE_DEPLOY_ALLOW`).
  An extra pending migration, including a not-yet-applied historical
  migration, is refused. After apply, `POST_DEPLOY_SAFE` requires empty
  pending, a successful-row predicate match (`finished_at` set,
  `rolled_back_at` null, valid `applied_steps_count`, logs free of
  failure/P30xx evidence), a DB checksum that exactly matches the current
  active migration artifact read from `prisma/migrations/<name>/migration.sql`,
  and no unrelated history divergence. Name presence is not authority. The
  password-security migration creates `PasswordHistory` and adds nullable
  `User.passwordChangeRequiredAt`. It does not backfill, and it does not
  change `User.passwordHash`. After apply, explicit password changes write
  history; login rehash and policy behavior are specified in
  `09-security-and-access-control.md`. `passwordChangeRequiredAt` stays
  unenforced. Historical first-deploy order for that completed provider-slot
  migration, which is not Stage 3.13E and not the password-security migration:
  pre-migration checks that do not query the new table; guarded overlay
  status; apply that provider-slot migration; verify migration state;
  **POST-MIGRATION ONLY** inspect provider-slot rows/leases; then continue
  readiness. On a database that has not yet applied that migration,
  do not query `TranscriptEnhancementProviderSlot` before the migration creates it.
- Enhancement quiescence for a deployment hold is decided by current D1 state —
  `executionStatus`, `publicationEligible`, `runId` currentness, and
  `leaseExpiresAt` — plus unexpired `TranscriptEnhancementProviderSlot` leases.
  Elapsed wall time is not authority: the deprecated
  `TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS` (default `7000`) never makes an eligible
  job with a valid lease quiescent. Predicates are in
  `docs/operations/deployment-runbook.md`.
- The additive `AiAnalysis.inputFingerprint` migration must be
  applied on any database the new client reads, including local. Production
  apply uses the guarded overlay
  (`npm run prisma:production:status` /
  `npm run prisma:production:deploy -- --confirm-legacy-production-history`)
  after the migration is explicitly allowlisted as
  `20260819120000_add_ai_analysis_input_fingerprint`. The column is nullable
  with no backfill. Apply schema before starting the new application process.
- Production nginx/systemd edits remain a controlled activation step documented in
  `docs/operations/deployment-runbook.md` and
  `docs/history/audits/stage-3-13c-proxy-readiness/`.
- Application start command binds `127.0.0.1` via `next start -H 127.0.0.1`.
- Next Server Actions behind nginx require the approved origin allowlist in
  `next.config.ts`; this fixes login/logout forwarded-host validation without
  weakening same-origin checks.
- Browser-interactive Event/Session copy-link actions use the actual page
  origin and canonical relative paths, so the same build works behind local,
  production, or future domains. Server/email links remain bound to explicitly
  configured canonical origins because no browser authority exists there.

## Operational CLI runtime

The maintenance CLI (`scripts/ops/stage-3-10-maintenance.ts`) is an
intentional non-Next runtime. The entrypoint calls
`bootstrapOperationalEnv()` before dynamically importing
`lib/stage-3-10-maintenance.ts`. Next-only `import "server-only"`
boundaries stay on application wrappers. Enabling the production timer
uses the same command; do not add a `node -e` wrapper or Next module
resolution shim.

## Source Notes

- `docs/operations/deployment-runbook.md` (authoritative deploy and env
  backup/rollback)
- Historical POC notes: `docs/history/checkpoints/deployment/`
- Historical Vox Yandex runbook: `docs/history/design-packets/voximplant/yandex-deployment-runbook.md`
- `docs/architecture/10-data-storage-and-retention.md` (recording bucket
  lifecycle is operator Object Storage configuration, not a deploy script)
- `lib/prisma-production-migration-overlay.ts`
- `scripts/ops/prisma-production-migration-overlay.ts`
- `scripts/ops/stage-3-10-maintenance.ts`
- `deploy/systemd/negotiations-stage310-maintenance.service`
- `deploy/systemd/negotiations-stage310-maintenance.timer`
