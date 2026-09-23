/**
 * Fail-closed classification of a seed database target.
 *
 * `pg` 8.22 / `pg-connection-string` 2.14 replaces the URI host and port when
 * the query string sets `host` or `port`. Seed therefore accepts no query
 * string and no fragment. The authorized host, port, and database are then
 * checked against that public parser so they are the endpoint `pg` would use.
 * Process environment mode is not an input. Disposable-name and production
 * patterns match tests/e2e/helpers/e2e-database.ts. Remote hosts are refused.
 * The canonical development database name `negotiations` is refused, including
 * preserved localhost:5432/negotiations. Keyword/value DSNs and unparseable
 * values are refused. Descriptors never include credentials.
 */

import { parse as parsePgConnectionString } from "pg-connection-string";

const LOCAL_HOST_ALIASES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const POSTGRES_PROTOCOLS = new Set(["postgresql:", "postgres:"]);
const DISPOSABLE_DB_MARKER = /(?:e2e|test|testing)/i;
const PRODUCTION_DB_PATTERN =
  /(?:^|[_-])(?:prod|production|main)(?:$|[_-])|negotaitions_prod|negotiations_prod/i;
const PRODUCTION_HOST_PATTERN =
  /(?:^|[.-])(?:prod|production|primary|master)(?:[.-]|$)|mdb\.yandexcloud|yandexcloud\.net/i;
const CANONICAL_DEVELOPMENT_DATABASE = "negotiations";
const PRESERVED_DEVELOPMENT_PORT = 5432;

export type SeedTargetDescriptor = {
  normalizedHost: string;
  port: number;
  database: string;
  databaseMasked: string;
};

type ParsedTarget = {
  host: string;
  port: number;
  database: string;
};

export function maskSeedDatabaseName(database: string): string {
  const name = database.trim();
  if (!name) return "(unknown)";
  if (name.length <= 4) return "***";
  const prefixLength = Math.min(4, Math.floor(name.length / 3));
  const suffixLength = Math.min(3, Math.floor(name.length / 4));
  return `${name.slice(0, prefixLength)}***${name.slice(-suffixLength)}`;
}

export function formatSeedTarget(descriptor: SeedTargetDescriptor): string {
  return `host=${descriptor.normalizedHost}, port=${descriptor.port}, database=${descriptor.databaseMasked}`;
}

function normalizeHost(hostname: string): string {
  const lower = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOST_ALIASES.has(lower)) return "localhost";
  return lower;
}

function refuse(message: string): never {
  throw new Error(`Refusing seed: ${message}`);
}

function parsePostgresTarget(databaseUrl: string): ParsedTarget {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    refuse("DATABASE_URL is not a parseable PostgreSQL connection URI.");
  }

  if (!POSTGRES_PROTOCOLS.has(parsed.protocol)) {
    refuse("DATABASE_URL must be a PostgreSQL connection URI.");
  }

  if (parsed.search) {
    refuse("UNSUPPORTED_QUERY_PARAMETER");
  }
  if (parsed.hash) {
    refuse("TARGET_OVERRIDE_NOT_ALLOWED");
  }

  let database: string;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, "").split("?")[0] ?? "")
      .trim()
      .toLowerCase();
  } catch {
    refuse("DATABASE_URL database name could not be read.");
  }

  if (!database || database.includes("/")) {
    refuse("DATABASE_URL must include a single database name.");
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (!host) {
    refuse("DATABASE_URL must include a database host.");
  }

  let effective: { host?: string | null; port?: string | null; database?: string | null };
  try {
    effective = parsePgConnectionString(databaseUrl);
  } catch {
    refuse("TARGET_OVERRIDE_NOT_ALLOWED");
  }

  const effectiveHost = typeof effective.host === "string" ? effective.host : "";
  const effectiveDatabase = typeof effective.database === "string" ? effective.database : "";
  if (normalizeHost(effectiveHost) !== normalizeHost(host)) {
    refuse("TARGET_OVERRIDE_NOT_ALLOWED");
  }
  if (effectiveDatabase.trim().toLowerCase() !== database) {
    refuse("TARGET_OVERRIDE_NOT_ALLOWED");
  }

  const port = agreeEffectivePort(parsed.port, effective.port ?? null);
  return { host, port, database };
}

function agreeEffectivePort(urlPort: string, parserPort: string | null): number {
  if (urlPort) {
    const port = Number(urlPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      refuse("DATABASE_URL must include a valid TCP port.");
    }
    if ((parserPort ?? "") !== urlPort) {
      refuse("TARGET_OVERRIDE_NOT_ALLOWED");
    }
    return port;
  }

  if (parserPort) {
    refuse("TARGET_OVERRIDE_NOT_ALLOWED");
  }
  const envPort = process.env.PGPORT?.trim();
  if (envPort && envPort !== "5432") {
    refuse("TARGET_OVERRIDE_NOT_ALLOWED");
  }
  return 5432;
}

function descriptorFor(target: ParsedTarget): SeedTargetDescriptor {
  return {
    normalizedHost: normalizeHost(target.host),
    port: target.port,
    database: target.database,
    databaseMasked: maskSeedDatabaseName(target.database),
  };
}

export function assertSeedDatabaseTarget(
  databaseUrl: string | undefined,
): SeedTargetDescriptor {
  const candidate = databaseUrl?.trim() ?? "";
  if (!candidate) {
    refuse("DATABASE_URL is not set.");
  }

  const target = parsePostgresTarget(candidate);
  const descriptor = descriptorFor(target);
  const where = formatSeedTarget(descriptor);

  if (
    descriptor.normalizedHost === "localhost" &&
    target.port === PRESERVED_DEVELOPMENT_PORT &&
    target.database === CANONICAL_DEVELOPMENT_DATABASE
  ) {
    refuse(
      `preserved development database localhost:5432/negotiations is not a writable seed target (${where}).`,
    );
  }

  if (PRODUCTION_HOST_PATTERN.test(target.host)) {
    refuse(`production-like database host is not a writable seed target (${where}).`);
  }

  if (PRODUCTION_DB_PATTERN.test(target.database)) {
    refuse(`production-like database name is not a writable seed target (${where}).`);
  }

  if (target.database === CANONICAL_DEVELOPMENT_DATABASE) {
    refuse(
      `canonical development database name is not a writable seed target (${where}).`,
    );
  }

  if (descriptor.normalizedHost !== "localhost") {
    refuse(`remote database host is not a writable seed target (${where}).`);
  }

  if (!DISPOSABLE_DB_MARKER.test(target.database)) {
    refuse(
      `database name is not an approved disposable seed target (${where}). Approved local seed databases contain e2e, test, or testing in the name.`,
    );
  }

  return descriptor;
}
