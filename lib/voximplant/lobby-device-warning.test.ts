import assert from "node:assert/strict";
import test from "node:test";

import {
  hasLiveMediaTrack,
  reconcileLobbyDeviceWarning,
} from "@/lib/voximplant/lobby-device-warning";

test("healthy microphone and camera clear the lobby device warning", () => {
  assert.equal(
    reconcileLobbyDeviceWarning({
      hasMicrophoneStream: true,
      hasCameraStream: true,
    }),
    null,
  );
});

test("missing microphone keeps a microphone warning even if camera is healthy", () => {
  assert.equal(
    reconcileLobbyDeviceWarning({
      hasMicrophoneStream: false,
      hasCameraStream: true,
    }),
    "microphoneUnavailable",
  );
});

test("missing camera keeps the camera/busy warning even if microphone is healthy", () => {
  assert.equal(
    reconcileLobbyDeviceWarning({
      hasMicrophoneStream: true,
      hasCameraStream: false,
    }),
    "cameraBusyOrUnavailable",
  );
});

test("both devices missing keep the combined camera/microphone warning", () => {
  assert.equal(
    reconcileLobbyDeviceWarning({
      hasMicrophoneStream: false,
      hasCameraStream: false,
    }),
    "cameraBusyOrUnavailable",
  );
});

test("live tracks count even when disabled, ended tracks do not", () => {
  assert.equal(
    hasLiveMediaTrack(
      {
        getVideoTracks: () => [{ readyState: "live" }],
      },
      "video",
    ),
    true,
  );
  assert.equal(
    hasLiveMediaTrack(
      {
        getAudioTracks: () => [{ readyState: "ended" }],
      },
      "audio",
    ),
    false,
  );
  assert.equal(hasLiveMediaTrack(null, "video"), false);
});
