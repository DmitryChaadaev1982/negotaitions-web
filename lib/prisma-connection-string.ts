/**
 * Connection-string helpers for the Prisma PostgreSQL adapter.
 *
 * PostgreSQL accepts two connection-string forms: a `postgresql://` /
 * `postgres://` URI and a libpq keyword/value DSN (`host=... dbname=...`).
 * Only the URI form can carry a `schema` query parameter, and only the URI form
 * is parsable by `new URL()`. A keyword/value DSN must therefore never turn
 * schema extraction into a startup failure — the underlying PostgreSQL client
 * keeps owning schema resolution in that case.
 *
 * These helpers never log, return, or embed the connection string.
 */

const POSTGRESQL_URI_PROTOCOLS = new Set(["postgresql:", "postgres:"]);

/**
 * Explicit Prisma schema override carried by a PostgreSQL connection string.
 *
 * Returns `undefined` when no override applies, which includes a URI without
 * `schema`, a libpq keyword/value DSN, and any value `new URL()` cannot parse.
 */
export function extractPrismaSchema(
  connectionString: string,
): string | undefined {
  const candidate = connectionString.trim();
  if (!candidate) return undefined;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (!POSTGRESQL_URI_PROTOCOLS.has(url.protocol)) return undefined;

  const schema = url.searchParams.get("schema")?.trim();
  return schema ? schema : undefined;
}
