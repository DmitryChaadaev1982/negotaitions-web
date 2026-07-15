import "dotenv/config";

const LOCAL_HOST_ALIASES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const POSTGRES_PROTOCOLS = new Set(["postgresql:", "postgres:"]);
const TEST_DB_MARKER = /(?:e2e|test|testing)/i;
const PRODUCTION_DB_PATTERN =
  /(?:^|[_-])(?:prod|production|main)(?:$|[_-])|negotaitions_prod|negotiations_prod/i;
const PRODUCTION_HOST_PATTERN =
  /(?:^|[.-])(?:prod|production|primary|master)(?:[.-]|$)|mdb\.yandexcloud|yandexcloud\.net/i;
const DEVELOPMENT_DB_NAME = /^negotiations$/i;

export type E2eDatabaseDescriptor = {
  host: string;
  normalizedHost: string;
  port: number;
  database: string;
  hostClass: "local" | "remote";
  databaseMasked: string;
};

export type ConnectionTuple = {
  host: string;
  port: number;
  database: string;
};

function normalizeHost(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  if (LOCAL_HOST_ALIASES.has(lower)) {
    return "localhost";
  }
  return lower;
}

function isLocalHost(hostname: string): boolean {
  return LOCAL_HOST_ALIASES.has(hostname.trim().toLowerCase());
}

export function maskDatabaseName(database: string): string {
  const name = database.trim();
  if (!name) {
    return "(unknown)";
  }
  if (name.length <= 4) {
    return "***";
  }
  const prefixLength = Math.min(4, Math.floor(name.length / 3));
  const suffixLength = Math.min(3, Math.floor(name.length / 4));
  return `${name.slice(0, prefixLength)}***${name.slice(-suffixLength)}`;
}

export function maskCredentialsInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "***";
    }
    if (parsed.username) {
      parsed.username = "***";
    }
    return parsed.toString();
  } catch {
    return "(invalid-url)";
  }
}

export function parsePostgresConnectionTuple(databaseUrl: string): ConnectionTuple {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error(
      "Database URL must be a valid PostgreSQL connection string (postgresql://...).",
    );
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(
      `Database URL must use the postgresql:// protocol (received ${parsed.protocol || "unknown"}).`,
    );
  }

  const database = parsed.pathname.replace(/^\//, "").split("?")[0]?.trim().toLowerCase();
  if (!database) {
    throw new Error("Database URL must include a database name in the path.");
  }

  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("Database URL must include a valid TCP port.");
  }

  return {
    host: parsed.hostname.toLowerCase(),
    port,
    database,
  };
}

function formatDescriptor(descriptor: E2eDatabaseDescriptor): string {
  return `hostClass=${descriptor.hostClass}, host=${descriptor.normalizedHost}, port=${descriptor.port}, database=${descriptor.databaseMasked}`;
}

function assertE2eTargetSafety(tuple: ConnectionTuple): void {
  const { host, port, database } = tuple;
  const normalizedHost = normalizeHost(host);
  const hostClass: "local" | "remote" = isLocalHost(host) ? "local" : "remote";
  const databaseMasked = maskDatabaseName(database);
  const descriptor = formatDescriptor({
    host,
    normalizedHost,
    port,
    database,
    hostClass,
    databaseMasked,
  });

  if (DEVELOPMENT_DB_NAME.test(database) && normalizedHost === "localhost" && port === 5432) {
    throw new Error(
      `Refusing development database negotiations on localhost:5432 (${descriptor}). Point E2E_DATABASE_URL to the dedicated E2E database (e.g. localhost:5433/negotiations_e2e).`,
    );
  }

  if (PRODUCTION_HOST_PATTERN.test(host)) {
    throw new Error(
      `Refusing production-like E2E database host (${descriptor}). Use a dedicated local or CI test database.`,
    );
  }

  if (PRODUCTION_DB_PATTERN.test(database)) {
    throw new Error(
      `Refusing production-like E2E database name (${descriptor}). Use a dedicated test database with an e2e/test marker.`,
    );
  }

  if (!TEST_DB_MARKER.test(database)) {
    throw new Error(
      `Refusing E2E database without test marker in name (${descriptor}). Database name must contain e2e, test, or testing.`,
    );
  }

  if (hostClass === "remote" && process.env.E2E_ALLOW_REMOTE_DATABASE !== "1") {
    throw new Error(
      `Refusing remote E2E database by default (${descriptor}). Use a local test database or set E2E_ALLOW_REMOTE_DATABASE=1 for an explicit CI opt-in.`,
    );
  }
}

