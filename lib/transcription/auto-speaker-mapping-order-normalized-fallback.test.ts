import assert from "node:assert/strict";
import test from "node:test";

import { decideWindowedTelemetrySelection } from "@/lib/transcription/windowed-source-selection";
import { selectTelemetrySourceForSpeakerMapping } from "@/lib/transcription/speaker-mapping-telemetry-source-selection";

function candidate(input: {
  available: boolean;
  reason: string | null;
  margin: number | null;
  coverage: Record<string, number | null>;
}) {
  return {
    available: input.available,
    reason: input.reason,
    globalAssignmentMargin: input.margin,
    selectedCoverageBySpeaker: input.coverage,
  };
}

test("cmrampp-like fixture selects ordered remote runtime path", () => {
  const speakerLabels = ["speaker_1", "speaker_2"];
  const rawSelection = selectTelemetrySourceForSpeakerMapping({
    speakerLabels,
    preferRemoteStreamTelemetry: true,
    remote: {
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: false,
      reason: "ambiguous_margin",
      mapping: {
        speaker_1: "cmramq02300455wm10mf8bvh0",
        speaker_2: "cmrampzio00445wm1bsxc75jf",
      },
      selectedCoverageBySpeaker: { speaker_1: 0.41, speaker_2: 0.39 },
      selectedMargins: { speaker_1: 0.01, speaker_2: 0.02 },
      globalAssignmentMargin: 0.025,
      blockingWarnings: [],
      hasBlockingWarnings: false,
    },
    local: {
      source: "VOXIMPLANT_MIC_ACTIVITY",
      available: false,
      reason: "ambiguous_margin",
      mapping: {
        speaker_1: "cmrampzio00445wm1bsxc75jf",
        speaker_2: "cmramq02300455wm10mf8bvh0",
      },
      selectedCoverageBySpeaker: { speaker_1: 0.4, speaker_2: 0.38 },
      selectedMargins: { speaker_1: 0.01, speaker_2: 0.01 },
      globalAssignmentMargin: 0.02,
      blockingWarnings: [],
      hasBlockingWarnings: false,
    },
  });
  const orderedSelection = selectTelemetrySourceForSpeakerMapping({
    speakerLabels,
    preferRemoteStreamTelemetry: true,
    remote: {
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: true,
      reason: null,
      mapping: {
        speaker_1: "cmrampzio00445wm1bsxc75jf",
        speaker_2: "cmramq02300455wm10mf8bvh0",
      },
      selectedCoverageBySpeaker: { speaker_1: 0.644, speaker_2: 0.727 },
      selectedMargins: { speaker_1: 0.428, speaker_2: 0.459 },
      globalAssignmentMargin: 0.893,
      blockingWarnings: [],
      hasBlockingWarnings: false,
    },
    local: {
      source: "VOXIMPLANT_MIC_ACTIVITY",
      available: false,
      reason: "low_selected_coverage",
      mapping: { speaker_1: null, speaker_2: null },
      selectedCoverageBySpeaker: { speaker_1: null, speaker_2: null },
      selectedMargins: { speaker_1: null, speaker_2: null },
      globalAssignmentMargin: null,
      blockingWarnings: [],
      hasBlockingWarnings: false,
    },
  });

  const decision = decideWindowedTelemetrySelection({
    speakerLabels,
    preferRemoteStreamTelemetry: true,
    remoteActivityRowCount: 12,
    hasPathologicalOverlap: true,
    providerWindowPathology: {
      hasPathologicalOverlap: true,
      overlapRatio: 0.47,
      conflictingSegments: [3, 6],
      reasons: ["provider_segments_overlap", "order_time_conflict"],
    },
    raw: {
      sourceSelection: rawSelection,
      remoteCandidate: candidate({
        available: false,
        reason: "ambiguous_margin",
        margin: 0.025,
        coverage: { speaker_1: 0.41, speaker_2: 0.39 },
      }),
      localCandidate: candidate({
        available: false,
        reason: "ambiguous_margin",
        margin: 0.02,
        coverage: { speaker_1: 0.4, speaker_2: 0.38 },
      }),
      remoteMapping: {
        speaker_1: "cmramq02300455wm10mf8bvh0",
        speaker_2: "cmrampzio00445wm1bsxc75jf",
      },
    },
    ordered: {
      sourceSelection: orderedSelection,
      remoteCandidate: candidate({
        available: true,
        reason: null,
        margin: 0.893,
        coverage: { speaker_1: 0.644, speaker_2: 0.727 },
      }),
      localCandidate: candidate({
        available: false,
        reason: "low_selected_coverage",
        margin: null,
        coverage: { speaker_1: null, speaker_2: null },
      }),
      remoteMapping: {
        speaker_1: "cmrampzio00445wm1bsxc75jf",
        speaker_2: "cmramq02300455wm10mf8bvh0",
      },
    },
  });

  assert.equal(decision.selectedTelemetrySource, "VOX_REMOTE_STREAM_ACTIVITY");
  assert.equal(decision.selectedWindowStrategy, "order_normalized_windows");
  assert.equal(decision.shouldApplyLike, true);
  assert.equal(decision.targetRuntimeDecision, "remote_selected");
});

