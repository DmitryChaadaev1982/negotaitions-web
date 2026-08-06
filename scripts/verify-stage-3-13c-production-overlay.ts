import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import pg from "pg";

import {
  executeProductionOverlay,
  EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS,
  LEGACY_PRODUCTION_MIGRATIONS,
  listActiveMigrationNames,
  readMigrationHistoryFromDatabase,
  type MigrationHistoryRow,
} from "@/lib/prisma-production-migration-overlay";
import {
  assertApprovedStage313cVerifierChildEnvironment,
  Stage313cTestDatabaseRefusal,
  STAGE313C_TEST_SCHEMA,
  STAGE313C_TEST_SCHEMA_MARKER,
} from "./stage-3-13c-test-database";

const PRE_STAGE_3_13C =
  "20260804143000_stage_3_13b_email_hardening";
const STAGE_3_13B = [
  "20260804113000_stage_3_13b_email_foundation",
  PRE_STAGE_3_13C,
] as const;
const STAGE_3_13C_ACCOUNT =
  "20260804170000_stage_3_13c_account_security_email";
const STAGE_3_13C_REMEDIATION =
  "20260805140000_stage_3_13c_security_remediation";
const STAGE_3_13C_PROVIDER_EVENTS =
  "20260806113000_add_email_provider_event_ingestion";
const STAGE_3_13C_PROVIDER_EVENT_HARDENING =
  "20260806160000_harden_email_provider_event_ingestion";
const STAGE_3_13C_PENDING = [
  STAGE_3_13C_ACCOUNT,
  STAGE_3_13C_REMEDIATION,
  STAGE_3_13C_PROVIDER_EVENTS,
  STAGE_3_13C_PROVIDER_EVENT_HARDENING,
] as const;
/**
 * The only application tables the pending Stage 3.13C migrations may create.
 * Anything else appearing after the overlay is an unreviewed schema change.
 */
const TABLES_ADDED_BY_STAGE_3_13C_OVERLAY = [
  "EmailProviderIngestionFailure",
  "EmailProviderStreamCheckpoint",
  "PasswordResetToken",
] as const;
const PASSWORD_RESET_INDEXES = [
  "PasswordResetToken_createdAt_idx",
  "PasswordResetToken_expiresAt_idx",
  "PasswordResetToken_one_active_per_user_key",
  "PasswordResetToken_pkey",
  "PasswordResetToken_tokenHash_key",
  "PasswordResetToken_userId_usedAt_revokedAt_idx",
] as const;
const REQUIRED_EMAIL_MESSAGE_INDEXES = [
  "EmailMessage_createdAt_idx",
  "EmailMessage_relatedTokenId_idx",
  "EmailMessage_sensitivePayloadClearedAt_idx",
  "EmailMessage_status_nextAttemptAt_createdAt_idx",
  "EmailMessage_userId_idx",
] as const;

type FailureCode =
  | "TEST_DATABASE_SAFETY_REFUSAL"
  | "VERIFIER_SCHEMA_NOT_EMPTY"
  | "DATABASE_IDENTITY_MISMATCH"
  | "PRISMA_SEED_DEPLOY_FAILED"
  | "VERIFICATION_FAILED";

class VerifierError extends Error {
  constructor(public readonly code: FailureCode) {
    super(code);
  }
}

class NullWritable extends Writable {
  override _write(
    _chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback();
  }
}

interface Workspace {
  rootDir: string;
  schemaPath: string;
  configPath: string;
  migrationNames: string[];
}

interface HistoryIdentityRow {
  id: string;
  migration_name: string;
  checksum: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
  applied_steps_count: number;
}

function refuse(code: FailureCode): never {
  throw new VerifierError(code);
}

