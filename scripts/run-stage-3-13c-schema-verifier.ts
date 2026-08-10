import { spawn } from "node:child_process";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import pg from "pg";

import {
  deriveStage313cSchemaScopedDatabaseUrl,
  resolveApprovedStage313cTestDatabase,
  Stage313cTestDatabaseRefusal,
  STAGE313C_COORDINATOR_APPLICATION_NAME,
  STAGE313C_TEST_DATABASE_APPROVED_ENV,
  STAGE313C_TEST_DATABASE_URL_ENV,
  STAGE313C_TEST_SCHEMA,
  STAGE313C_TEST_SCHEMA_ENV,
  STAGE313C_TEST_SCHEMA_MARKER,
  STAGE313C_VERIFIER_APPLICATION_NAME,
} from "./stage-3-13c-test-database";
import { assertIsolatedE2eDatabase } from "../tests/e2e/helpers/e2e-database";

loadEnvConfig(process.cwd());

const COORDINATION_LOCK_TIMEOUT_MS = 10_000;
const COORDINATION_LOCK_LABEL_PREFIX =
  "negotaitions:stage313c:persistent-verifier";
const REQUIRED_STAGE313C_MIGRATIONS = [
  "20260804170000_stage_3_13c_account_security_email",
  "20260805140000_stage_3_13c_security_remediation",
  "20260806113000_add_email_provider_event_ingestion",
  "20260806160000_harden_email_provider_event_ingestion",
  "20260806183000_add_provider_event_consumer_fencing",
  "20260807190000_harden_ai_analysis_operation_lifecycle",
] as const;
const ALLOWED_CHILD_NAME_KEYS = new Set([
  "reason",
  "pendingBefore",
  "appliedByOverlay",
  "pendingAfter",
  "legacyMigrations",
  "passwordResetTokenIndexes",
]);
const VERIFIERS = {
  integration: "scripts/verify-stage-3-13c-account-email.ts",
  overlay: "scripts/verify-stage-3-13c-production-overlay.ts",
  remediation: "scripts/verify-stage-3-13c-remediation.ts",
  "high-remediation-r2": "scripts/verify-stage-3-13c-high-remediation-r2.ts",
  "final-remediation": "scripts/verify-stage-3-13c-final-remediation.ts",
  "ai-analysis": "scripts/verify-stage-3-13d-ai-migration.ts",
} as const;

type VerifierName = keyof typeof VERIFIERS;

class VerifierHarnessError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "VerifierHarnessError";
  }
}

function parseVerifierName(argv: string[]): VerifierName {
  if (argv.length !== 2 || argv[0] !== "--verifier") {
    throw new VerifierHarnessError("VERIFIER_ARGUMENTS_INVALID");
  }
  const name = argv[1] as VerifierName;
  if (!Object.hasOwn(VERIFIERS, name)) {
    throw new VerifierHarnessError("VERIFIER_NAME_REFUSED");
  }
  return name;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function acquireCoordinationLock(
  client: pg.Client,
  label: string,
): Promise<void> {
  const deadline = performance.now() + COORDINATION_LOCK_TIMEOUT_MS;
  let delayMs = 25;
  while (true) {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [label],
    );
    if (result.rows[0]?.acquired) return;
    if (performance.now() >= deadline) {
      throw new VerifierHarnessError("VERIFIER_COORDINATION_LOCK_TIMEOUT");
    }
    const remainingMs = Math.max(1, deadline - performance.now());
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(delayMs, remainingMs));
    });
    delayMs = Math.min(delayMs * 2, 250);
  }
}

async function releaseCoordinationLock(
  client: pg.Client,
  label: string,
): Promise<void> {
  const released = await client.query<{ released: boolean }>(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released",
    [label],
  );
  if (!released.rows[0]?.released) {
    throw new VerifierHarnessError("VERIFIER_COORDINATION_LOCK_RELEASE_FAILED");
  }
  const duplicate = await client.query<{ released: boolean }>(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released",
    [label],
  );
  if (duplicate.rows[0]?.released) {
    throw new VerifierHarnessError("VERIFIER_COORDINATION_LOCK_STILL_HELD");
  }
}

