import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

export const LEGACY_PRODUCTION_HISTORY_DIR = "prisma/legacy-production-history";
export const ACTIVE_MIGRATIONS_DIR = "prisma/migrations";
export const CONFIRM_LEGACY_PRODUCTION_HISTORY_FLAG =
  "--confirm-legacy-production-history";

export const LEGACY_PRODUCTION_MIGRATIONS = [
  {
    migrationName:
      "20260625090944_add_two_pass_transcription_quality_enhancement",
    expectedSha256:
      "ea6930e3c7149c7fcdbf614a81d8e14558ea1208e56c943ef96030114da1e8de",
    sourceCommit: "c86f3abeb6da53ca95dbb4f58ee7b1d36aecd898",
    sourceBlob: "4ecaef8fb11e8ab7c0e0a830cada34689b4be61e",
  },
  {
    migrationName: "20260625120000_squash_and_diarization_fields",
    expectedSha256:
      "892a0be5d1ae18c87e3c7b0da218e0d87ffdb179da3f8ac3dbed67ef91794fc3",
    sourceCommit: "c86f3abeb6da53ca95dbb4f58ee7b1d36aecd898",
    sourceBlob: "cc418b3f010e2fa0a1539e68e1eeca2ecaf90303",
  },
] as const;

export const REQUIRED_PRODUCTION_BASELINE =
  "20260627_production_initial_baseline";

export const EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS = [
  "20260804170000_stage_3_13c_account_security_email",
] as const;

export type OverlayMode = "status" | "deploy" | "verify";

export type OverlayRefusalCode =
  | "REFUSE_DATABASE_URL_MISSING"
  | "REFUSE_EMPTY_OR_NO_HISTORY"
  | "REFUSE_LEGACY_ROW_MISSING"
  | "REFUSE_LEGACY_CHECKSUM_MISMATCH"
  | "REFUSE_LEGACY_ROLLED_BACK"
  | "REFUSE_LEGACY_UNFINISHED"
  | "REFUSE_BASELINE_MISSING"
  | "REFUSE_BASELINE_UNSUCCESSFUL"
  | "REFUSE_FAILED_MIGRATION_HISTORY"
  | "REFUSE_UNKNOWN_LEGACY_DIVERGENCE"
  | "REFUSE_UNEXPECTED_PENDING_MIGRATIONS"
  | "REFUSE_DEPLOY_CONFIRMATION_REQUIRED"
  | "REFUSE_ARCHIVE_HASH_MISMATCH"
  | "REFUSE_MANIFEST_INVALID"
  | "REFUSE_LEGACY_ACTIVE_MIGRATION_PRESENT"
  | "REFUSE_TEMPORARY_OVERLAY_CLEANUP_FAILED"
  | "PRISMA_COMMAND_FAILED";

export class PrismaProductionOverlayError extends Error {
  constructor(
    public readonly code: OverlayRefusalCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "PrismaProductionOverlayError";
  }
}

export interface MigrationHistoryRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
  applied_steps_count: number;
}

export interface ManifestMigration {
  migrationName: string;
  expectedSha256: string;
  sourceCommit: string;
  sourceBlob: string;
  purpose: string;
  productionStatus: string;
  emptyDatabaseSafety: string;
}

export interface LegacyManifest {
  purpose: string;
  emptyDatabaseSafety: string;
  productionHistoryPolicy: string;
  migrations: ManifestMigration[];
}

export interface HistoryGuardResult {
  rows: MigrationHistoryRow[];
  pendingActiveMigrations: string[];
  appliedActiveMigrations: string[];
  recognizedLegacyMigrations: string[];
}

export interface OverlayDirectory {
  repoRoot: string;
  rootDir: string;
  schemaPath: string;
  configPath: string;
  migrationsDir: string;
}

interface RunPrismaOptions {
  mode: "status" | "deploy";
  overlay: OverlayDirectory;
  databaseUrl?: string;
  expectedPendingMigrations?: string[];
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}

