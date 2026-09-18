import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  BUG02_PROVIDER_SLOT_MIGRATION,
  EXPECTED_PRODUCTION_PENDING_MIGRATIONS,
  EXPECTED_RELEASE_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_13E_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_15A_PENDING_MIGRATIONS,
  EXPECTED_STAGE_3_25A_PENDING_MIGRATIONS,
  PRODUCTION_FIRST_DEPLOY_SEQUENCE,
  assertArchiveDirectorySetExact,
  assertManifestDeclaredSetExact,
  evaluateReleasePendingSet,
  isExpectedPendingStatusOutput,
  isSuccessfulArchivedMigrationRow,
  LEGACY_PRODUCTION_MIGRATIONS,
  LEGACY_PRODUCTION_SCHEMA_EFFECTS,
  listActiveMigrationNames,
  listLegacyArchiveMigrationNames,
  loadLegacyManifest,
  PrismaProductionOverlayError,
  prismaMigrationArtifactChecksum,
  readActiveMigrationArtifactChecksum,
  readCurrentReleaseArtifactChecksums,
  readMigrationHistoryFromDatabase,
  readObservedSchemaColumns,
  redactSensitiveOutput,
  removeTemporaryOverlayDirectory,
  REQUIRED_PRODUCTION_BASELINE,
  runPrismaMigrationCommand,
  sha256File,
  validateLegacySchemaEffects,
  validateMigrationHistoryRows,
  verifyLegacyArchiveHashes,
  type LegacyManifest,
  type LegacySchemaColumnFact,
  type MigrationHistoryRow,
  type ObservedSchemaColumn,
  type OverlayRefusalCode,
  type ReleasePendingAuthorityInput,
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
    logs: null,
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

function preDeployHistoryRows(): MigrationHistoryRow[] {
  return historyWithOnlyTheseActiveMigrationsPending([
    BUG02_PROVIDER_SLOT_MIGRATION,
  ]);
}

function releaseAuthority(
  overrides: Partial<ReleasePendingAuthorityInput> &
    Pick<ReleasePendingAuthorityInput, "actualPending">,
): ReleasePendingAuthorityInput {
  return {
    historyRows: preDeployHistoryRows(),
    activeArtifactChecksums: {},
    ...overrides,
  };
}

async function currentReleaseArtifactChecksum(): Promise<string> {
  return readActiveMigrationArtifactChecksum(
    process.cwd(),
    BUG02_PROVIDER_SLOT_MIGRATION,
  );
}

async function postDeployAuthority(options?: {
  rowPatch?: Partial<MigrationHistoryRow>;
  checksumOverride?: string;
  extraRows?: MigrationHistoryRow[];
  omitArtifactChecksum?: boolean;
}): Promise<ReleasePendingAuthorityInput> {
  const artifactChecksum = await currentReleaseArtifactChecksum();
  const rows = historyWithOnlyTheseActiveMigrationsPending([]).map((row) => {
    if (row.migration_name !== BUG02_PROVIDER_SLOT_MIGRATION) return row;
    return {
      ...row,
      checksum: artifactChecksum,
      ...options?.rowPatch,
    };
  });
  if (options?.extraRows) rows.push(...options.extraRows);
  return {
    actualPending: [],
    historyRows: rows,
    activeArtifactChecksums: options?.omitArtifactChecksum
      ? {}
      : {
          [BUG02_PROVIDER_SLOT_MIGRATION]:
            options?.checksumOverride ?? artifactChecksum,
        },
  };
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

const AI_ANALYSIS_PROGRESS_MIGRATION =
  "20260810120000_add_ai_analysis_progress";

function patchRowByName(
  rows: MigrationHistoryRow[],
  migrationName: string,
  patch: Partial<MigrationHistoryRow>,
): MigrationHistoryRow[] {
  return rows.map((row) =>
    row.migration_name === migrationName ? { ...row, ...patch } : row,
  );
}

test("manifest parsing and archive SHA verification use exact legacy evidence", async () => {
  const manifest = await loadLegacyManifest(process.cwd());
  assert.equal(manifest.migrations.length, 3);
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

test("exact approved Stage 3.13C/3.13D/3.13E/3.15A/3.25A sequence is accepted", () => {
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
    ...EXPECTED_STAGE_3_25A_PENDING_MIGRATIONS,
  ]);
  assert.deepEqual(
    result.recognizedLegacyMigrations,
    LEGACY_PRODUCTION_MIGRATIONS.map((migration) => migration.migrationName),
  );
});

test("current production baseline accepts only approved Stage 3.13D/3.13E/3.15A/3.25A migrations pending", () => {
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
      ...EXPECTED_STAGE_3_25A_PENDING_MIGRATIONS,
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

test("MIG-01 exactly the BUG02 provider-slot migration pending is allowed", async () => {
  const activeMigrationNames = await listActiveMigrationNames(process.cwd());
  assert.ok(activeMigrationNames.includes(BUG02_PROVIDER_SLOT_MIGRATION));
  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([BUG02_PROVIDER_SLOT_MIGRATION]),
    ACTIVE_MIGRATIONS,
  );
  assert.deepEqual(result.pendingActiveMigrations, [BUG02_PROVIDER_SLOT_MIGRATION]);
  assert.deepEqual(EXPECTED_STAGE_3_25A_PENDING_MIGRATIONS, [
    BUG02_PROVIDER_SLOT_MIGRATION,
  ]);
});

test("MIG-02 BUG02 migration plus an unexpected pending migration is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        historyWithOnlyTheseActiveMigrationsPending([BUG02_PROVIDER_SLOT_MIGRATION]),
        [...ACTIVE_MIGRATIONS, "20260916090001_unreviewed_migration"],
      ),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
});

