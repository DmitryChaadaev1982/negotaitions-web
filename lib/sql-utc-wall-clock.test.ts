import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@/app/generated/prisma/client";
import { sqlUtcWallClockNow, sqlUtcWallClockOrDate } from "@/lib/sql-utc-wall-clock";

test("sqlUtcWallClockNow emits CURRENT_TIMESTAMP AT TIME ZONE UTC", () => {
  const fragment = sqlUtcWallClockNow();
  assert.equal(fragment.strings.join("?"), "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')");
});

test("sqlUtcWallClockOrDate prefers explicit Date binding when provided", () => {
  const frozen = new Date("2026-07-29T19:33:25.910Z");
  const fragment = sqlUtcWallClockOrDate(frozen);
  assert.notEqual(
    fragment.strings.join("?"),
    "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')",
  );
  assert.ok(fragment.values.includes(frozen));
});

test("sqlUtcWallClockOrDate falls back to UTC wall-clock SQL", () => {
  const fragment = sqlUtcWallClockOrDate();
  assert.equal(
    Prisma.sql`${fragment}`.strings.join("?"),
    sqlUtcWallClockNow().strings.join("?"),
  );
});
