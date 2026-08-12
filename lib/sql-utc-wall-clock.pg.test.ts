import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";

import { decideFinishRoomLifecycle } from "@/lib/session-room-occupancy-policy";
import { evaluateDebriefAutoCloseEligibility } from "@/lib/session-room-occupancy-policy";
import { RoomLifecycle } from "@/app/generated/prisma/client";
import {
  assertIsolatedE2eDatabase,
  isE2eDatabaseConfigured,
} from "../tests/e2e/helpers/e2e-database";

/**
 * Dual-timezone PostgreSQL regression for the Stage 3.10 occupancy clock bug.
 * Requires E2E_DATABASE_URL. DATABASE_URL is deliberately not accepted so this
 * regression cannot run against the normal development database.
 */
function resolveDbUrl(): string | null {
  if (!isE2eDatabaseConfigured()) return null;
  return assertIsolatedE2eDatabase();
}

async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = resolveDbUrl();
  if (!url) {
    test.skip("PostgreSQL URL not configured for dual-TZ occupancy tests");
    // unreachable for typechecker
    throw new Error("skip");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function probeLeaseComparisons(client: pg.Client, timeZone: string) {
  await client.query(`SET TIME ZONE '${timeZone}'`);
  const result = await client.query<{
    tz: string;
    expires_gt_now: boolean;
    expires_gt_utc_wall: boolean;
  }>(`
    SELECT
      current_setting('TimeZone') AS tz,
      (((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '2 minutes') > NOW())
        AS expires_gt_now,
      (((CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '2 minutes')
        > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AS expires_gt_utc_wall
  `);
  return result.rows[0];
}

test("UTC wall-clock lease comparison is stable under UTC and Europe/Moscow", async () => {
  if (!resolveDbUrl()) {
    test.skip("PostgreSQL URL not configured for dual-TZ occupancy tests");
    return;
  }

  await withClient(async (client) => {
    const utc = await probeLeaseComparisons(client, "UTC");
    const msk = await probeLeaseComparisons(client, "Europe/Moscow");

    assert.equal(utc.tz, "UTC");
    assert.equal(msk.tz, "Europe/Moscow");

    // Defect signature: NOW() flips under MSK; UTC wall-clock stays true in both.
    assert.equal(utc.expires_gt_now, true);
    assert.equal(utc.expires_gt_utc_wall, true);
    assert.equal(msk.expires_gt_now, false);
    assert.equal(msk.expires_gt_utc_wall, true);

    assert.equal(
      decideFinishRoomLifecycle({
        effectiveLifecycle: RoomLifecycle.OPEN,
        hardClose: false,
        activeConnectionCount: utc.expires_gt_utc_wall ? 1 : 0,
      }),
      RoomLifecycle.DEBRIEF_OPEN,
    );
    assert.equal(
      decideFinishRoomLifecycle({
        effectiveLifecycle: RoomLifecycle.OPEN,
        hardClose: false,
        activeConnectionCount: msk.expires_gt_utc_wall ? 1 : 0,
      }),
      RoomLifecycle.DEBRIEF_OPEN,
    );
    assert.equal(
      decideFinishRoomLifecycle({
        effectiveLifecycle: RoomLifecycle.OPEN,
        hardClose: false,
        activeConnectionCount: msk.expires_gt_now ? 1 : 0,
      }),
      RoomLifecycle.DEBRIEF_OPEN,
    );
  });
});

test("updatedAt UTC wall-clock write is timezone-stable", async () => {
  if (!resolveDbUrl()) {
    test.skip("PostgreSQL URL not configured for dual-TZ occupancy tests");
    return;
  }

  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`
        CREATE TEMP TABLE tz_updated_at_probe (
          id text PRIMARY KEY,
          "updatedAt" timestamp without time zone NOT NULL
        ) ON COMMIT DROP
      `);

      const id = randomUUID();
      await client.query(`SET TIME ZONE 'Europe/Moscow'`);
      await client.query(
        `INSERT INTO tz_updated_at_probe(id, "updatedAt")
         VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))`,
        [id],
      );
      const mskWrite = await client.query<{ updatedAt: Date }>(
        `SELECT "updatedAt" FROM tz_updated_at_probe WHERE id = $1`,
        [id],
      );

      await client.query(`SET TIME ZONE 'UTC'`);
      await client.query(
        `UPDATE tz_updated_at_probe
         SET "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
         WHERE id = $1`,
        [id],
      );
      const utcWrite = await client.query<{
        updatedAt: Date;
        matches_utc_wall: boolean;
      }>(
        `SELECT "updatedAt",
                ABS(EXTRACT(EPOCH FROM ("updatedAt" - (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')))) < 2
                  AS matches_utc_wall
         FROM tz_updated_at_probe WHERE id = $1`,
        [id],
      );

      assert.ok(mskWrite.rows[0]?.updatedAt);
      assert.equal(utcWrite.rows[0]?.matches_utc_wall, true);

      // Contrast: bare NOW() under MSK would store local wall-clock into timestamp w/o tz.
      await client.query(`SET TIME ZONE 'Europe/Moscow'`);
      const contrast = await client.query<{
        now_as_naive_local: Date;
        utc_wall: Date;
        differ: boolean;
      }>(`
        SELECT
          NOW()::timestamp AS now_as_naive_local,
          (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AS utc_wall,
          (NOW()::timestamp IS DISTINCT FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AS differ
      `);
      assert.equal(contrast.rows[0]?.differ, true);
    } finally {
      await client.query("ROLLBACK");
    }
  });
});

test("grace eligibility remains pure JS Date math across TZ labels", () => {
  const now = new Date("2026-07-29T19:33:54.910Z");
  const lastInvalidatedAt = new Date("2026-07-29T19:33:25.910Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    activeConnectionCount: 0,
    debriefOpenedAt: new Date("2026-07-29T19:30:00.000Z"),
    lastInvalidatedAt,
    now,
    graceMs: 30_000,
  });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "grace_period_active");
  assert.equal(eligibility.graceRemainingMs, 1_000);
});
