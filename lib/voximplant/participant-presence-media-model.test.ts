import test from "node:test";
import assert from "node:assert/strict";

import {
  buildParticipantReconnectMediaState,
  canShowSpeakingHighlight,
  normalizeParticipantPresenceMedia,
} from "@/lib/voximplant/participant-presence-media-model";

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

test("explicit remote media signals override inferred track state", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Participant C",
    connectedSignal: true,
    videoStream: mediaStreamWithTrack("video", true),
    audioStream: mediaStreamWithTrack("audio", true),
    micSignal: "off",
    cameraSignal: "off",
  });
  assert.equal(model.connectionStatus, "connected");
  assert.equal(model.micStatus, "off");
  assert.equal(model.cameraStatus, "off");
});

test("disconnected participant forces unknown media state despite stale signals", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Participant D",
    connectedSignal: false,
    lastSeenAt: null,
    micSignal: "on",
    cameraSignal: "on",
  });
  assert.equal(model.connectionStatus, "unknown");
  assert.equal(model.micStatus, "unknown");
  assert.equal(model.cameraStatus, "unknown");
  assert.equal(model.shouldRenderActiveTile, false);
});

test("observer reconnects muted as muted icon and red border input", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Observer",
    connectedSignal: true,
    audioStream: mediaStreamWithTrack("audio", false),
    micSignal: "off",
  });
  assert.equal(model.micStatus, "off");
  assert.equal(canShowSpeakingHighlight({ ...model, isSpeaking: true }), false);
});

test("observer reconnects enabled and can show speaking", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Observer",
    connectedSignal: true,
    audioStream: mediaStreamWithTrack("audio", true),
    micSignal: "on",
  });
  assert.equal(model.micStatus, "on");
  assert.equal(canShowSpeakingHighlight({ ...model, isSpeaking: true }), true);
});

test("facilitator reconnects muted as muted icon and red border input", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Facilitator",
    connectedSignal: true,
    audioStream: mediaStreamWithTrack("audio", false),
    micSignal: "off",
  });
  assert.equal(model.micStatus, "off");
  assert.equal(canShowSpeakingHighlight({ ...model, isSpeaking: true }), false);
});

test("facilitator reconnects enabled and can show speaking", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Facilitator",
    connectedSignal: true,
    audioStream: mediaStreamWithTrack("audio", true),
    micSignal: "on",
  });
  assert.equal(model.micStatus, "on");
  assert.equal(canShowSpeakingHighlight({ ...model, isSpeaking: true }), true);
});

test("facilitator unmute after reconnect clears muted status and permits speaking", () => {
  const muted = normalizeParticipantPresenceMedia({
    displayName: "Facilitator",
    connectedSignal: true,
    audioStream: mediaStreamWithTrack("audio", false),
    micSignal: "off",
  });
  const enabled = normalizeParticipantPresenceMedia({
    displayName: "Facilitator",
    connectedSignal: true,
    audioStream: mediaStreamWithTrack("audio", true),
    micSignal: "on",
  });
  assert.equal(muted.micStatus, "off");
  assert.equal(enabled.micStatus, "on");
  assert.equal(canShowSpeakingHighlight({ ...enabled, isSpeaking: true }), true);
});

test("participant A reconnects muted", () => {
  const state = buildParticipantReconnectMediaState({
    userId: "participant-a-user",
    role: "PARTICIPANT",
    connectionGeneration: 2,
    providerEndpointId: "endpoint-a2",
    audioStream: mediaStreamWithTrack("audio", false),
    microphoneEnabled: false,
  });
  assert.equal(state.microphoneEnabled, false);
  assert.equal(state.isSpeaking, false);
});

test("participant B reconnects enabled", () => {
  const state = buildParticipantReconnectMediaState({
    userId: "participant-b-user",
    role: "PARTICIPANT",
    connectionGeneration: 2,
    providerEndpointId: "endpoint-b2",
    audioStream: mediaStreamWithTrack("audio", true),
    microphoneEnabled: true,
    isSpeaking: true,
  });
  assert.equal(state.audioTrackPresent, true);
  assert.equal(state.microphoneEnabled, true);
  assert.equal(state.isSpeaking, true);
});

