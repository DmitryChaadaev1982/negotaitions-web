import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import pg from "pg";

import {
  CONFIRM_LEGACY_PRODUCTION_HISTORY_FLAG,
  createTemporaryOverlayDirectory,
  copyFileBytePreserving,
  executeProductionOverlay,
  EXPECTED_PRODUCTION_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_13E_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_15A_PENDING_MIGRATIONS,
  isExpectedPendingStatusOutput,
  LEGACY_PRODUCTION_MIGRATIONS,
  listActiveMigrationNames,
  loadLegacyManifest,
  PrismaProductionOverlayError,
  readMigrationHistoryFromDatabase,
  redactSensitiveOutput,
  removeTemporaryOverlayDirectory,
  REQUIRED_PRODUCTION_BASELINE,
  runPrismaMigrationCommand,
  sha256File,
  validateMigrationHistoryRows,
  verifyLegacyArchiveHashes,
  type MigrationHistoryRow,
  type OverlayRefusalCode,
} from "@/lib/prisma-production-migration-overlay";

const ACTIVE_MIGRATIONS = [
  REQUIRED_PRODUCTION_BASELINE,
  "20260629200500_add_video_provider_identity",
  "20260630120000_add_app_setting",
  "20260713183000_stage_3_10_room_lifecycle_and_connection_ledger",
  "20260721002000_stage_3_10_voximplant_server_stop",
  "20260804113000_stage_3_13b_email_foundation",
  "20260804143000_stage_3_13b_email_hardening",
  ...EXPECTED_PRODUCTION_PENDING_MIGRATIONS,
];

function successfulRow(
  migrationName: string,
  checksum = `checksum-${migrationName}`,
): MigrationHistoryRow {
  return {
    migration_name: migrationName,
    checksum,
    finished_at: new Date("2026-08-04T08:00:00.000Z"),
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function legacyRows(): MigrationHistoryRow[] {
  return LEGACY_PRODUCTION_MIGRATIONS.map((migration) =>
    successfulRow(migration.migrationName, migration.expectedSha256),
  );
}

function preApprovedProductionHistoryRows(): MigrationHistoryRow[] {
  const preStageRows = ACTIVE_MIGRATIONS.filter(
    (name) => !EXPECTED_PRODUCTION_PENDING_MIGRATIONS.includes(
      name as (typeof EXPECTED_PRODUCTION_PENDING_MIGRATIONS)[number],
    ),
  ).map((name) => successfulRow(name));
  return [...legacyRows(), ...preStageRows];
}

function currentProductionHistoryRows(): MigrationHistoryRow[] {
  return [
    ...preApprovedProductionHistoryRows(),
    ...EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS.map((name) =>
      successfulRow(name),
    ),
  ];
}

function historyWithOnlyTheseActiveMigrationsPending(
  pendingMigrationNames: readonly string[],
): MigrationHistoryRow[] {
  const pending = new Set(pendingMigrationNames);
  return [
    ...legacyRows(),
    ...ACTIVE_MIGRATIONS.filter((name) => !pending.has(name)).map((name) =>
      successfulRow(name),
    ),
  ];
}

function assertRefusal(
  fn: () => unknown,
  code: OverlayRefusalCode,
): void {
  assert.throws(
    fn,
    (error) =>
      error instanceof PrismaProductionOverlayError && error.code === code,
  );
}

async function assertRejectsWithCode(
  fn: () => Promise<unknown>,
  code: OverlayRefusalCode,
): Promise<void> {
  await assert.rejects(
    fn,
    (error) =>
      error instanceof PrismaProductionOverlayError && error.code === code,
  );
}

async function command(
  executable: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}

class MemoryWritable extends Writable {
  public readonly chunks: string[] = [];

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString("utf8"));
    callback();
  }
}

test("manifest parsing and archive SHA verification use exact legacy evidence", async () => {
  const manifest = await loadLegacyManifest(process.cwd());
  assert.equal(manifest.migrations.length, 2);
  const hashes = await verifyLegacyArchiveHashes(process.cwd(), manifest);
  for (const migration of LEGACY_PRODUCTION_MIGRATIONS) {
    assert.equal(hashes.get(migration.migrationName), migration.expectedSha256);
  }
});

