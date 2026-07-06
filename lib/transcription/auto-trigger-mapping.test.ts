import assert from "node:assert/strict";
import test from "node:test";

import { decideAutoMappingApplication } from "@/lib/transcription/mapping-decision";
import { evaluateMappingSafety } from "@/lib/transcription/mapping-safety";
import {
  computeGlobalAssignmentMargin,
  shouldAllowGlobalMarginOverride,
} from "@/lib/transcription/auto-trigger-mapping-core";

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

test("global margin override allows 2x2 auto-apply despite one weak per-speaker margin", () => {
  const margin = computeGlobalAssignmentMargin({
    speakerLabels: ["speaker_1", "speaker_2"],
    participantIds: ["A", "B"],
    scoreMatrix: {
      speaker_1: {
        A: { coverage: 0.174 },
        B: { coverage: 0.118 },
      },
      speaker_2: {
        A: { coverage: 0.084 },
        B: { coverage: 0.262 },
      },
    },
  });
  assert.equal(margin.margin, 0.234);

  const overridden = shouldAllowGlobalMarginOverride({
    weakMargin: true,
    speakerLabelCount: 2,
    participantCandidateCount: 2,
    allSpeakersCovered: true,
    mappingSafetySafe: true,
    globalAssignmentMargin: margin.margin,
    selectedCoverageBySpeaker: {
      speaker_1: 0.17,
      speaker_2: 0.26,
    },
    telemetryQuality: {
      participantCoverage: 2,
      participantCount: 2,
      rowsByParticipant: { A: 8, B: 6 },
      durationByParticipantMs: { A: 8133, B: 10299 },
      avgIntervalMs: { A: 4067, B: 5150 },
      medianIntervalMs: { A: 4067, B: 5150 },
      shortIntervalCount: 0,
      mergedIntervalCount: 10,
      totalRows: 14,
      imbalanceByRows: 0.57,
      imbalanceByDuration: 0.56,
      hasOffsets: true,
      hasDerivedOffsets: true,
      alignmentMode: "offsets",
      activeParticipantsDuringRecording: 2,
      outsideRecordingWindowRows: 4,
      warnings: [
        "intervals_merged",
        "derived_offsets",
        "activity_outside_recording_window",
      ],
    },
  });
  assert.equal(overridden, true);

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
    hasDerivedOffsets: true,
    telemetryWarnings: [
      "intervals_merged",
      "derived_offsets",
      "activity_outside_recording_window",
    ],
  });
  assert.equal(decision.shouldApply, true);
  assert.equal(decision.reason, "high_confidence_prefilled");
});

test("symmetric 2x2 evidence keeps low-margin review", () => {
  const margin = computeGlobalAssignmentMargin({
    speakerLabels: ["speaker_1", "speaker_2"],
    participantIds: ["A", "B"],
    scoreMatrix: {
      speaker_1: {
        A: { coverage: 0.22 },
        B: { coverage: 0.21 },
      },
      speaker_2: {
        A: { coverage: 0.2 },
        B: { coverage: 0.21 },
      },
    },
  });
  assert.equal(margin.margin, 0.02);

  const overridden = shouldAllowGlobalMarginOverride({
    weakMargin: true,
    speakerLabelCount: 2,
    participantCandidateCount: 2,
    allSpeakersCovered: true,
    mappingSafetySafe: true,
    globalAssignmentMargin: margin.margin,
    selectedCoverageBySpeaker: { speaker_1: 0.22, speaker_2: 0.21 },
    telemetryQuality: {
      participantCoverage: 2,
      participantCount: 2,
      rowsByParticipant: { A: 6, B: 6 },
      durationByParticipantMs: { A: 9000, B: 9100 },
      avgIntervalMs: { A: 1400, B: 1450 },
      medianIntervalMs: { A: 1300, B: 1400 },
      shortIntervalCount: 0,
      mergedIntervalCount: 0,
      totalRows: 12,
      imbalanceByRows: 0.5,
      imbalanceByDuration: 0.5,
      hasOffsets: true,
      hasDerivedOffsets: false,
      alignmentMode: "offsets",
      activeParticipantsDuringRecording: 2,
      outsideRecordingWindowRows: 0,
      warnings: [],
    },
  });
  assert.equal(overridden, false);
});

