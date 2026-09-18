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

/**
 * Explicit successful legacy production rows archived outside the active
 * chain. Historical DB-only migrations are admitted only when listed here
 * with verified checksum evidence. Unknown successful rows still fail closed.
 */
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
  {
    migrationName: "20260810120000_add_ai_analysis_progress",
    expectedSha256:
      "a5b48e99f2d978b83c7c36aec06abcfe97451a693a8cde224ed4cb63772d76c0",
    sourceCommit: "5877ea340c2a46ed6c38d1d6223c47b1dc19858b",
    sourceBlob: "e4f752028a6166bac8562fd8e57ffc4e7918fbf5",
  },
] as const;

export const REQUIRED_PRODUCTION_BASELINE =
  "20260627_production_initial_baseline";

/**
 * The Stage 3.13C migrations explicitly approved for the production overlay.
 * The provider-event migrations are additive: they add ingestion tables,
 * nullable remediation columns/indexes, and durable fencing metadata, so an
 * older disabled runtime that predates them keeps working against the newer
 * schema.
 */
export const EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS = [
  "20260804170000_stage_3_13c_account_security_email",
  "20260805140000_stage_3_13c_security_remediation",
  "20260806113000_add_email_provider_event_ingestion",
  "20260806160000_harden_email_provider_event_ingestion",
  "20260806183000_add_provider_event_consumer_fencing",
] as const;

/**
 * The Stage 3.13D additive AI-analysis migrations explicitly approved for the
 * production overlay.
 */
export const EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS = [
  "20260807190000_harden_ai_analysis_operation_lifecycle",
  "20260808210000_add_ai_analysis_provider_response_id",
] as const;

/**
 * The exact Stage 3.13E additive migrations explicitly approved for the
 * production overlay.
 */
export const EXPECTED_STAGE_3_13E_PENDING_MIGRATIONS = [
  "20260811112000_stage_3_13e_session_sound_preference",
  "20260812111000_add_recording_attempt_fencing",
  "20260814161500_add_ai_analysis_publication_grants",
] as const;

/**
 * The exact Stage 3.15A additive migration explicitly approved for the
 * production overlay. It adds nullable `AiAnalysis.inputFingerprint` with no
 * backfill. Historical rows remain NULL.
 */
export const EXPECTED_STAGE_3_15A_PENDING_MIGRATIONS = [
  "20260819120000_add_ai_analysis_input_fingerprint",
] as const;

/**
 * The exact Stage 3.25A / BUG02 additive migration explicitly approved for
 * the production overlay. It creates `TranscriptEnhancementProviderSlot`.
 */
export const BUG02_PROVIDER_SLOT_MIGRATION =
  "20260916090000_add_transcript_enhancement_provider_slots";

export const EXPECTED_STAGE_3_25A_PENDING_MIGRATIONS = [
  BUG02_PROVIDER_SLOT_MIGRATION,
] as const;

/**
 * Exact active pending set authorized for the current production release
 * preflight. Not a historical union and not a subset allowlist.
 */
export const EXPECTED_RELEASE_PENDING_MIGRATIONS = [
  BUG02_PROVIDER_SLOT_MIGRATION,
] as const;

/**
 * Canonical first-deploy operational order for BUG02. Provider-slot table
 * inspection is post-migration only: the table does not exist until the
 * admitted migration is applied.
 */
export const PRODUCTION_FIRST_DEPLOY_SEQUENCE = [
  "pre_migration_checks_without_provider_slot_table",
  "guarded_migration_overlay_status",
  "apply_admitted_migration",
  "verify_migration_state",
  "inspect_provider_slot_rows_post_migration_only",
  "continue_normal_deployment_readiness",
] as const;

/**
 * The complete, explicit production pending-migration allowlist. Keep this as
 * a union of stage-specific lists so future migrations cannot pass implicitly.
 */
