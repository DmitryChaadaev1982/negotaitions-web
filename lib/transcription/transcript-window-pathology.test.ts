import assert from "node:assert/strict";
import test from "node:test";

import { detectTranscriptWindowPathology } from "@/lib/transcription/transcript-window-pathology";

test("detects cross-speaker overlap", () => {
  const result = detectTranscriptWindowPathology([
    { orderIndex: 1, speakerLabel: "speaker_1", startMs: 0, endMs: 8000 },
    { orderIndex: 2, speakerLabel: "speaker_2", startMs: 2000, endMs: 9000 },
  ]);

  assert.equal(result.hasPathologicalOverlap, true);
  assert.equal(result.reasons.includes("provider_segments_overlap"), true);
});

test("detects order/time conflict", () => {
  const result = detectTranscriptWindowPathology([
    { orderIndex: 1, speakerLabel: "speaker_1", startMs: 1000, endMs: 5000 },
    { orderIndex: 2, speakerLabel: "speaker_2", startMs: 2500, endMs: 2600 },
  ]);

  assert.equal(result.reasons.includes("order_time_conflict"), true);
});

test("does not flag clean diarization", () => {
  const result = detectTranscriptWindowPathology([
    { orderIndex: 1, speakerLabel: "speaker_1", startMs: 0, endMs: 2000 },
    { orderIndex: 2, speakerLabel: "speaker_2", startMs: 2200, endMs: 5000 },
    { orderIndex: 3, speakerLabel: "speaker_1", startMs: 5200, endMs: 7000 },
  ]);

  assert.equal(result.hasPathologicalOverlap, false);
  assert.deepEqual(result.reasons, []);
});
