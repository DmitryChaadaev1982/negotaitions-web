import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPeerMediaSelectionOwner,
  upsertVoxRoomRemoteParticipant,
  type PeerMediaRemote,
} from "@/lib/voximplant/peer-media-selection-runtime";
import { selectedRemotesByLogicalIdentity } from "@/lib/voximplant/participant-media-selection";
import {
  reconcileRemoteAudioPlayback,
  remoteAudioElementKey,
} from "@/lib/voximplant/remote-audio-playback";

const USER_A = "ng_u_aaaaaaaaaaaaaaaa";

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

function liveVideo(id: string): MediaStream {
  return makeStream([makeTrack("video", "live")], id);
}

function liveAudio(id: string): MediaStream {
  return makeStream([makeTrack("audio", "live")], id);
}

function endedVideo(id: string): MediaStream {
  return makeStream([makeTrack("video", "ended")], id);
}

function endedAudio(id: string): MediaStream {
  return makeStream([makeTrack("audio", "ended")], id);
}

function remote(
  id: string,
  overrides: Partial<PeerMediaRemote> = {},
): PeerMediaRemote {
  return {
    id,
    displayName: "A",
    endpointUsername: USER_A,
    conferenceGeneration: 1,
    stream: liveVideo(`${id}-v`),
    audioStream: liveAudio(`${id}-a`),
    ...overrides,
  };
}

function videoAndAudioSelected(
  remotes: readonly PeerMediaRemote[],
  selectedEndpointIds: ReadonlySet<string>,
): { video: string | undefined; audio: string | undefined } {
  const video = selectedRemotesByLogicalIdentity(remotes, selectedEndpointIds).get(USER_A)?.id;
  const audio = [...selectedEndpointIds].find((id) => remotes.some((item) => item.id === id));
  return { video, audio };
}

test("R7-01 equal-quality lexicographically-smaller endpoint does not steal video or audio", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const first = owner.commit([remote("ep-z")]);
  assert.equal(first.projection.selectedIds.has("ep-z"), true);
  const second = owner.commit((current) => [...current, remote("ep-a")]);
  const { video, audio } = videoAndAudioSelected(second.remotes, second.projection.selectedIds);
  assert.equal(video, "ep-z");
  assert.equal(audio, "ep-z");
  assert.equal(second.projection.selectedIds.has("ep-a"), false);
});

test("R7-02 unusable previous selection switches video and audio in the same commit", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  owner.commit([remote("ep-z"), remote("ep-a")]);
  const after = owner.commit((current) =>
    current.map((item) =>
      item.id === "ep-z"
        ? {
            ...item,
            stream: endedVideo("ep-z-v"),
            audioStream: endedAudio("ep-z-a"),
          }
        : item,
    ),
  );
  const { video, audio } = videoAndAudioSelected(after.remotes, after.projection.selectedIds);
  assert.equal(video, "ep-a");
  assert.equal(audio, "ep-a");
});

test("R7-03 removing the selected endpoint switches video and audio to the remaining candidate", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  owner.commit([remote("ep-z"), remote("ep-a")]);
  const after = owner.commit((current) => current.filter((item) => item.id !== "ep-z"));
  const { video, audio } = videoAndAudioSelected(after.remotes, after.projection.selectedIds);
  assert.equal(video, "ep-a");
  assert.equal(audio, "ep-a");
});

test("R7-04 initial empty previous selection uses lexicographic fallback for video and audio", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const first = owner.commit([remote("ep-z"), remote("ep-a")]);
  const { video, audio } = videoAndAudioSelected(first.remotes, first.projection.selectedIds);
  assert.equal(video, "ep-a");
  assert.equal(audio, "ep-a");
});

test("R7-05 two independent recovery episodes keep one authoritative selection", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  owner.commit([remote("E1")]);
  owner.commit((current) => [
    ...current.map((item) =>
      item.id === "E1"
        ? { ...item, stream: endedVideo("E1-v"), audioStream: endedAudio("E1-a") }
        : item,
    ),
    remote("E2"),
  ]);
  const episode2 = owner.commit((current) => [
    ...current.map((item) =>
      item.id === "E2"
        ? { ...item, stream: endedVideo("E2-v"), audioStream: endedAudio("E2-a") }
        : item,
    ),
    remote("E3"),
  ]);
  const { video, audio } = videoAndAudioSelected(episode2.remotes, episode2.projection.selectedIds);
  assert.equal(video, "E3");
  assert.equal(audio, "E3");
  assert.equal(episode2.projection.selectedIds.size, 1);
});