test("MIG-03 policy expects BUG02 migration but the filesystem artifact is missing", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        historyWithOnlyTheseActiveMigrationsPending([]),
        ACTIVE_MIGRATIONS.filter((name) => name !== BUG02_PROVIDER_SLOT_MIGRATION),
      ),
    "REFUSE_EXPECTED_MIGRATION_MISSING",
  );
});

test("MIG-04 BUG02 migration already applied is accepted with no pending refusal", () => {
  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([]),
    ACTIVE_MIGRATIONS,
  );
  assert.ok(result.appliedActiveMigrations.includes(BUG02_PROVIDER_SLOT_MIGRATION));
  assert.equal(result.pendingActiveMigrations.includes(BUG02_PROVIDER_SLOT_MIGRATION), false);
});

test("LEGACY-AIP-01 known historical AI-progress row with exact checksum is admitted", () => {
  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([BUG02_PROVIDER_SLOT_MIGRATION]),
    ACTIVE_MIGRATIONS,
  );
  const expected = LEGACY_PRODUCTION_MIGRATIONS.find(
    (migration) => migration.migrationName === AI_ANALYSIS_PROGRESS_MIGRATION,
  );
  assert.ok(expected);
  const row = result.rows.find(
    (entry) => entry.migration_name === AI_ANALYSIS_PROGRESS_MIGRATION,
  );
  assert.ok(row);
  assert.equal(row.checksum, expected.expectedSha256);
  assert.ok(row.finished_at);
  assert.equal(row.rolled_back_at, null);
  assert.ok(
    result.recognizedLegacyMigrations.includes(AI_ANALYSIS_PROGRESS_MIGRATION),
  );
});

test("LEGACY-AIP-02 AI-progress row with the wrong checksum is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        patchRowByName(
          historyWithOnlyTheseActiveMigrationsPending([
            BUG02_PROVIDER_SLOT_MIGRATION,
          ]),
          AI_ANALYSIS_PROGRESS_MIGRATION,
          { checksum: "bad-ai-progress-checksum" },
        ),
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_LEGACY_CHECKSUM_MISMATCH",
  );
});

test("LEGACY-AIP-03 AI-progress row in failed or incomplete state is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        patchRowByName(
          historyWithOnlyTheseActiveMigrationsPending([
            BUG02_PROVIDER_SLOT_MIGRATION,
          ]),
          AI_ANALYSIS_PROGRESS_MIGRATION,
          { finished_at: null },
        ),
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_LEGACY_UNFINISHED",
  );
});

test("LEGACY-AIP-04 AI-progress row marked rolled back is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        patchRowByName(
          historyWithOnlyTheseActiveMigrationsPending([
            BUG02_PROVIDER_SLOT_MIGRATION,
          ]),
          AI_ANALYSIS_PROGRESS_MIGRATION,
          { rolled_back_at: new Date("2026-08-10T12:00:00.000Z") },
        ),
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_LEGACY_ROLLED_BACK",
  );
});

test("LEGACY-AIP-05 three known historical rows plus BUG02 pending is allowed", () => {
  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([BUG02_PROVIDER_SLOT_MIGRATION]),
    ACTIVE_MIGRATIONS,
  );
  assert.deepEqual(result.recognizedLegacyMigrations, [
    "20260625090944_add_two_pass_transcription_quality_enhancement",
    "20260625120000_squash_and_diarization_fields",
    AI_ANALYSIS_PROGRESS_MIGRATION,
  ]);
  assert.deepEqual(result.pendingActiveMigrations, [
    BUG02_PROVIDER_SLOT_MIGRATION,
  ]);
});

test("LEGACY-AIP-06 known history plus an extra unknown successful DB-only row is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        [
          ...historyWithOnlyTheseActiveMigrationsPending([
            BUG02_PROVIDER_SLOT_MIGRATION,
          ]),
          successfulRow("20260820120000_unknown_successful_db_only"),
        ],
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_UNKNOWN_LEGACY_DIVERGENCE",
  );
});