function connectionTuplesEqual(left: ConnectionTuple, right: ConnectionTuple): boolean {
  return (
    normalizeHost(left.host) === normalizeHost(right.host) &&
    left.port === right.port &&
    left.database === right.database
  );
}

export function resolveE2eDatabaseUrl(): string {
  const raw = process.env.E2E_DATABASE_URL?.trim();
  if (!raw) {
    throw new Error(
      "E2E_DATABASE_URL is required for Playwright tests. Set E2E_DATABASE_URL to a dedicated test database (e.g. localhost:5433/negotiations_e2e). DATABASE_URL and TEST_DATABASE_URL are not accepted.",
    );
  }

  const tuple = parsePostgresConnectionTuple(raw);
  assertE2eTargetSafety(tuple);
  return raw;
}

export function getSanitizedE2eDatabaseDescriptor(databaseUrl?: string): E2eDatabaseDescriptor {
  const resolved = databaseUrl ?? resolveE2eDatabaseUrl();
  const tuple = parsePostgresConnectionTuple(resolved);
  const normalizedHost = normalizeHost(tuple.host);

  return {
    host: tuple.host,
    normalizedHost,
    port: tuple.port,
    database: tuple.database,
    hostClass: isLocalHost(tuple.host) ? "local" : "remote",
    databaseMasked: maskDatabaseName(tuple.database),
  };
}

export function getDevelopmentDatabaseDescriptor(): E2eDatabaseDescriptor | null {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    return null;
  }

  const tuple = parsePostgresConnectionTuple(raw);
  const normalizedHost = normalizeHost(tuple.host);

  return {
    host: tuple.host,
    normalizedHost,
    port: tuple.port,
    database: tuple.database,
    hostClass: isLocalHost(tuple.host) ? "local" : "remote",
    databaseMasked: maskDatabaseName(tuple.database),
  };
}

export function assertIsolatedE2eDatabase(): string {
  const e2eUrl = resolveE2eDatabaseUrl();
  const developmentUrl = process.env.DATABASE_URL?.trim();

  if (developmentUrl && e2eUrl === developmentUrl) {
    throw new Error(
      "E2E_DATABASE_URL must not equal DATABASE_URL. Use a dedicated E2E database such as localhost:5433/negotiations_e2e.",
    );
  }

  if (developmentUrl) {
    const e2eTuple = parsePostgresConnectionTuple(e2eUrl);
    const developmentTuple = parsePostgresConnectionTuple(developmentUrl);

    if (connectionTuplesEqual(e2eTuple, developmentTuple)) {
      const e2eDescriptor = getSanitizedE2eDatabaseDescriptor(e2eUrl);
      const developmentDescriptor = getDevelopmentDatabaseDescriptor();
      throw new Error(
        `E2E_DATABASE_URL must not target the same host, port, and database as DATABASE_URL (e2e=${formatDescriptor(e2eDescriptor)}, development=${developmentDescriptor ? formatDescriptor(developmentDescriptor) : "unknown"}).`,
      );
    }
  }

  return e2eUrl;
}

export function buildE2eServerEnvironment(
  overrides: Record<string, string> = {},
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const e2eUrl = assertIsolatedE2eDatabase();
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  env.E2E_DATABASE_URL = e2eUrl;
  env.DATABASE_URL = e2eUrl;
  Object.assign(env, overrides);
  return env;
}

export function isE2eDatabaseConfigured(): boolean {
  return Boolean(process.env.E2E_DATABASE_URL?.trim());
}
