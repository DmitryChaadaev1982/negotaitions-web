# Prisma Production History Repair - 2026-08-04

## Root Cause

Production contains successful historical Prisma migration rows whose directories were later deleted from the repository. Historical DB-only migrations are accepted only when explicitly archived with verified checksum/evidence. Unknown successful rows still fail closed.

The original pre-squash pair:

- `20260625090944_add_two_pass_transcription_quality_enhancement`
- `20260625120000_squash_and_diarization_fields`

Those directories were removed when the repository introduced the later squashed production baseline `20260627_production_initial_baseline`. Production kept the real `_prisma_migrations` rows, so Prisma correctly reported missing migration directories when Stage 3.13B deployment reached migration status/deploy.

A later post-baseline row is archived the same way:

- `20260810120000_add_ai_analysis_progress`

That directory was added, applied in production, then removed from the active chain when speculative `AiAnalysis.progressJson` persistence was withdrawn. Production kept the successful row and the leftover nullable JSONB column.

## Production Evidence

The historical SQL files were recovered from Git object history, not reconstructed.

`20260625090944_add_two_pass_transcription_quality_enhancement`:

- source commit: `c86f3abeb6da53ca95dbb4f58ee7b1d36aecd898`
- source blob: `4ecaef8fb11e8ab7c0e0a830cada34689b4be61e`
- production checksum: `ea6930e3c7149c7fcdbf614a81d8e14558ea1208e56c943ef96030114da1e8de`

`20260625120000_squash_and_diarization_fields`:

- source commit: `c86f3abeb6da53ca95dbb4f58ee7b1d36aecd898`
- source blob: `cc418b3f010e2fa0a1539e68e1eeca2ecaf90303`
- production checksum: `892a0be5d1ae18c87e3c7b0da218e0d87ffdb179da3f8ac3dbed67ef91794fc3`

`20260810120000_add_ai_analysis_progress`:

- source commit: `5877ea340c2a46ed6c38d1d6223c47b1dc19858b`
- source blob: `e4f752028a6166bac8562fd8e57ffc4e7918fbf5`
- production checksum: `a5b48e99f2d978b83c7c36aec06abcfe97451a693a8cde224ed4cb63772d76c0`
- recovered Git SQL adds nullable `AiAnalysis.progressJson JSONB`
- archive bytes are the apply-time CRLF form of that SQL so the Prisma checksum matches the production row; the Git blob itself is LF-normalized

Production also has `20260627_production_initial_baseline` and later pre-email migrations successfully applied. Stage 3.13B email migrations were not applied before this repair.

## Why Not Restore Under Active Migrations

Putting the recovered directories back under `prisma/migrations` makes clean installs invalid. The recovered `20260625090944` SQL alters tables created by the later squashed baseline, so an empty database fails with `relation "Transcript" does not exist`.

The active migration chain must remain the clean-environment source of truth. Legacy production history is evidence for production only.

## Archive Location

Exact legacy files are stored outside active Prisma discovery:

- `prisma/legacy-production-history/manifest.json`
- `prisma/legacy-production-history/20260625090944_add_two_pass_transcription_quality_enhancement/migration.sql`
- `prisma/legacy-production-history/20260625120000_squash_and_diarization_fields/migration.sql`
- `prisma/legacy-production-history/20260810120000_add_ai_analysis_progress/migration.sql`

`.gitattributes` disables text conversion and diff handling for `prisma/legacy-production-history/**` so archived bytes remain stable across checkouts. The current release migration directory is also `-text` so `POST_DEPLOY_SAFE` hashes the repository-stable `migration.sql` bytes rather than a checkout-normalized working tree.

## Overlay Architecture

Operational entrypoint:

- `scripts/ops/prisma-production-migration-overlay.ts`

Reusable guard/overlay implementation:

- `lib/prisma-production-migration-overlay.ts`

Package scripts:

- `npm run prisma:production:status`
- `npm run prisma:production:deploy -- --confirm-legacy-production-history`
- `npm run prisma:production:overlay:verify`

The tool creates a randomized temporary directory, copies `prisma/schema.prisma`, copies active migrations, copies the archived legacy migrations with their original names, copies `migration_lock.toml`, writes a temporary Prisma config pointing at that overlay, verifies legacy SHA256 values, invokes Prisma against the temporary schema/config, then deletes the temporary directory in `finally` and verifies cleanup.

The tool does not copy `.env`, does not put credentials in command-line arguments, and redacts database URLs from subprocess output.

## Database Guards

Before overlay `status` or `deploy`, the tool reads `_prisma_migrations`
metadata and trusted `information_schema` column facts. It refuses unless
all conditions hold:

- target database already has Prisma migration history;
- the archive manifest and `prisma/legacy-production-history/` directories
  agree exactly with `LEGACY_PRODUCTION_MIGRATIONS` — extra archive entries
  and extra manifest rows are not authority;
