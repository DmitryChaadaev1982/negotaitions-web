import assert from "node:assert/strict";
import test from "node:test";

import { applyPauseSegmentProcessingMode } from "@/lib/transcription/pause-segment-processing";

type Segment = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
};

const SAMPLE_SEGMENTS: Segment[] = [
  { id: "active-a", startSeconds: 1, endSeconds: 4, text: "active-a" },
  { id: "paused-mid", startSeconds: 10, endSeconds: 12, text: "paused-mid" },
  { id: "active-b", startSeconds: 20, endSeconds: 24, text: "active-b" },
];

const PAUSE_OFFSETS = [{ startSeconds: 9, endSeconds: 15 }];

test("source_audio_cut bypasses transcript interval filtering", () => {
  const result = applyPauseSegmentProcessingMode(
    "source_audio_cut",
    SAMPLE_SEGMENTS,
    PAUSE_OFFSETS,
  );
  assert.deepEqual(
    result.keptSegments.map((segment) => segment.id),
    ["active-a", "paused-mid", "active-b"],
  );
  assert.equal(result.droppedSegments.length, 0);
  assert.equal(result.diagnostics.filteredSegmentCount, 0);
});

test("transcript_interval_filter applies legacy pause segment filtering", () => {
  const result = applyPauseSegmentProcessingMode(
    "transcript_interval_filter",
    SAMPLE_SEGMENTS,
    PAUSE_OFFSETS,
  );
  assert.deepEqual(
    result.keptSegments.map((segment) => segment.id),
    ["active-a", "active-b"],
  );
  assert.deepEqual(
    result.droppedSegments.map((segment) => segment.id),
    ["paused-mid"],
  );
  assert.equal(result.diagnostics.filteredSegmentCount, 1);
  assert.equal(result.diagnostics.fullyPausedDroppedCount, 1);
});