async function protectedSchemaFingerprint(
  client: pg.Client,
): Promise<string> {
  const schemas = await client.query<{
    schema_name: string;
    owner_name: string;
    comment: string | null;
    relations: string;
    types: string;
    routines: string;
  }>(
    `SELECT
       n.nspname AS schema_name,
       pg_get_userbyid(n.nspowner) AS owner_name,
       obj_description(n.oid, 'pg_namespace') AS comment,
       (SELECT COUNT(*) FROM pg_class c WHERE c.relnamespace = n.oid) AS relations,
       (SELECT COUNT(*) FROM pg_type t
        WHERE t.typnamespace = n.oid AND t.typtype IN ('d', 'e')) AS types,
       (SELECT COUNT(*) FROM pg_proc p WHERE p.pronamespace = n.oid) AS routines
     FROM pg_namespace n
     WHERE n.nspname <> $1
       AND n.nspname NOT IN ('pg_catalog', 'information_schema')
       AND n.nspname NOT LIKE 'pg_toast%'
       AND n.nspname NOT LIKE 'pg_temp_%'
     ORDER BY n.nspname`,
    [STAGE313C_TEST_SCHEMA],
  );
  const extensions = await client.query<{
    name: string;
    version: string;
    schema_name: string;
  }>(
    `SELECT e.extname AS name, e.extversion AS version, n.nspname AS schema_name
     FROM pg_extension e
     JOIN pg_namespace n ON n.oid = e.extnamespace
     ORDER BY e.extname`,
  );
  return JSON.stringify({
    schemas: schemas.rows,
    extensions: extensions.rows,
  });
}