export const EXPECTED_PRODUCTION_PENDING_MIGRATIONS = [
  ...EXPECTED_STAGE_3_13C_PENDING_MIGRATIONS,
  ...EXPECTED_STAGE_3_13D_PENDING_MIGRATIONS,
  ...EXPECTED_STAGE_3_13E_PENDING_MIGRATIONS,
  ...EXPECTED_STAGE_3_15A_PENDING_MIGRATIONS,
  ...EXPECTED_STAGE_3_25A_PENDING_MIGRATIONS,
] as const;

export type OverlayMode = "status" | "deploy" | "verify";

export type OverlayRefusalCode =
  | "REFUSE_DATABASE_URL_MISSING"
  | "REFUSE_EMPTY_OR_NO_HISTORY"
  | "REFUSE_LEGACY_ROW_MISSING"
  | "REFUSE_LEGACY_CHECKSUM_MISMATCH"
  | "REFUSE_LEGACY_ROLLED_BACK"
  | "REFUSE_LEGACY_UNFINISHED"
  | "REFUSE_LEGACY_APPLIED_STEPS_INVALID"
  | "REFUSE_LEGACY_FAILURE_LOGS"
  | "REFUSE_LEGACY_SCHEMA_EFFECT_MISSING"
  | "REFUSE_LEGACY_SCHEMA_EFFECT_MISMATCH"
  | "REFUSE_LEGACY_SCHEMA_EFFECT_AMBIGUOUS"
  | "REFUSE_LEGACY_SCHEMA_EVIDENCE_UNDEFINED"
  | "REFUSE_BASELINE_MISSING"
  | "REFUSE_BASELINE_UNSUCCESSFUL"
  | "REFUSE_FAILED_MIGRATION_HISTORY"
  | "REFUSE_UNKNOWN_LEGACY_DIVERGENCE"
  | "REFUSE_UNEXPECTED_PENDING_MIGRATIONS"
  | "REFUSE_MISSING_EXPECTED_PENDING"
  | "REFUSE_EXPECTED_MIGRATION_MISSING"
  | "REFUSE_DEPLOY_CONFIRMATION_REQUIRED"
  | "REFUSE_ARCHIVE_HASH_MISMATCH"
  | "REFUSE_MANIFEST_INVALID"
  | "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_MISSING"
  | "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_EMPTY"
  | "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_UNKNOWN"
  | "REFUSE_MANIFEST_DUPLICATE_MIGRATION"
  | "REFUSE_LEGACY_SCHEMA_QUERY_FAILED"
  | "REFUSE_RELEASE_MIGRATION_CHECKSUM_MISMATCH"
  | "REFUSE_RELEASE_MIGRATION_INCONSISTENT"
  | "REFUSE_UNDECLARED_ARCHIVE_ENTRY"
  | "REFUSE_ARCHIVE_ARTIFACT_MISSING"
  | "REFUSE_ARCHIVE_ACTIVE_NAME_COLLISION"
  | "REFUSE_LEGACY_ACTIVE_MIGRATION_PRESENT"
  | "REFUSE_TEMPORARY_OVERLAY_CLEANUP_FAILED"
  | "PRISMA_COMMAND_FAILED";

export type ReleasePendingDecision = "PRE_DEPLOY_ALLOW" | "POST_DEPLOY_SAFE";

export type LegacySchemaDataType =
  | "jsonb"
  | "text"
  | "double precision"
  | "boolean";

export interface LegacySchemaColumnFact {
  kind: "column";
  schema: "public";
  table: string;
  column: string;
  dataType: LegacySchemaDataType;
  nullable: boolean;
}

export interface ObservedSchemaColumn {
  schema: string;
  table: string;
  column: string;
  dataType: string;
  nullable: boolean;
}

/**
 * Trusted, repository-controlled schema-effect catalog. Manifest entries may
 * only reference these ids. This is not arbitrary SQL from archive data.
 */
export const LEGACY_PRODUCTION_SCHEMA_EFFECTS: Readonly<
  Record<string, readonly LegacySchemaColumnFact[]>
