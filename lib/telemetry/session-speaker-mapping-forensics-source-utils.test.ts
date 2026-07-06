import assert from "node:assert/strict";
import test from "node:test";

import {
  REQUIRED_SOURCE_SCENARIOS,
  evaluateRemoteSourceRecommendation,
} from "../../scripts/debug/session-speaker-mapping-forensics-source-utils.mjs";

test("required source-aware scenarios are declared", () => {
  assert.deepEqual(REQUIRED_SOURCE_SCENARIOS, [
    "current_runtime",
    "local_mic_only",
    "remote_stream_only",
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
