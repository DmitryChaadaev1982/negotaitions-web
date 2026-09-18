import assert from "node:assert/strict";
import test from "node:test";

import { selectPerJobConcurrency, selectPhaseAPolicies } from "./run";
import type { LiveRunSummary } from "./types";

function run(partial: Partial<LiveRunSummary> & Pick<LiveRunSummary, "maxChars" | "concurrency" | "workloadId">): LiveRunSummary {
  return {
    phase: "A",
    runId: "t",
    chunkCount: 7,
    successfulChunkCount: 7,
    failedChunkCount: 0,
    fallbackSegmentCount: 0,
    retryCount: 0,
    overallStatus: "COMPLETED",
    wallClockMs: 12000,
    quality: {
      verdict: "PASS",
      schemaValid: true,
      indexPreservation: true,
      noLoss: true,
      missingIndexes: [],
      extraIndexes: [],
      emptyReplacements: [],
      catastrophicShrinkCount: 0,
      expansionAnomalyCount: 0,
      changedSegmentCount: 0,
      unchangedSegmentCount: 1,
      medianLengthRatio: 1,
      obviousDistortion: [],
      rejectReasons: [],
    },
    providerCalls: [],
    http429: 0,
    http5xx: 0,
    networkFailures: 0,
    callLatencyMs: [9000],
    actualInputTokens: 1,
    actualOutputTokens: 1,
    actualTotalTokens: 2,
    configuredMaxTokensSeen: 100,
    tokensUsedEqualsConfiguredCap: false,
    maxSegments: 18,
    ...partial,
  };
}

test("Phase A selection rejects 700 and prefers a passing larger envelope", () => {
  const selected = selectPhaseAPolicies([
    run({ phase: "A", workloadId: "L", maxChars: 700, concurrency: 4, quality: {
      ...run({ workloadId: "L", maxChars: 700, concurrency: 4 }).quality,
      verdict: "REJECT",
      rejectReasons: ["obvious_lexical_distortion"],
    }, fallbackSegmentCount: 6 }),
    run({ phase: "A", workloadId: "L", maxChars: 1800, concurrency: 4, chunkCount: 7 }),
    run({ phase: "A", workloadId: "L", maxChars: 2500, concurrency: 4, chunkCount: 5 }),
    run({ phase: "A", workloadId: "M", maxChars: 700, concurrency: 4 }),
    run({ phase: "A", workloadId: "M", maxChars: 1800, concurrency: 4, chunkCount: 4 }),
    run({ phase: "A", workloadId: "M", maxChars: 2500, concurrency: 4, chunkCount: 3 }),
  ]);
  assert.ok(!selected.includes(700));
  assert.ok(selected.includes(2500) || selected.includes(1800));
});

test("per-job selection keeps 8 when it is healthy and XL-tested, not unused 12", () => {
  const selected = selectPerJobConcurrency([
    run({ phase: "B", workloadId: "L", maxChars: 1800, concurrency: 4 }),
    run({ phase: "B", workloadId: "L", maxChars: 1800, concurrency: 8, wallClockMs: 11000 }),
    run({ phase: "B", workloadId: "L", maxChars: 1800, concurrency: 12, wallClockMs: 10000, chunkCount: 7 }),
    run({ phase: "B", workloadId: "XL", maxChars: 1800, concurrency: 4, chunkCount: 20 }),
    run({ phase: "B", workloadId: "XL", maxChars: 1800, concurrency: 8, chunkCount: 20, wallClockMs: 30000 }),
  ]);
  assert.equal(selected, 8);
});