> = {
  "20260625090944_add_two_pass_transcription_quality_enhancement": [
    {
      kind: "column",
      schema: "public",
      table: "Transcript",
      column: "alignmentConfidence",
      dataType: "double precision",
      nullable: true,
    },
    {
      kind: "column",
      schema: "public",
      table: "Transcript",
      column: "alignmentStatus",
      dataType: "text",
      nullable: true,
    },
    {
      kind: "column",
      schema: "public",
      table: "Transcript",
      column: "diarizationPassStatus",
      dataType: "text",
      nullable: true,
    },
    {
      kind: "column",
      schema: "public",
      table: "Transcript",
      column: "qualityModel",
      dataType: "text",
      nullable: true,
    },
    {
      kind: "column",
      schema: "public",
      table: "Transcript",
      column: "qualityPassStatus",
      dataType: "text",
      nullable: true,
    },
    {
      kind: "column",
      schema: "public",
      table: "Transcript",
      column: "strategy",
      dataType: "text",
      nullable: true,
    },
    {
      kind: "column",
      schema: "public",
      table: "TranscriptSegment",
      column: "alignmentConfidence",
      dataType: "double precision",
      nullable: true,
    },
    {
      kind: "column",
      schema: "public",
      table: "TranscriptSegment",
      column: "qualityText",
      dataType: "text",
      nullable: true,
    },
    {
      kind: "column",
      schema: "public",
      table: "TranscriptSegment",
      column: "textSource",
      dataType: "text",
      nullable: true,
    },
  ],
  "20260625120000_squash_and_diarization_fields": [
    {
      kind: "column",
      schema: "public",
      table: "Transcript",
      column: "hasSpeakerDiarization",
      dataType: "boolean",
      nullable: false,
    },
    {
      kind: "column",
      schema: "public",
      table: "Transcript",
      column: "speakerMapping",
      dataType: "jsonb",
      nullable: true,
    },
  ],
  "20260810120000_add_ai_analysis_progress": [
    {
      kind: "column",
      schema: "public",
      table: "AiAnalysis",
      column: "progressJson",
      dataType: "jsonb",
      nullable: true,
    },
  ],
};

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
  logs?: string | null;
}

export interface ReleasePendingAuthorityInput {
  actualPending: readonly string[];
  expectedReleasePending?: readonly string[];
  historyRows: readonly MigrationHistoryRow[];
  activeArtifactChecksums: Readonly<Record<string, string>>;
}

export type ObservedSchemaColumnQuery = (
  tables: readonly string[],
) => Promise<ObservedSchemaColumn[]>;

