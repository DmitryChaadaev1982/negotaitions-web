import assert from "node:assert/strict";
import test from "node:test";

import { decideAutoMappingApplication } from "@/lib/transcription/mapping-decision";
import { evaluateMappingSafety } from "@/lib/transcription/mapping-safety";

test("production-like 27-vs-2 scenario never auto-applies collapsed mapping", () => {
  const oldCollapsedCandidate = {
    speaker_1: "A",
    speaker_2: "A",
  };

  const safety = evaluateMappingSafety({
    mapping: oldCollapsedCandidate,
    rawSpeakerLabels: ["speaker_1", "speaker_2"],
    participantIds: ["A", "B"],
    mode: "unknown",
  });

  const decision = decideAutoMappingApplication({
    allSpeakersCovered: true,
    highConfidence: true,
    weakMargin: false,
    mappingSafetySafe: safety.safe,
    mappingSafetyReason: safety.reason,
    rawSpeakerCount: 2,
    expectedParticipantCount: 2,
    activeParticipantsDuringRecording: 2,
    hasOffsets: true,
    hasDerivedOffsets: false,
    telemetryWarnings: ["telemetry_imbalanced"],
  });

  assert.equal(safety.safe, false);
  assert.equal(
    safety.reason,
    "many_to_one_mapping_in_multi_participant_session",
  );
  assert.equal(decision.shouldApply, false);
  assert.equal(decision.reason, "many_to_one_mapping_in_multi_participant_session");
});

test("auto-apply is blocked when only one participant has recording-window coverage", () => {
  const decision = decideAutoMappingApplication({
    allSpeakersCovered: true,
    highConfidence: true,
    weakMargin: false,
    mappingSafetySafe: true,
    mappingSafetyReason: null,
    rawSpeakerCount: 2,
    expectedParticipantCount: 2,
    activeParticipantsDuringRecording: 1,
    hasOffsets: true,
    hasDerivedOffsets: false,
    telemetryWarnings: [],
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.reason, "telemetry_coverage_review_required");
});

test("derived offsets still allow safe auto-apply", () => {
  const decision = decideAutoMappingApplication({
    allSpeakersCovered: true,
    highConfidence: true,
    weakMargin: false,
    mappingSafetySafe: true,
    mappingSafetyReason: null,
    rawSpeakerCount: 2,
    expectedParticipantCount: 2,
    activeParticipantsDuringRecording: 2,
    hasOffsets: false,
    hasDerivedOffsets: true,
    telemetryWarnings: [],
  });

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.reason, "high_confidence_prefilled");
});