- every explicitly archived legacy row exists by exact name and checksum;
- every archived legacy row satisfies the strict successful-row predicate
  (`finished_at` set, `rolled_back_at` null, `applied_steps_count` a
  non-negative integer, logs free of failure evidence);
- every archived legacy migration has an explicit `schemaEffectId` and a
  trusted schema-effect definition, and that effect is present in the
  target database; missing, empty, or unknown ids are refused and are
  never defaulted from the migration name;
- `information_schema` query failure or a nullability/type mismatch
  fails closed;
- each expected schema/table/column fact has exactly one matching
  observation (zero refuses missing; identical or conflicting
  duplicates refuse ambiguous);
- `20260627_production_initial_baseline` is successfully applied;
- no migration row is unfinished/failed;
- no migration row exists outside the active migration set plus the
  explicitly archived legacy evidence rows;
- at the current release preflight boundary, the actual pending active
  set equals `EXPECTED_RELEASE_PENDING_MIGRATIONS` exactly, or the
  post-deploy already-applied empty pending set.

Code and the archive manifest own this truth. This document is not a second
allowlist.

Refusal codes are explicit, including `REFUSE_EMPTY_OR_NO_HISTORY`,
`REFUSE_LEGACY_ROW_MISSING`, `REFUSE_LEGACY_CHECKSUM_MISMATCH`,
`REFUSE_LEGACY_ROLLED_BACK`, `REFUSE_LEGACY_UNFINISHED`,
`REFUSE_LEGACY_APPLIED_STEPS_INVALID`, `REFUSE_LEGACY_FAILURE_LOGS`,
`REFUSE_LEGACY_SCHEMA_EFFECT_MISSING`, `REFUSE_LEGACY_SCHEMA_EFFECT_MISMATCH`,
`REFUSE_LEGACY_SCHEMA_EFFECT_AMBIGUOUS`,
`REFUSE_LEGACY_SCHEMA_EVIDENCE_UNDEFINED`, `REFUSE_LEGACY_SCHEMA_QUERY_FAILED`,
`REFUSE_MANIFEST_SCHEMA_EFFECT_ID_MISSING`,
`REFUSE_MANIFEST_SCHEMA_EFFECT_ID_EMPTY`,
`REFUSE_MANIFEST_SCHEMA_EFFECT_ID_UNKNOWN`,
`REFUSE_RELEASE_MIGRATION_CHECKSUM_MISMATCH`,
`REFUSE_RELEASE_MIGRATION_INCONSISTENT`, `REFUSE_FAILED_MIGRATION_HISTORY`,
`REFUSE_UNKNOWN_LEGACY_DIVERGENCE`, `REFUSE_UNEXPECTED_PENDING_MIGRATIONS`,
`REFUSE_MISSING_EXPECTED_PENDING`, `REFUSE_UNDECLARED_ARCHIVE_ENTRY`, and
`REFUSE_ARCHIVE_ACTIVE_NAME_COLLISION`.

Overlay `deploy` additionally requires `--confirm-legacy-production-history`. `NODE_ENV` is never treated as permission.

## Standard Clean-Environment Workflow

For new databases, development databases, CI databases, and any database without the exact legacy production rows, use standard Prisma:

```bash
npx prisma migrate deploy
npx prisma migrate status
```

Do not use the production overlay on an empty database. The guard will refuse because the legacy history rows are absent.

## Production Legacy-History Workflow

For the existing production database only, after branch and server preflight:

```bash
npm run prisma:production:status
npm run prisma:production:deploy -- --confirm-legacy-production-history
npm run prisma:production:status
```

Distinguish these four sets. Do not treat this document as an independent
complete list:

- **Archived legacy** — `LEGACY_PRODUCTION_MIGRATIONS` and
  `prisma/legacy-production-history/manifest.json`. Already applied in
  production; never executed on an empty database.
- **Active chain** — directories under `prisma/migrations`.
- **Current release authorized pending** —
  `EXPECTED_RELEASE_PENDING_MIGRATIONS` in
  `lib/prisma-production-migration-overlay.ts`. For this candidate that set
  is exactly `20260916090000_add_transcript_enhancement_provider_slots`.
- **Post-deploy already-applied** — `POST_DEPLOY_SAFE` only after empty
  pending plus complete current-release success proof: exact migration
  name, `finished_at` set, `rolled_back_at` null, valid
  `applied_steps_count`, logs free of failure/P30xx evidence, DB checksum
  equal to the current active `migration.sql` artifact checksum, and no
  unrelated divergence. Name presence is not authority. A later status
  check must not treat a proven successful apply as missing history.

