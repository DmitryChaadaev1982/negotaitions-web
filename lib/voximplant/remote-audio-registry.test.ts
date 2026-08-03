import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRemoteAudioElementKey,
  isRemoteAudioElementKeyForEndpoint,
  resolveRemoteAudioStream,
  shouldCreateRemoteAudioElement,
} from "@/lib/voximplant/remote-audio-registry";

function stream(input: { id: string; trackId?: string; enabled?: boolean }): MediaStream {
  const tracks =
    input.trackId === undefined
      ? []
      : [
          {
            id: input.trackId,
            kind: "audio",
            enabled: input.enabled !== false,
          } as MediaStreamTrack,
        ];
  return {
    id: input.id,
    getAudioTracks: () => tracks,
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

test("audio element keys are scoped per endpoint", () => {
  const key = buildRemoteAudioElementKey("observer-endpoint", "audio-1");
  assert.equal(key, "observer-endpoint-audio-1");
  assert.equal(isRemoteAudioElementKeyForEndpoint(key, "observer-endpoint"), true);
  assert.equal(isRemoteAudioElementKeyForEndpoint(key, "facilitator-endpoint"), false);
});

test("endpoint refresh prefers a live endpoint audio stream", () => {
  const live = stream({ id: "audio-live", trackId: "track-live" });
  const attached = stream({ id: "audio-old", trackId: "track-old" });
  assert.equal(
    resolveRemoteAudioStream({ endpointAudioStreams: [live], attachedAudioStream: attached }),
    live,
  );
});

test("endpoint refresh never downgrades an attached observer audio stream to null", () => {
  const attached = stream({ id: "audio-attached", trackId: "track-attached" });
  assert.equal(
    resolveRemoteAudioStream({ endpointAudioStreams: [], attachedAudioStream: attached }),
    attached,
  );
  assert.equal(
    resolveRemoteAudioStream({ endpointAudioStreams: [null], attachedAudioStream: attached }),
    attached,
  );
});

test("endpoint refresh clears audio once no stream carries a track", () => {
  assert.equal(
    resolveRemoteAudioStream({
      endpointAudioStreams: [],
      attachedAudioStream: stream({ id: "audio-empty" }),
    }),
    null,
  );
  assert.equal(
    resolveRemoteAudioStream({ endpointAudioStreams: [], attachedAudioStream: null }),
    null,
  );
});

test("endpoint refresh keeps a disabled track over no track at all", () => {
  const disabled = stream({ id: "audio-disabled", trackId: "track-disabled", enabled: false });
  assert.equal(
    resolveRemoteAudioStream({
      endpointAudioStreams: [stream({ id: "audio-empty" })],
      attachedAudioStream: disabled,
    }),
    disabled,
  );
});

test("playback element is created once per endpoint audio stream", () => {
  const key = buildRemoteAudioElementKey("observer-endpoint", "audio-1");
  assert.equal(shouldCreateRemoteAudioElement({ attachedElementKeys: [], key }), true);
  assert.equal(shouldCreateRemoteAudioElement({ attachedElementKeys: [key], key }), false);
});

test("re-added observer audio stream can attach a fresh playback element after release", () => {
  const key = buildRemoteAudioElementKey("observer-endpoint", "audio-1");
  const attachedElementKeys = [key];
  assert.equal(shouldCreateRemoteAudioElement({ attachedElementKeys, key }), false);
  const afterRelease = attachedElementKeys.filter((item) => item !== key);
  assert.equal(
    shouldCreateRemoteAudioElement({ attachedElementKeys: afterRelease, key }),
    true,
  );
});
