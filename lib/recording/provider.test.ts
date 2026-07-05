import test from "node:test";
import assert from "node:assert/strict";

import {
  isLiveKitRecordingProvider,
  isVoximplantRecordingProvider,
} from "@/lib/recording/provider";

test("detects VOXIMPLANT provider values", () => {
  assert.equal(isVoximplantRecordingProvider("VOXIMPLANT"), true);
  assert.equal(isVoximplantRecordingProvider("  voximplant "), true);
  assert.equal(isVoximplantRecordingProvider("LIVEKIT_CLOUD"), false);
});

test("detects LIVEKIT provider values", () => {
  assert.equal(isLiveKitRecordingProvider("LIVEKIT"), true);
  assert.equal(isLiveKitRecordingProvider("livekit_cloud"), true);
  assert.equal(isLiveKitRecordingProvider("VOXIMPLANT"), false);
});