test("LEGACY-AIP-07 known history plus an unexpected second repo-pending migration is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        historyWithOnlyTheseActiveMigrationsPending([
          BUG02_PROVIDER_SLOT_MIGRATION,
        ]),
        [...ACTIVE_MIGRATIONS, "20260916090001_unreviewed_second_pending"],
      ),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
});

test("LEGACY-AIP-08 known history expects BUG02 pending but the artifact is missing", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        historyWithOnlyTheseActiveMigrationsPending([
          BUG02_PROVIDER_SLOT_MIGRATION,
        ]),
        ACTIVE_MIGRATIONS.filter(
          (name) => name !== BUG02_PROVIDER_SLOT_MIGRATION,
        ),
      ),
    "REFUSE_EXPECTED_MIGRATION_MISSING",
  );
});

test("MIG-05 first-deploy sequence inspects provider slots only after migration", async () => {
  assert.deepEqual(
    [...PRODUCTION_FIRST_DEPLOY_SEQUENCE],
    [
      "pre_migration_checks_without_provider_slot_table",
      "guarded_migration_overlay_status",
      "apply_admitted_migration",
      "verify_migration_state",
      "inspect_provider_slot_rows_post_migration_only",
      "continue_normal_deployment_readiness",
    ],
  );
  const inspectIndex = PRODUCTION_FIRST_DEPLOY_SEQUENCE.indexOf(
    "inspect_provider_slot_rows_post_migration_only",
  );
  const applyIndex = PRODUCTION_FIRST_DEPLOY_SEQUENCE.indexOf("apply_admitted_migration");
  assert.ok(applyIndex >= 0 && inspectIndex > applyIndex);

  const runbook = await readFile(
    path.join(process.cwd(), "docs", "operations", "deployment-runbook.md"),
    "utf8",
  );
  const architecture = await readFile(
    path.join(process.cwd(), "docs", "architecture", "11-deployment-architecture.md"),
    "utf8",
  );
  const slotQueryIndex = runbook.indexOf('FROM "TranscriptEnhancementProviderSlot"');
  const postMigrationLabelIndex = runbook.indexOf("POST-MIGRATION ONLY");
  const deployIndex = runbook.indexOf("npm run prisma:production:deploy");
  assert.ok(slotQueryIndex >= 0);
  assert.ok(postMigrationLabelIndex >= 0);
  assert.ok(postMigrationLabelIndex < slotQueryIndex);
  assert.ok(deployIndex >= 0);
  assert.ok(deployIndex < slotQueryIndex);
  assert.match(architecture, /POST-MIGRATION ONLY/);
  assert.match(architecture, /do not query `TranscriptEnhancementProviderSlot` before/);
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
  assert.equal(
    isExpectedPendingStatusOutput(
      `Following migrations have not yet been applied:\n${BUG02_PROVIDER_SLOT_MIGRATION}\n20260916999999_extra\n\nTo apply migrations in production`,
      [BUG02_PROVIDER_SLOT_MIGRATION],
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

function cloneManifest(manifest: LegacyManifest): LegacyManifest {
  return structuredClone(manifest);
}

function expectedSchemaColumns(): ObservedSchemaColumn[] {
  return Object.values(LEGACY_PRODUCTION_SCHEMA_EFFECTS).flatMap((facts) =>
    facts.map((fact) => ({
      schema: fact.schema,
      table: fact.table,
      column: fact.column,
      dataType: fact.dataType,
      nullable: fact.nullable,
    })),
  );
}

test("SCHEMA-LEGACY-01 known legacy row plus expected schema is admitted", () => {
  const result = validateMigrationHistoryRows(
    historyWithOnlyTheseActiveMigrationsPending([BUG02_PROVIDER_SLOT_MIGRATION]),
    ACTIVE_MIGRATIONS,
  );
  assert.ok(
    result.recognizedLegacyMigrations.includes(AI_ANALYSIS_PROGRESS_MIGRATION),
  );
  for (const migration of LEGACY_PRODUCTION_MIGRATIONS) {
    validateLegacySchemaEffects(migration.migrationName, expectedSchemaColumns());
  }
});

test("SCHEMA-LEGACY-02 AUTH-SCHEMA-01 AI-progress row without progressJson is refused", () => {
  const observed = expectedSchemaColumns().filter(
    (column) => column.column !== "progressJson",
  );
  assertRefusal(
    () =>
      validateLegacySchemaEffects(AI_ANALYSIS_PROGRESS_MIGRATION, observed),
    "REFUSE_LEGACY_SCHEMA_EFFECT_MISSING",
  );
});

test("SCHEMA-LEGACY-03 progressJson with the wrong type is refused", () => {
  const observed = expectedSchemaColumns().map((column) =>
    column.column === "progressJson"
      ? { ...column, dataType: "text" }
      : column,
  );
  assertRefusal(
    () =>
      validateLegacySchemaEffects(AI_ANALYSIS_PROGRESS_MIGRATION, observed),
    "REFUSE_LEGACY_SCHEMA_EFFECT_MISMATCH",
  );
});

test("SCHEMA-LEGACY-04 missing schema evidence definition is refused", () => {
  assertRefusal(
    () =>
      validateLegacySchemaEffects(AI_ANALYSIS_PROGRESS_MIGRATION, expectedSchemaColumns(), {
        [AI_ANALYSIS_PROGRESS_MIGRATION]: [],
      }),
    "REFUSE_LEGACY_SCHEMA_EVIDENCE_UNDEFINED",
  );
});

test("SCHEMA-ID-01 missing schemaEffectId is refused", async () => {
  const manifest = cloneManifest(await loadLegacyManifest(process.cwd()));
  delete manifest.migrations[2]!.schemaEffectId;
  assertRefusal(
    () => assertManifestDeclaredSetExact(manifest),
    "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_MISSING",
  );
});

test("SCHEMA-ID-02 empty schemaEffectId is refused", async () => {
  const manifest = cloneManifest(await loadLegacyManifest(process.cwd()));
  manifest.migrations[2]!.schemaEffectId = "   ";
  assertRefusal(
    () => assertManifestDeclaredSetExact(manifest),
    "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_EMPTY",
  );
});

test("SCHEMA-ID-03 unknown schemaEffectId is refused", async () => {
  const manifest = cloneManifest(await loadLegacyManifest(process.cwd()));
  manifest.migrations[2]!.schemaEffectId = "not-a-catalog-id";
  assertRefusal(
    () => assertManifestDeclaredSetExact(manifest),
    "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_UNKNOWN",
  );
});

test("SCHEMA-QUERY-01 information_schema query failure is refused closed", async () => {
  const facts: LegacySchemaColumnFact[] = [
    LEGACY_PRODUCTION_SCHEMA_EFFECTS[AI_ANALYSIS_PROGRESS_MIGRATION]![0]!,
  ];
  await assertRejectsWithCode(
    () =>
      readObservedSchemaColumns(
        "postgresql://overlay-schema-query-test/unused",
        facts,
        async () => {
          const error = new Error(
            "permission denied for table information_schema.columns",
          );
          (error as { code?: string }).code = "42501";
          throw error;
        },
      ),
    "REFUSE_LEGACY_SCHEMA_QUERY_FAILED",
  );
});

test("SCHEMA-NULL-01 nullability mismatch is refused", () => {
  const observed = expectedSchemaColumns().map((column) =>
    column.column === "progressJson"
      ? { ...column, nullable: false }
      : column,
  );
  assertRefusal(
    () =>
      validateLegacySchemaEffects(AI_ANALYSIS_PROGRESS_MIGRATION, observed),
    "REFUSE_LEGACY_SCHEMA_EFFECT_MISMATCH",
  );
});

function progressJsonObservation(): ObservedSchemaColumn {
  return expectedSchemaColumns().find(
    (column) => column.column === "progressJson",
  )!;
}

test("SCHEMA-DUP-01 zero matching observations is refused missing", () => {
  const observed = expectedSchemaColumns().filter(
    (column) => column.column !== "progressJson",
  );
  assertRefusal(
    () =>
      validateLegacySchemaEffects(AI_ANALYSIS_PROGRESS_MIGRATION, observed),
    "REFUSE_LEGACY_SCHEMA_EFFECT_MISSING",
  );
});

test("SCHEMA-DUP-02 exactly one valid observation is admitted", () => {
  validateLegacySchemaEffects(
    AI_ANALYSIS_PROGRESS_MIGRATION,
    expectedSchemaColumns(),
  );
});

test("SCHEMA-DUP-03 two identical matching observations are refused ambiguous", () => {
  const match = progressJsonObservation();
  const observed = [...expectedSchemaColumns(), { ...match }];
  assertRefusal(
    () =>
      validateLegacySchemaEffects(AI_ANALYSIS_PROGRESS_MIGRATION, observed),
    "REFUSE_LEGACY_SCHEMA_EFFECT_AMBIGUOUS",
  );
});

test("SCHEMA-DUP-04 two conflicting matching observations are refused ambiguous", () => {
  const match = progressJsonObservation();
  const observed = [
    ...expectedSchemaColumns(),
    { ...match, dataType: "text", nullable: false },
  ];
  assertRefusal(
    () =>
      validateLegacySchemaEffects(AI_ANALYSIS_PROGRESS_MIGRATION, observed),
    "REFUSE_LEGACY_SCHEMA_EFFECT_AMBIGUOUS",
  );
});

test("SCHEMA-DUP-05 one valid match plus unrelated observations is admitted", () => {
  validateLegacySchemaEffects(AI_ANALYSIS_PROGRESS_MIGRATION, [
    ...expectedSchemaColumns(),
    {
      schema: "public",
      table: "UnrelatedTable",
      column: "unrelatedColumn",
      dataType: "text",
      nullable: true,
    },
  ]);
});

test("MANIFEST-EXACT-01 manifest exactly matches the intended archive", async () => {
  const manifest = await loadLegacyManifest(process.cwd());
  assertManifestDeclaredSetExact(manifest);
  const archiveNames = await listLegacyArchiveMigrationNames(process.cwd());
  assertArchiveDirectorySetExact({
    declaredNames: LEGACY_PRODUCTION_MIGRATIONS.map(
      (migration) => migration.migrationName,
    ),
    archiveNames,
    activeNames: await listActiveMigrationNames(process.cwd()),
  });
  assert.deepEqual(
    archiveNames,
    LEGACY_PRODUCTION_MIGRATIONS.map((migration) => migration.migrationName).sort(),
  );
});

test("MANIFEST-EXACT-02 AUTH-MANIFEST-01 extra undeclared archive entry is refused", async () => {
  const manifest = cloneManifest(await loadLegacyManifest(process.cwd()));
  const activeNames = await listActiveMigrationNames(process.cwd());
  assertRefusal(
    () =>
      assertArchiveDirectorySetExact({
        declaredNames: manifest.migrations.map(
          (migration) => migration.migrationName,
        ),
        archiveNames: [
          ...manifest.migrations.map((migration) => migration.migrationName),
          "20260916999999_undeclared_archive",
        ],
        activeNames,
      }),
    "REFUSE_UNDECLARED_ARCHIVE_ENTRY",
  );
  manifest.migrations.push({
    ...manifest.migrations[0]!,
    migrationName: "20260916999999_undeclared_archive",
    schemaEffectId: "20260916999999_undeclared_archive",
  });
  assertRefusal(
    () => assertManifestDeclaredSetExact(manifest),
    "REFUSE_MANIFEST_INVALID",
  );
});

test("MANIFEST-EXACT-03 manifest entry missing its archive artifact is refused", async () => {
  const manifest = await loadLegacyManifest(process.cwd());
  const activeNames = await listActiveMigrationNames(process.cwd());
  assertRefusal(
    () =>
      assertArchiveDirectorySetExact({
        declaredNames: manifest.migrations.map(
          (migration) => migration.migrationName,
        ),
        archiveNames: manifest.migrations
          .map((migration) => migration.migrationName)
          .filter((name) => name !== AI_ANALYSIS_PROGRESS_MIGRATION),
        activeNames,
      }),
    "REFUSE_ARCHIVE_ARTIFACT_MISSING",
  );
});

test("MANIFEST-EXACT-04 archive name colliding with the active chain is refused", async () => {
  const manifest = await loadLegacyManifest(process.cwd());
  const declaredNames = manifest.migrations.map(
    (migration) => migration.migrationName,
  );
  assertRefusal(
    () =>
      assertArchiveDirectorySetExact({
        declaredNames,
        archiveNames: declaredNames,
        activeNames: [AI_ANALYSIS_PROGRESS_MIGRATION],
      }),
    "REFUSE_ARCHIVE_ACTIVE_NAME_COLLISION",
  );
});

test("PENDING-EXACT-01 AUTH-PENDING-01 actual pending exactly BUG02 is allowed", () => {
  assert.deepEqual([...EXPECTED_RELEASE_PENDING_MIGRATIONS], [
    BUG02_PROVIDER_SLOT_MIGRATION,
  ]);
  assert.equal(
    evaluateReleasePendingSet(
      releaseAuthority({
        actualPending: [BUG02_PROVIDER_SLOT_MIGRATION],
      }),
    ),
    "PRE_DEPLOY_ALLOW",
  );
  assert.equal(
    isExpectedPendingStatusOutput(
      `Following migration have not yet been applied:\n${BUG02_PROVIDER_SLOT_MIGRATION}\n\nTo apply migrations in production`,
      [BUG02_PROVIDER_SLOT_MIGRATION],
    ),
    true,
  );
});

test("PENDING-EXACT-02 BUG02 plus an extra pending migration is refused", () => {
  assertRefusal(
    () =>
      evaluateReleasePendingSet(
        releaseAuthority({
          actualPending: [BUG02_PROVIDER_SLOT_MIGRATION, "20260916999999_extra"],
        }),
      ),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
  assert.equal(
    isExpectedPendingStatusOutput(
      `Following migrations have not yet been applied:\n${BUG02_PROVIDER_SLOT_MIGRATION}\n20260916999999_extra\n\nTo apply migrations in production`,
      [BUG02_PROVIDER_SLOT_MIGRATION],
    ),
    false,
  );
});

test("PENDING-EXACT-03 empty pending without a successful current row is refused", () => {
  assertRefusal(
    () =>
      evaluateReleasePendingSet(
        releaseAuthority({
          actualPending: [],
          activeArtifactChecksums: {
            [BUG02_PROVIDER_SLOT_MIGRATION]: "unused-without-row",
          },
        }),
      ),
    "REFUSE_MISSING_EXPECTED_PENDING",
  );
});

test("PENDING-EXACT-04 only an unexpected pending migration is refused", () => {
  assertRefusal(
    () =>
      evaluateReleasePendingSet(
        releaseAuthority({
          actualPending: ["20260916999999_extra"],
        }),
      ),
    "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
  );
});

test("ROW-SUCCESS-01 AUTH-ROW-01 finished valid steps and no failure logs are admitted", () => {
  const rows = historyWithOnlyTheseActiveMigrationsPending([
    BUG02_PROVIDER_SLOT_MIGRATION,
  ]);
  const squash = rows.find(
    (row) =>
      row.migration_name === "20260625120000_squash_and_diarization_fields",
  );
  assert.ok(squash);
  squash.applied_steps_count = 0;
  squash.logs = "";
  const result = validateMigrationHistoryRows(rows, ACTIVE_MIGRATIONS);
  assert.ok(isSuccessfulArchivedMigrationRow(squash));
  assert.ok(
    result.recognizedLegacyMigrations.includes(
      "20260625120000_squash_and_diarization_fields",
    ),
  );
});

test("ROW-SUCCESS-02 finished_at NULL is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        patchRowByName(
          historyWithOnlyTheseActiveMigrationsPending([
            BUG02_PROVIDER_SLOT_MIGRATION,
          ]),
          AI_ANALYSIS_PROGRESS_MIGRATION,
          { finished_at: null },
        ),
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_LEGACY_UNFINISHED",
  );
});

test("ROW-SUCCESS-03 rolled_back_at present is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        patchRowByName(
          historyWithOnlyTheseActiveMigrationsPending([
            BUG02_PROVIDER_SLOT_MIGRATION,
          ]),
          AI_ANALYSIS_PROGRESS_MIGRATION,
          { rolled_back_at: new Date("2026-08-10T12:00:00.000Z") },
        ),
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_LEGACY_ROLLED_BACK",
  );
});