export interface ManifestMigration {
  migrationName: string;
  expectedSha256: string;
  sourceCommit: string;
  sourceBlob: string;
  schemaEffectId?: string;
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
  releasePendingDecision?: ReleasePendingDecision;
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

const ARCHIVE_ROOT_ALLOWED_FILES = new Set(["manifest.json"]);

const PENDING_STATUS_HEADER =
  /Following migrations? ha(?:ve|s) not yet been applied:/;
const MIGRATION_NAME_LINE = /^\d{8,}[_A-Za-z0-9]+$/;
const SUCCESS_LOG_FAILURE_PATTERN =
  /\b(error|failed|failure|exception|p30\d{2})\b/i;

/**
 * Strict successful-row predicate for Prisma `_prisma_migrations` evidence.
 * Shared by archived legacy production history and the current release
 * migration. Name presence is not success.
 *
 * A row is successful only when all of the following hold:
 * - `finished_at` is non-NULL
 * - `rolled_back_at` is NULL
 * - `applied_steps_count` is a finite integer >= 0
 * - `logs` is NULL, blank, or otherwise free of failure/error evidence
 *
 * `applied_steps_count === 0` is valid. Prisma recorded some legitimate
 * successful historical rows that way, including the June squash archive
 * row and `20260627_production_initial_baseline` on the production-derived
 * local database. Negative, non-integer, or missing step counts are invalid.
 */
export function archivedMigrationAppliedStepsAreValid(
  appliedStepsCount: number | null | undefined,
): boolean {
  return Number.isInteger(appliedStepsCount) && Number(appliedStepsCount) >= 0;
}

export function archivedMigrationLogsAreSuccessful(
  logs: string | null | undefined,
): boolean {
  if (logs == null) return true;
  if (typeof logs !== "string") return false;
  const trimmed = logs.trim();
  if (trimmed === "") return true;
  return !SUCCESS_LOG_FAILURE_PATTERN.test(trimmed);
}

export function isSuccessfulArchivedMigrationRow(
  row: MigrationHistoryRow | undefined,
): boolean {
  if (!row) return false;
  return (
    row.finished_at != null &&
    row.rolled_back_at == null &&
    archivedMigrationAppliedStepsAreValid(row.applied_steps_count) &&
    archivedMigrationLogsAreSuccessful(row.logs)
  );
}

function isSuccessfulMigration(row: MigrationHistoryRow | undefined): boolean {
  return isSuccessfulArchivedMigrationRow(row);
}

function isUnfinishedMigration(row: MigrationHistoryRow): boolean {
  return row.finished_at == null && row.rolled_back_at == null;
}

export function sameStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) return false;
  const expectedSet = new Set(expected);
  return actual.every((name) => expectedSet.has(name));
}

function assertSuccessfulArchivedMigrationRow(
  row: MigrationHistoryRow,
  migrationName: string,
): void {
  if (row.finished_at == null) {
    throw new PrismaProductionOverlayError(
      "REFUSE_LEGACY_UNFINISHED",
      `${migrationName} is not marked finished.`,
    );
  }
  if (row.rolled_back_at != null) {
    throw new PrismaProductionOverlayError(
      "REFUSE_LEGACY_ROLLED_BACK",
      `${migrationName} is marked rolled back.`,
    );
  }
  if (!archivedMigrationAppliedStepsAreValid(row.applied_steps_count)) {
    throw new PrismaProductionOverlayError(
      "REFUSE_LEGACY_APPLIED_STEPS_INVALID",
      `${migrationName} applied_steps_count is not valid successful-row evidence.`,
    );
  }
  if (!archivedMigrationLogsAreSuccessful(row.logs)) {
    throw new PrismaProductionOverlayError(
      "REFUSE_LEGACY_FAILURE_LOGS",
      `${migrationName} logs are inconsistent with successful application.`,
    );
  }
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

export function parsePendingMigrationsFromStatusOutput(
  output: string,
): string[] | null {
  const header = PENDING_STATUS_HEADER.exec(output);
  if (!header || header.index == null) return null;
  const after = output.slice(header.index + header[0].length);
  const names: string[] = [];
  for (const rawLine of after.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") {
      if (names.length > 0) break;
      continue;
    }
    if (!MIGRATION_NAME_LINE.test(line)) break;
    names.push(line);
  }
  return names;
}

export function isExpectedPendingStatusOutput(
  output: string,
  expectedPendingMigrations: readonly string[],
): boolean {
  const actual = parsePendingMigrationsFromStatusOutput(output);
  if (actual == null) return false;
  if (expectedPendingMigrations.length === 0) return false;
  return sameStringSet(actual, expectedPendingMigrations);
}

function findHistoryRow(
  rows: readonly MigrationHistoryRow[],
  migrationName: string,
): MigrationHistoryRow | undefined {
  return rows.find((row) => row.migration_name === migrationName);
}

/**
 * Current-release pending authority.
 *
 * PRE_DEPLOY_ALLOW requires the actual pending set to equal the current
 * release set and that none of those migrations already have a history row.
 *
 * POST_DEPLOY_SAFE requires empty pending plus a complete successful-row
 * proof for every current-release migration, including an exact checksum
 * match against the active migration artifact. Name presence is not enough.
 */