test("near-zero selected speaker evidence keeps review required", () => {
  const overridden = shouldAllowGlobalMarginOverride({
    weakMargin: true,
    speakerLabelCount: 2,
    participantCandidateCount: 2,
    allSpeakersCovered: true,
    mappingSafetySafe: true,
    globalAssignmentMargin: 0.25,
    selectedCoverageBySpeaker: {
      speaker_1: 0.05,
      speaker_2: 0.34,
    },
    telemetryQuality: {
      participantCoverage: 2,
      participantCount: 2,
      rowsByParticipant: { A: 8, B: 7 },
      durationByParticipantMs: { A: 9000, B: 10500 },
      avgIntervalMs: { A: 1500, B: 1700 },
      medianIntervalMs: { A: 1200, B: 1600 },
      shortIntervalCount: 0,
      mergedIntervalCount: 0,
      totalRows: 15,
      imbalanceByRows: 0.53,
      imbalanceByDuration: 0.54,
      hasOffsets: true,
      hasDerivedOffsets: false,
      alignmentMode: "offsets",
      activeParticipantsDuringRecording: 2,
      outsideRecordingWindowRows: 0,
      warnings: [],
    },
  });
  assert.equal(overridden, false);
});

test("incomplete participant coverage keeps review required", () => {
  const overridden = shouldAllowGlobalMarginOverride({
    weakMargin: true,
    speakerLabelCount: 2,
    participantCandidateCount: 2,
    allSpeakersCovered: true,
    mappingSafetySafe: true,
    globalAssignmentMargin: 0.25,
    selectedCoverageBySpeaker: {
      speaker_1: 0.2,
      speaker_2: 0.25,
    },
    telemetryQuality: {
      participantCoverage: 1,
      participantCount: 2,
      rowsByParticipant: { A: 9, B: 0 },
      durationByParticipantMs: { A: 12000, B: 0 },
      avgIntervalMs: { A: 1300, B: null },
      medianIntervalMs: { A: 1200, B: null },
      shortIntervalCount: 0,
      mergedIntervalCount: 0,
      totalRows: 9,
      imbalanceByRows: 1,
      imbalanceByDuration: 1,
      hasOffsets: true,
      hasDerivedOffsets: false,
      alignmentMode: "offsets",
      activeParticipantsDuringRecording: 1,
      outsideRecordingWindowRows: 0,
      warnings: ["missing_participant_coverage", "no_activity_for_participant"],
    },
  });
  assert.equal(overridden, false);
});

test("speaker/participant count mismatch keeps review required", () => {
  const overridden = shouldAllowGlobalMarginOverride({
    weakMargin: true,
    speakerLabelCount: 3,
    participantCandidateCount: 2,
    allSpeakersCovered: false,
    mappingSafetySafe: true,
    globalAssignmentMargin: 0.25,
    selectedCoverageBySpeaker: {
      speaker_1: 0.2,
      speaker_2: 0.21,
      speaker_3: 0.19,
    },
    telemetryQuality: {
      participantCoverage: 2,
      participantCount: 2,
      rowsByParticipant: { A: 10, B: 9 },
      durationByParticipantMs: { A: 10000, B: 9800 },
      avgIntervalMs: { A: 1300, B: 1200 },
      medianIntervalMs: { A: 1200, B: 1100 },
      shortIntervalCount: 0,
      mergedIntervalCount: 0,
      totalRows: 19,
      imbalanceByRows: 0.53,
      imbalanceByDuration: 0.51,
      hasOffsets: true,
      hasDerivedOffsets: false,
      alignmentMode: "offsets",
      activeParticipantsDuringRecording: 2,
      outsideRecordingWindowRows: 0,
      warnings: [],
    },
  });
  assert.equal(overridden, false);
});

test("many-to-one safety failure prevents override in two-speaker session", () => {
  const safety = evaluateMappingSafety({
    mapping: {
      speaker_1: "A",
      speaker_2: "A",
    },
    rawSpeakerLabels: ["speaker_1", "speaker_2"],
    participantIds: ["A", "B"],
    mode: "unknown",
  });
  assert.equal(safety.safe, false);

  const overridden = shouldAllowGlobalMarginOverride({
    weakMargin: true,
    speakerLabelCount: 2,
    participantCandidateCount: 2,
    allSpeakersCovered: true,
    mappingSafetySafe: safety.safe,
    globalAssignmentMargin: 0.3,
    selectedCoverageBySpeaker: {
      speaker_1: 0.25,
      speaker_2: 0.21,
    },
    telemetryQuality: {
      participantCoverage: 2,
      participantCount: 2,
      rowsByParticipant: { A: 9, B: 8 },
      durationByParticipantMs: { A: 11000, B: 9500 },
      avgIntervalMs: { A: 1400, B: 1350 },
      medianIntervalMs: { A: 1300, B: 1300 },
      shortIntervalCount: 0,
      mergedIntervalCount: 0,
      totalRows: 17,
      imbalanceByRows: 0.53,
      imbalanceByDuration: 0.53,
      hasOffsets: true,
      hasDerivedOffsets: false,
      alignmentMode: "offsets",
      activeParticipantsDuringRecording: 2,
      outsideRecordingWindowRows: 2,
      warnings: ["activity_outside_recording_window"],
    },
  });

  assert.equal(overridden, false);
});
