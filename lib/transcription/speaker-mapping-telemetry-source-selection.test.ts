import assert from "node:assert/strict";
import test from "node:test";

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
    mapping: input.mapping ?? { speaker_1: "A" },
    selectedCoverageBySpeaker: input.selectedCoverageBySpeaker ?? { speaker_1: 0.7 },
    selectedMargins: input.selectedMargins ?? { speaker_1: 0.3 },
    globalAssignmentMargin: input.globalAssignmentMargin ?? 0.3,
    blockingWarnings: input.blockingWarnings ?? [],
    hasBlockingWarnings: input.hasBlockingWarnings ?? false,
  };
}

test("remote healthy source is selected first", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({ source: "VOX_REMOTE_STREAM_ACTIVITY" }),
    local: candidate({ source: "VOXIMPLANT_MIC_ACTIVITY" }),
  });
  assert.equal(result.selectedTelemetrySource, "VOX_REMOTE_STREAM_ACTIVITY");
});

test("remote unavailable falls back to local", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: false,
      reason: "no_audio_activity",
    }),
    local: candidate({ source: "VOXIMPLANT_MIC_ACTIVITY" }),
  });
  assert.equal(result.selectedTelemetrySource, "VOXIMPLANT_MIC_ACTIVITY");
  assert.equal(result.targetRuntimeDecision, "local_fallback_selected");
});

test("remote unhealthy source falls back to local", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: false,
      reason: "telemetry_imbalanced",
      hasBlockingWarnings: true,
      blockingWarnings: ["telemetry_imbalanced"],
    }),
    local: candidate({ source: "VOXIMPLANT_MIC_ACTIVITY" }),
  });
  assert.equal(result.selectedTelemetrySource, "VOXIMPLANT_MIC_ACTIVITY");
});

test("conflicting valid sources require clear remote quality winner", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      mapping: { speaker_1: "A" },
      selectedCoverageBySpeaker: { speaker_1: 0.8 },
      globalAssignmentMargin: 0.35,
    }),
    local: candidate({
      source: "VOXIMPLANT_MIC_ACTIVITY",
      mapping: { speaker_1: "B" },
      selectedCoverageBySpeaker: { speaker_1: 0.55 },
      globalAssignmentMargin: 0.15,
    }),
  });
  assert.equal(result.selectedTelemetrySource, "VOX_REMOTE_STREAM_ACTIVITY");
});

test("conflicting similar-quality sources keep manual review", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      mapping: { speaker_1: "A" },
      selectedCoverageBySpeaker: { speaker_1: 0.61 },
      globalAssignmentMargin: 0.18,
    }),
    local: candidate({
      source: "VOXIMPLANT_MIC_ACTIVITY",
      mapping: { speaker_1: "B" },
      selectedCoverageBySpeaker: { speaker_1: 0.6 },
      globalAssignmentMargin: 0.17,
    }),
  });
  assert.equal(result.selectedTelemetrySource, "NONE");
  assert.equal(result.targetRuntimeDecision, "manual_review");
});

test("one-speaker ambiguous margins blocks auto source selection", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: false,
      reason: "ambiguous_margin",
      selectedMargins: { speaker_1: 0 },
    }),
    local: candidate({
      source: "VOXIMPLANT_MIC_ACTIVITY",
      available: false,
      reason: "ambiguous_margin",
      selectedMargins: { speaker_1: 0 },
    }),
  });
  assert.equal(result.selectedTelemetrySource, "NONE");
});

test("two-speaker many-to-one stays manual", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1", "speaker_2"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: false,
      reason: "many_to_one_mapping",
      mapping: { speaker_1: "A", speaker_2: "A" },
      selectedCoverageBySpeaker: { speaker_1: 0.7, speaker_2: 0.69 },
      selectedMargins: { speaker_1: 0.2, speaker_2: 0.2 },
      globalAssignmentMargin: 0.2,
    }),
    local: candidate({
      source: "VOXIMPLANT_MIC_ACTIVITY",
      available: false,
      reason: "incomplete_mapping",
      mapping: { speaker_1: "A", speaker_2: null },
      selectedCoverageBySpeaker: { speaker_1: 0.7, speaker_2: null },
      selectedMargins: { speaker_1: 0.2, speaker_2: null },
      globalAssignmentMargin: 0.2,
    }),
  });
  assert.equal(result.selectedTelemetrySource, "NONE");
});

test("facilitator-only local rows are treated as unavailable source", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({ source: "VOX_REMOTE_STREAM_ACTIVITY" }),
    local: candidate({
      source: "VOXIMPLANT_MIC_ACTIVITY",
      available: false,
      reason: "no_participant_activity_for_source",
    }),
  });
  assert.equal(result.selectedTelemetrySource, "VOX_REMOTE_STREAM_ACTIVITY");
});

test("if only non-participant local source exists mapping stays manual", () => {
  const result = selectTelemetrySourceForSpeakerMapping({
    speakerLabels: ["speaker_1"],
    preferRemoteStreamTelemetry: true,
    remote: candidate({
      source: "VOX_REMOTE_STREAM_ACTIVITY",
      available: false,
      reason: "no_audio_activity",
    }),
    local: candidate({
      source: "VOXIMPLANT_MIC_ACTIVITY",
      available: false,
      reason: "no_participant_activity_for_source",
    }),
  });
  assert.equal(result.selectedTelemetrySource, "NONE");
  assert.equal(result.targetRuntimeDecision, "manual_review");
});