test("pathology false keeps raw behavior unchanged", () => {
  const decision = decideWindowedTelemetrySelection({
    speakerLabels: ["speaker_1", "speaker_2"],
    preferRemoteStreamTelemetry: true,
    remoteActivityRowCount: 10,
    hasPathologicalOverlap: false,
    providerWindowPathology: {
      hasPathologicalOverlap: false,
      overlapRatio: 0,
      conflictingSegments: [],
      reasons: [],
    },
    raw: {
      sourceSelection: {
        selectedTelemetrySource: "NONE",
        fallbackReason: "no_reliable_telemetry_source",
        sourceDecisionSummary: "raw manual",
        targetRuntimeDecision: "manual_review",
      },
      remoteCandidate: candidate({
        available: false,
        reason: "ambiguous_margin",
        margin: 0.03,
        coverage: { speaker_1: 0.4, speaker_2: 0.39 },
      }),
      localCandidate: candidate({
        available: false,
        reason: "ambiguous_margin",
        margin: 0.02,
        coverage: { speaker_1: 0.39, speaker_2: 0.38 },
      }),
      remoteMapping: { speaker_1: "A", speaker_2: "B" },
    },
    ordered: {
      sourceSelection: {
        selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
        fallbackReason: null,
        sourceDecisionSummary: "ordered strong",
        targetRuntimeDecision: "remote_selected",
      },
      remoteCandidate: candidate({
        available: true,
        reason: null,
        margin: 0.8,
        coverage: { speaker_1: 0.7, speaker_2: 0.7 },
      }),
      localCandidate: candidate({
        available: false,
        reason: "low_selected_coverage",
        margin: null,
        coverage: { speaker_1: null, speaker_2: null },
      }),
      remoteMapping: { speaker_1: "B", speaker_2: "A" },
    },
  });

  assert.equal(decision.selectedWindowStrategy, "provider_raw_windows");
  assert.equal(decision.selectedTelemetrySource, "NONE");
});

