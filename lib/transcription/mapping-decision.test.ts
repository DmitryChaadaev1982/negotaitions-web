import assert from "node:assert/strict";
import test from "node:test";

import { decideAutoMappingApplication } from "@/lib/transcription/mapping-decision";

test("returns low_margin_review_required when weak margin is present", () => {
  const decision = decideAutoMappingApplication({
    allSpeakersCovered: true,
    highConfidence: true,
    weakMargin: true,
    mappingSafetySafe: true,
    mappingSafetyReason: null,
    rawSpeakerCount: 2,
    expectedParticipantCount: 2,
    activeParticipantsDuringRecording: 2,
    hasOffsets: true,
    hasDerivedOffsets: false,
    telemetryWarnings: [],
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.reason, "low_margin_review_required");
});

test("returns speaker_count_mismatch when speakers exceed participants", () => {
  const decision = decideAutoMappingApplication({
    allSpeakersCovered: false,
    highConfidence: true,
    weakMargin: false,
    mappingSafetySafe: true,
    mappingSafetyReason: null,
    rawSpeakerCount: 3,
    expectedParticipantCount: 2,
    activeParticipantsDuringRecording: 2,
    hasOffsets: true,
    hasDerivedOffsets: false,
    telemetryWarnings: [],
  });

  assert.equal(decision.shouldApply, false);
  assert.equal(decision.reason, "speaker_count_mismatch_review_required");
});

test("returns high_confidence_prefilled when all gates pass", () => {
  const decision = decideAutoMappingApplication({
    allSpeakersCovered: true,
    highConfidence: true,
    weakMargin: false,
    mappingSafetySafe: true,
    mappingSafetyReason: null,
    rawSpeakerCount: 2,
    expectedParticipantCount: 2,
    activeParticipantsDuringRecording: 2,
    hasOffsets: true,
    hasDerivedOffsets: false,
    telemetryWarnings: [],
  });

  assert.equal(decision.shouldApply, true);
  assert.equal(decision.reason, "high_confidence_prefilled");
});
