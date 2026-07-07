import assert from "node:assert/strict";
import test from "node:test";

import { shouldApplyOrderNormalizedWindowStrategy } from "@/lib/transcription/order-normalized-window-selection";
import {
  selectTelemetrySourceForSpeakerMapping,
  type TelemetrySourceCandidate,
} from "@/lib/transcription/speaker-mapping-telemetry-source-selection";

function candidate(
  input: Partial<TelemetrySourceCandidate> & Pick<TelemetrySourceCandidate, "source">,
): TelemetrySourceCandidate {
  return {
    source: input.source,
    available: input.available ?? true,
    reason: input.reason ?? null,
    mapping: input.mapping ?? { speaker_1: "A", speaker_2: "B" },
    selectedCoverageBySpeaker:
      input.selectedCoverageBySpeaker ?? { speaker_1: 0.6, speaker_2: 0.6 },
    selectedMargins: input.selectedMargins ?? { speaker_1: 0.2, speaker_2: 0.2 },
    globalAssignmentMargin: input.globalAssignmentMargin ?? 0.2,
    blockingWarnings: input.blockingWarnings ?? [],
    hasBlockingWarnings: input.hasBlockingWarnings ?? false,
  };
}

test("order-normalized fallback applies for pathological low-margin remote raw windows", () => {
  const speakerLabels = ["speaker_1", "speaker_2"];
  const rawRemote = candidate({
    source: "VOX_REMOTE_STREAM_ACTIVITY",
    available: false,
    reason: "ambiguous_margin",
    mapping: { speaker_1: "cmramq02300455wm10mf8bvh0", speaker_2: "cmrampzio00445wm1bsxc75jf" },
    selectedCoverageBySpeaker: { speaker_1: 0.41, speaker_2: 0.39 },
    selectedMargins: { speaker_1: 0.01, speaker_2: 0.02 },
    globalAssignmentMargin: 0.03,
  });
  const rawLocal = candidate({
    source: "VOXIMPLANT_MIC_ACTIVITY",
    available: false,
    reason: "ambiguous_margin",
    mapping: { speaker_1: "cmrampzio00445wm1bsxc75jf", speaker_2: "cmramq02300455wm10mf8bvh0" },
    selectedCoverageBySpeaker: { speaker_1: 0.4, speaker_2: 0.38 },
    selectedMargins: { speaker_1: 0.01, speaker_2: 0.01 },
    globalAssignmentMargin: 0.02,
  });
  const orderedRemote = candidate({
    source: "VOX_REMOTE_STREAM_ACTIVITY",
    available: true,
    mapping: { speaker_1: "cmrampzio00445wm1bsxc75jf", speaker_2: "cmramq02300455wm10mf8bvh0" },
    selectedCoverageBySpeaker: { speaker_1: 0.64, speaker_2: 0.73 },
    selectedMargins: { speaker_1: 0.42, speaker_2: 0.46 },
    globalAssignmentMargin: 0.55,
  });
  const orderedLocal = candidate({
    source: "VOXIMPLANT_MIC_ACTIVITY",
    available: false,
    reason: "low_selected_coverage",
  });

  const rawSelection = selectTelemetrySourceForSpeakerMapping({
    speakerLabels,
    preferRemoteStreamTelemetry: true,
    remote: rawRemote,
    local: rawLocal,
  });
  const orderedSelection = selectTelemetrySourceForSpeakerMapping({
    speakerLabels,
    preferRemoteStreamTelemetry: true,
    remote: orderedRemote,
    local: orderedLocal,
  });

  const shouldApply = shouldApplyOrderNormalizedWindowStrategy({
    rawSourceSelection: rawSelection,
    orderedSourceSelection: orderedSelection,
    rawRemoteCandidate: rawRemote,
    orderedRemoteCandidate: orderedRemote,
    rawRemoteMapping: rawRemote.mapping,
    orderedRemoteMapping: orderedRemote.mapping,
    speakerLabels,
    preferRemoteStreamTelemetry: true,
    remoteActivityRowCount: 12,
    hasPathologicalOverlap: true,
  });

  assert.equal(shouldApply, true);
});

test("does not apply order-normalized fallback when ordered result is unsafe", () => {
  const speakerLabels = ["speaker_1", "speaker_2"];
  const rawSelection = {
    selectedTelemetrySource: "NONE",
    fallbackReason: "no_reliable_telemetry_source",
    sourceDecisionSummary: "manual",
    targetRuntimeDecision: "manual_review",
  } as const;
  const orderedSelection = {
    selectedTelemetrySource: "NONE",
    fallbackReason: "no_reliable_telemetry_source",
    sourceDecisionSummary: "manual",
    targetRuntimeDecision: "manual_review",
  } as const;
  const shouldApply = shouldApplyOrderNormalizedWindowStrategy({
    rawSourceSelection: rawSelection,
    orderedSourceSelection: orderedSelection,
    rawRemoteCandidate: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: false,
      reason: "ambiguous_margin",
    }),
    orderedRemoteCandidate: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: false,
      reason: "many_to_one_mapping",
      mapping: { speaker_1: "A", speaker_2: "A" },
    }),
    rawRemoteMapping: { speaker_1: "A", speaker_2: "B" },
    orderedRemoteMapping: { speaker_1: "A", speaker_2: "A" },
    speakerLabels,
    preferRemoteStreamTelemetry: true,
    remoteActivityRowCount: 10,
    hasPathologicalOverlap: true,
  });

  assert.equal(shouldApply, false);
});

test("raw success keeps provider window strategy preferred", () => {
  const shouldApply = shouldApplyOrderNormalizedWindowStrategy({
    rawSourceSelection: {
      selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
      fallbackReason: null,
      sourceDecisionSummary: "remote selected",
      targetRuntimeDecision: "remote_selected",
    },
    orderedSourceSelection: {
      selectedTelemetrySource: "VOX_REMOTE_STREAM_ACTIVITY",
      fallbackReason: null,
      sourceDecisionSummary: "remote selected",
      targetRuntimeDecision: "remote_selected",
    },
    rawRemoteCandidate: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: true,
      reason: null,
    }),
    orderedRemoteCandidate: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: true,
      reason: null,
    }),
    rawRemoteMapping: { speaker_1: "A", speaker_2: "B" },
    orderedRemoteMapping: { speaker_1: "A", speaker_2: "B" },
    speakerLabels: ["speaker_1", "speaker_2"],
    preferRemoteStreamTelemetry: true,
    remoteActivityRowCount: 10,
    hasPathologicalOverlap: true,
  });

  assert.equal(shouldApply, false);
});
