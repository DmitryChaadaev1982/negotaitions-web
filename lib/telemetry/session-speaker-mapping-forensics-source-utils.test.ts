import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_SOURCE_SCENARIOS,
  evaluateRemoteSourceRecommendation,
  evaluateTargetRuntimeTelemetrySelection,
} from "../../scripts/debug/session-speaker-mapping-forensics-source-utils.mjs";

test("required source-aware scenarios are declared", () => {
  assert.deepEqual(REQUIRED_SOURCE_SCENARIOS, [
    "current_runtime",
    "local_mic_only",
    "remote_stream_only",
    "local_mic_order_normalized_windows",
    "remote_stream_order_normalized_windows",
    "target_order_normalized_runtime",
    "combined_naive",
    "combined_deduplicated",
  ]);
});

test("remote source can be recommended when local fails and remote is complete", () => {
  const recommendations = evaluateRemoteSourceRecommendation({
    currentRuntime: { shouldApply: false },
    localMicOnly: {
      shouldApply: false,
      globalMargin: 0.05,
      selectedCoverageBySpeaker: { speaker_1: 0.2, speaker_2: 0.2 },
    },
    remoteStreamOnly: {
      mapping: { speaker_1: "sp_a", speaker_2: "sp_b" },
      activityRows: 12,
      globalMargin: 0.35,
      selectedCoverageBySpeaker: { speaker_1: 0.81, speaker_2: 0.79 },
    },
    speakerLabels: ["speaker_1", "speaker_2"],
  });

  assert.ok(recommendations.includes("REMOTE_STREAM_SOURCE_WOULD_HELP"));
  assert.ok(!recommendations.includes("KEEP_LOCAL_FALLBACK"));
});

test("local fallback is kept when remote source is incomplete", () => {
  const recommendations = evaluateRemoteSourceRecommendation({
    currentRuntime: { shouldApply: false },
    localMicOnly: {
      shouldApply: false,
      globalMargin: 0.12,
      selectedCoverageBySpeaker: { speaker_1: 0.4, speaker_2: 0.3 },
    },
    remoteStreamOnly: {
      mapping: { speaker_1: "sp_a", speaker_2: "sp_a" },
      activityRows: 8,
      globalMargin: 0.2,
      selectedCoverageBySpeaker: { speaker_1: 0.6, speaker_2: 0.5 },
    },
    speakerLabels: ["speaker_1", "speaker_2"],
  });

  assert.ok(recommendations.includes("KEEP_LOCAL_FALLBACK"));
  assert.ok(!recommendations.includes("REMOTE_STREAM_SOURCE_WOULD_HELP"));
});

test("target runtime summary uses unified ordered-window decision", () => {
  const result = evaluateTargetRuntimeTelemetrySelection({
    localMicOnly: {
      selectedMapping: { speaker_1: "sp_a", speaker_2: "sp_b" },
      selectedCoverageBySpeaker: { speaker_1: 0.35, speaker_2: 0.34 },
      globalMargin: 0.05,
      shouldApplyLike: false,
      reason: "low_margin_review_required",
    },
    remoteStreamOnly: {
      selectedMapping: { speaker_1: "sp_b", speaker_2: "sp_a" },
      selectedCoverageBySpeaker: { speaker_1: 0.39, speaker_2: 0.38 },
      globalMargin: 0.03,
      shouldApplyLike: false,
      reason: "low_margin_review_required",
      activityRows: 12,
    },
    speakerLabels: ["speaker_1", "speaker_2"],
    providerWindowPathology: {
      hasPathologicalOverlap: true,
      overlapRatio: 0.44,
      conflictingSegments: [3, 6],
      reasons: ["provider_segments_overlap", "order_time_conflict"],
    },
    ordered: {
      sourceSelection: {
        selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
        fallbackReason: null,
        sourceDecisionSummary: "Order-normalized scenario replay.",
        targetRuntimeDecision: "remote_selected",
      },
      remoteCandidate: {
        available: true,
        reason: null,
        globalAssignmentMargin: 0.89,
        selectedCoverageBySpeaker: { speaker_1: 0.64, speaker_2: 0.73 },
      },
      localCandidate: {
        available: false,
        reason: "low_selected_coverage",
        globalAssignmentMargin: null,
        selectedCoverageBySpeaker: { speaker_1: null, speaker_2: null },
      },
      remoteMapping: {
        speaker_1: "sp_a",
        speaker_2: "sp_b",
      },
    },
  });

  assert.equal(result.selectedTelemetrySource, "VOX_REMOTE_STREAM_ACTIVITY");
  assert.equal(result.selectedWindowStrategy, "order_normalized_windows");
  assert.equal(result.targetRuntimeDecision, "remote_selected");
  assert.equal(result.wouldAutoApplyWithTargetLogic, true);
  assert.notEqual(result.fallbackReason, "no_reliable_telemetry_source");
  assert.equal(result.orderedWindowRejectionReason, null);
});

test("target runtime returns explicit ordered rejection reason", () => {
  const result = evaluateTargetRuntimeTelemetrySelection({
    localMicOnly: {
      selectedMapping: { speaker_1: null, speaker_2: null },
      selectedCoverageBySpeaker: { speaker_1: null, speaker_2: null },
      globalMargin: null,
      shouldApplyLike: false,
      reason: "low_margin_review_required",
    },
    remoteStreamOnly: {
      selectedMapping: { speaker_1: "sp_a", speaker_2: "sp_b" },
      selectedCoverageBySpeaker: { speaker_1: 0.3, speaker_2: 0.31 },
      globalMargin: 0.02,
      shouldApplyLike: false,
      reason: "low_margin_review_required",
      activityRows: 8,
    },
    speakerLabels: ["speaker_1", "speaker_2"],
    providerWindowPathology: {
      hasPathologicalOverlap: true,
      overlapRatio: 0.5,
      conflictingSegments: [1, 2],
      reasons: ["provider_segments_overlap"],
    },
    ordered: {
      sourceSelection: {
        selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
        fallbackReason: null,
        sourceDecisionSummary: "Order-normalized scenario replay.",
        targetRuntimeDecision: "remote_selected",
      },
      remoteCandidate: {
        available: true,
        reason: null,
        globalAssignmentMargin: 0.03,
        selectedCoverageBySpeaker: { speaker_1: 0.31, speaker_2: 0.32 },
      },
      localCandidate: {
        available: false,
        reason: "low_selected_coverage",
        globalAssignmentMargin: null,
        selectedCoverageBySpeaker: { speaker_1: null, speaker_2: null },
      },
      remoteMapping: {
        speaker_1: "sp_b",
        speaker_2: "sp_a",
      },
    },
  });

  assert.equal(result.selectedTelemetrySource, "NONE");
  assert.equal(
    result.orderedWindowRejectionReason,
    "ordered_not_materially_stronger",
  );
});
