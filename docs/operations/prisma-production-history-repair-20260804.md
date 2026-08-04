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
- only Stage 3.13B migrations may be pending.

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

The expected pre-deploy overlay status is that both legacy rows are recognized and only these migrations are pending:

- `20260804113000_stage_3_13b_email_foundation`
- `20260804143000_stage_3_13b_email_hardening`

## Simulation Evidence

Local disposable PostgreSQL verification must cover both paths:

- clean install with ordinary `npx prisma migrate deploy` succeeds and does not include the two legacy migrations;
- simulated production history includes the two legacy rows plus the squashed baseline and pre-email migrations;
- ordinary Prisma status/deploy against the simulated production-history database shows the legacy divergence;
- overlay status recognizes the legacy rows and shows only Stage 3.13B pending;
- overlay deploy applies only Stage 3.13B;
- overlay post-status is up to date;
- email tables and indexes exist afterward;
- existing application tables remain present.

## Rollback Implications

Stage 3.13B migrations are additive. If runtime rollback is needed after migration, roll back application code to the previous working SHA and leave the additive email schema in place. Do not drop email schema and do not rewrite production migration history.

## Prohibited Repair Actions

Do not manually edit `_prisma_migrations`.

Do not delete production migration rows.

Do not update production migration checksums.

Do not use `prisma migrate resolve` to conceal the divergence.

Do not run `prisma migrate dev`, `prisma db push`, or `prisma migrate reset` on production.

Do not execute the archived legacy SQL on an empty database.

Do not enable real email delivery as part of this repair.
