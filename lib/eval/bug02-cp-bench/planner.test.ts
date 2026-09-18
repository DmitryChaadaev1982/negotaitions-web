import assert from "node:assert/strict";
import test from "node:test";

import { expectedWaves, planChunks, resolveCharBoundSegmentCap } from "./planner";
import { createBenchWorkload } from "./workloads";

test("char-bound segment cap lets larger char envelopes reduce L chunk count", () => {
  const large = createBenchWorkload("L");
  const at700 = planChunks(large, 700);
  const at2500 = planChunks(large, 2500);
  assert.equal(at700.overlappingTargetIndexes.length, 0);
  assert.equal(at2500.overlappingTargetIndexes.length, 0);
  assert.ok(at700.chunkCount > at2500.chunkCount);
  assert.equal(resolveCharBoundSegmentCap(700), 7);
  assert.equal(resolveCharBoundSegmentCap(2500), 25);
});

test("expected waves match concurrency partitioning", () => {
  assert.equal(expectedWaves(18, 4), 5);
  assert.equal(expectedWaves(6, 6), 1);
});
