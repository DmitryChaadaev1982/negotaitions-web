import test from "node:test";
import assert from "node:assert/strict";

import {
  shouldAcceptRemoteSpeakingLevel,
  shouldAttachRemoteSpeakingMeter,
} from "@/lib/voximplant/remote-speaking";

function mediaStreamWithAudioTrack(enabled: boolean): MediaStream {
  const track = { enabled, kind: "audio" } as MediaStreamTrack;
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