test("R7-06 same endpoint id replacement stream does not split video/audio identity", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  owner.commit([
    remote("E1", { stream: endedVideo("old"), audioStream: endedAudio("old-a") }),
  ]);
  const replaced = owner.commit((current) =>
    upsertVoxRoomRemoteParticipant(current, {
      id: "E1",
      displayName: "A",
      endpointUsername: USER_A,
      stream: liveVideo("new"),
      audioStream: liveAudio("new-a"),
    }),
  );
  const { video, audio } = videoAndAudioSelected(
    replaced.remotes,
    replaced.projection.selectedIds,
  );
  assert.equal(replaced.remotes.length, 1);
  assert.equal(video, "E1");
  assert.equal(audio, "E1");
});

test("R7-07 old-generation candidate cannot become audio or video owner", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  owner.commit([remote("E2", { conferenceGeneration: 5 })]);
  const reclaim = owner.commit((current) => [
    ...current,
    remote("E1", { conferenceGeneration: 4 }),
  ]);
  const { video, audio } = videoAndAudioSelected(reclaim.remotes, reclaim.projection.selectedIds);
  assert.equal(video, "E2");
  assert.equal(audio, "E2");
  const e1Key = remoteAudioElementKey("E1", "old");
  const e2Key = remoteAudioElementKey("E2", "E2-a");
  const audioPlan = reconcileRemoteAudioPlayback({
    remotes: reclaim.remotes,
    selectedEndpointIds: reclaim.projection.selectedIds,
    previouslySelectedEndpointIds: reclaim.previouslySelectedEndpointIds,
    elements: new Map([
      [e1Key, { paused: true, play: async () => undefined, pause() {} }],
      [e2Key, { paused: true, play: async () => undefined, pause() {} }],
    ]),
    elementOwnership: new Map([
      [e1Key, { endpointId: "E1", streamId: "old" }],
      [e2Key, { endpointId: "E2", streamId: "E2-a" }],
    ]),
    newlyAttachedKeys: new Set([e1Key]),
  });
  assert.equal(audioPlan.playKeys.includes(e1Key), false);
  assert.deepEqual(audioPlan.pauseKeys, [e1Key]);
});

test("R7-08 layout and hook consume the same owner selected ids, not an independent selector", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  owner.commit([remote("ep-z")]);
  const { remotes, projection } = owner.commit((current) => [...current, remote("ep-a")]);
  const layoutMap = selectedRemotesByLogicalIdentity(remotes, projection.selectedIds);
  assert.equal(layoutMap.get(USER_A)?.id, "ep-z");
  assert.equal(projection.selectedIds.has("ep-z"), true);

  const hook = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const layout = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  const page = readFileSync("components/voximplant-negotiation-room-page.tsx", "utf-8");
  assert.match(hook, /createPeerMediaSelectionOwner/);
  assert.match(hook, /setSelectedPeerEndpointIds\(projection\.selectedIds\)/);
  assert.match(page, /selectedPeerEndpointIds=\{selectedPeerEndpointIds\}/);
  assert.match(layout, /selectedRemotesByLogicalIdentity\(\s*remoteParticipants,\s*selectedPeerEndpointIds/);
  assert.doesNotMatch(layout, /projectSelectedPeerEndpoints\(/);
  assert.doesNotMatch(layout, /previouslySelectedByIdentity/);
  assert.match(hook, /createPeerMediaSelectionOwner<VoxRoomParticipant>/);
  assert.match(hook, /from "@\/lib\/voximplant\/peer-media-selection-runtime"/);
});

test("peer media owner commit is synchronous and does not await", () => {
  const runtime = readFileSync("lib/voximplant/peer-media-selection-runtime.ts", "utf-8");
  const selection = readFileSync("lib/voximplant/participant-media-selection.ts", "utf-8");
  assert.doesNotMatch(runtime, /\bawait\b/);
  assert.doesNotMatch(runtime, /\bfetch\s*\(/);
  assert.doesNotMatch(runtime, /\bsetTimeout\b/);
  assert.doesNotMatch(selection, /\bawait\b/);
});
