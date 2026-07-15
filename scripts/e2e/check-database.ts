import "dotenv/config";

import { Client } from "pg";

import {
  assertIsolatedE2eDatabase,
  getDevelopmentDatabaseDescriptor,
  getSanitizedE2eDatabaseDescriptor,
  maskCredentialsInUrl,
} from "../../tests/e2e/helpers/e2e-database";

async function main(): Promise<void> {
  const e2eUrl = assertIsolatedE2eDatabase();
  const e2eDescriptor = getSanitizedE2eDatabaseDescriptor(e2eUrl);
  const developmentDescriptor = getDevelopmentDatabaseDescriptor();

  const client = new Client({ connectionString: e2eUrl });
  await client.connect();

  try {
    const identity = await client.query<{ current_database: string; current_user: string }>(
      "SELECT current_database() AS current_database, current_user AS current_user",
    );
    const currentDatabase = identity.rows[0]?.current_database ?? "(unknown)";
    const currentUser = identity.rows[0]?.current_user ?? "(unknown)";

    const migrationsTable = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = '_prisma_migrations'
       ) AS exists`,
    );
    const hasMigrationsTable = migrationsTable.rows[0]?.exists === true;

    let migrationCount = 0;
    if (hasMigrationsTable) {
      const migrationRows = await client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM _prisma_migrations",
      );
      migrationCount = Number(migrationRows.rows[0]?.count ?? 0);
    }

    const publicTables = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_type = 'BASE TABLE'`,
    );
    const publicTableCount = Number(publicTables.rows[0]?.count ?? 0);

    console.log("E2E database preflight");
    console.log("- E2E target accepted");
    console.log(`- E2E URL (sanitized): ${maskCredentialsInUrl(e2eUrl)}`);
    console.log(`- E2E host class: ${e2eDescriptor.hostClass}`);
    console.log(`- E2E host: ${e2eDescriptor.normalizedHost}`);
    console.log(`- E2E port: ${e2eDescriptor.port}`);
    console.log(`- E2E database (masked): ${e2eDescriptor.databaseMasked}`);
    console.log(`- Connected database: ${currentDatabase}`);
    console.log(`- Connected user: ${currentUser}`);

    if (developmentDescriptor) {
      console.log("- Development target differs from E2E target");
      console.log(`- Development host class: ${developmentDescriptor.hostClass}`);
      console.log(`- Development host: ${developmentDescriptor.normalizedHost}`);
      console.log(`- Development port: ${developmentDescriptor.port}`);
      console.log(`- Development database (masked): ${developmentDescriptor.databaseMasked}`);
    } else {
      console.log("- Development DATABASE_URL is not configured in this process");
    }

    console.log(`- Public table count: ${publicTableCount}`);
    console.log(`- _prisma_migrations exists: ${hasMigrationsTable ? "yes" : "no"}`);
    console.log(`- Migration row count: ${migrationCount}`);
    console.log("- No writes performed");

    if (!hasMigrationsTable) {
      throw new Error(
        "E2E database is missing _prisma_migrations. Apply migrations to the dedicated E2E database before running Playwright tests.",
      );
    }

    if (publicTableCount === 0) {
      throw new Error(
        "E2E database public schema has no tables. Apply migrations to the dedicated E2E database before running Playwright tests.",
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[e2e-db-preflight-error] ${message}`);
  process.exitCode = 1;
});
