import assert from "node:assert/strict";

import pg from "pg";

import { assertApprovedStage313cVerifierChildEnvironment } from "./stage-3-13c-test-database";

const MIGRATION_NAME =
  "20260807190000_harden_ai_analysis_operation_lifecycle";

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
         AND column_name IN ('runToken', 'leaseExpiresAt')
       ORDER BY column_name`,
      [approved.schemaName],
    );
    assert.deepEqual(
      columns.rows,
      [
        { column_name: "leaseExpiresAt", is_nullable: "YES" },
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

    const migration = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM "${approved.schemaName}"."_prisma_migrations"
       WHERE migration_name = $1
         AND finished_at IS NOT NULL
         AND rolled_back_at IS NULL`,
      [MIGRATION_NAME],
    );
    assert.equal(Number(migration.rows[0]?.count ?? 0), 1);

    return {
      ok: true,
      counts: {
        nullableOwnershipColumns: columns.rowCount ?? 0,
        ownershipIndexes: indexes.rowCount ?? 0,
        migrationRows: Number(migration.rows[0]?.count ?? 0),
      },
      cases: [
        "additive-nullable-columns",
        "lease-index",
        "migration-history",
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