async function assertExistingSchemaIsVerifierOwned(
  client: pg.Client,
): Promise<void> {
  const result = await client.query<{
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
  if (result.rowCount === 0) return;
  const row = result.rows[0];
  if (!row?.owned_by_current_user) {
    throw new VerifierHarnessError("VERIFIER_SCHEMA_OWNERSHIP_NOT_PROVEN");
  }
  if (row.comment === STAGE313C_TEST_SCHEMA_MARKER) return;
  if (row.comment !== null) {
    throw new VerifierHarnessError("VERIFIER_SCHEMA_OWNERSHIP_NOT_PROVEN");
  }

  const contents = await client.query<{
    relations: string;
    types: string;
    routines: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1) AS relations,
       (SELECT COUNT(*) FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typtype IN ('d', 'e')) AS types,
       (SELECT COUNT(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1) AS routines`,
    [STAGE313C_TEST_SCHEMA],
  );
  if (
    Object.values(contents.rows[0] ?? {}).some((count) => Number(count) !== 0)
  ) {
    throw new VerifierHarnessError("VERIFIER_SCHEMA_OWNERSHIP_NOT_PROVEN");
  }
  await client.query(
    `COMMENT ON SCHEMA ${quoteIdentifier(STAGE313C_TEST_SCHEMA)}
     IS 'NegotAItions Stage 3.13C verifier-owned schema'`,
  );
}

async function resetVerifierSchema(client: pg.Client): Promise<void> {
  await assertExistingSchemaIsVerifierOwned(client);
  await client.query(
    `DROP SCHEMA IF EXISTS ${quoteIdentifier(STAGE313C_TEST_SCHEMA)} CASCADE`,
  );
  await client.query(
    `CREATE SCHEMA ${quoteIdentifier(STAGE313C_TEST_SCHEMA)} AUTHORIZATION CURRENT_USER`,
  );
  await client.query(
    `COMMENT ON SCHEMA ${quoteIdentifier(STAGE313C_TEST_SCHEMA)}
     IS 'NegotAItions Stage 3.13C verifier-owned schema'`,
  );
}

async function assertVerifierSchemaMarker(client: pg.Client): Promise<void> {
  const result = await client.query<{ comment: string | null }>(
    `SELECT obj_description(n.oid, 'pg_namespace') AS comment
     FROM pg_namespace n
     WHERE n.nspname = $1
       AND n.nspowner = (SELECT usesysid FROM pg_user WHERE usename = current_user)`,
    [STAGE313C_TEST_SCHEMA],
  );
  if (
    result.rowCount !== 1 ||
    result.rows[0]?.comment !== STAGE313C_TEST_SCHEMA_MARKER
  ) {
    throw new VerifierHarnessError("VERIFIER_SCHEMA_MARKER_MISSING");
  }
}

async function applyMigrations(
  repoRoot: string,
  scopedDatabaseUrl: string,
): Promise<void> {
  const prismaCli = path.join(
    repoRoot,
    "node_modules",
    "prisma",
    "build",
    "index.js",
  );
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: scopedDatabaseUrl,
      },
      stdio: ["ignore", "ignore", "ignore"],
      shell: false,
    });
    child.once("error", () =>
      reject(new VerifierHarnessError("VERIFIER_MIGRATION_SPAWN_FAILED")),
    );
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new VerifierHarnessError("VERIFIER_MIGRATION_DEPLOY_FAILED"));
    });
  });
}

async function assertRequiredMigrationsApplied(
  client: pg.Client,
): Promise<number> {
  const result = await client.query<{
    migration_name: string;
    finished_at: Date | string | null;
    rolled_back_at: Date | string | null;
  }>(
    `SELECT migration_name, finished_at, rolled_back_at
     FROM ${quoteIdentifier(STAGE313C_TEST_SCHEMA)}."_prisma_migrations"
     ORDER BY migration_name`,
  );
  const applied = new Set(
    result.rows
      .filter((row) => row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name),
  );
  if (
    REQUIRED_STAGE313C_MIGRATIONS.some(
      (migrationName) => !applied.has(migrationName),
    )
  ) {
    throw new VerifierHarnessError("STAGE313C_MIGRATION_HISTORY_INCOMPLETE");
  }
  return result.rows.length;
}

function isSafeName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    /^[A-Za-z0-9_.-]+$/.test(value)
  );
}

function sanitizeVerifierResult(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const allowedRootKeys = new Set([
    "ok",
    "counts",
    "cases",
    "runId",
    "ids",
    "names",
  ]);
  if (Object.keys(result).some((key) => !allowedRootKeys.has(key))) return null;
  if (typeof result.ok !== "boolean") return null;

  if (result.counts !== undefined) {
    if (
      !result.counts ||
      typeof result.counts !== "object" ||
      Array.isArray(result.counts) ||
      Object.entries(result.counts as Record<string, unknown>).some(
        ([key, count]) =>
          !isSafeName(key) ||
          typeof count !== "number" ||
          !Number.isSafeInteger(count),
      )
    ) {
      return null;
    }
  }
  if (
    result.cases !== undefined &&
    (!Array.isArray(result.cases) || result.cases.some((item) => !isSafeName(item)))
  ) {
    return null;
  }
  if (result.runId !== undefined && !isSafeName(result.runId)) return null;
  if (result.ids !== undefined) {
    if (
      !result.ids ||
      typeof result.ids !== "object" ||
      Array.isArray(result.ids) ||
      Object.entries(result.ids as Record<string, unknown>).some(
        ([key, identifier]) => key !== "runId" || !isSafeName(identifier),
      )
    ) {
      return null;
    }
  }
  if (result.names !== undefined) {
    if (
      !result.names ||
      typeof result.names !== "object" ||
      Array.isArray(result.names) ||
      Object.entries(result.names as Record<string, unknown>).some(
        ([key, names]) =>
          !ALLOWED_CHILD_NAME_KEYS.has(key) ||
          !Array.isArray(names) ||
          names.some((item) => !isSafeName(item)),
      )
    ) {
      return null;
    }
  }
  return result;
}

async function runVerifierChild(params: {
  repoRoot: string;
  verifierPath: string;
  scopedDatabaseUrl: string;
  baseEnvironment: NodeJS.ProcessEnv;
}): Promise<Record<string, unknown>[]> {
  const env: NodeJS.ProcessEnv = {
    ...params.baseEnvironment,
    DATABASE_URL: params.scopedDatabaseUrl,
    EMAIL_PROVIDER: "fake",
    EMAIL_DELIVERY_ENABLED: "true",
    EMAIL_LOCAL_PREVIEW_ENABLED: "false",
  };
  delete env.STAGE313C_DISPOSABLE_DATABASE_URL;
  delete env.YANDEX_POSTBOX_ACCESS_KEY_ID;
  delete env.YANDEX_POSTBOX_SECRET_ACCESS_KEY;

  const output = await new Promise<{ code: number | null; text: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", params.verifierPath],
        {
          cwd: params.repoRoot,
          env,
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
        },
      );
      let text = "";
      const append = (chunk: Buffer) => {
        if (text.length < 256_000) text += chunk.toString("utf8");
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.once("error", () =>
        reject(new VerifierHarnessError("VERIFIER_CHILD_SPAWN_FAILED")),
      );
      child.once("close", (code) => resolve({ code, text }));
    },
  );

  const parsedLines = output.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return undefined;
      }
    })
    .filter((value) => value !== undefined);
  const sanitized = parsedLines
    .map((value) => sanitizeVerifierResult(value))
    .filter((value): value is Record<string, unknown> => value !== null);
  if (sanitized.length === 0) {
    if (parsedLines.length === 0) {
      const diagnosticText = output.text.replace(
        /\u001b\[[0-9;]*m/g,
        "",
      );
      const sourceLine = diagnosticText.match(
        /verify-stage-3-13c-final-remediation\.ts:(\d+):\d+/,
      )?.[1];
      const errorClass = diagnosticText.match(
        /(?:^|\n)([A-Za-z][A-Za-z0-9]*Error)(?:\s+\[([A-Z0-9_]+)\])?:/,
      );
      const crashKind = sourceLine
        ? `CHILD_CRASH_LINE_${sourceLine}`
        : errorClass
          ? `ERROR_CLASS_${errorClass[1]?.toUpperCase()}${
              errorClass[2] ? `_${errorClass[2]}` : ""
            }`
          : /ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)/i.test(output.text)
          ? "MODULE_LOAD_FAILED"
          : /Transform failed|SyntaxError/i.test(output.text)
            ? "COMPILE_FAILED"
            : /PrismaClientInitializationError|P1001/i.test(output.text)
              ? "DATABASE_INITIALIZATION_FAILED"
              : /ReferenceError/i.test(output.text)
                ? "REFERENCE_ERROR"
                : /TypeError/i.test(output.text)
                  ? "TYPE_ERROR"
                  : /AssertionError/i.test(output.text)
                    ? "ASSERTION_BEFORE_RUN"
                    : /does not provide an export named/i.test(output.text)
                      ? "MODULE_EXPORT_FAILED"
                      : `CHILD_CRASHED_EXIT_${output.code ?? "NULL"}_LINES_${
                          output.text.split(/\r?\n/).filter(Boolean).length
                        }_BYTES_${output.text.length}`;
      throw new VerifierHarnessError(`VERIFIER_OUTPUT_${crashKind}`);
    }
    const rootKeys = [
      ...new Set(
        parsedLines.flatMap((value) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.keys(value as Record<string, unknown>)
            : [],
        ),
      ),
    ]
      .filter(isSafeName)
      .sort()
      .join("_")
      .toUpperCase();
    throw new VerifierHarnessError(
      rootKeys
        ? `VERIFIER_OUTPUT_INVALID_${rootKeys}`
        : "VERIFIER_OUTPUT_INVALID_JSON",
    );
  }
  for (const result of sanitized) {
    console.log(JSON.stringify(result));
  }
  if (output.code !== 0 || sanitized.some((result) => result.ok !== true)) {
    throw new VerifierHarnessError("VERIFIER_CHILD_FAILED");
  }
  return sanitized;
}

async function assertNoApplicationRows(client: pg.Client): Promise<number> {
  const tables = await client.query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = $1
       AND tablename <> '_prisma_migrations'
     ORDER BY tablename`,
    [STAGE313C_TEST_SCHEMA],
  );
  for (const { tablename } of tables.rows) {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM ${quoteIdentifier(STAGE313C_TEST_SCHEMA)}.${quoteIdentifier(tablename)}`,
    );
    if (Number(result.rows[0]?.count ?? 0) !== 0) {
      throw new VerifierHarnessError("VERIFIER_ROW_CLEANUP_INCOMPLETE");
    }
  }
  return tables.rows.length;
}

async function assertNoVerifierAdvisoryLocks(
  client: pg.Client,
): Promise<void> {
  const result = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count
     FROM pg_locks l
     JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'advisory'
       AND l.granted
       AND a.application_name = $1`,
    [STAGE313C_VERIFIER_APPLICATION_NAME],
  );
  if (Number(result.rows[0]?.count ?? 0) !== 0) {
    throw new VerifierHarnessError("VERIFIER_ADVISORY_LOCK_CLEANUP_INCOMPLETE");
  }
}

async function main() {
  const verifierName = parseVerifierName(process.argv.slice(2));
  const verifierDatabaseUrl = new URL(assertIsolatedE2eDatabase());
  verifierDatabaseUrl.searchParams.delete("schema");
  verifierDatabaseUrl.searchParams.delete("options");
  verifierDatabaseUrl.searchParams.delete("application_name");
  const verifierEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    [STAGE313C_TEST_DATABASE_URL_ENV]: verifierDatabaseUrl.toString(),
    [STAGE313C_TEST_DATABASE_APPROVED_ENV]: "true",
    [STAGE313C_TEST_SCHEMA_ENV]: STAGE313C_TEST_SCHEMA,
  };
  const approved = resolveApprovedStage313cTestDatabase(verifierEnvironment);
  const scopedDatabaseUrl =
    deriveStage313cSchemaScopedDatabaseUrl(approved);
  const repoRoot = process.cwd();
  const verifierPath = path.join(repoRoot, VERIFIERS[verifierName]);
  const coordinationLabel = `${COORDINATION_LOCK_LABEL_PREFIX}:${approved.databaseName}:${approved.schemaName}`;
  const client = new pg.Client({
    connectionString: approved.baseDatabaseUrl,
    application_name: STAGE313C_COORDINATOR_APPLICATION_NAME,
  });
  let lockAcquired = false;
  let succeeded = false;
  let protectedBefore = "";
  let verifiedTables = 0;
  let migrationHistoryRows = 0;

  try {
    await client.connect();
    const identity = await client.query<{ database_name: string }>(
      "SELECT current_database() AS database_name",
    );
    if (identity.rows[0]?.database_name !== approved.databaseName) {
      throw new VerifierHarnessError("VERIFIER_DATABASE_IDENTITY_MISMATCH");
    }

    await acquireCoordinationLock(client, coordinationLabel);
    lockAcquired = true;
    protectedBefore = await protectedSchemaFingerprint(client);
    await resetVerifierSchema(client);

    if (verifierName !== "overlay") {
      await applyMigrations(repoRoot, scopedDatabaseUrl);
      migrationHistoryRows = await assertRequiredMigrationsApplied(client);
    }

    await runVerifierChild({
      repoRoot,
      verifierPath,
      scopedDatabaseUrl,
      baseEnvironment: verifierEnvironment,
    });
    await assertVerifierSchemaMarker(client);
    verifiedTables = await assertNoApplicationRows(client);
    await assertNoVerifierAdvisoryLocks(client);
    succeeded = true;
  } finally {
    let finalizationError: unknown;
    if (lockAcquired) {
      try {
        if (!succeeded) {
          await resetVerifierSchema(client);
        }
        const protectedAfter = await protectedSchemaFingerprint(client);
        if (protectedBefore && protectedAfter !== protectedBefore) {
          throw new VerifierHarnessError("PROTECTED_SCHEMA_CHANGED");
        }
        await assertVerifierSchemaMarker(client);
        await assertNoApplicationRows(client);
        await assertNoVerifierAdvisoryLocks(client);
      } catch (error) {
        finalizationError = error;
      }
      try {
        await releaseCoordinationLock(client, coordinationLabel);
      } catch (error) {
        finalizationError ??= error;
      }
    }
    await client.end().catch(() => undefined);
    if (finalizationError) throw finalizationError;
  }

  return {
    ok: true,
    counts: {
      migrationHistoryRows,
      stage313cMigrationsVerified: REQUIRED_STAGE313C_MIGRATIONS.length,
      applicationTablesVerified: verifiedTables,
      protectedSchemasUnchanged: 1,
      coordinationLocksReleased: 1,
      fakeProviderBoundary: 1,
    },
    names: {
      schema: [STAGE313C_TEST_SCHEMA],
      verifier: [verifierName],
    },
  };
}

void main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error: unknown) => {
    process.exitCode = 1;
    const reason =
      error instanceof Stage313cTestDatabaseRefusal ||
      error instanceof VerifierHarnessError
        ? error.code
        : "VERIFIER_HARNESS_FAILED";
    console.error(
      JSON.stringify({
        ok: false,
        counts: {
          failures: 1,
          safetyRefusals:
            error instanceof Stage313cTestDatabaseRefusal ? 1 : 0,
        },
        names: { reason: [reason] },
      }),
    );
  });