test("ROW-SUCCESS-04 invalid applied_steps_count is refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        patchRowByName(
          historyWithOnlyTheseActiveMigrationsPending([
            BUG02_PROVIDER_SLOT_MIGRATION,
          ]),
          AI_ANALYSIS_PROGRESS_MIGRATION,
          { applied_steps_count: -1 },
        ),
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_LEGACY_APPLIED_STEPS_INVALID",
  );
});

test("ROW-SUCCESS-05 failure logs inconsistent with success are refused", () => {
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        patchRowByName(
          historyWithOnlyTheseActiveMigrationsPending([
            BUG02_PROVIDER_SLOT_MIGRATION,
          ]),
          AI_ANALYSIS_PROGRESS_MIGRATION,
          { logs: "Error: P3009 migration failed" },
        ),
        ACTIVE_MIGRATIONS,
      ),
    "REFUSE_LEGACY_FAILURE_LOGS",
  );
});

test("POSTSAFE-01 valid current migration row plus exact artifact checksum is safe", async () => {
  const artifactChecksum = await currentReleaseArtifactChecksum();
  const sqlPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    BUG02_PROVIDER_SLOT_MIGRATION,
    "migration.sql",
  );
  assert.equal(artifactChecksum, await sha256File(sqlPath));
  assert.equal(
    artifactChecksum,
    prismaMigrationArtifactChecksum(await readFile(sqlPath)),
  );
  assert.equal(
    evaluateReleasePendingSet(await postDeployAuthority()),
    "POST_DEPLOY_SAFE",
  );
});

