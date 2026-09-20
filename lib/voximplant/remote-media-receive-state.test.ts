import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isUsableRemoteVideo,
  projectRemoteVideoStream,
  readSdkIsReceiving,
} from "@/lib/voximplant/remote-media-receive-state";

function makeTrack(kind: "audio" | "video", readyState: "live" | "ended"): MediaStreamTrack {
  return { kind, enabled: true, readyState } as MediaStreamTrack;
}

function makeStream(tracks: MediaStreamTrack[], id: string): MediaStream {
  return {
    id,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream;
}

function liveVideo(id: string) {
  return makeStream([makeTrack("video", "live")], id);
}

function sdkWatchable(value: boolean) {
  return { value };
}

test("Watchable.value=false normalizes to false and is not usable remote video", () => {
  const watchable = sdkWatchable(false);
  assert.equal(typeof watchable, "object");
  assert.equal(Boolean(watchable), true);
  assert.equal(readSdkIsReceiving({ isReceiving: watchable }), false);
  assert.equal(
    isUsableRemoteVideo({
      currentGeneration: true,
      trackLive: true,
      isReceiving: readSdkIsReceiving({ isReceiving: watchable }),
    }),
    false,
  );
});

test("Watchable.value=true normalizes to true", () => {
  assert.equal(readSdkIsReceiving({ isReceiving: sdkWatchable(true) }), true);
});

test("missing stream or missing isReceiving is unknown", () => {
  assert.equal(readSdkIsReceiving(null), undefined);
  assert.equal(readSdkIsReceiving(undefined), undefined);
  assert.equal(readSdkIsReceiving({}), undefined);
});

test("session room projection: Watchable.value=false is paused and unusable", () => {
  const projected = projectRemoteVideoStream({
    streams: [
      {
        id: "ep-a:video",
        isReceiving: sdkWatchable(false),
        sourceStream: liveVideo("ep-a:video"),
      },
    ],
    currentGeneration: true,
  });
  const videoReceiving = projected.stream ? projected.isReceiving : false;
  assert.equal(videoReceiving, false);
  assert.equal(projected.usable, false);
  assert.equal(projected.status, "paused");
  assert.equal(projected.streamId, "ep-a:video");
});

test("one-second reconciliation: Watchable.value=false + live track stays unusable", () => {
  const projected = projectRemoteVideoStream({
    streams: [
      {
        id: "ep-a:video",
        isReceiving: sdkWatchable(false),
        sourceStream: liveVideo("ep-a:video"),
      },
    ],
    currentGeneration: true,
  });
  assert.equal(projected.trackLive, true);
  assert.equal(projected.isReceiving, false);
  assert.equal(projected.usable, false);
});

test("event lobby projection: Watchable.value=false stays paused", () => {
  const projected = projectRemoteVideoStream({
    streams: [
      {
        id: "lobby-ep:video",
        isReceiving: sdkWatchable(false),
        sourceStream: liveVideo("lobby-ep:video"),
      },
    ],
    currentGeneration: true,
  });
  assert.equal(projected.stream ? projected.isReceiving : false, false);
  assert.equal(projected.usable, false);
  assert.equal(projected.status, "paused");
});

test("receiving control: Watchable.value=true stays usable when other conditions are valid", () => {
  const projected = projectRemoteVideoStream({
    streams: [
      {
        id: "ep-a:video",
        isReceiving: sdkWatchable(true),
        sourceStream: liveVideo("ep-a:video"),
      },
    ],
    currentGeneration: true,
  });
  assert.equal(readSdkIsReceiving(projected.stream), true);
  assert.equal(projected.isReceiving, true);
  assert.equal(projected.usable, true);
  assert.equal(projected.status, "receiving");
});

test("session room and lobby VoxStream shims model isReceiving as Watchable", () => {
  const room = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const lobby = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(room, /isReceiving\?: VoxWatchable<boolean>/);
  assert.match(lobby, /isReceiving\?: VoxWatchable<boolean>/);
  assert.doesNotMatch(room, /isReceiving\?: boolean;/);
  assert.doesNotMatch(lobby, /isReceiving\?: boolean;/);
});