const LEGACY_MIGRATION_NAMES: ReadonlySet<string> = new Set(
  LEGACY_PRODUCTION_MIGRATIONS.map((migration) => migration.migrationName),
);

function isSuccessfulMigration(row: MigrationHistoryRow | undefined): boolean {
  return Boolean(row?.finished_at) && row?.rolled_back_at == null;
}

function isUnfinishedMigration(row: MigrationHistoryRow): boolean {
  return row.finished_at == null && row.rolled_back_at == null;
}

function normalizeSha(value: string): string {
  return value.trim().toLowerCase();
}

function toPrismaConfigPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function redactSensitiveOutput(chunk: string, databaseUrl?: string): string {
  let sanitized = chunk;
  if (databaseUrl) {
    sanitized = sanitized.split(databaseUrl).join("[REDACTED_DATABASE_URL]");
  }
  return sanitized.replace(
    /postgres(?:ql)?:\/\/[^\s"'`<>]+/gi,
    "[REDACTED_DATABASE_URL]",
  );
}

export function isExpectedPendingStatusOutput(
  output: string,
  expectedPendingMigrations: readonly string[],
): boolean {
  return (
    /Following migrations? ha(?:ve|s) not yet been applied/.test(output) &&
    expectedPendingMigrations.length > 0 &&
    expectedPendingMigrations.every((migrationName) =>
      output.includes(migrationName),
    )
  );
}

export async function sha256File(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("sha256").update(buffer).digest("hex");
}

export async function copyFileBytePreserving(
  sourcePath: string,
  destinationPath: string,
): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  const [sourceHash, destinationHash] = await Promise.all([
    sha256File(sourcePath),
    sha256File(destinationPath),
  ]);
  if (sourceHash !== destinationHash) {
    throw new PrismaProductionOverlayError(
      "REFUSE_ARCHIVE_HASH_MISMATCH",
      `Byte-preserving copy check failed for ${path.basename(sourcePath)}.`,
    );
  }
}

export async function loadLegacyManifest(
  repoRoot: string,
): Promise<LegacyManifest> {
  const manifestPath = path.join(
    repoRoot,
    LEGACY_PRODUCTION_HISTORY_DIR,
    "manifest.json",
  );
  const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { migrations?: unknown }).migrations)
  ) {
    throw new PrismaProductionOverlayError(
      "REFUSE_MANIFEST_INVALID",
      "Legacy production history manifest is not structured as expected.",
    );
  }

  const manifest = parsed as LegacyManifest;
  for (const expected of LEGACY_PRODUCTION_MIGRATIONS) {
    const entry = manifest.migrations.find(
      (migration) => migration.migrationName === expected.migrationName,
    );
    if (
      !entry ||
      normalizeSha(entry.expectedSha256) !== expected.expectedSha256 ||
      entry.sourceCommit !== expected.sourceCommit ||
      entry.sourceBlob !== expected.sourceBlob
    ) {
      throw new PrismaProductionOverlayError(
        "REFUSE_MANIFEST_INVALID",
        `Legacy production history manifest does not match ${expected.migrationName}.`,
      );
    }
  }
  return manifest;
}

export async function verifyLegacyArchiveHashes(
  repoRoot: string,
  manifest: LegacyManifest,
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  for (const migration of manifest.migrations) {
    const sqlPath = path.join(
      repoRoot,
      LEGACY_PRODUCTION_HISTORY_DIR,
      migration.migrationName,
      "migration.sql",
    );
    const actual = await sha256File(sqlPath);
    const expected = normalizeSha(migration.expectedSha256);
    if (actual !== expected) {
      throw new PrismaProductionOverlayError(
        "REFUSE_ARCHIVE_HASH_MISMATCH",
        `${migration.migrationName} archive checksum ${actual} does not match ${expected}.`,
      );
    }
    hashes.set(migration.migrationName, actual);
  }
  return hashes;
}

