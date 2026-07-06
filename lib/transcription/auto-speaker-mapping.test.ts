import assert from "node:assert/strict";
import test from "node:test";

import { selectOneToOneMappingFromScoreMatrix } from "@/lib/transcription/auto-speaker-mapping-core";

test("selectOneToOneMappingFromScoreMatrix evaluates global one-to-one assignments", () => {
  const result = selectOneToOneMappingFromScoreMatrix(
    ["speaker_1", "speaker_2"],
    ["A", "B"],
    {
      speaker_1: {
        A: { overlapMs: 1000, speakerDurationMs: 5000, coverage: 0.35 },
        B: { overlapMs: 900, speakerDurationMs: 5000, coverage: 0.34 },
      },
      speaker_2: {
        A: { overlapMs: 400, speakerDurationMs: 5000, coverage: 0.08 },
        B: { overlapMs: 1700, speakerDurationMs: 5000, coverage: 0.34 },
      },
    },
  );

  assert.deepEqual(result.mapping, {
    speaker_1: "A",
    speaker_2: "B",
  });
  assert.equal(result.confidence.speaker_1, 0.35);
  assert.equal(result.confidence.speaker_2, 0.34);
  assert.equal(result.margins.speaker_1, 0.01);
  assert.equal(result.margins.speaker_2, 0.26);
});

test("selectOneToOneMappingFromScoreMatrix does not assign one participant twice", () => {
  const result = selectOneToOneMappingFromScoreMatrix(
    ["speaker_1", "speaker_2"],
    ["A", "B"],
    {
      speaker_1: {
        A: { overlapMs: 2000, speakerDurationMs: 5000, coverage: 0.4 },
        B: { overlapMs: 250, speakerDurationMs: 5000, coverage: 0.05 },
      },
      speaker_2: {
        A: { overlapMs: 1900, speakerDurationMs: 5000, coverage: 0.38 },
        B: { overlapMs: 1700, speakerDurationMs: 5000, coverage: 0.34 },
      },
    },
  );

  assert.equal(result.mapping.speaker_1, "A");
  assert.equal(result.mapping.speaker_2, "B");
  assert.notEqual(result.mapping.speaker_1, result.mapping.speaker_2);
});
