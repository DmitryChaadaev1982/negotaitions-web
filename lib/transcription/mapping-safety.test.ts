import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMappingSafety,
  evaluateTelemetryQuality,
} from "@/lib/transcription/mapping-safety";

test("safe one-to-one mapping remains safe", () => {
  const result = evaluateMappingSafety({
    rawSpeakerLabels: ["speaker_1", "speaker_2"],
    participantIds: ["A", "B"],
    mapping: {
      speaker_1: "A",
      speaker_2: "B",
    },
    mode: "multi_device",
  });

  assert.equal(result.safe, true);
  assert.equal(result.distinctMappedParticipantCount, 2);
  assert.deepEqual(result.duplicateParticipantIds, []);
});

test("many-to-one mapping is rejected for multi-participant sessions", () => {
  const result = evaluateMappingSafety({
    rawSpeakerLabels: ["speaker_1", "speaker_2"],
    participantIds: ["A", "B"],
    mapping: {
      speaker_1: "A",
      speaker_2: "A",
    },
    mode: "multi_device",
  });

  assert.equal(result.safe, false);
  assert.equal(result.reason, "many_to_one_mapping_in_multi_participant_session");
  assert.equal(result.distinctMappedParticipantCount, 1);
  assert.deepEqual(result.duplicateParticipantIds, ["A"]);
});

test("single-device many-to-one still requires manual review", () => {
  const result = evaluateMappingSafety({
    rawSpeakerLabels: ["speaker_1", "speaker_2"],
    participantIds: ["A", "B"],
    mapping: {
      speaker_1: "A",
      speaker_2: "A",
    },
    mode: "single_device",
  });

  assert.equal(result.safe, false);
  assert.equal(result.reason, "many_to_one_requires_manual_review_single_device");
});

test("telemetry one-sided emits coverage and low-activity warnings", () => {
  const quality = evaluateTelemetryQuality({
    rowsByParticipant: { A: 27, B: 0 },
    durationByParticipantMs: { A: 62000, B: 0 },
    avgIntervalMs: { A: 2300, B: null },
    medianIntervalMs: { A: 1900, B: null },
    shortIntervalCount: 3,
    mergedIntervalCount: 8,
    participantCount: 2,
    hasOffsets: false,
    hasAbsoluteTimestamps: true,
  });

  assert.ok(quality.warnings.includes("missing_participant_coverage"));
  assert.ok(quality.warnings.includes("participant_low_activity"));
  assert.ok(quality.warnings.includes("offsets_missing_fallback_absolute_time"));
});

test("telemetry imbalanced emits telemetry_imbalanced warning", () => {
  const quality = evaluateTelemetryQuality({
    rowsByParticipant: { A: 27, B: 2 },
    durationByParticipantMs: { A: 61000, B: 1500 },
    avgIntervalMs: { A: 2260, B: 1250 },
    medianIntervalMs: { A: 1900, B: 1100 },
    shortIntervalCount: 4,
    mergedIntervalCount: 12,
    participantCount: 2,
    hasOffsets: false,
    hasAbsoluteTimestamps: true,
  });

  assert.ok(quality.warnings.includes("telemetry_imbalanced"));
  assert.equal(quality.participantCoverage, 2);
  assert.equal(quality.totalRows, 29);
});

test("row imbalance alone does not mark telemetry one-sided", () => {
  const quality = evaluateTelemetryQuality({
    rowsByParticipant: { A: 27, B: 2 },
    durationByParticipantMs: { A: 46000, B: 35000 },
    avgIntervalMs: { A: 1700, B: 17500 },
    medianIntervalMs: { A: 1400, B: 17300 },
    shortIntervalCount: 1,
    mergedIntervalCount: 9,
    participantCount: 2,
    hasOffsets: false,
    hasAbsoluteTimestamps: true,
  });

  assert.ok(quality.warnings.includes("row_imbalance_high"));
  assert.ok(!quality.warnings.includes("duration_imbalance_high"));
  assert.ok(!quality.warnings.includes("telemetry_imbalanced"));
});