test("byte-preserving copy retains SHA256", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "overlay-copy-test-"));
  try {
    const source = path.join(tempDir, "source.bin");
    const destination = path.join(tempDir, "nested", "destination.bin");
    await writeFile(source, Buffer.from([0, 1, 2, 3, 10, 13, 255]));
    await copyFileBytePreserving(source, destination);
    assert.equal(await sha256File(destination), await sha256File(source));
    assert.deepEqual(await readFile(destination), await readFile(source));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("empty migration history is refused", () => {
  assertRefusal(
    () => validateMigrationHistoryRows([], ACTIVE_MIGRATIONS),
    "REFUSE_EMPTY_OR_NO_HISTORY",
  );
});

test("missing legacy row is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        preApprovedProductionHistoryRows().slice(1),
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_LEGACY_ROW_MISSING",
  );
});

test("legacy checksum mismatch is refused", () => {
  const rows = preApprovedProductionHistoryRows();
  rows[0] = { ...rows[0], checksum: "bad-checksum" };
  assertRefusal(
    () => validateMigrationHistoryRows(rows, ACTIVE_MIGRATIONS),
    "REFUSE_LEGACY_CHECKSUM_MISMATCH",
  );
});

test("rolled-back legacy row is refused", () => {
  const rows = preApprovedProductionHistoryRows();
  rows[0] = {
    ...rows[0],
    rolled_back_at: new Date("2026-08-04T09:00:00.000Z"),
  };
  assertRefusal(
    () => validateMigrationHistoryRows(rows, ACTIVE_MIGRATIONS),
    "REFUSE_LEGACY_ROLLED_BACK",
  );
});

test("unfinished legacy row is refused", () => {
  const rows = preApprovedProductionHistoryRows();
  rows[0] = { ...rows[0], finished_at: null };
  assertRefusal(
    () => validateMigrationHistoryRows(rows, ACTIVE_MIGRATIONS),
    "REFUSE_LEGACY_UNFINISHED",
  );
});

test("failed migration history is refused", () => {
  const rows = preApprovedProductionHistoryRows();
  rows.push({
    ...successfulRow("20260804170000_stage_3_13c_account_security_email"),
    finished_at: null,
  });
  assertRefusal(
    () => validateMigrationHistoryRows(rows, ACTIVE_MIGRATIONS),
    "REFUSE_FAILED_MIGRATION_HISTORY",
  );
});

test("exact approved Stage 3.13C/3.13D/3.13E/3.15A sequence is accepted", () => {
  const result = validateMigrationHistoryRows(
    preApprovedProductionHistoryRows(),
    ACTIVE_MIGRATIONS,
  );
  assert.deepEqual(
    result.pendingActiveMigrations,
    [...EXPECTED_PRODUCTION_PENDING_MIGRATIONS],
  );
  assert.deepEqual(EXPECTED_PRODUCTION_PENDING_MIGRATIONS, [
    ...EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS,
    ...EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS,
    ...EXPECTED_STAGE_3_13E_PENDING_MIGRATIONS,
    ...EXPECTED_STAGE_3_15A_PENDING_MIGRATIONS,
  ]);
  assert.deepEqual(
    result.recognizedLegacyMigrations,
    LEGACY_PRODUCTION_MIGRATIONS.map((migration) => migration.migrationName),
  );
});

test("current production baseline accepts only approved Stage 3.13D/3.13E/3.15A migrations pending", () => {
  const result = validateMigrationHistoryRows(
    currentProductionHistoryRows(),
    ACTIVE_MIGRATIONS,
  );
  assert.deepEqual(
    result.pendingActiveMigrations,
    [
      ...EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS,
      ...EXPECTED_STAGE_3_13E_PENDING_MIGRATIONS,
      ...EXPECTED_STAGE_3_15A_PENDING_MIGRATIONS,
    ],
  );
  assert.deepEqual(
    result.recognizedLegacyMigrations,
    LEGACY_PRODUCTION_MIGRATIONS.map((migration) => migration.migrationName),
  );
});