export function evaluateReleasePendingSet(
  input: ReleasePendingAuthorityInput,
): ReleasePendingDecision {
  const actual = [...input.actualPending];
  const expected = [
    ...(input.expectedReleasePending ?? EXPECTED_RELEASE_PENDING_MIGRATIONS),
  ];
  const unexpected = actual.filter((name) => !expected.includes(name));
  if (unexpected.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
      `Actual pending migrations must equal the current release set ${expected.join(", ") || "(none)"}; unexpected: ${unexpected.join(", ")}.`,
    );
  }

  if (sameStringSet(actual, expected)) {
    for (const name of expected) {
      if (findHistoryRow(input.historyRows, name)) {
        throw new PrismaProductionOverlayError(
          "REFUSE_RELEASE_MIGRATION_INCONSISTENT",
          `${name} is still pending but a _prisma_migrations row already exists.`,
        );
      }
    }
    return "PRE_DEPLOY_ALLOW";
  }

  if (actual.length === 0) {
    for (const name of expected) {
      const artifactChecksum = input.activeArtifactChecksums[name];
      if (!artifactChecksum) {
        throw new PrismaProductionOverlayError(
          "REFUSE_EXPECTED_MIGRATION_MISSING",
          `${name} active migration artifact checksum is unavailable.`,
        );
      }
      const row = findHistoryRow(input.historyRows, name);
      if (!row) {
        throw new PrismaProductionOverlayError(
          "REFUSE_MISSING_EXPECTED_PENDING",
          `Current release expected pending ${expected.join(", ") || "(none)"} but actual pending was (none).`,
        );
      }
      assertSuccessfulArchivedMigrationRow(row, name);
      if (normalizeSha(row.checksum) !== normalizeSha(artifactChecksum)) {
        throw new PrismaProductionOverlayError(
          "REFUSE_RELEASE_MIGRATION_CHECKSUM_MISMATCH",
          `${name} checksum does not match the current active migration artifact.`,
        );
      }
    }
    return "POST_DEPLOY_SAFE";
  }

  throw new PrismaProductionOverlayError(
    "REFUSE_MISSING_EXPECTED_PENDING",
    `Current release expected pending ${expected.join(", ") || "(none)"} but actual pending was ${actual.join(", ") || "(none)"}.`,
  );
}

function assertExplicitSchemaEffectId(
  entry: ManifestMigration,
  expected: (typeof LEGACY_PRODUCTION_MIGRATIONS)[number],
): string {
  if (entry.schemaEffectId == null) {
    throw new PrismaProductionOverlayError(
      "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_MISSING",
      `${expected.migrationName} schemaEffectId is required and must not be defaulted.`,
    );
  }
  if (
    typeof entry.schemaEffectId !== "string" ||
    entry.schemaEffectId.trim() === ""
  ) {
    throw new PrismaProductionOverlayError(
      "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_EMPTY",
      `${expected.migrationName} schemaEffectId is empty.`,
    );
  }
  if (
    entry.schemaEffectId !== expected.migrationName ||
    LEGACY_PRODUCTION_SCHEMA_EFFECTS[entry.schemaEffectId] == null
  ) {
    throw new PrismaProductionOverlayError(
      "REFUSE_MANIFEST_SCHEMA_EFFECT_ID_UNKNOWN",
      `${expected.migrationName} schemaEffectId is not a trusted catalog id.`,
    );
  }
  return entry.schemaEffectId;
}