export async function listActiveMigrationNames(
  repoRoot: string,
): Promise<string[]> {
  const migrationsDir = path.join(repoRoot, ACTIVE_MIGRATIONS_DIR);
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const legacyActive = names.filter((name) => LEGACY_MIGRATION_NAMES.has(name));
  if (legacyActive.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_LEGACY_ACTIVE_MIGRATION_PRESENT",
      `Legacy migration directories must stay outside active migrations: ${legacyActive.join(", ")}`,
    );
  }
  return names;
}

export function validateMigrationHistoryRows(
  rows: MigrationHistoryRow[],
  activeMigrationNames: string[],
): HistoryGuardResult {
  if (rows.length === 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_EMPTY_OR_NO_HISTORY",
      "Target database has no Prisma migration history.",
    );
  }

  const byName = new Map<string, MigrationHistoryRow>();
  for (const row of rows) {
    if (byName.has(row.migration_name)) {
      throw new PrismaProductionOverlayError(
        "REFUSE_UNKNOWN_LEGACY_DIVERGENCE",
        `Duplicate migration history row found for ${row.migration_name}.`,
      );
    }
    byName.set(row.migration_name, row);
  }

  for (const expected of LEGACY_PRODUCTION_MIGRATIONS) {
    const row = byName.get(expected.migrationName);
    if (!row) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_ROW_MISSING",
        `${expected.migrationName} is not present in target migration history.`,
      );
    }
    if (normalizeSha(row.checksum) !== expected.expectedSha256) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_CHECKSUM_MISMATCH",
        `${expected.migrationName} checksum does not match production evidence.`,
      );
    }
    if (row.rolled_back_at != null) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_ROLLED_BACK",
        `${expected.migrationName} is marked rolled back.`,
      );
    }
    if (row.finished_at == null) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_UNFINISHED",
        `${expected.migrationName} is not marked finished.`,
      );
    }
  }

  const failedRows = rows.filter(isUnfinishedMigration);
  if (failedRows.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_FAILED_MIGRATION_HISTORY",
      `Target migration history contains unfinished failed rows: ${failedRows
        .map((row) => row.migration_name)
        .join(", ")}`,
    );
  }

  const baseline = byName.get(REQUIRED_PRODUCTION_BASELINE);
  if (!baseline) {
    throw new PrismaProductionOverlayError(
      "REFUSE_BASELINE_MISSING",
      `${REQUIRED_PRODUCTION_BASELINE} is not present in target migration history.`,
    );
  }
  if (!isSuccessfulMigration(baseline)) {
    throw new PrismaProductionOverlayError(
      "REFUSE_BASELINE_UNSUCCESSFUL",
      `${REQUIRED_PRODUCTION_BASELINE} is not successfully applied.`,
    );
  }

  const expectedHistoryNames = new Set([
    ...activeMigrationNames,
    ...LEGACY_PRODUCTION_MIGRATIONS.map(
      (migration) => migration.migrationName,
    ),
  ]);
  const unknownRows = rows.filter(
    (row) => !expectedHistoryNames.has(row.migration_name),
  );
  if (unknownRows.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_UNKNOWN_LEGACY_DIVERGENCE",
      `Target migration history contains rows outside the overlay: ${unknownRows
        .map((row) => row.migration_name)
        .join(", ")}`,
    );
  }

  const pendingActiveMigrations = activeMigrationNames.filter(
    (name) => !byName.has(name),
  );
  const appliedActiveMigrations = activeMigrationNames.filter((name) =>
    byName.has(name),
  );

  const unexpectedPending = pendingActiveMigrations.filter(
    (name) =>
      !EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS.includes(
        name as (typeof EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS)[number],
      ),
  );
  if (unexpectedPending.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
      `Only the Stage 3.13C account-security migration may be pending through this overlay: ${unexpectedPending.join(", ")}`,
    );
  }

  return {
    rows,
    pendingActiveMigrations,
    appliedActiveMigrations,
    recognizedLegacyMigrations: LEGACY_PRODUCTION_MIGRATIONS.map(
      (migration) => migration.migrationName,
    ),
  };
}