test("only the expected recording-attempt fencing migration pending is allowed", () => {
  const recordingAttemptMigration =
    "20260812111000_add_recording_attempt_fencing";
  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([recordingAttemptMigration]),
    ACTIVE_MIGRATIONS,
  );

  assert.deepEqual(result.pendingActiveMigrations, [recordingAttemptMigration]);
});

test("existing expected migrations plus recording-attempt fencing are allowed", () => {
  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending(
      EXPECTED_PRODUCTION_PENDING_MIGRATIONS,
    ),
    ACTIVE_MIGRATIONS,
  );

  assert.deepEqual(
    result.pendingActiveMigrations,
    [...EXPECTED_PRODUCTION_PENDING_MIGRATIONS],
  );
});

test("Stage 3.15A inputFingerprint migration is filesystem-present and explicitly admitted", async () => {
  const fingerprintMigration =
    "20260819120000_add_ai_analysis_input_fingerprint";
  const activeMigrationNames = await listActiveMigrationNames(process.cwd());
  assert.ok(activeMigrationNames.includes(fingerprintMigration));
  assert.deepEqual(EXPECTED_STAGE_3_15A_PENDING_MIGRATIONS, [
    fingerprintMigration,
  ]);

  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([fingerprintMigration]),
    ACTIVE_MIGRATIONS,
  );
  assert.deepEqual(result.pendingActiveMigrations, [fingerprintMigration]);

  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        historyWithOnlyTheseActiveMigrationsPending([fingerprintMigration]),
        [...ACTIVE_MIGRATIONS, "20260819120100_unreviewed_migration"],
      ),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
});

test("Wave C publication-grant migration is filesystem-present and explicitly admitted", async () => {
  const publicationGrantMigration =
    "20260814161500_add_ai_analysis_publication_grants";
  const activeMigrationNames = await listActiveMigrationNames(process.cwd());
  assert.ok(activeMigrationNames.includes(publicationGrantMigration));

  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([publicationGrantMigration]),
    ACTIVE_MIGRATIONS,
  );
  assert.deepEqual(result.pendingActiveMigrations, [publicationGrantMigration]);

  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        historyWithOnlyTheseActiveMigrationsPending([publicationGrantMigration]),
        [...ACTIVE_MIGRATIONS, "20260814161600_unreviewed_migration"],
      ),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
});

test("recording-attempt fencing plus one unknown pending migration is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        historyWithOnlyTheseActiveMigrationsPending([
          "20260812111000_add_recording_attempt_fencing",
        ]),
        [...ACTIVE_MIGRATIONS, "20260812120000_unreviewed_migration"],
      ),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
});

test("an unknown pending migration by itself is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        historyWithOnlyTheseActiveMigrationsPending([]),
        [...ACTIVE_MIGRATIONS, "20260812120000_unreviewed_migration"],
      ),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
});

test("no pending active migrations is clean and up to date", () => {
  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([]),
    ACTIVE_MIGRATIONS,
  );

  assert.deepEqual(result.pendingActiveMigrations, []);
  assert.deepEqual(result.appliedActiveMigrations, ACTIVE_MIGRATIONS);
});

test("an additional unknown pending migration is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(currentProductionHistoryRows(), [
        ...ACTIVE_MIGRATIONS,
        "20260809120000_unreviewed_migration",
      ]),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
});

test("unknown migration-history rows remain refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        [
          ...currentProductionHistoryRows(),
          successfulRow("20260809120000_unknown_history"),
        ],
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_UNKNOWN_LEGACY_DIVERGENCE",
  );
});

test("fully applied approved sequence is accepted idempotently", () => {
  const result = validateMigrationHistoryRows(
    [...legacyRows(), ...ACTIVE_MIGRATIONS.map((name) => successfulRow(name))],
    ACTIVE_MIGRATIONS,
  );
  assert.deepEqual(result.pendingActiveMigrations, []);
});