export function assertManifestDeclaredSetExact(
  manifest: LegacyManifest,
  declared = LEGACY_PRODUCTION_MIGRATIONS,
): void {
  const names = manifest.migrations.map((migration) => migration.migrationName);
  if (new Set(names).size !== names.length) {
    throw new PrismaProductionOverlayError(
      "REFUSE_MANIFEST_DUPLICATE_MIGRATION",
      "Legacy production history manifest contains duplicate migration names.",
    );
  }
  const declaredNames = declared.map((migration) => migration.migrationName);
  if (!sameStringSet(names, declaredNames)) {
    throw new PrismaProductionOverlayError(
      "REFUSE_MANIFEST_INVALID",
      "Legacy production history manifest must declare exactly the approved archive set.",
    );
  }
  for (const expected of declared) {
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
    const schemaEffectId = assertExplicitSchemaEffectId(entry, expected);
    const facts = LEGACY_PRODUCTION_SCHEMA_EFFECTS[schemaEffectId];
    if (!facts || facts.length === 0) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_SCHEMA_EVIDENCE_UNDEFINED",
        `${expected.migrationName} has no trusted schema-effect definition.`,
      );
    }
  }
}

export function assertArchiveDirectorySetExact(options: {
  declaredNames: readonly string[];
  archiveNames: readonly string[];
  activeNames: readonly string[];
}): void {
  const { declaredNames, archiveNames, activeNames } = options;
  if (new Set(archiveNames).size !== archiveNames.length) {
    throw new PrismaProductionOverlayError(
      "REFUSE_MANIFEST_DUPLICATE_MIGRATION",
      "Legacy archive directories contain duplicate migration names.",
    );
  }
  const extra = archiveNames.filter((name) => !declaredNames.includes(name));
  if (extra.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_UNDECLARED_ARCHIVE_ENTRY",
      `Undeclared legacy archive entries cannot become migration authority: ${extra.join(", ")}`,
    );
  }
  const missing = declaredNames.filter((name) => !archiveNames.includes(name));
  if (missing.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_ARCHIVE_ARTIFACT_MISSING",
      `Declared legacy archive artifacts are missing: ${missing.join(", ")}`,
    );
  }
  const collisions = declaredNames.filter((name) => activeNames.includes(name));
  if (collisions.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_ARCHIVE_ACTIVE_NAME_COLLISION",
      `Archived migration names collide with the active chain: ${collisions.join(", ")}`,
    );
  }
}

export function validateLegacySchemaEffects(
  migrationName: string,
  observed: readonly ObservedSchemaColumn[],
  catalog: Readonly<Record<string, readonly LegacySchemaColumnFact[]>> = LEGACY_PRODUCTION_SCHEMA_EFFECTS,
): void {
  const expected = catalog[migrationName];
  if (!expected || expected.length === 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_LEGACY_SCHEMA_EVIDENCE_UNDEFINED",
      `${migrationName} has no trusted schema-effect definition.`,
    );
  }
  for (const fact of expected) {
    const matches = observed.filter(
      (column) =>
        column.schema === fact.schema &&
        column.table === fact.table &&
        column.column === fact.column,
    );
    if (matches.length === 0) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_SCHEMA_EFFECT_MISSING",
        `${migrationName} expected ${fact.schema}.${fact.table}.${fact.column} is absent.`,
      );
    }
    if (matches.length > 1) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_SCHEMA_EFFECT_AMBIGUOUS",
        `${migrationName} expected ${fact.schema}.${fact.table}.${fact.column} has ${matches.length} observations; exactly one is required.`,
      );
    }
    const found = matches[0]!;
    if (found.dataType !== fact.dataType || found.nullable !== fact.nullable) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_SCHEMA_EFFECT_MISMATCH",
        `${migrationName} expected ${fact.schema}.${fact.table}.${fact.column} ${fact.dataType} nullable=${fact.nullable}.`,
      );
    }
  }
}

export function prismaMigrationArtifactChecksum(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return prismaMigrationArtifactChecksum(buffer);
}

export async function readActiveMigrationArtifactChecksum(
  repoRoot: string,
  migrationName: string,
): Promise<string> {
  const sqlPath = path.join(
    repoRoot,
    ACTIVE_MIGRATIONS_DIR,
    migrationName,
    "migration.sql",
  );
  try {
    await stat(sqlPath);
  } catch {
    throw new PrismaProductionOverlayError(
      "REFUSE_EXPECTED_MIGRATION_MISSING",
      `${migrationName} active migration artifact is missing.`,
    );
  }
  return sha256File(sqlPath);
}

