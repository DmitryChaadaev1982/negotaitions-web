import { Prisma } from "@/app/generated/prisma/client";

/**
 * UTC wall-clock "now" as `timestamp without time zone`.
 *
 * Prisma DateTime columns in this schema are stored as
 * `timestamp without time zone` using the JS/UTC wall-clock convention.
 * Comparing those columns to PostgreSQL `NOW()`/`CURRENT_TIMESTAMP`
 * (timestamptz interpreted in the session TimeZone) is unsafe when the DB
 * TimeZone is not UTC — production uses Europe/Moscow.
 *
 * Use this expression only when reading/writing/comparing against
 * Prisma DateTime columns that follow the UTC wall-clock convention.
 */
export function sqlUtcWallClockNow(): Prisma.Sql {
  return Prisma.sql`(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
}

/**
 * Prefer an explicit JS Date (also UTC wall-clock via Prisma binding) when a
 * caller needs a frozen decision clock; otherwise use the SQL UTC wall-clock.
 */
export function sqlUtcWallClockOrDate(now?: Date): Prisma.Sql {
  if (now) {
    return Prisma.sql`${now}`;
  }
  return sqlUtcWallClockNow();
}