test("temporary overlay directory is cleaned up", async () => {
  const manifest = await loadLegacyManifest(process.cwd());
  const overlay = await createTemporaryOverlayDirectory(process.cwd(), manifest);
  await removeTemporaryOverlayDirectory(overlay);
  await assert.rejects(stat(overlay.rootDir), { code: "ENOENT" });
});

test("deploy requires explicit legacy production confirmation", async () => {
  await assertRejectsWithCode(
    () =>
      executeProductionOverlay({
        repoRoot: process.cwd(),
        mode: "deploy",
        confirmed: false,
        databaseUrl: "postgresql://example.invalid/db",
      }),
    "REFUSE_DEPLOY_CONFIRMATION_REQUIRED",
  );
  assert.equal(
    CONFIRM_LEGACY_PRODUCTION_HISTORY_FLAG,
    "--confirm-legacy-production-history",
  );
});

test("command failure path still cleans temporary overlay", async () => {
  const manifest = await loadLegacyManifest(process.cwd());
  const overlay = await createTemporaryOverlayDirectory(process.cwd(), manifest);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();
  try {
    await assertRejectsWithCode(
      () =>
        runPrismaMigrationCommand({
          mode: "status",
          overlay,
          databaseUrl: undefined,
          stdout,
          stderr,
        }),
      "PRISMA_COMMAND_FAILED",
    );
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    await removeTemporaryOverlayDirectory(overlay);
  }
  await assert.rejects(stat(overlay.rootDir), { code: "ENOENT" });
});

test("sanitized output never logs DATABASE_URL", () => {
  const databaseUrl =
    "postgresql://user:secret-password@localhost:5432/negotaitions";
  const sanitized = redactSensitiveOutput(
    `connecting to ${databaseUrl}\nerror at postgresql://other:secret@db.internal:5432/app`,
    databaseUrl,
  );
  assert.doesNotMatch(sanitized, /secret-password/);
  assert.doesNotMatch(sanitized, /other:secret/);
  assert.match(sanitized, /\[REDACTED_DATABASE_URL\]/);
});

test("Prisma status accepts singular and plural expected-pending output", () => {
  const pending = [...EXPECTED_PRODUCTION_PENDING_MIGRATIONS];
  // Singular phrasing is only valid when exactly one migration is expected.
  assert.equal(
    isExpectedPendingStatusOutput(
      `Following migration have not yet been applied:\n${pending[0]}`,
      [pending[0]!],
    ),
    true,
  );
  assert.equal(
    isExpectedPendingStatusOutput(
      `Following migrations have not yet been applied:\n${pending.join("\n")}`,
      pending,
    ),
    true,
  );
  assert.equal(
    isExpectedPendingStatusOutput(
      "Following migration have not yet been applied:\nunexpected_migration",
      pending,
    ),
    false,
  );
});

test("empty disposable PostgreSQL database is refused by the DB guard", async (t) => {
  const docker = await command("docker", [
    "version",
    "--format",
    "{{.Server.Version}}",
  ]);
  if (docker.code !== 0) {
    t.skip("Docker is not available in this environment.");
    return;
  }

  const name = `negotaitions-overlay-test-${randomUUID().slice(0, 12)}`;
  const password = `overlay-${randomUUID()}`;
  const run = await command("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-e",
    "POSTGRES_DB=overlay_empty",
    "-p",
    "0:5432",
    "postgres:16-alpine",
  ]);
  assert.equal(run.code, 0, run.stderr);
  t.after(async () => {
    await command("docker", ["rm", "-f", name]);
  });

  const portResult = await command("docker", ["port", name, "5432/tcp"]);
  assert.equal(portResult.code, 0, portResult.stderr);
  const port = portResult.stdout.trim().split(":").at(-1);
  assert.ok(port);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/overlay_empty`;

  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      await client.end();
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  await assertRejectsWithCode(
    () => readMigrationHistoryFromDatabase(databaseUrl),
    "REFUSE_EMPTY_OR_NO_HISTORY",
  );
});