async function createWorkspace(repoRoot: string): Promise<Workspace> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `stage313c-overlay-seed-${randomUUID()}-`),
  );
  try {
    await chmod(rootDir, 0o700);
    const migrationsDir = path.join(rootDir, "migrations");
    await mkdir(migrationsDir, { recursive: true, mode: 0o700 });
    const schemaPath = path.join(rootDir, "schema.prisma");
    await copyFile(path.join(repoRoot, "prisma", "schema.prisma"), schemaPath);

    const migrationNames = (await listActiveMigrationNames(repoRoot)).filter(
      (name) => name <= PRE_STAGE_3_13C,
    );
    assert.ok(migrationNames.includes(PRE_STAGE_3_13C));
    for (const pending of STAGE_3_13C_PENDING) {
      assert.ok(!migrationNames.includes(pending));
    }
    for (const name of migrationNames) {
      await cp(
        path.join(repoRoot, "prisma", "migrations", name),
        path.join(migrationsDir, name),
        {
          recursive: true,
          errorOnExist: true,
          force: false,
          preserveTimestamps: true,
        },
      );
    }
    await copyFile(
      path.join(repoRoot, "prisma", "migrations", "migration_lock.toml"),
      path.join(migrationsDir, "migration_lock.toml"),
    );

    const slash = (value: string) => value.replace(/\\/g, "/");
    const configPath = path.join(rootDir, "prisma.config.ts");
    await writeFile(
      configPath,
      [
        "export default {",
        `  schema: ${JSON.stringify(slash(schemaPath))},`,
        "  migrations: {",
        `    path: ${JSON.stringify(slash(migrationsDir))},`,
        "  },",
        "  datasource: {",
        '    url: process.env["DATABASE_URL"],',
        "  },",
        "};",
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
    return { rootDir, schemaPath, configPath, migrationNames };
  } catch (error) {
    await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function ordinaryDeploy(
  repoRoot: string,
  workspace: Workspace,
  databaseUrl: string,
): Promise<void> {
  const args = [
    path.join(repoRoot, "node_modules", "prisma", "build", "index.js"),
    "migrate",
    "deploy",
    "--schema",
    workspace.schemaPath,
    "--config",
    workspace.configPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
    });
    const failed = () => reject(new VerifierError("PRISMA_SEED_DEPLOY_FAILED"));
    child.on("error", failed);
    child.on("close", (code) => (code === 0 ? resolve() : failed()));
  });
}

async function assertEmpty(
  client: pg.Client,
  databaseName: string,
  schemaName: string,
) {
  const identity = await client.query<{
    name: string;
    schema_name: string | null;
  }>(
    "SELECT current_database() AS name, current_schema() AS schema_name",
  );
  if (
    identity.rows[0]?.name !== databaseName ||
    identity.rows[0]?.schema_name !== schemaName
  ) {
    refuse("DATABASE_IDENTITY_MISMATCH");
  }
  const result = await client.query<Record<string, string>>(
    `
    SELECT
      (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1
         AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS relations,
      (SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname = $1
         AND t.typtype IN ('d', 'e')) AS types,
      (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = $1) AS routines
  `,
    [schemaName],
  );
  const count = Object.values(result.rows[0] ?? {}).reduce(
    (sum, value) => sum + Number(value),
    0,
  );
  if (count !== 0) refuse("VERIFIER_SCHEMA_NOT_EMPTY");
}

function assertHistory(
  rows: MigrationHistoryRow[],
  expectedNames: ReadonlySet<string>,
) {
  assert.equal(rows.length, expectedNames.size);
  assert.equal(new Set(rows.map((row) => row.migration_name)).size, rows.length);
  for (const row of rows) {
    assert.ok(expectedNames.has(row.migration_name));
    assert.ok(row.finished_at);
    assert.equal(row.rolled_back_at, null);
    assert.equal(row.applied_steps_count, 1);
  }
}

