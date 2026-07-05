import assert from "node:assert/strict";
import test from "node:test";

import { clearRemoteAudioElements, stopVoxLikeStreamTracks } from "@/lib/voximplant/media-cleanup";

test("stopVoxLikeStreamTracks stops explicit track and source tracks (leave/unmount/reconnect)", () => {
  let directTrackStops = 0;
  let sourceTrackStops = 0;
  const directTrack = { stop: () => { directTrackStops += 1; } } as MediaStreamTrack;
  const sourceTracks = [
    { stop: () => { sourceTrackStops += 1; } },
    { stop: () => { sourceTrackStops += 1; } },
  ] as unknown as MediaStreamTrack[];

  stopVoxLikeStreamTracks({
    track: directTrack,
    sourceStream: {
      getTracks: () => sourceTracks,
    } as unknown as MediaStream,
  });

  assert.equal(directTrackStops, 1);
  assert.equal(sourceTrackStops, 2);
});

test("clearRemoteAudioElements pauses and detaches srcObject", () => {
  let pauseCalls = 0;
  const first = {
    pause: () => {
      pauseCalls += 1;
    },
    srcObject: {} as MediaStream,
  };
  const second = {
    pause: () => {
      pauseCalls += 1;
    },
    srcObject: {} as MediaStream,
  };
  const map = new Map<string, { pause: () => void; srcObject: MediaStream | null }>([
    ["a", first],
    ["b", second],
  ]);

  clearRemoteAudioElements(map);

  assert.equal(pauseCalls, 2);
  assert.equal(first.srcObject, null);
  assert.equal(second.srcObject, null);
  assert.equal(map.size, 0);
});