test("POSTSAFE-02 current release row absent is refused", async () => {
  const artifactChecksum = await currentReleaseArtifactChecksum();
  assertRefusal(
    () =>
      evaluateReleasePendingSet(
        releaseAuthority({
          actualPending: [],
          activeArtifactChecksums: {
            [BUG02_PROVIDER_SLOT_MIGRATION]: artifactChecksum,
          },
        }),
      ),
    "REFUSE_MISSING_EXPECTED_PENDING",
  );
});

test("POSTSAFE-03 finished_at NULL is refused", async () => {
  const authority = await postDeployAuthority({
    rowPatch: { finished_at: null },
  });
  assertRefusal(
    () => evaluateReleasePendingSet(authority),
    "REFUSE_LEGACY_UNFINISHED",
  );
});

test("POSTSAFE-04 rolled_back_at present is refused", async () => {
  const authority = await postDeployAuthority({
    rowPatch: { rolled_back_at: new Date("2026-09-16T12:00:00.000Z") },
  });
  assertRefusal(
    () => evaluateReleasePendingSet(authority),
    "REFUSE_LEGACY_ROLLED_BACK",
  );
});

test("POSTSAFE-05 invalid applied_steps_count is refused", async () => {
  const authority = await postDeployAuthority({
    rowPatch: { applied_steps_count: -1 },
  });
  assertRefusal(
    () => evaluateReleasePendingSet(authority),
    "REFUSE_LEGACY_APPLIED_STEPS_INVALID",
  );
});