async function insertSyntheticLegacyRows(client: pg.Client) {
  const fixture = LEGACY_PRODUCTION_MIGRATIONS.map((migration, index) => ({
    ...migration,
    id: randomUUID(),
    startedAt: new Date(
      index === 0
        ? "2026-06-25T09:09:44.000Z"
        : "2026-06-25T12:00:00.000Z",
    ),
    finishedAt: new Date(
      index === 0
        ? "2026-06-25T09:09:45.000Z"
        : "2026-06-25T12:00:01.000Z",
    ),
  }));
  await client.query("BEGIN");
  try {
    for (const row of fixture) {
      await client.query(
        `INSERT INTO "_prisma_migrations"
          (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES ($1, $2, $3, $4, NULL, NULL, $5, 1)`,
        [
          row.id,
          row.expectedSha256,
          row.finishedAt,
          row.migrationName,
          row.startedAt,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

async function historyIdentity(client: pg.Client, names: readonly string[]) {
  const result = await client.query<HistoryIdentityRow>(
    `SELECT id, migration_name, checksum, started_at, finished_at,
            rolled_back_at, applied_steps_count
     FROM "_prisma_migrations"
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name`,
    [names],
  );
  assert.equal(result.rows.length, names.length);
  return result.rows.map((row) => ({
    id: row.id,
    migrationName: row.migration_name,
    checksum: row.checksum,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
    rolledBackAt: iso(row.rolled_back_at),
    appliedStepsCount: row.applied_steps_count,
  }));
}

async function applicationTables(
  client: pg.Client,
  schemaName: string,
): Promise<string[]> {
  const result = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = $1 AND tablename <> '_prisma_migrations'
     ORDER BY tablename`,
    [schemaName],
  );
  return result.rows.map((row) => row.tablename);
}

async function passwordResetIndexes(
  client: pg.Client,
  schemaName: string,
): Promise<string[]> {
  const result = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = $1 AND tablename = 'PasswordResetToken'
     ORDER BY indexname`,
    [schemaName],
  );
  return result.rows.map((row) => row.indexname);
}

async function assertStage313cDatabaseInvariants(
  client: pg.Client,
  schemaName: string,
) {
  const columns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1
       AND (
         (table_name = 'User' AND column_name = 'credentialGeneration')
         OR
         (table_name = 'EmailMessage' AND column_name IN (
           'sensitivePayloadCiphertext',
           'sensitivePayloadNonce',
           'sensitivePayloadClearedAt',
           'relatedTokenId'
         ))
       )
    ORDER BY table_name, column_name`,
    [schemaName],
  );
  assert.equal(columns.rows.length, 5);
  const credentialGeneration = columns.rows.find(
    (row) =>
      row.table_name === "User" &&
      row.column_name === "credentialGeneration",
  );
  assert.equal(credentialGeneration?.data_type, "integer");
  assert.equal(credentialGeneration?.is_nullable, "NO");
  assert.match(credentialGeneration?.column_default ?? "", /\b0\b/);

  const encryptedColumns = new Map(
    columns.rows
      .filter((row) => row.table_name === "EmailMessage")
      .map((row) => [row.column_name, row]),
  );
  assert.equal(
    encryptedColumns.get("sensitivePayloadCiphertext")?.data_type,
    "text",
  );
  assert.equal(encryptedColumns.get("sensitivePayloadNonce")?.data_type, "text");
  assert.equal(
    encryptedColumns.get("sensitivePayloadClearedAt")?.data_type,
    "timestamp without time zone",
  );
  assert.equal(encryptedColumns.get("relatedTokenId")?.data_type, "text");
  for (const row of encryptedColumns.values()) {
    assert.equal(row.is_nullable, "YES");
  }

  const constraints = await client.query<{
    conname: string;
    contype: string;
    definition: string;
  }>(
    `SELECT c.conname, c.contype, pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = $1 AND t.relname = 'PasswordResetToken'
     ORDER BY c.conname`,
    [schemaName],
  );
  const byConstraint = new Map(
    constraints.rows.map((row) => [row.conname, row]),
  );
  assert.equal(byConstraint.get("PasswordResetToken_pkey")?.contype, "p");
  assert.equal(
    byConstraint.get("PasswordResetToken_userId_fkey")?.contype,
    "f",
  );
  assert.match(
    byConstraint.get("PasswordResetToken_userId_fkey")?.definition ?? "",
    /FOREIGN KEY \("userId"\).*"User"\(id\).*ON DELETE CASCADE/i,
  );

  const indexRows = await client.query<{
    tablename: string;
    indexname: string;
    indexdef: string;
  }>(
    `SELECT tablename, indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = $1
       AND tablename IN ('PasswordResetToken', 'EmailMessage', 'User')
     ORDER BY tablename, indexname`,
    [schemaName],
  );
  const indexesByName = new Map(
    indexRows.rows.map((row) => [row.indexname, row.indexdef]),
  );
  const activeTokenIndex = indexesByName.get(
    "PasswordResetToken_one_active_per_user_key",
  );
  assert.match(activeTokenIndex ?? "", /CREATE UNIQUE INDEX/i);
  assert.match(activeTokenIndex ?? "", /"usedAt" IS NULL/i);
  assert.match(activeTokenIndex ?? "", /"revokedAt" IS NULL/i);
  for (const name of REQUIRED_EMAIL_MESSAGE_INDEXES) {
    assert.ok(indexesByName.has(name), `Missing required index: ${name}`);
  }
  assert.ok(indexesByName.has("User_credentialGeneration_idx"));

  const migrationHistory = await client.query<{ migration_name: string }>(
    `SELECT migration_name FROM "_prisma_migrations"
     WHERE migration_name = ANY($1::text[])
     ORDER BY migration_name`,
    [[...STAGE_3_13C_PENDING]],
  );
  assert.deepEqual(
    migrationHistory.rows.map((row) => row.migration_name),
    [...STAGE_3_13C_PENDING],
  );

  const providerEvents = await assertProviderEventRemediationIsAdditive(
    client,
    schemaName,
  );

  return {
    verifiedColumns: columns.rows.length + providerEvents.verifiedColumns,
    verifiedConstraints: constraints.rows.length,
    verifiedIndexes: indexRows.rows.length + providerEvents.verifiedIndexes,
  };
}

/**
 * The remediation migration must stay additive: an older runtime that never
 * writes these columns has to keep working against the newer schema, so each
 * added column is nullable and carries no default.
 */
async function assertProviderEventRemediationIsAdditive(
  client: pg.Client,
  schemaName: string,
) {
  const columns = await client.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: "YES" | "NO";
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = $1
       AND (
         (table_name = 'EmailProviderEvent' AND column_name = 'suppressionDisposition')
         OR
         (table_name = 'EmailProviderStreamCheckpoint' AND column_name = 'initialReadAt')
       )
     ORDER BY table_name, column_name`,
    [schemaName],
  );
  assert.equal(columns.rows.length, 2);
  for (const row of columns.rows) {
    assert.equal(row.is_nullable, "YES", `${row.column_name} must be nullable`);
    assert.equal(row.column_default, null, `${row.column_name} must have no default`);
  }
  const disposition = columns.rows.find(
    (row) => row.column_name === "suppressionDisposition",
  );
  assert.equal(disposition?.udt_name, "EmailProviderEventSuppressionDisposition");
  assert.equal(
    columns.rows.find((row) => row.column_name === "initialReadAt")?.data_type,
    "timestamp without time zone",
  );

  const enumValues = await client.query<{ enumlabel: string }>(
    `SELECT e.enumlabel
     FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = $1 AND t.typname = 'EmailProviderEventSuppressionDisposition'
     ORDER BY e.enumsortorder`,
    [schemaName],
  );
  assert.deepEqual(
    enumValues.rows.map((row) => row.enumlabel),
    ["NONE", "HARD_BOUNCE", "COMPLAINT"],
  );

  const indexes = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = $1
       AND indexname = ANY($2::text[])
     ORDER BY indexname`,
    [
      schemaName,
      [
        "EmailProviderIngestionFailure_provider_streamName_shardId_idx",
        "EmailProviderStreamCheckpoint_streamName_shardId_idx",
      ],
    ],
  );
  assert.deepEqual(
    indexes.rows.map((row) => row.indexname),
    [
      "EmailProviderIngestionFailure_provider_streamName_shardId_idx",
      "EmailProviderStreamCheckpoint_streamName_shardId_idx",
    ],
  );

  return {
    verifiedColumns: columns.rows.length,
    verifiedIndexes: indexes.rows.length,
  };
}

async function clearOwnedOverlaySchema(client: pg.Client): Promise<void> {
  const ownership = await client.query<{
    owned_by_current_user: boolean;
    comment: string | null;
  }>(
    `SELECT
       n.nspowner = (SELECT usesysid FROM pg_user WHERE usename = current_user)
         AS owned_by_current_user,
       obj_description(n.oid, 'pg_namespace') AS comment
     FROM pg_namespace n
     WHERE n.nspname = $1`,
    [STAGE313C_TEST_SCHEMA],
  );
  if (
    ownership.rowCount !== 1 ||
    !ownership.rows[0]?.owned_by_current_user ||
    ownership.rows[0]?.comment !== STAGE313C_TEST_SCHEMA_MARKER
  ) {
    refuse("TEST_DATABASE_SAFETY_REFUSAL");
  }
  await client.query(
    `DROP SCHEMA "${STAGE313C_TEST_SCHEMA}" CASCADE`,
  );
  await client.query(
    `CREATE SCHEMA "${STAGE313C_TEST_SCHEMA}" AUTHORIZATION CURRENT_USER`,
  );
  await client.query(
    `COMMENT ON SCHEMA "${STAGE313C_TEST_SCHEMA}"
     IS 'NegotAItions Stage 3.13C verifier-owned schema'`,
  );
}

async function main() {
  const approved =
    assertApprovedStage313cVerifierChildEnvironment(process.env);
  const databaseUrl = approved.scopedDatabaseUrl;
  const { databaseName, schemaName } = approved;
  const repoRoot = process.cwd();
  const client = new pg.Client({ connectionString: databaseUrl });
  let workspace: Workspace | undefined;
  let ownsOverlaySchema = false;
  let overlaySchemaCleaned = false;

  try {
    await client.connect();
    await assertEmpty(client, databaseName, schemaName);
    ownsOverlaySchema = true;
    workspace = await createWorkspace(repoRoot);
    await ordinaryDeploy(repoRoot, workspace, databaseUrl);

    const seedHistory = await readMigrationHistoryFromDatabase(databaseUrl);
    assertHistory(seedHistory, new Set(workspace.migrationNames));
    const preexistingTables = await applicationTables(client, schemaName);
    assert.ok(preexistingTables.length > 0);

    await insertSyntheticLegacyRows(client);
    const legacyNames = LEGACY_PRODUCTION_MIGRATIONS.map(
      (migration) => migration.migrationName,
    );
    const expectedPreNames = new Set([...workspace.migrationNames, ...legacyNames]);
    assertHistory(
      await readMigrationHistoryFromDatabase(databaseUrl),
      expectedPreNames,
    );
    const legacyBefore = await historyIdentity(client, legacyNames);
    const stage313bBefore = await historyIdentity(client, STAGE_3_13B);
    const sink = new NullWritable();

    const preStatus = await executeProductionOverlay({
      repoRoot,
      mode: "status",
      databaseUrl,
      stdout: sink,
      stderr: sink,
    });
    assert.deepEqual(
      preStatus?.pendingActiveMigrations,
      [...STAGE_3_13C_PENDING],
    );
    assert.deepEqual(
      preStatus?.pendingActiveMigrations,
      [...EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS],
    );

    const beforeDeployNames = new Set(
      (await readMigrationHistoryFromDatabase(databaseUrl)).map(
        (row) => row.migration_name,
      ),
    );
    const deployGuard = await executeProductionOverlay({
      repoRoot,
      mode: "deploy",
      confirmed: true,
      databaseUrl,
      stdout: sink,
      stderr: sink,
    });
    assert.deepEqual(
      deployGuard?.pendingActiveMigrations,
      [...STAGE_3_13C_PENDING],
    );

    const afterDeployHistory =
      await readMigrationHistoryFromDatabase(databaseUrl);
    const appliedByOverlay = afterDeployHistory
      .map((row) => row.migration_name)
      .filter((name) => !beforeDeployNames.has(name));
    assert.deepEqual(appliedByOverlay, [...STAGE_3_13C_PENDING]);
    assertHistory(
      afterDeployHistory,
      new Set([...expectedPreNames, ...STAGE_3_13C_PENDING]),
    );

    const postStatus = await executeProductionOverlay({
      repoRoot,
      mode: "status",
      databaseUrl,
      stdout: sink,
      stderr: sink,
    });
    assert.deepEqual(postStatus?.pendingActiveMigrations, []);

    assert.deepEqual(await historyIdentity(client, legacyNames), legacyBefore);
    assert.deepEqual(
      await historyIdentity(client, STAGE_3_13B),
      stage313bBefore,
    );
    const postTables = await applicationTables(client, schemaName);
    const addedTables = new Set<string>(TABLES_ADDED_BY_STAGE_3_13C_OVERLAY);
    // Every pre-existing table survives untouched and only the reviewed tables
    // are added, so the overlay never drops or renames production tables.
    assert.deepEqual(
      postTables.filter((name) => !addedTables.has(name)),
      preexistingTables,
    );
    for (const name of TABLES_ADDED_BY_STAGE_3_13C_OVERLAY) {
      assert.ok(postTables.includes(name), `overlay did not create ${name}`);
    }
    const indexes = await passwordResetIndexes(client, schemaName);
    assert.deepEqual(indexes, [...PASSWORD_RESET_INDEXES].sort());
    const invariants = await assertStage313cDatabaseInvariants(
      client,
      schemaName,
    );

    await clearOwnedOverlaySchema(client);
    overlaySchemaCleaned = true;
    await assertEmpty(client, databaseName, schemaName);

    return {
      ok: true,
      counts: {
        seedMigrations: workspace.migrationNames.length,
        syntheticLegacyRows: legacyNames.length,
        pendingBefore: preStatus?.pendingActiveMigrations.length ?? 0,
        appliedByOverlay: appliedByOverlay.length,
        pendingAfter: postStatus?.pendingActiveMigrations.length ?? 0,
        preexistingApplicationTables: preexistingTables.length,
        passwordResetTokenIndexes: indexes.length,
        unchangedLegacyRows: legacyBefore.length,
        unchangedStage313bRows: stage313bBefore.length,
        verifiedColumns: invariants.verifiedColumns,
        verifiedConstraints: invariants.verifiedConstraints,
        verifiedIndexes: invariants.verifiedIndexes,
        cleanedVerifierSchemas: 1,
      },
      names: {
        pendingBefore: preStatus?.pendingActiveMigrations ?? [],
        appliedByOverlay,
        pendingAfter: postStatus?.pendingActiveMigrations ?? [],
        legacyMigrations: legacyNames,
        passwordResetTokenIndexes: indexes,
      },
    };
  } finally {
    try {
      if (workspace) {
        await rm(workspace.rootDir, { recursive: true, force: true });
      }
    } finally {
      if (ownsOverlaySchema && !overlaySchemaCleaned) {
        await clearOwnedOverlaySchema(client).catch(() => undefined);
      }
      await client.end().catch(() => undefined);
    }
  }
}

void main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error: unknown) => {
    process.exitCode = 1;
    const reason =
      error instanceof Stage313cTestDatabaseRefusal
        ? "TEST_DATABASE_SAFETY_REFUSAL"
        : error instanceof VerifierError
          ? error.code
          : "VERIFICATION_FAILED";
    console.error(
      JSON.stringify({
        ok: false,
        counts: {
          failures: 1,
          safetyRefusals: reason.includes("SAFETY") ? 1 : 0,
        },
        names: { reason: [reason] },
      }),
    );
  });
