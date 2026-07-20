/**
 * Local DATABASE_URL safety gates for POC temporary entity writes.
 * Never prints credentials.
 */

export type SanitizedDatabaseTarget = {
  host: string;
  port: number | null;
  database: string;
  sanitizedUrl: string;
};

export type LocalDbSafetyErrorCode =
  | "UNSAFE_DATABASE_TARGET"
  | "LOCAL_DB_WRITE_CONFIRMATION_REQUIRED"
  | "DATABASE_URL_MISSING"
  | "DATABASE_URL_INVALID";

export class LocalDbSafetyError extends Error {
  readonly code: LocalDbSafetyErrorCode;

  constructor(code: LocalDbSafetyErrorCode, message: string) {
    super(message);
    this.name = "LocalDbSafetyError";
    this.code = code;
  }
}

const SAFE_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
]);

/** Known production / non-local database names that must never be mutated by POC. */
const UNSAFE_DATABASE_NAMES = new Set([
  "negotiations_prod",
  "negotiations-production",
  "production",
  "prod",
]);

export function parseDatabaseUrl(databaseUrl: string): SanitizedDatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new LocalDbSafetyError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL could not be parsed.",
    );
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new LocalDbSafetyError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL must use postgres/postgresql scheme.",
    );
  }

  const host = (parsed.hostname || "").toLowerCase();
  const port = parsed.port ? Number(parsed.port) : 5432;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, "")).trim();

  if (!host || !database) {
    throw new LocalDbSafetyError(
      "DATABASE_URL_INVALID",
      "DATABASE_URL is missing host or database name.",
    );
  }

  return {
    host,
    port: Number.isFinite(port) ? port : null,
    database,
    sanitizedUrl: `postgres://${host}:${Number.isFinite(port) ? port : "?"}/${database}`,
  };
}

export function assertSafeLocalDatabaseTarget(
  databaseUrl: string | null | undefined,
): SanitizedDatabaseTarget {
  if (!databaseUrl?.trim()) {
    throw new LocalDbSafetyError(
      "DATABASE_URL_MISSING",
      "DATABASE_URL is required before any POC local DB write.",
    );
  }

  const target = parseDatabaseUrl(databaseUrl.trim());

  if (!SAFE_LOCAL_HOSTS.has(target.host)) {
    throw new LocalDbSafetyError(
      "UNSAFE_DATABASE_TARGET",
      `Refusing non-local database host (${target.host}).`,
    );
  }

  const dbLower = target.database.toLowerCase();
  if (UNSAFE_DATABASE_NAMES.has(dbLower) || dbLower.includes("prod")) {
    throw new LocalDbSafetyError(
      "UNSAFE_DATABASE_TARGET",
      `Refusing unsafe database name (${target.database}).`,
    );
  }

  return target;
}

export function assertLocalDbWriteConfirmation(confirmed: boolean): void {
  if (!confirmed) {
    throw new LocalDbSafetyError(
      "LOCAL_DB_WRITE_CONFIRMATION_REQUIRED",
      "Full mode requires --confirm-local-db-write in addition to --confirm-live-poc.",
    );
  }
}
