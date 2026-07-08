import test from "node:test";
import assert from "node:assert/strict";

import { normalizeParticipantPresenceMedia } from "@/lib/voximplant/participant-presence-media-model";

function mediaStreamWithTrack(kind: "audio" | "video", enabled: boolean): MediaStream {
  const track = {
    enabled,
    kind,
  } as MediaStreamTrack;
  if (kind === "audio") {
    return {
      getAudioTracks: () => [track],
      getVideoTracks: () => [],
    } as MediaStream;
  }
  return {
    getAudioTracks: () => [],
    getVideoTracks: () => [track],
  } as MediaStream;
}

test("assigned participant without endpoint stays non-connected", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Observer",
    connectedSignal: false,
    lastSeenAt: null,
    videoStream: null,
    audioStream: null,
  });
  assert.equal(model.connectionStatus, "unknown");
  assert.equal(model.micStatus, "unknown");
  assert.equal(model.cameraStatus, "unknown");
  assert.equal(model.shouldRenderActiveTile, false);
});

test("connected participant with disabled tracks resolves OFF statuses", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Participant A",
    connectedSignal: true,
    videoStream: mediaStreamWithTrack("video", false),
    audioStream: mediaStreamWithTrack("audio", false),
  });
  assert.equal(model.connectionStatus, "connected");
  assert.equal(model.micStatus, "off");
  assert.equal(model.cameraStatus, "off");
  assert.equal(model.shouldRenderActiveTile, true);
});

test("connected participant with enabled tracks resolves ON statuses", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Participant B",
    connectedSignal: true,
    videoStream: mediaStreamWithTrack("video", true),
    audioStream: mediaStreamWithTrack("audio", true),
  });
  assert.equal(model.connectionStatus, "connected");
  assert.equal(model.micStatus, "on");
  assert.equal(model.cameraStatus, "on");
  assert.equal(model.shouldRenderActiveTile, true);
});
