# Prisma Production History Repair - 2026-08-04

## Root Cause

Production contains two successful historical Prisma migration rows whose directories were later deleted from the repository:

- `20260625090944_add_two_pass_transcription_quality_enhancement`
- `20260625120000_squash_and_diarization_fields`

Those directories were removed when the repository introduced the later squashed production baseline `20260627_production_initial_baseline`. Production kept the real `_prisma_migrations` rows, so Prisma correctly reported missing migration directories when Stage 3.13B deployment reached migration status/deploy.

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

Production also has `20260627_production_initial_baseline` and later pre-email migrations successfully applied. Stage 3.13B email migrations were not applied before this repair.

## Why Not Restore Under Active Migrations

Putting the recovered directories back under `prisma/migrations` makes clean installs invalid. The recovered `20260625090944` SQL alters tables created by the later squashed baseline, so an empty database fails with `relation "Transcript" does not exist`.

The active migration chain must remain the clean-environment source of truth. Legacy production history is evidence for production only.

## Archive Location

Exact legacy files are stored outside active Prisma discovery:

- `prisma/legacy-production-history/manifest.json`
- `prisma/legacy-production-history/20260625090944_add_two_pass_transcription_quality_enhancement/migration.sql`
- `prisma/legacy-production-history/20260625120000_squash_and_diarization_fields/migration.sql`

`.gitattributes` disables text conversion and diff handling for `prisma/legacy-production-history/**` so archived bytes remain stable across checkouts.

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

Before overlay `status` or `deploy`, the tool reads only `_prisma_migrations` metadata and refuses unless all conditions hold:

- target database already has Prisma migration history;
- both legacy rows exist by exact name;
- both legacy checksums match production evidence;
- both legacy rows are finished and not rolled back;
- `20260627_production_initial_baseline` is successfully applied;
- no migration row is unfinished/failed;
- no migration row exists outside the active migration set plus the two legacy evidence rows;
- all Stage 3.13B migrations are already successful and every pending active
  migration is one of the exact Stage 3.13C, Stage 3.13D, Stage 3.13E, or
  Stage 3.15A names listed below. There is no prefix, date, or stage-wide
  wildcard.

Refusal codes are explicit, including `REFUSE_EMPTY_OR_NO_HISTORY`, `REFUSE_LEGACY_ROW_MISSING`, `REFUSE_LEGACY_CHECKSUM_MISMATCH`, `REFUSE_LEGACY_ROLLED_BACK`, `REFUSE_LEGACY_UNFINISHED`, `REFUSE_FAILED_MIGRATION_HISTORY`, `REFUSE_UNKNOWN_LEGACY_DIVERGENCE`, and `REFUSE_UNEXPECTED_PENDING_MIGRATIONS`.

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

The complete pending-migration allowlist is:

- `20260804170000_stage_3_13c_account_security_email`
- `20260805140000_stage_3_13c_security_remediation`
- `20260806113000_add_email_provider_event_ingestion`
- `20260806160000_harden_email_provider_event_ingestion`
- `20260806183000_add_provider_event_consumer_fencing`
- `20260807190000_harden_ai_analysis_operation_lifecycle`
- `20260808210000_add_ai_analysis_provider_response_id`
- `20260811112000_stage_3_13e_session_sound_preference`
- `20260812111000_add_recording_attempt_fencing`
- `20260814161500_add_ai_analysis_publication_grants`
- `20260819120000_add_ai_analysis_input_fingerprint`

The last entry is the Stage 3.15A additive nullable
`AiAnalysis.inputFingerprint` column. No historical backfill. Any other
pending active migration must produce `REFUSE_UNEXPECTED_PENDING_MIGRATIONS`.

Local verification must use a simulated production-history database. It must
not run this deploy command against production.

## Simulation Evidence

Local disposable PostgreSQL verification must cover both paths:

- clean install with ordinary `npx prisma migrate deploy` succeeds and does not include the two legacy migrations;
- simulated production history includes the two legacy rows plus the squashed
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
