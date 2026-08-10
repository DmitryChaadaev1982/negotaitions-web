import assert from "node:assert/strict";

import pg from "pg";

import { EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS } from "@/lib/prisma-production-migration-overlay";
import { assertApprovedStage313cVerifierChildEnvironment } from "./stage-3-13c-test-database";

async function main() {
  const approved = assertApprovedStage313cVerifierChildEnvironment(process.env);
  const client = new pg.Client({
    connectionString: approved.scopedDatabaseUrl,
    application_name: "stage313d_ai_migration_verifier",
  });
  await client.connect();
  try {
    const columns = await client.query<{
      column_name: string;
      is_nullable: "YES" | "NO";
    }>(
      `SELECT column_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = $1
         AND table_name = 'AiAnalysis'
         AND column_name IN ('runToken', 'leaseExpiresAt', 'providerResponseId')
       ORDER BY column_name`,
      [approved.schemaName],
    );
    assert.deepEqual(
      columns.rows,
      [
        { column_name: "leaseExpiresAt", is_nullable: "YES" },
        { column_name: "providerResponseId", is_nullable: "YES" },
        { column_name: "runToken", is_nullable: "YES" },
      ],
    );

    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = $1
         AND tablename = 'AiAnalysis'
         AND indexname = 'AiAnalysis_status_leaseExpiresAt_idx'`,
      [approved.schemaName],
    );
    assert.equal(indexes.rowCount, 1);

    const migrations = await client.query<{ migration_name: string }>(
      `SELECT migration_name
       FROM "${approved.schemaName}"."_prisma_migrations"
       WHERE migration_name = ANY($1::text[])
         AND finished_at IS NOT NULL
         AND rolled_back_at IS NULL
       ORDER BY migration_name`,
      [[...EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS]],
    );
    assert.deepEqual(
      migrations.rows.map((row) => row.migration_name),
      [...EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS],
    );

    return {
      ok: true,
      counts: {
        nullableAiAnalysisColumns: columns.rowCount ?? 0,
        ownershipIndexes: indexes.rowCount ?? 0,
        migrationRows: migrations.rowCount ?? 0,
      },
      cases: [
        "additive-nullable-columns",
        "lease-index",
        "stage-3-13d-migration-history",
      ],
    };
  } finally {
    await client.end();
  }
}

void main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch(() => {
    process.exitCode = 1;
    console.error(
      JSON.stringify({
        ok: false,
        counts: { failures: 1 },
        cases: ["ai-migration-verification"],
      }),
    );
  });
