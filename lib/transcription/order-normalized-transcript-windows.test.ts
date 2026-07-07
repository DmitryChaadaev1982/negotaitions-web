import assert from "node:assert/strict";
import test from "node:test";

import { buildOrderNormalizedTranscriptWindows } from "@/lib/transcription/order-normalized-transcript-windows";

test("non-overlapping segments remain unchanged", () => {
  const windows = buildOrderNormalizedTranscriptWindows([
    { orderIndex: 1, speakerLabel: "speaker_1", startMs: 0, endMs: 1000 },
    { orderIndex: 2, speakerLabel: "speaker_2", startMs: 1200, endMs: 2200 },
  ]);

  assert.equal(windows[0]?.scoringStartMs, 0);
  assert.equal(windows[0]?.scoringEndMs, 1000);
  assert.equal(windows[0]?.adjustmentReason, "none");
  assert.equal(windows[1]?.scoringStartMs, 1200);
  assert.equal(windows[1]?.scoringEndMs, 2200);
  assert.equal(windows[1]?.adjustmentReason, "none");
});

test("overlapping next segment is shifted after previous scoring end", () => {
  const windows = buildOrderNormalizedTranscriptWindows([
    { orderIndex: 1, speakerLabel: "speaker_1", startMs: 1000, endMs: 5000 },
    { orderIndex: 2, speakerLabel: "speaker_2", startMs: 3000, endMs: 7000 },
  ]);

  assert.equal(windows[1]?.scoringStartMs, 5000);
  assert.equal(windows[1]?.scoringEndMs, 7000);
  assert.match(windows[1]?.adjustmentReason ?? "", /shifted_for_order_overlap/);
});

test("long segment starting before previous end is corrected", () => {
  const windows = buildOrderNormalizedTranscriptWindows([
    { orderIndex: 1, speakerLabel: "speaker_2", startMs: 3540, endMs: 33820 },
    { orderIndex: 2, speakerLabel: "speaker_1", startMs: 8920, endMs: 57079 },
  ]);

  assert.equal(windows[1]?.scoringStartMs, 33820);
  assert.equal(windows[1]?.scoringEndMs, 57079);
  assert.equal((windows[1]?.durationMs ?? 0) > 0, true);
});

test("zero or negative adjusted duration is kept and flagged safely", () => {
  const windows = buildOrderNormalizedTranscriptWindows([
    { orderIndex: 1, speakerLabel: "speaker_1", startMs: 0, endMs: 1000 },
    { orderIndex: 2, speakerLabel: "speaker_2", startMs: 200, endMs: 800 },
  ]);

  assert.equal(windows[1]?.scoringStartMs, 1000);
  assert.equal(windows[1]?.scoringEndMs, 1000);
  assert.equal(windows[1]?.durationMs, 0);
  assert.match(windows[1]?.adjustmentReason ?? "", /zero_duration_clamped/);
});