Pre-deploy pending `{}` when the release migration is still absent is
`REFUSE_MISSING_EXPECTED_PENDING`. `{BUG02, EXTRA}` or `{EXTRA}` is
`REFUSE_UNEXPECTED_PENDING_MIGRATIONS`.

Local verification must use a simulated production-history database. It must
not run this deploy command against production.

## BUG02 rehearsal sequence

This is process evidence for later EO migration automation. It is not a
second authority source.

1. Initial prod-like preflight: `REFUSE_UNKNOWN_LEGACY_DIVERGENCE`.
2. AI-progress historical artifact recovered from Git.
3. Exact applied checksum proven against the recovered artifact.
4. Explicit archive admission added.
5. First independent review found schema/exact-set/success-row gaps.
6. Authority hardened for exact pending set, explicit archive admission,
   and the archived successful-row predicate.
7. Second independent review found `POST_DEPLOY_SAFE` name-presence
   false-safe classification and silent `schemaEffectId` defaulting.
8. Hardened read-only pre-deploy check against the
   production-derived local database (`localhost:5432/negotiations`):
   `PRE_DEPLOY_ALLOW` is evidence only that, before the local apply
   rehearsal, only
   `20260916090000_add_transcript_enhancement_provider_slots` was pending.
9. LOCAL guarded apply rehearsal on `localhost:5432/negotiations` only
   (2026-09-16). Production was not touched and is not claimed migrated.
   - Fresh pre-apply custom-format backup:
     `C:\Projects\Negotiations AI\local-db-backups\negotiations-pre-bug02-apply-20260916-222252.dump`
     (1,231,272 bytes; `pg_restore --list` TOC readable; previous
     `negotiations-pre-bug02-20260916-201002.dump` preserved).
   - Canonical command:
     `npm run prisma:production:deploy -- --confirm-legacy-production-history`
     with `PRISMA_PRODUCTION_OVERLAY_ENV_FILE=.env.bug02-uat.local`.
   - Overlay decision at apply time: `PRE_DEPLOY_ALLOW`.
   - Applied exactly
     `20260916090000_add_transcript_enhancement_provider_slots`
     (exit 0; duration 4815 ms). No other active migration applied.
   - Immediate and repeat canonical status: `POST_DEPLOY_SAFE`, pending `{}`.
   - History row finished, `rolled_back_at` NULL, `applied_steps_count=1`,
     no failure/P30xx evidence. DB checksum equals
     `readActiveMigrationArtifactChecksum` =
     `9e9cd2d3a193015fa5b2f928839279fb6500032f8941263d3edcea5c841ad5f4`.
   - Schema matches migration SQL: table
     `TranscriptEnhancementProviderSlot` with designed columns, primary key
     `TranscriptEnhancementProviderSlot_pkey`, and indexes
     `TranscriptEnhancementProviderSlot_leaseExpiresAt_idx` and
     `TranscriptEnhancementProviderSlot_jobId_leaseExpiresAt_idx`.
   - Migration seeds the fixed 10-slot inventory (`slotIndex` 0–9,
     unleased). Domain-table counts were unchanged.
   - Current Prisma client structurally read older completed Session,
     transcripts with/without enhancement metadata, mapped transcript,
     historical AiAnalysis, and `progressJson` SQL-NULL plus one
     SQL-non-NULL row without mutating records.

This document still does not authorize production deploy. The apply above
is a local prod-derived rehearsal only.

## Simulation Evidence

Local disposable PostgreSQL verification must cover both paths:

- clean install with ordinary `npx prisma migrate deploy` succeeds and does not include the archived legacy migrations;
- simulated production history includes the archived legacy rows plus the squashed
  baseline and all active migrations through Stage 3.13B;
- ordinary Prisma status/deploy against the simulated production-history database shows the legacy divergence;
- overlay status recognizes the legacy rows and shows only the exact approved
  pending active migrations;
- overlay deploy applies only those approved active migrations;
- overlay post-status is up to date;
- email tables and indexes exist afterward;
- existing application tables remain present.

The automated `verify:stage313c:overlay` simulation may insert synthetic legacy
history rows only after it has refused any non-local, non-disposable, or
nonempty target. This fixture is test setup inside that disposable verifier,
not an operational repair instruction; the script fails before insertion when
the target is nonempty.

## Rollback Implications

Stage 3.13B and Stage 3.13C migrations are additive. If runtime rollback is
needed after migration, roll back application code to the previous working SHA
and leave the additive email/token schema in place. Do not drop schema and do
not rewrite production migration history.

## Prohibited Repair Actions

Do not manually edit `_prisma_migrations`.

Do not delete production migration rows.

Do not update production migration checksums.

Do not use `prisma migrate resolve` to conceal the divergence.

Do not run `prisma migrate dev`, `prisma db push`, or `prisma migrate reset` on production.

Do not execute the archived legacy SQL on an empty database.

Do not enable real email delivery as part of this repair.