test("POSTSAFE-06 failure or P30xx logs are refused", async () => {
  const authority = await postDeployAuthority({
    rowPatch: { logs: "Error: P3009 failed to apply migration" },
  });
  assertRefusal(
    () => evaluateReleasePendingSet(authority),
    "REFUSE_LEGACY_FAILURE_LOGS",
  );
});

test("POSTSAFE-07 wrong checksum is refused", async () => {
  const authority = await postDeployAuthority({
    rowPatch: { checksum: "0".repeat(64) },
  });
  assertRefusal(
    () => evaluateReleasePendingSet(authority),
    "REFUSE_RELEASE_MIGRATION_CHECKSUM_MISMATCH",
  );
});

test("POSTSAFE-08 correct BUG02 row plus unknown divergence is refused", async () => {
  const authority = await postDeployAuthority({
    extraRows: [successfulRow("20260916999999_unknown_divergence")],
  });
  assertRefusal(
    () => validateMigrationHistoryRows(authority.historyRows, ACTIVE_MIGRATIONS),
    "REFUSE_UNKNOWN_LEGACY_DIVERGENCE",
  );
});

test("POSTSAFE-09 correct BUG02 row but active current artifact missing is refused", async () => {
  const authority = await postDeployAuthority();
  assertRefusal(
    () =>
      validateMigrationHistoryRows(
        authority.historyRows,
        ACTIVE_MIGRATIONS.filter(
          (name) => name !== BUG02_PROVIDER_SLOT_MIGRATION,
        ),
      ),
    "REFUSE_EXPECTED_MIGRATION_MISSING",
  );
  const missingArtifact = await postDeployAuthority({
    omitArtifactChecksum: true,
  });
  assertRefusal(
    () => evaluateReleasePendingSet(missingArtifact),
    "REFUSE_EXPECTED_MIGRATION_MISSING",
  );
});

