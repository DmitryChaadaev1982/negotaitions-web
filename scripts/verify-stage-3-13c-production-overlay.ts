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
const STAGE_3_13C_PENDING = [
  STAGE_3_13C_ACCOUNT,
  STAGE_3_13C_REMEDIATION,
] as const;
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);
const DISPOSABLE_NAME =
  /(?:^|[_-])(?:stage[_-]?3[_-]?13c|overlay|test(?:ing)?)(?:$|[_-])/i;
const PRODUCTION_NAME =
  /(?:^|[_-])(?:prod|production|main|primary|master)(?:$|[_-])/i;
const DEVELOPMENT_NAME =
  /(?:^|[_-])(?:dev|development)(?:$|[_-])|^(?:postgres|template[01]|negotaitions|negotiations)$/i;
const PASSWORD_RESET_INDEXES = [
  "PasswordResetToken_createdAt_idx",
  "PasswordResetToken_expiresAt_idx",
  "PasswordResetToken_one_active_per_user_key",
  "PasswordResetToken_pkey",
  "PasswordResetToken_tokenHash_key",
  "PasswordResetToken_userId_usedAt_revokedAt_idx",
] as const;

type FailureCode =
  | "DATABASE_URL_MISSING"
  | "DATABASE_URL_INVALID"
  | "DATABASE_NOT_POSTGRESQL"
  | "DATABASE_HOST_NOT_LOCAL"
  | "DATABASE_NAME_NOT_DISPOSABLE"
  | "DATABASE_NAME_PRODUCTION_LIKE"
  | "DATABASE_NAME_NORMAL_DEVELOPMENT"
  | "DATABASE_TARGET_NOT_EMPTY"
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

function parseDatabaseUrl(raw: string | undefined) {
  if (!raw) refuse("DATABASE_URL_MISSING");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    refuse("DATABASE_URL_INVALID");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    refuse("DATABASE_NOT_POSTGRESQL");
  }
  if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) {
    refuse("DATABASE_HOST_NOT_LOCAL");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (
    !databaseName ||
    databaseName.includes("/") ||
    !DISPOSABLE_NAME.test(databaseName)
  ) {
    refuse("DATABASE_NAME_NOT_DISPOSABLE");
  }
  if (PRODUCTION_NAME.test(databaseName)) {
    refuse("DATABASE_NAME_PRODUCTION_LIKE");
  }
  if (DEVELOPMENT_NAME.test(databaseName)) {
    refuse("DATABASE_NAME_NORMAL_DEVELOPMENT");
  }
  return { databaseUrl: raw, databaseName };
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
    assert.ok(!migrationNames.includes(STAGE_3_13C_ACCOUNT));
    assert.ok(!migrationNames.includes(STAGE_3_13C_REMEDIATION));
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

async function assertEmpty(client: pg.Client, databaseName: string) {
  const identity = await client.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  if (identity.rows[0]?.name !== databaseName) {
    refuse("DATABASE_IDENTITY_MISMATCH");
  }
  const result = await client.query<Record<string, string>>(`
    SELECT
      (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
         AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS relations,
      (SELECT COUNT(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
         AND t.typtype IN ('d', 'e')) AS types,
      (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
         AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%') AS routines,
      (SELECT COUNT(*) FROM pg_namespace
       WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema')
         AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%') AS schemas,
      (SELECT COUNT(*) FROM pg_extension WHERE extname <> 'plpgsql') AS extensions
  `);
  const count = Object.values(result.rows[0] ?? {}).reduce(
    (sum, value) => sum + Number(value),
    0,
  );
  if (count !== 0) refuse("DATABASE_TARGET_NOT_EMPTY");
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

async function applicationTables(client: pg.Client): Promise<string[]> {
  const result = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
     ORDER BY tablename`,
  );
  return result.rows.map((row) => row.tablename);
}

async function passwordResetIndexes(client: pg.Client): Promise<string[]> {
  const result = await client.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'PasswordResetToken'
     ORDER BY indexname`,
  );
  return result.rows.map((row) => row.indexname);
}

async function main() {
  const { databaseUrl, databaseName } = parseDatabaseUrl(
    process.env.DATABASE_URL,
  );
  const repoRoot = process.cwd();
  const client = new pg.Client({ connectionString: databaseUrl });
  let workspace: Workspace | undefined;

  try {
    await client.connect();
    await assertEmpty(client, databaseName);
    workspace = await createWorkspace(repoRoot);
    await ordinaryDeploy(repoRoot, workspace, databaseUrl);

    const seedHistory = await readMigrationHistoryFromDatabase(databaseUrl);
    assertHistory(seedHistory, new Set(workspace.migrationNames));
    const preexistingTables = await applicationTables(client);
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
    const postTables = await applicationTables(client);
    assert.deepEqual(
      postTables.filter((name) => name !== "PasswordResetToken"),
      preexistingTables,
    );
    assert.ok(postTables.includes("PasswordResetToken"));
    const indexes = await passwordResetIndexes(client);
    assert.deepEqual(indexes, [...PASSWORD_RESET_INDEXES].sort());

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
      await client.end().catch(() => undefined);
    }
  }
}

void main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error: unknown) => {
    process.exitCode = 1;
    const reason =
      error instanceof VerifierError ? error.code : "VERIFICATION_FAILED";
    console.error(
      JSON.stringify({
        ok: false,
        counts: {
          failures: 1,
          safetyRefusals: reason.startsWith("DATABASE_") ? 1 : 0,
        },
        names: { reason: [reason] },
      }),
    );
  });
