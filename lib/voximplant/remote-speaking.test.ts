import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  isRemoteSpeaking,
  resolveRemoteSpeakingGeneration,
  resolveSpeakingAudioTrackId,
  resolveSpeakingSourceStream,
  shouldAcceptRemoteSpeakingLevel,
  shouldAttachRemoteSpeakingMeter,
} from "@/lib/voximplant/remote-speaking";

function mediaStreamWithAudioTrack(enabled: boolean, id = "track"): MediaStream {
  const track = { enabled, kind: "audio", id } as MediaStreamTrack;
  return {
    getAudioTracks: () => [track],
  } as MediaStream;
}

test("old analyser generation is ignored", () => {
  assert.equal(
    shouldAcceptRemoteSpeakingLevel({
      currentGeneration: "new-stream",
      updateGeneration: "old-stream",
      microphoneEnabled: true,
      level: 40,
    }),
    false,
  );
});

test("current analyser generation is accepted when microphone is enabled", () => {
  assert.equal(
    shouldAcceptRemoteSpeakingLevel({
      currentGeneration: "new-stream",
      updateGeneration: "new-stream",
      microphoneEnabled: true,
      level: 40,
    }),
    true,
  );
});

test("muted microphone rejects speaking-level callbacks", () => {
  assert.equal(
    shouldAcceptRemoteSpeakingLevel({
      currentGeneration: "new-stream",
      updateGeneration: "new-stream",
      microphoneEnabled: false,
      level: 40,
    }),
    false,
  );
});

test("old analyser is disposed when microphone becomes disabled", () => {
  assert.equal(
    shouldAttachRemoteSpeakingMeter({
      id: "facilitator",
      stream: mediaStreamWithAudioTrack(true),
      microphoneEnabled: false,
      generation: "current",
    }),
    false,
  );
});

test("new analyser attaches to replacement enabled track", () => {
  assert.equal(
    shouldAttachRemoteSpeakingMeter({
      id: "facilitator",
      stream: mediaStreamWithAudioTrack(true),
      microphoneEnabled: true,
      generation: "replacement",
    }),
    true,
  );
});

test("disabled audio track does not attach an analyser", () => {
  assert.equal(
    shouldAttachRemoteSpeakingMeter({
      id: "observer",
      stream: mediaStreamWithAudioTrack(false),
      microphoneEnabled: true,
      generation: "current",
    }),
    false,
  );
});

test("observer analyser attaches to the enabled audio track of the current stream", () => {
  assert.equal(
    shouldAttachRemoteSpeakingMeter({
      id: "observer",
      stream: mediaStreamWithAudioTrack(true, "observer-track"),
      microphoneEnabled: true,
      generation: "current",
    }),
    true,
  );
  assert.equal(
    resolveSpeakingAudioTrackId(mediaStreamWithAudioTrack(true, "observer-track")),
    "observer-track",
  );
});

test("analyser identity is the audio track, not the wrapping media stream", () => {
  const track = { enabled: true, kind: "audio", id: "shared-track" } as MediaStreamTrack;
  const wrapperA = { getAudioTracks: () => [track] } as MediaStream;
  const wrapperB = { getAudioTracks: () => [track] } as MediaStream;
  assert.notEqual(wrapperA, wrapperB);
  assert.equal(
    resolveSpeakingAudioTrackId(wrapperA),
    resolveSpeakingAudioTrackId(wrapperB),
  );
});

test("speaking source resolution prefers the stream carrying enabled audio", () => {
  const videoOnly = { getAudioTracks: () => [] } as MediaStream;
  const withAudio = mediaStreamWithAudioTrack(true, "observer-track");
  assert.equal(
    resolveSpeakingSourceStream({ audioStream: withAudio, videoStream: videoOnly }),
    withAudio,
  );
  assert.equal(
    resolveSpeakingSourceStream({ audioStream: null, videoStream: withAudio }),
    withAudio,
  );
  assert.equal(
    resolveSpeakingSourceStream({ audioStream: null, videoStream: videoOnly }),
    null,
  );
});

test("speaking state lookup is generation aware", () => {
  const speakingById = {
    "observer-endpoint": { isSpeaking: true, generation: "connection-new" },
    "facilitator-endpoint": { isSpeaking: false, generation: "connection-new" },
  };
  assert.equal(isRemoteSpeaking(speakingById, "observer-endpoint"), true);
  assert.equal(isRemoteSpeaking(speakingById, "facilitator-endpoint"), false);
  assert.equal(isRemoteSpeaking(speakingById, "missing-endpoint"), false);
  assert.equal(
    resolveRemoteSpeakingGeneration(speakingById, "observer-endpoint"),
    "connection-new",
  );
  assert.equal(resolveRemoteSpeakingGeneration(speakingById, "missing-endpoint"), undefined);
});

test("re-added remote audio stream is published before playback idempotency", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const attachBody = source.slice(
    source.indexOf("const attachRemoteAudioStream"),
    source.indexOf("const detachRemoteAudioStreams"),
  );
  const publishIndex = attachBody.indexOf("upsertRemote({ id: endpointId, audioStream: ms })");
  const idempotencyIndex = attachBody.indexOf("shouldCreateRemoteAudioElement");
  assert.ok(publishIndex >= 0, "attach must publish the current audio stream");
  assert.ok(idempotencyIndex >= 0, "attach must keep playback element idempotency");
  assert.ok(
    publishIndex < idempotencyIndex,
    "audio stream must be published before the playback idempotency guard",
  );
});

test("removed remote audio stream releases its playback element", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  assert.match(source, /const onRemoved = \(event: VoxEndpointMediaEvent\) => \{/);
  assert.match(source, /releaseRemoteAudioStream\(endpoint\.id, stream\)/);
});

test("endpoint refresh resolves audio instead of overwriting it blindly", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  assert.match(
    source,
    /audioStream: \(attachedAudioStream\) =>\s*resolveRemoteAudioStream\(\{ endpointAudioStreams, attachedAudioStream \}\)/,
  );
});