const BUG02_ARTIFACT_RELATIVE_PATH = path.join(
  "prisma",
  "migrations",
  BUG02_PROVIDER_SLOT_MIGRATION,
  "migration.sql",
);

async function withTemporaryArtifactRepo<T>(
  fn: (tempRoot: string) => Promise<T>,
): Promise<T> {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "bug02-artifact-fs-"),
  );
  try {
    return await fn(tempRoot);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeExactBug02Artifact(tempRoot: string): Promise<string> {
  const destination = path.join(tempRoot, BUG02_ARTIFACT_RELATIVE_PATH);
  await copyFileBytePreserving(
    path.join(process.cwd(), BUG02_ARTIFACT_RELATIVE_PATH),
    destination,
  );
  return destination;
}

async function writeBug02MigrationDirectory(tempRoot: string): Promise<string> {
  const directory = path.join(
    tempRoot,
    "prisma",
    "migrations",
    BUG02_PROVIDER_SLOT_MIGRATION,
  );
  await mkdir(directory, { recursive: true });
  return directory;
}

test("ARTIFACT-FS-01 temporary repo with exact active BUG02 artifact resolves checksum", async () => {
  await withTemporaryArtifactRepo(async (tempRoot) => {
    await writeExactBug02Artifact(tempRoot);
    const checksum = await readActiveMigrationArtifactChecksum(
      tempRoot,
      BUG02_PROVIDER_SLOT_MIGRATION,
    );
    assert.equal(checksum, await currentReleaseArtifactChecksum());
    assert.deepEqual(await readCurrentReleaseArtifactChecksums(tempRoot), {
      [BUG02_PROVIDER_SLOT_MIGRATION]: checksum,
    });
    await stat(path.join(process.cwd(), BUG02_ARTIFACT_RELATIVE_PATH));
  });
});

test("ARTIFACT-FS-02 temporary repo with BUG02 directory but missing migration.sql is refused", async () => {
  await withTemporaryArtifactRepo(async (tempRoot) => {
    await writeBug02MigrationDirectory(tempRoot);
    await assertRejectsWithCode(
      () =>
        readActiveMigrationArtifactChecksum(
          tempRoot,
          BUG02_PROVIDER_SLOT_MIGRATION,
        ),
      "REFUSE_EXPECTED_MIGRATION_MISSING",
    );
    await assertRejectsWithCode(
      () => readCurrentReleaseArtifactChecksums(tempRoot),
      "REFUSE_EXPECTED_MIGRATION_MISSING",
    );
    await stat(path.join(process.cwd(), BUG02_ARTIFACT_RELATIVE_PATH));
  });
});

test("ARTIFACT-FS-03 temporary repo lacking the BUG02 directory is refused", async () => {
  await withTemporaryArtifactRepo(async (tempRoot) => {
    await mkdir(path.join(tempRoot, "prisma", "migrations"), {
      recursive: true,
    });
    await assertRejectsWithCode(
      () =>
        readActiveMigrationArtifactChecksum(
          tempRoot,
          BUG02_PROVIDER_SLOT_MIGRATION,
        ),
      "REFUSE_EXPECTED_MIGRATION_MISSING",
    );
    await assertRejectsWithCode(
      () => readCurrentReleaseArtifactChecksums(tempRoot),
      "REFUSE_EXPECTED_MIGRATION_MISSING",
    );
    await stat(path.join(process.cwd(), BUG02_ARTIFACT_RELATIVE_PATH));
  });
});

test("ARTIFACT-FS-04 altered temporary artifact checksum does not match the DB row", async () => {
  await withTemporaryArtifactRepo(async (tempRoot) => {
    const destination = await writeExactBug02Artifact(tempRoot);
    await writeFile(
      destination,
      Buffer.concat([
        await readFile(destination),
        Buffer.from("\n-- artifact-fs-altered\n"),
      ]),
    );
    const artifactChecksums = await readCurrentReleaseArtifactChecksums(
      tempRoot,
    );
    const dbChecksum = await currentReleaseArtifactChecksum();
    assert.notEqual(
      artifactChecksums[BUG02_PROVIDER_SLOT_MIGRATION],
      dbChecksum,
    );
    const authority = {
      ...(await postDeployAuthority()),
      activeArtifactChecksums: artifactChecksums,
    };
    assertRefusal(
      () => evaluateReleasePendingSet(authority),
      "REFUSE_RELEASE_MIGRATION_CHECKSUM_MISMATCH",
    );
    assert.equal(
      await currentReleaseArtifactChecksum(),
      dbChecksum,
    );
  });
});

test("ARTIFACT-FS-05 full POST_DEPLOY_SAFE authority with exact temporary artifact", async () => {
  await withTemporaryArtifactRepo(async (tempRoot) => {
    await writeExactBug02Artifact(tempRoot);
    const artifactChecksums = await readCurrentReleaseArtifactChecksums(
      tempRoot,
    );
    const authority = {
      ...(await postDeployAuthority()),
      activeArtifactChecksums: artifactChecksums,
    };
    assert.equal(evaluateReleasePendingSet(authority), "POST_DEPLOY_SAFE");
  });
});

test("ARTIFACT-FS-06 full authority refuses when the temporary artifact is absent", async () => {
  await withTemporaryArtifactRepo(async (tempRoot) => {
    await mkdir(path.join(tempRoot, "prisma", "migrations"), {
      recursive: true,
    });
    await assertRejectsWithCode(async () => {
      const artifactChecksums =
        await readCurrentReleaseArtifactChecksums(tempRoot);
      return evaluateReleasePendingSet({
        ...(await postDeployAuthority()),
        activeArtifactChecksums: artifactChecksums,
      });
    }, "REFUSE_EXPECTED_MIGRATION_MISSING");
    await stat(path.join(process.cwd(), BUG02_ARTIFACT_RELATIVE_PATH));
  });
});

test("POSTSAFE-10 correct BUG02 row plus pending BUG02 is inconsistent and refused", async () => {
  const authority = await postDeployAuthority();
  assertRefusal(
    () =>
      evaluateReleasePendingSet({
        ...authority,
        actualPending: [BUG02_PROVIDER_SLOT_MIGRATION],
      }),
    "REFUSE_RELEASE_MIGRATION_INCONSISTENT",
  );
});

test("production-history docs do not claim a stale complete pending allowlist", async () => {
  const repair = await readFile(
    path.join(
      process.cwd(),
      "docs",
      "operations",
      "prisma-production-history-repair-20260804.md",
    ),
    "utf8",
  );
  const architecture = await readFile(
    path.join(
      process.cwd(),
      "docs",
      "architecture",
      "11-deployment-architecture.md",
    ),
    "utf8",
  );
  assert.doesNotMatch(repair, /The complete pending-migration allowlist is:/);
  assert.match(repair, /EXPECTED_RELEASE_PENDING_MIGRATIONS/);
  assert.match(repair, /20260916090000_add_transcript_enhancement_provider_slots/);
  assert.match(repair, /`PRE_DEPLOY_ALLOW` is evidence only/);
  assert.match(architecture, /EXPECTED_RELEASE_PENDING_MIGRATIONS/);
  assert.match(
    architecture,
    /20260916090000_add_transcript_enhancement_provider_slots/,
  );
  assert.match(architecture, /successful-row predicate/);
  assert.doesNotMatch(
    architecture,
    /already present is `POST_DEPLOY_SAFE`/,
  );
});
