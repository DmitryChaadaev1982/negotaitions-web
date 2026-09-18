import assert from "node:assert/strict";
import test from "node:test";

import { loadEnvConfig } from "@next/env";

import { requirePgDatabase } from "../../test-helpers/pg-test-gate";
import { inspectBenchSafety } from "./env-safety";
import { runD1PersistenceStress } from "./d1-persistence";

loadEnvConfig(process.cwd());

test("D1 persistence stress keeps namespaces on isolated E2E DB", async (t) => {
  const safety = inspectBenchSafety();
  const ready = requirePgDatabase(t, {
    databaseReady: safety.e2eIsolated && !safety.productionLikeRefused,
    unavailableReason: safety.blockReason ?? "E2E isolated database is not configured",
  });
  if (!ready) return;

  const result = await runD1PersistenceStress({ burstWriters: 6, xlChunkCount: 24 });
  assert.equal(result.lostMapping, false);
  assert.equal(result.lostSibling, false);
  assert.equal(result.interruptedReadable, true);
  assert.equal(result.staleSnapshotLostChunk, true);
  assert.deepEqual(result.lostChunks, []);
  assert.ok(result.xlJsonBytes > 0);
  // D1_REJECT is a stress failure, never an accepted outcome.
  assert.equal(result.decision, "D1_PASS");
});