export async function readMigrationHistoryFromDatabase(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<MigrationHistoryRow[]> {
  if (!databaseUrl) {
    throw new PrismaProductionOverlayError(
      "REFUSE_DATABASE_URL_MISSING",
      "DATABASE_URL is required but will not be printed.",
    );
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query<MigrationHistoryRow>(
      'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count FROM "_prisma_migrations" ORDER BY started_at, migration_name',
    );
    return result.rows;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "42P01") {
      throw new PrismaProductionOverlayError(
        "REFUSE_EMPTY_OR_NO_HISTORY",
        "Target database does not contain Prisma migration history.",
      );
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runHistoryGuard(
  repoRoot: string,
  databaseUrl: string | undefined = process.env.DATABASE_URL,
): Promise<HistoryGuardResult> {
  const activeMigrationNames = await listActiveMigrationNames(repoRoot);
  const rows = await readMigrationHistoryFromDatabase(databaseUrl);
  return validateMigrationHistoryRows(rows, activeMigrationNames);
}

async function copyMigrationDirectory(
  sourceDir: string,
  destinationDir: string,
): Promise<void> {
  await cp(sourceDir, destinationDir, {
    recursive: true,
    errorOnExist: true,
    force: false,
    preserveTimestamps: true,
  });
}

export async function createTemporaryOverlayDirectory(
  repoRoot: string,
  manifest: LegacyManifest,
): Promise<OverlayDirectory> {
  const rootDir = await mkdtemp(
    path.join(os.tmpdir(), `prisma-production-overlay-${randomUUID()}-`),
  );
  await chmod(rootDir, 0o700).catch(() => undefined);
  const migrationsDir = path.join(rootDir, "migrations");
  await mkdir(migrationsDir, { recursive: true, mode: 0o700 });

  const schemaPath = path.join(rootDir, "schema.prisma");
  await copyFileBytePreserving(
    path.join(repoRoot, "prisma", "schema.prisma"),
    schemaPath,
  );

  const activeMigrationNames = await listActiveMigrationNames(repoRoot);
  for (const migrationName of activeMigrationNames) {
    await copyMigrationDirectory(
      path.join(repoRoot, ACTIVE_MIGRATIONS_DIR, migrationName),
      path.join(migrationsDir, migrationName),
    );
  }

  await copyFileBytePreserving(
    path.join(repoRoot, ACTIVE_MIGRATIONS_DIR, "migration_lock.toml"),
    path.join(migrationsDir, "migration_lock.toml"),
  );

  for (const migration of manifest.migrations) {
    await copyMigrationDirectory(
      path.join(repoRoot, LEGACY_PRODUCTION_HISTORY_DIR, migration.migrationName),
      path.join(migrationsDir, migration.migrationName),
    );
    const copiedHash = await sha256File(
      path.join(migrationsDir, migration.migrationName, "migration.sql"),
    );
    if (copiedHash !== normalizeSha(migration.expectedSha256)) {
      throw new PrismaProductionOverlayError(
        "REFUSE_ARCHIVE_HASH_MISMATCH",
        `${migration.migrationName} temporary overlay checksum does not match production evidence.`,
      );
    }
  }

  const configPath = path.join(rootDir, "prisma.config.ts");
  await writeFile(
    configPath,
    [
      "export default {",
      `  schema: ${JSON.stringify(toPrismaConfigPath(schemaPath))},`,
      "  migrations: {",
      `    path: ${JSON.stringify(toPrismaConfigPath(migrationsDir))},`,
      "  },",
      "  datasource: {",
      '    url: process.env["DATABASE_URL"],',
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    repoRoot,
    rootDir,
    schemaPath,
    configPath,
    migrationsDir,
  };
}

export async function removeTemporaryOverlayDirectory(
  overlay: OverlayDirectory,
): Promise<void> {
  await rm(overlay.rootDir, { recursive: true, force: true });
  try {
    await stat(overlay.rootDir);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return;
    throw error;
  }
  throw new PrismaProductionOverlayError(
    "REFUSE_TEMPORARY_OVERLAY_CLEANUP_FAILED",
    `Temporary overlay directory still exists: ${overlay.rootDir}`,
  );
}

export async function runPrismaMigrationCommand({
  mode,
  overlay,
  databaseUrl,
  expectedPendingMigrations = [],
  stdout = process.stdout,
  stderr = process.stderr,
}: RunPrismaOptions): Promise<void> {
  const executable = process.execPath;
  const args = [
    path.join(overlay.repoRoot, "node_modules", "prisma", "build", "index.js"),
    "migrate",
    mode,
    "--schema",
    overlay.schemaPath,
    "--config",
    overlay.configPath,
  ];

  await new Promise<void>((resolve, reject) => {
    const outputChunks: string[] = [];
    const child = spawn(executable, args, {
      cwd: overlay.repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      outputChunks.push(text);
      stdout.write(redactSensitiveOutput(text, databaseUrl));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      outputChunks.push(text);
      stderr.write(redactSensitiveOutput(text, databaseUrl));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else if (
        mode === "status" &&
        code === 1 &&
        expectedPendingMigrations.length > 0
      ) {
        const output = outputChunks.join("");
        const pendingOnly = isExpectedPendingStatusOutput(
          output,
          expectedPendingMigrations,
        );
        if (pendingOnly) {
          resolve();
          return;
        }
        reject(
          new PrismaProductionOverlayError(
            "PRISMA_COMMAND_FAILED",
            `Prisma migrate ${mode} exited with code ${code}.`,
          ),
        );
      } else {
        reject(
          new PrismaProductionOverlayError(
            "PRISMA_COMMAND_FAILED",
            `Prisma migrate ${mode} exited with code ${code}.`,
          ),
        );
      }
    });
  });
}

export async function executeProductionOverlay(options: {
  repoRoot: string;
  mode: OverlayMode;
  confirmed?: boolean;
  databaseUrl?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
}): Promise<HistoryGuardResult | null> {
  const { repoRoot, mode, databaseUrl = process.env.DATABASE_URL } = options;
  if (mode === "deploy" && !options.confirmed) {
    throw new PrismaProductionOverlayError(
      "REFUSE_DEPLOY_CONFIRMATION_REQUIRED",
      `Production overlay deploy requires ${CONFIRM_LEGACY_PRODUCTION_HISTORY_FLAG}.`,
    );
  }

  const manifest = await loadLegacyManifest(repoRoot);
  await verifyLegacyArchiveHashes(repoRoot, manifest);

  let guardResult: HistoryGuardResult | null = null;
  if (mode !== "verify") {
    guardResult = await runHistoryGuard(repoRoot, databaseUrl);
  }

  const overlay = await createTemporaryOverlayDirectory(repoRoot, manifest);
  try {
    if (mode === "verify") {
      options.stdout?.write(
        "Legacy production overlay verified and temporary directory cleaned.\n",
      );
      return null;
    }
    options.stdout?.write(
      `Legacy rows recognized: ${guardResult?.recognizedLegacyMigrations.join(", ")}\n`,
    );
    options.stdout?.write(
      `Pending active migrations: ${guardResult?.pendingActiveMigrations.join(", ") || "(none)"}\n`,
    );
    await runPrismaMigrationCommand({
      mode: "status",
      overlay,
      databaseUrl,
      expectedPendingMigrations: guardResult?.pendingActiveMigrations,
      stdout: options.stdout,
      stderr: options.stderr,
    });
    if (mode === "deploy") {
      await runPrismaMigrationCommand({
        mode: "deploy",
        overlay,
        databaseUrl,
        stdout: options.stdout,
        stderr: options.stderr,
      });
    }
    return guardResult;
  } finally {
    await removeTemporaryOverlayDirectory(overlay);
  }
}