test("missing audio track does not render microphone enabled", () => {
  const state = buildParticipantReconnectMediaState({
    userId: "observer-user",
    role: "OBSERVER",
    audioStream: null,
  });
  assert.equal(state.audioTrackPresent, false);
  assert.equal(state.microphoneEnabled, null);
});

test("unknown media state is neutral for connected tiles", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "Unknown Media",
    connectedSignal: true,
    allowConnectedWithoutMediaTile: true,
    audioStream: null,
    videoStream: null,
  });
  assert.equal(model.micStatus, "unknown");
  assert.equal(model.cameraStatus, "unknown");
  assert.equal(model.shouldRenderActiveTile, true);
});

test("old generation mute event is ignored by reconnect state selection", () => {
  const current = buildParticipantReconnectMediaState({
    userId: "user",
    role: "OBSERVER",
    connectionGeneration: "new",
    audioStream: mediaStreamWithTrack("audio", true),
    microphoneEnabled: true,
  });
  const staleMuteGeneration = "old";
  assert.notEqual(staleMuteGeneration, current.connectionGeneration);
  assert.equal(current.microphoneEnabled, true);
});

test("old generation unmute event is ignored by reconnect state selection", () => {
  const current = buildParticipantReconnectMediaState({
    userId: "user",
    role: "FACILITATOR",
    connectionGeneration: "new",
    audioStream: mediaStreamWithTrack("audio", false),
    microphoneEnabled: false,
  });
  const staleUnmuteGeneration = "old";
  assert.notEqual(staleUnmuteGeneration, current.connectionGeneration);
  assert.equal(current.microphoneEnabled, false);
});

test("old generation speaking event is ignored by highlighted state", () => {
  const state = buildParticipantReconnectMediaState({
    userId: "user",
    role: "OBSERVER",
    connectionGeneration: "new",
    audioStream: mediaStreamWithTrack("audio", false),
    microphoneEnabled: false,
    isSpeaking: true,
  });
  assert.equal(state.isSpeaking, false);
});

test("muting resets speaking immediately", () => {
  const state = buildParticipantReconnectMediaState({
    userId: "user",
    role: "PARTICIPANT",
    audioStream: mediaStreamWithTrack("audio", false),
    microphoneEnabled: false,
    isSpeaking: true,
  });
  assert.equal(state.isSpeaking, false);
});

test("track removal resets speaking immediately", () => {
  const state = buildParticipantReconnectMediaState({
    userId: "user",
    role: "PARTICIPANT",
    audioStream: null,
    isSpeaking: true,
  });
  assert.equal(state.audioTrackPresent, false);
  assert.equal(state.isSpeaking, false);
});

test("camera state remains unchanged by microphone reconnect", () => {
  const state = buildParticipantReconnectMediaState({
    userId: "user",
    role: "PARTICIPANT",
    audioStream: mediaStreamWithTrack("audio", false),
    microphoneEnabled: false,
    cameraEnabled: true,
  });
  assert.equal(state.microphoneEnabled, false);
  assert.equal(state.cameraEnabled, true);
});

test("role changes do not alter media-state semantics", () => {
  const observer = buildParticipantReconnectMediaState({
    role: "OBSERVER",
    audioStream: mediaStreamWithTrack("audio", false),
    microphoneEnabled: false,
  });
  const facilitator = buildParticipantReconnectMediaState({
    role: "FACILITATOR",
    audioStream: mediaStreamWithTrack("audio", false),
    microphoneEnabled: false,
  });
  assert.equal(observer.microphoneEnabled, facilitator.microphoneEnabled);
  assert.equal(observer.isSpeaking, facilitator.isSpeaking);
});

test("self and remote facilitator tile agree on microphone state", () => {
  const self = normalizeParticipantPresenceMedia({
    displayName: "Facilitator",
    connectedSignal: true,
    micSignal: "off",
  });
  const remote = normalizeParticipantPresenceMedia({
    displayName: "Facilitator",
    connectedSignal: true,
    audioStream: mediaStreamWithTrack("audio", false),
  });
  assert.equal(self.micStatus, "off");
  assert.equal(remote.micStatus, "off");
});