test("ordered conflict without material strength keeps manual review", () => {
  const decision = decideWindowedTelemetrySelection({
    speakerLabels: ["speaker_1", "speaker_2"],
    preferRemoteStreamTelemetry: true,
    remoteActivityRowCount: 10,
    hasPathologicalOverlap: true,
    providerWindowPathology: {
      hasPathologicalOverlap: true,
      overlapRatio: 0.41,
      conflictingSegments: [1, 2],
      reasons: ["provider_segments_overlap"],
    },
    raw: {
      sourceSelection: {
        selectedTelemetrySource: "NONE",
        fallbackReason: "no_reliable_telemetry_source",
        sourceDecisionSummary: "raw manual",
        targetRuntimeDecision: "manual_review",
      },
      remoteCandidate: candidate({
        available: false,
        reason: "ambiguous_margin",
        margin: 0.15,
        coverage: { speaker_1: 0.55, speaker_2: 0.56 },
      }),
      localCandidate: candidate({
        available: false,
        reason: "ambiguous_margin",
        margin: 0.1,
        coverage: { speaker_1: 0.53, speaker_2: 0.54 },
      }),
      remoteMapping: { speaker_1: "A", speaker_2: "B" },
    },
    ordered: {
      sourceSelection: {
        selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
        fallbackReason: null,
        sourceDecisionSummary: "ordered candidate",
        targetRuntimeDecision: "remote_selected",
      },
      remoteCandidate: candidate({
        available: true,
        reason: null,
        margin: 0.18,
        coverage: { speaker_1: 0.58, speaker_2: 0.57 },
      }),
      localCandidate: candidate({
        available: false,
        reason: "incomplete_mapping",
        margin: null,
        coverage: { speaker_1: null, speaker_2: null },
      }),
      remoteMapping: { speaker_1: "B", speaker_2: "A" },
    },
  });

  assert.equal(decision.selectedWindowStrategy, "provider_raw_windows");
  assert.equal(decision.selectedTelemetrySource, "NONE");
});

test("raw low_margin reason still promotes to ordered when ordered is strong", () => {
  const decision = decideWindowedTelemetrySelection({
    speakerLabels: ["speaker_1", "speaker_2"],
    preferRemoteStreamTelemetry: true,
    remoteActivityRowCount: 12,
    hasPathologicalOverlap: true,
    providerWindowPathology: {
      hasPathologicalOverlap: true,
      overlapRatio: 0.463,
      conflictingSegments: [3, 6],
      reasons: [
        "provider_segments_overlap",
        "order_time_conflict",
        "long_segment_crosses_turn_boundary",
      ],
    },
    raw: {
      sourceSelection: {
        selectedTelemetrySource: "NONE",
        fallbackReason: "no_reliable_telemetry_source",
        sourceDecisionSummary: "Neither remote nor local telemetry produced a safe unambiguous mapping.",
        targetRuntimeDecision: "manual_review",
      },
      remoteCandidate: candidate({
        available: false,
        reason: "low_margin_review_required",
        margin: 0.059,
        coverage: { speaker_1: 0.42, speaker_2: 0.4 },
      }),
      localCandidate: candidate({
        available: false,
        reason: "low_margin_review_required",
        margin: 0.03,
        coverage: { speaker_1: 0.35, speaker_2: 0.33 },
      }),
      remoteMapping: {
        speaker_1: "cmramq02300455wm10mf8bvh0",
        speaker_2: "cmrampzio00445wm1bsxc75jf",
      },
    },
    ordered: {
      sourceSelection: {
        selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
        fallbackReason: null,
        sourceDecisionSummary: "Remote telemetry produced a complete safe mapping.",
        targetRuntimeDecision: "remote_selected",
      },
      remoteCandidate: candidate({
        available: true,
        reason: "high_confidence_prefilled",
        margin: 0.893,
        coverage: { speaker_1: 0.644, speaker_2: 0.727 },
      }),
      localCandidate: candidate({
        available: false,
        reason: "low_selected_coverage",
        margin: null,
        coverage: { speaker_1: null, speaker_2: null },
      }),
      remoteMapping: {
        speaker_1: "cmrampzio00445wm1bsxc75jf",
        speaker_2: "cmramq02300455wm10mf8bvh0",
      },
    },
  });

  assert.equal(decision.selectedTelemetrySource, "VOX_REMOTE_STREAM_ACTIVITY");
  assert.equal(decision.selectedWindowStrategy, "order_normalized_windows");
  assert.equal(decision.shouldApplyLike, true);
  assert.equal(decision.targetRuntimeDecision, "remote_selected");
});
