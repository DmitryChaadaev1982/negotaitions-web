import assert from "node:assert/strict";
import test from "node:test";

import { scoreEnhancementQuality } from "./quality";
import { createBenchWorkload } from "./workloads";

test("quality scorer accepts exact index-preserving lexical cleanup", () => {
  const workload = createBenchWorkload("S");
  const result = scoreEnhancementQuality({
    original: workload.segments,
    result: {
      segments: workload.segments.map((segment) => ({
        index: segment.index,
        cleanedText: segment.originalText.replace(/\s+/g, " ").trim(),
      })),
      globalWarnings: [],
      meta: {
        mode: "chunked",
        model: "bench",
        overallStatus: "COMPLETED",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        totalLatencyMs: 1,
        originalSegmentCount: workload.segmentCount,
        originalCharacterCount: workload.charCount,
        chunkCount: 1,
        concurrency: 1,
        successfulChunkCount: 1,
        failedChunkCount: 0,
        fallbackSegmentCount: 0,
        changedSegmentCount: 0,
        unchangedSegmentCount: workload.segmentCount,
        retryCount: 0,
        perChunk: [],
        originalWordCount: 1,
        enhancedWordCount: 1,
        addedWordEstimate: 0,
        removedWordEstimate: 0,
        schemaChunkCount: 1,
      },
    },
  });
  assert.equal(result.verdict, "PASS");
  assert.equal(result.noLoss, true);
});

test("quality scorer rejects missing indexes and emptied text", () => {
  const workload = createBenchWorkload("S");
  const result = scoreEnhancementQuality({
    original: workload.segments,
    result: {
      segments: [
        { index: workload.segments[0].index, cleanedText: "" },
      ],
      globalWarnings: [],
      meta: {
        mode: "chunked",
        model: "bench",
        overallStatus: "PARTIAL",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        totalLatencyMs: 1,
        originalSegmentCount: workload.segmentCount,
        originalCharacterCount: workload.charCount,
        chunkCount: 1,
        concurrency: 1,
        successfulChunkCount: 0,
        failedChunkCount: 1,
        fallbackSegmentCount: 1,
        changedSegmentCount: 0,
        unchangedSegmentCount: 0,
        retryCount: 0,
        perChunk: [],
        originalWordCount: 1,
        enhancedWordCount: 0,
        addedWordEstimate: 0,
        removedWordEstimate: 1,
      },
    },
  });
  assert.equal(result.verdict, "REJECT");
  assert.ok(result.rejectReasons.includes("segment_loss"));
  assert.ok(result.rejectReasons.includes("target_index_error"));
});