export async function readCurrentReleaseArtifactChecksums(
  repoRoot: string,
  migrationNames: readonly string[] = EXPECTED_RELEASE_PENDING_MIGRATIONS,
): Promise<Record<string, string>> {
  const checksums: Record<string, string> = {};
  for (const migrationName of migrationNames) {
    checksums[migrationName] = await readActiveMigrationArtifactChecksum(
      repoRoot,
      migrationName,
    );
  }
  return checksums;
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
  assertManifestDeclaredSetExact(manifest);
  return manifest;
}

export async function listLegacyArchiveMigrationNames(
  repoRoot: string,
): Promise<string[]> {
  const archiveDir = path.join(repoRoot, LEGACY_PRODUCTION_HISTORY_DIR);
  const entries = await readdir(archiveDir, { withFileTypes: true });
  const names: string[] = [];
  const undeclared: string[] = [];
  for (const entry of entries) {
    if (entry.isFile() && ARCHIVE_ROOT_ALLOWED_FILES.has(entry.name)) {
      continue;
    }
    if (entry.isDirectory()) {
      names.push(entry.name);
      continue;
    }
    undeclared.push(entry.name);
  }
  if (undeclared.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_UNDECLARED_ARCHIVE_ENTRY",
      `Legacy archive root contains undeclared entries: ${undeclared.join(", ")}`,
    );
  }
  return names.sort();
}

export async function listActiveMigrationDirectoryNames(
  repoRoot: string,
): Promise<string[]> {
  const migrationsDir = path.join(repoRoot, ACTIVE_MIGRATIONS_DIR);
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function assertLegacyArchiveExactlyMatchesManifest(
  repoRoot: string,
  manifest: LegacyManifest,
): Promise<void> {
  const archiveNames = await listLegacyArchiveMigrationNames(repoRoot);
  const activeNames = await listActiveMigrationDirectoryNames(repoRoot);
  assertArchiveDirectorySetExact({
    declaredNames: manifest.migrations.map((migration) => migration.migrationName),
    archiveNames,
    activeNames,
  });
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
    try {
      await stat(sqlPath);
    } catch {
      throw new PrismaProductionOverlayError(
        "REFUSE_ARCHIVE_ARTIFACT_MISSING",
        `${migration.migrationName} archive artifact is missing.`,
      );
    }
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
    assertSuccessfulArchivedMigrationRow(row, expected.migrationName);
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

  const missingExpected = EXPECTED_PRODUCTION_PENDING_MIGRATIONS.filter(
    (name) => !activeMigrationNames.includes(name),
  );
  if (missingExpected.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_EXPECTED_MIGRATION_MISSING",
      `Policy expects migrations that are absent from the active migration filesystem: ${missingExpected.join(", ")}`,
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
      !EXPECTED_PRODUCTION_PENDING_MIGRATIONS.includes(
        name as (typeof EXPECTED_PRODUCTION_PENDING_MIGRATIONS)[number],
      ),
  );
  if (unexpectedPending.length > 0) {
    throw new PrismaProductionOverlayError(
      "REFUSE_UNEXPECTED_PENDING_MIGRATIONS",
      `Only explicitly approved production migrations may be pending through this overlay: ${unexpectedPending.join(", ")}`,
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
      'SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count, logs FROM "_prisma_migrations" ORDER BY started_at, migration_name',
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

function refuseClosedSchemaQueryFailure(error: unknown): never {
  if (error instanceof PrismaProductionOverlayError) throw error;
  throw new PrismaProductionOverlayError(
    "REFUSE_LEGACY_SCHEMA_QUERY_FAILED",
    "Trusted information_schema query failed; refusing closed.",
  );
}

export async function readObservedSchemaColumns(
  databaseUrl: string | undefined,
  facts: readonly LegacySchemaColumnFact[],
  executeQuery?: ObservedSchemaColumnQuery,
): Promise<ObservedSchemaColumn[]> {
  if (!databaseUrl) {
    throw new PrismaProductionOverlayError(
      "REFUSE_DATABASE_URL_MISSING",
      "DATABASE_URL is required but will not be printed.",
    );
  }
  const tables = [...new Set(facts.map((fact) => fact.table))];
  if (executeQuery) {
    try {
      return await executeQuery(tables);
    } catch (error) {
      refuseClosedSchemaQueryFailure(error);
    }
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: "YES" | "NO";
    }>(
      `SELECT table_schema, table_name, column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [tables],
    );
    return result.rows.map((row) => ({
      schema: row.table_schema,
      table: row.table_name,
      column: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === "YES",
    }));
  } catch (error) {
    refuseClosedSchemaQueryFailure(error);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function assertLegacySchemaEffectsInDatabase(
  databaseUrl: string | undefined = process.env.DATABASE_URL,
  catalog: Readonly<
    Record<string, readonly LegacySchemaColumnFact[]>
  > = LEGACY_PRODUCTION_SCHEMA_EFFECTS,
): Promise<void> {
  const allFacts: LegacySchemaColumnFact[] = [];
  for (const migration of LEGACY_PRODUCTION_MIGRATIONS) {
    const facts = catalog[migration.migrationName];
    if (!facts || facts.length === 0) {
      throw new PrismaProductionOverlayError(
        "REFUSE_LEGACY_SCHEMA_EVIDENCE_UNDEFINED",
        `${migration.migrationName} has no trusted schema-effect definition.`,
      );
    }
    allFacts.push(...facts);
  }
  const observed = await readObservedSchemaColumns(databaseUrl, allFacts);
  for (const migration of LEGACY_PRODUCTION_MIGRATIONS) {
    validateLegacySchemaEffects(migration.migrationName, observed, catalog);
  }
}

export async function runHistoryGuard(
  repoRoot: string,
  databaseUrl: string | undefined = process.env.DATABASE_URL,
  options: {
    expectedReleasePendingMigrations?: readonly string[];
  } = {},
): Promise<HistoryGuardResult> {
  const activeMigrationNames = await listActiveMigrationNames(repoRoot);
  const rows = await readMigrationHistoryFromDatabase(databaseUrl);
  const result = validateMigrationHistoryRows(rows, activeMigrationNames);
  await assertLegacySchemaEffectsInDatabase(databaseUrl);
  const activeArtifactChecksums = await readCurrentReleaseArtifactChecksums(
    repoRoot,
    options.expectedReleasePendingMigrations ??
      EXPECTED_RELEASE_PENDING_MIGRATIONS,
  );
  const releasePendingDecision = evaluateReleasePendingSet({
    actualPending: result.pendingActiveMigrations,
    historyRows: result.rows,
    activeArtifactChecksums,
    expectedReleasePending: options.expectedReleasePendingMigrations,
  });
  return {
    ...result,
    releasePendingDecision,
  };
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

  assertManifestDeclaredSetExact(manifest);
  for (const migration of LEGACY_PRODUCTION_MIGRATIONS) {
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
  expectedReleasePendingMigrations?: readonly string[];
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
  await assertLegacyArchiveExactlyMatchesManifest(repoRoot, manifest);
  await verifyLegacyArchiveHashes(repoRoot, manifest);

  let guardResult: HistoryGuardResult | null = null;
  if (mode !== "verify") {
    guardResult = await runHistoryGuard(repoRoot, databaseUrl, {
      expectedReleasePendingMigrations:
        options.expectedReleasePendingMigrations,
    });
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
    if (guardResult?.releasePendingDecision) {
      options.stdout?.write(
        `Release pending decision: ${guardResult.releasePendingDecision}\n`,
      );
    }
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
