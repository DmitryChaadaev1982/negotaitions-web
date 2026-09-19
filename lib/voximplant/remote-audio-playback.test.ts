import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPeerMediaSelectionOwner,
  upsertVoxRoomRemoteParticipant,
  type PeerMediaRemote,
  type PeerMediaSelectionCommit,
} from "@/lib/voximplant/peer-media-selection-runtime";
import {
  findRemoteAudioElementKey,
  isRemoteAudioAutoplayBlock,
  planRemoteAudioPlayback,
  reconcileRemoteAudioPlayback,
  remoteAudioElementKey,
  selectedRemoteAudioStreamIdsByEndpoint,
  type RemoteAudioElementOwnership,
} from "@/lib/voximplant/remote-audio-playback";

const USER_A = "ng_u_aaaaaaaaaaaaaaaa";
const USER_B = "ng_u_bbbbbbbbbbbbbbbb";

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

function liveAudio(id: string): MediaStream {
  return makeStream([makeTrack("audio", "live")], id);
}

function liveVideo(id: string): MediaStream {
  return makeStream([makeTrack("video", "live")], id);
}

function endedAudio(id: string): MediaStream {
  return makeStream([makeTrack("audio", "ended")], id);
}

function endedVideo(id: string): MediaStream {
  return makeStream([makeTrack("video", "ended")], id);
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

type FakeAudio = {
  paused: boolean;
  playCalls: number;
  pauseCalls: number;
  playError: Error | null;
  play: () => Promise<void>;
  pause: () => void;
};

function fakeAudio(paused = true, playError: Error | null = null): FakeAudio {
  const audio: FakeAudio = {
    paused,
    playCalls: 0,
    pauseCalls: 0,
    playError,
    play() {
      audio.playCalls += 1;
      if (audio.playError) return Promise.reject(audio.playError);
      audio.paused = false;
      return Promise.resolve();
    },
    pause() {
      audio.pauseCalls += 1;
      audio.paused = true;
    },
  };
  return audio;
}

function bindElement(
  elements: Map<string, FakeAudio>,
  ownership: Map<string, RemoteAudioElementOwnership>,
  endpointId: string,
  streamId: string,
  audio: FakeAudio,
  voxStreamId = streamId,
): string {
  const key = remoteAudioElementKey(endpointId, streamId);
  elements.set(key, audio);
  ownership.set(key, { endpointId, streamId, voxStreamId });
  return key;
}

function reconcileCommit(
  commit: PeerMediaSelectionCommit<PeerMediaRemote>,
  elements: Map<string, FakeAudio>,
  ownership: Map<string, RemoteAudioElementOwnership>,
  extra?: {
    previousRemotes?: readonly PeerMediaRemote[];
    newlyAttachedKeys?: ReadonlySet<string>;
    unlock?: boolean;
  },
) {
  return reconcileRemoteAudioPlayback({
    remotes: commit.remotes,
    selectedEndpointIds: commit.projection.selectedIds,
    previouslySelectedEndpointIds: commit.previouslySelectedEndpointIds,
    previousRemotes: extra?.previousRemotes,
    newlyAttachedKeys: extra?.newlyAttachedKeys,
    unlock: extra?.unlock,
    elements,
    elementOwnership: ownership,
  });
}

/**
 * Mirrors session-room attach order: register the audio element, then commit
 * the candidate snapshot synchronously, then reconcile playback. React setState
 * is not part of this path.
 */
function attachRemoteAudioLikeHook(input: {
  owner: ReturnType<typeof createPeerMediaSelectionOwner<PeerMediaRemote>>;
  elements: Map<string, FakeAudio>;
  ownership: Map<string, RemoteAudioElementOwnership>;
  endpointId: string;
  streamId: string;
  audio?: FakeAudio;
  remote?: PeerMediaRemote;
  voxStreamId?: string;
}): {
  remotes: PeerMediaRemote[];
  selectedIds: Set<string>;
  playKeys: string[];
  pauseKeys: string[];
  playResults: Array<{ key: string; result: Promise<void> }>;
  reactStateFlushed: boolean;
  key: string;
} {
  const audio = input.audio ?? fakeAudio(true);
  const key = bindElement(
    input.elements,
    input.ownership,
    input.endpointId,
    input.streamId,
    audio,
    input.voxStreamId,
  );
  let reactStateFlushed = false;
  const queuedReactPublish = () => {
    reactStateFlushed = true;
  };
  const previousRemotes = [...input.owner.remotes];
  const commit = input.owner.commit((current) =>
    upsertVoxRoomRemoteParticipant(
      current,
      input.remote ?? {
        id: input.endpointId,
        displayName: "A",
        endpointUsername: USER_A,
        audioStream: liveAudio(input.streamId),
        stream: liveVideo(`${input.endpointId}-v`),
      },
    ),
  );
  const outcome = reconcileCommit(commit, input.elements, input.ownership, {
    previousRemotes,
    newlyAttachedKeys: new Set([key]),
  });
  void queuedReactPublish;
  return {
    remotes: commit.remotes,
    selectedIds: commit.projection.selectedIds,
    playKeys: outcome.playKeys,
    pauseKeys: outcome.pauseKeys,
    playResults: outcome.playResults,
    reactStateFlushed,
    key,
  };
}

function detachRemoteAudioLikeHook(
  elements: Map<string, FakeAudio>,
  ownership: Map<string, RemoteAudioElementOwnership>,
  endpointId: string,
  streamId: string,
): void {
  const key = findRemoteAudioElementKey(ownership, endpointId, streamId);
  if (!key) return;
  elements.get(key)?.pause();
  elements.delete(key);
  ownership.delete(key);
}

test("R8-01 first healthy remote audio is selected and play() is attempted immediately", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  const attached = attachRemoteAudioLikeHook({
    owner,
    elements,
    ownership,
    endpointId: "E1",
    streamId: "s1",
  });
  const audio = elements.get(attached.key)!;
  assert.equal(attached.selectedIds.has("E1"), true);
  assert.deepEqual(attached.playKeys, [attached.key]);
  assert.equal(audio.playCalls, 1);
  assert.equal(audio.paused, false);
  assert.equal(attached.pauseKeys.includes(attached.key), false);
  assert.equal(attached.reactStateFlushed, false);
});

test("R8-02 suppressed endpoint audio is paused while E1 is selected", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "ep-z", streamId: "s1" });
  const attachedE2 = attachRemoteAudioLikeHook({
    owner,
    elements,
    ownership,
    endpointId: "ep-a",
    streamId: "s2",
  });
  const e2 = elements.get(attachedE2.key)!;
  assert.equal(attachedE2.selectedIds.has("ep-z"), true);
  assert.equal(attachedE2.selectedIds.has("ep-a"), false);
  assert.deepEqual(attachedE2.pauseKeys, [attachedE2.key]);
  assert.equal(e2.playCalls, 0);
  assert.equal(e2.paused, true);
  assert.equal(e2.pauseCalls >= 1, true);
});

test("R8-03 E1 becoming unusable automatically attempts play() on previously suppressed E2", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  const e1 = fakeAudio(false);
  const e2 = fakeAudio(true);
  bindElement(elements, ownership, "ep-z", "ep-z-a", e1);
  bindElement(elements, ownership, "ep-a", "ep-a-a", e2);
  owner.commit([remote("ep-z")]);
  owner.commit([remote("ep-z"), remote("ep-a")]);
  const previousRemotes = [...owner.remotes];
  const after = owner.commit((current) =>
    current.map((item) =>
      item.id === "ep-z"
        ? { ...item, stream: endedVideo("ep-z-v"), audioStream: endedAudio("ep-z-a") }
        : item,
    ),
  );
  const outcome = reconcileCommit(after, elements, ownership, { previousRemotes });
  assert.equal(after.projection.selectedIds.has("ep-a"), true);
  assert.deepEqual(outcome.pauseKeys, [remoteAudioElementKey("ep-z", "ep-z-a")]);
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("ep-a", "ep-a-a")]);
  assert.equal(e1.paused, true);
  assert.equal(e2.playCalls, 1);
  assert.equal(e2.paused, false);
});

test("R8-04 selected play() NotAllowedError is autoplay-blocked and does not play stale audio", async () => {
  const blocked = Object.assign(new Error("NotAllowedError: play()"), { name: "NotAllowedError" });
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  bindElement(elements, ownership, "E2", "E2-a", fakeAudio(true, blocked));
  bindElement(elements, ownership, "E1", "old-a", fakeAudio(true));
  const previousRemotes: PeerMediaRemote[] = [];
  const commit = owner.commit([
    remote("E1", { stream: endedVideo("old"), audioStream: endedAudio("old-a") }),
    remote("E2"),
  ]);
  const outcome = reconcileCommit(commit, elements, ownership, {
    previousRemotes,
    newlyAttachedKeys: new Set([remoteAudioElementKey("E2", "E2-a")]),
  });
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("E2", "E2-a")]);
  assert.equal(outcome.pauseKeys.includes(remoteAudioElementKey("E1", "old-a")), true);
  const playError = await outcome.playResults[0]!.result.then(
    () => null,
    (error: unknown) => error,
  );
  assert.equal(isRemoteAudioAutoplayBlock(playError), true);
  assert.equal(elements.get(remoteAudioElementKey("E1", "old-a"))!.playCalls, 0);
  assert.equal(elements.get(remoteAudioElementKey("E1", "old-a"))!.paused, true);
});

test("R8-05 manual unlock plays only the selected endpoint", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  bindElement(elements, ownership, "E1", "E1-a", fakeAudio(true));
  bindElement(elements, ownership, "E2", "E2-a", fakeAudio(true));
  const commit = owner.commit([remote("E1"), remote("E2")]);
  const outcome = reconcileCommit(commit, elements, ownership, {
    previousRemotes: commit.remotes,
    unlock: true,
  });
  const selectedId = [...commit.projection.selectedIds][0]!;
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey(selectedId, `${selectedId}-a`)]);
  assert.equal(elements.get(remoteAudioElementKey(selectedId, `${selectedId}-a`))!.playCalls, 1);
});

test("R8-06 manual unlock leaves suppressed audio paused", () => {
  const selected = fakeAudio(true);
  const suppressed = fakeAudio(true);
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  bindElement(elements, ownership, "ep-z", "s", selected);
  bindElement(elements, ownership, "ep-a", "s", suppressed);
  const remotes = [
    remote("ep-z", { audioStream: liveAudio("s") }),
    remote("ep-a", { audioStream: liveAudio("s") }),
  ];
  const outcome = reconcileRemoteAudioPlayback({
    remotes,
    selectedEndpointIds: new Set(["ep-z"]),
    previouslySelectedEndpointIds: new Set(["ep-z"]),
    previousRemotes: remotes,
    unlock: true,
    elements,
    elementOwnership: ownership,
  });
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("ep-z", "s")]);
  assert.deepEqual(outcome.pauseKeys, [remoteAudioElementKey("ep-a", "s")]);
  assert.equal(selected.playCalls, 1);
  assert.equal(suppressed.playCalls, 0);
  assert.equal(suppressed.paused, true);
});

test("R8-07 selection E1 → E2 → E3 keeps only the current endpoint eligible", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const e1 = fakeAudio(false);
  const e2 = fakeAudio(true);
  const e3 = fakeAudio(true);
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  bindElement(elements, ownership, "E1", "E1-a", e1);
  bindElement(elements, ownership, "E2", "E2-a", e2);
  bindElement(elements, ownership, "E3", "E3-a", e3);
  owner.commit([remote("E1")]);
  const previousToE2 = [...owner.remotes];
  const toE2 = owner.commit((current) => [
    ...current.map((item) =>
      item.id === "E1"
        ? { ...item, stream: endedVideo("E1-v"), audioStream: endedAudio("E1-a") }
        : item,
    ),
    remote("E2"),
  ]);
  reconcileCommit(toE2, elements, ownership, { previousRemotes: previousToE2 });
  const previousToE3 = [...owner.remotes];
  const toE3 = owner.commit((current) => [
    ...current.map((item) =>
      item.id === "E2"
        ? { ...item, stream: endedVideo("E2-v"), audioStream: endedAudio("E2-a") }
        : item,
    ),
    remote("E3"),
  ]);
  const outcome = reconcileCommit(toE3, elements, ownership, { previousRemotes: previousToE3 });
  assert.deepEqual([...toE3.projection.selectedIds], ["E3"]);
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("E3", "E3-a")]);
  assert.equal(outcome.pauseKeys.includes(remoteAudioElementKey("E1", "E1-a")), true);
  assert.equal(outcome.pauseKeys.includes(remoteAudioElementKey("E2", "E2-a")), true);
  assert.equal(e3.playCalls, 1);
  assert.equal(e1.paused, true);
  assert.equal(e2.paused, true);
});

test("R8-08 EndpointRemoved of selected E1 resumes E2 automatically", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  bindElement(elements, ownership, "E1", "E1-a", fakeAudio(false));
  bindElement(elements, ownership, "E2", "E2-a", fakeAudio(true));
  owner.commit([remote("E1")]);
  owner.commit([remote("E1"), remote("E2")]);
  const previousRemotes = [...owner.remotes];
  const after = owner.commit((current) => current.filter((item) => item.id !== "E1"));
  const outcome = reconcileCommit(after, elements, ownership, { previousRemotes });
  assert.equal(after.projection.selectedIds.has("E2"), true);
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("E2", "E2-a")]);
  assert.equal(elements.get(remoteAudioElementKey("E2", "E2-a"))!.playCalls, 1);
});

test("R8-09 same-endpoint replacement audio is playable without waiting for a later reconcile", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "old" });
  const oldAudio = elements.get(remoteAudioElementKey("E1", "old"))!;
  const replacement = attachRemoteAudioLikeHook({
    owner,
    elements,
    ownership,
    endpointId: "E1",
    streamId: "new",
    remote: {
      id: "E1",
      displayName: "A",
      endpointUsername: USER_A,
      stream: liveVideo("new-v"),
      audioStream: liveAudio("new"),
    },
  });
  assert.equal(replacement.selectedIds.has("E1"), true);
  assert.deepEqual(replacement.playKeys, [remoteAudioElementKey("E1", "new")]);
  assert.equal(elements.get(remoteAudioElementKey("E1", "new"))!.playCalls, 1);
  assert.equal(replacement.pauseKeys.includes(remoteAudioElementKey("E1", "old")), true);
  assert.equal(oldAudio.paused, true);
  assert.equal(oldAudio.playCalls, 1);
  assert.equal(replacement.reactStateFlushed, false);
});

test("R8-10 initial attach selection does not depend on React state-updater execution", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const reactRemotes: PeerMediaRemote[] | null = null;
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  const key = bindElement(elements, ownership, "E1", "s1", fakeAudio(true));
  const previousRemotes: PeerMediaRemote[] = [];
  const commit = owner.commit((current) =>
    upsertVoxRoomRemoteParticipant(current, {
      id: "E1",
      displayName: "A",
      endpointUsername: USER_A,
      audioStream: liveAudio("s1"),
    }),
  );
  const outcome = reconcileCommit(commit, elements, ownership, {
    previousRemotes,
    newlyAttachedKeys: new Set([key]),
  });
  assert.equal(reactRemotes, null);
  assert.equal(commit.projection.selectedIds.has("E1"), true);
  assert.deepEqual(outcome.playKeys, [key]);
  assert.equal(elements.get(key)!.playCalls, 1);
});

test("R9-01 E1-S1 selected and playing then E1-S2 replacement pauses S1 and plays S2 immediately", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "s1" });
  const s1 = elements.get(remoteAudioElementKey("E1", "s1"))!;
  assert.equal(s1.paused, false);
  const replacement = attachRemoteAudioLikeHook({
    owner,
    elements,
    ownership,
    endpointId: "E1",
    streamId: "s2",
  });
  const s2 = elements.get(remoteAudioElementKey("E1", "s2"))!;
  assert.equal(replacement.selectedIds.has("E1"), true);
  assert.equal(s1.paused, true);
  assert.equal(replacement.pauseKeys.includes(remoteAudioElementKey("E1", "s1")), true);
  assert.deepEqual(replacement.playKeys, [remoteAudioElementKey("E1", "s2")]);
  assert.equal(s2.playCalls, 1);
  assert.equal(s2.paused, false);
  assert.equal(
    selectedRemoteAudioStreamIdsByEndpoint(replacement.remotes, replacement.selectedIds).get("E1"),
    "s2",
  );
});

test("R9-02 S2 appears before RemoteMediaRemoved(S1) and only S2 is playback eligible", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "s1" });
  const after = attachRemoteAudioLikeHook({
    owner,
    elements,
    ownership,
    endpointId: "E1",
    streamId: "s2",
  });
  assert.equal(elements.has(remoteAudioElementKey("E1", "s1")), true);
  assert.equal(elements.has(remoteAudioElementKey("E1", "s2")), true);
  assert.deepEqual(after.playKeys, [remoteAudioElementKey("E1", "s2")]);
  assert.equal(after.pauseKeys.includes(remoteAudioElementKey("E1", "s1")), true);
  assert.equal(elements.get(remoteAudioElementKey("E1", "s1"))!.paused, true);
  assert.equal(elements.get(remoteAudioElementKey("E1", "s2"))!.paused, false);
});

test("R9-03 late RemoteMediaRemoved(S1) leaves S2 selected and playing", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "s1" });
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "s2" });
  const s2 = elements.get(remoteAudioElementKey("E1", "s2"))!;
  const s2PauseBefore = s2.pauseCalls;
  const s2PlayBefore = s2.playCalls;
  detachRemoteAudioLikeHook(elements, ownership, "E1", "s1");
  const previousRemotes = [...owner.remotes];
  const afterRemoval = owner.commit((current) =>
    upsertVoxRoomRemoteParticipant(current, {
      id: "E1",
      displayName: "A",
      endpointUsername: USER_A,
      stream: liveVideo("E1-v"),
      audioStream: liveAudio("s2"),
    }),
  );
  const outcome = reconcileCommit(afterRemoval, elements, ownership, { previousRemotes });
  assert.equal(afterRemoval.projection.selectedIds.has("E1"), true);
  assert.equal(
    selectedRemoteAudioStreamIdsByEndpoint(
      afterRemoval.remotes,
      afterRemoval.projection.selectedIds,
    ).get("E1"),
    "s2",
  );
  assert.equal(elements.has(remoteAudioElementKey("E1", "s1")), false);
  assert.equal(s2.paused, false);
  assert.equal(s2.pauseCalls, s2PauseBefore);
  assert.equal(s2.playCalls, s2PlayBefore);
  assert.equal(outcome.pauseKeys.includes(remoteAudioElementKey("E1", "s2")), false);
});

test("R9-04 late S1 Stream ENDED cannot pause or replace S2", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "s1" });
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "s2" });
  const s2 = elements.get(remoteAudioElementKey("E1", "s2"))!;
  const pauseBefore = s2.pauseCalls;
  detachRemoteAudioLikeHook(elements, ownership, "E1", "s1");
  const previousRemotes = [...owner.remotes];
  const afterEnded = owner.commit((current) =>
    current.map((item) =>
      item.id === "E1" ? { ...item, audioStream: liveAudio("s2") } : item,
    ),
  );
  reconcileCommit(afterEnded, elements, ownership, { previousRemotes });
  assert.equal(afterEnded.remotes[0]?.audioStream?.id, "s2");
  assert.equal(s2.paused, false);
  assert.equal(s2.pauseCalls, pauseBefore);
  assert.equal(s2.playCalls, 1);
});

test("R9-05 manual unlock with obsolete S1 and current S2 paused plays only S2", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  const s1 = fakeAudio(true);
  const s2 = fakeAudio(true);
  bindElement(elements, ownership, "E1", "s1", s1);
  bindElement(elements, ownership, "E1", "s2", s2);
  const commit = owner.commit([remote("E1", { audioStream: liveAudio("s2") })]);
  const outcome = reconcileCommit(commit, elements, ownership, {
    previousRemotes: commit.remotes,
    unlock: true,
  });
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("E1", "s2")]);
  assert.equal(outcome.pauseKeys.includes(remoteAudioElementKey("E1", "s1")), true);
  assert.equal(s2.playCalls, 1);
  assert.equal(s1.playCalls, 0);
  assert.equal(s1.paused, true);
});

test("R9-06 same endpoint with multiple stale audio elements plays only the current projected stream", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  const staleA = fakeAudio(true);
  const staleB = fakeAudio(true);
  const current = fakeAudio(true);
  bindElement(elements, ownership, "E1", "stale-a", staleA);
  bindElement(elements, ownership, "E1", "stale-b", staleB);
  bindElement(elements, ownership, "E1", "current", current);
  const commit = owner.commit([remote("E1", { audioStream: liveAudio("current") })]);
  const outcome = reconcileCommit(commit, elements, ownership, {
    previousRemotes: [],
    newlyAttachedKeys: new Set([remoteAudioElementKey("E1", "current")]),
  });
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("E1", "current")]);
  assert.equal(outcome.pauseKeys.includes(remoteAudioElementKey("E1", "stale-a")), true);
  assert.equal(outcome.pauseKeys.includes(remoteAudioElementKey("E1", "stale-b")), true);
  assert.equal(current.playCalls, 1);
  assert.equal(staleA.playCalls, 0);
  assert.equal(staleB.playCalls, 0);
  assert.equal(staleA.paused, true);
  assert.equal(staleB.paused, true);
});

test("R9-07 endpoint switch E1-S1 → E2-S2 pauses S1 and plays S2", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  const s1 = fakeAudio(false);
  const s2 = fakeAudio(true);
  bindElement(elements, ownership, "E1", "s1", s1);
  bindElement(elements, ownership, "E2", "s2", s2);
  owner.commit([remote("E1", { audioStream: liveAudio("s1") })]);
  const previousRemotes = [...owner.remotes];
  const switched = owner.commit((current) => [
    ...current.map((item) =>
      item.id === "E1"
        ? { ...item, stream: endedVideo("E1-v"), audioStream: endedAudio("s1") }
        : item,
    ),
    remote("E2", { audioStream: liveAudio("s2") }),
  ]);
  const outcome = reconcileCommit(switched, elements, ownership, { previousRemotes });
  assert.equal(switched.projection.selectedIds.has("E2"), true);
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("E2", "s2")]);
  assert.equal(outcome.pauseKeys.includes(remoteAudioElementKey("E1", "s1")), true);
  assert.equal(s1.paused, true);
  assert.equal(s2.playCalls, 1);
});

test("R9-08 same-endpoint replacement does not require a React state flush", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "s1" });
  const replacement = attachRemoteAudioLikeHook({
    owner,
    elements,
    ownership,
    endpointId: "E1",
    streamId: "s2",
  });
  assert.equal(replacement.reactStateFlushed, false);
  assert.equal(elements.get(remoteAudioElementKey("E1", "s1"))!.paused, true);
  assert.equal(elements.get(remoteAudioElementKey("E1", "s2"))!.playCalls, 1);
});

test("R9-09 same-endpoint replacement does not require a reconciliation poll", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  attachRemoteAudioLikeHook({ owner, elements, ownership, endpointId: "E1", streamId: "s1" });
  const previousRemotes = [...owner.remotes];
  const s2 = fakeAudio(true);
  bindElement(elements, ownership, "E1", "s2", s2);
  const commit = owner.commit((current) =>
    upsertVoxRoomRemoteParticipant(current, {
      id: "E1",
      displayName: "A",
      endpointUsername: USER_A,
      audioStream: liveAudio("s2"),
    }),
  );
  const outcome = reconcileCommit(commit, elements, ownership, { previousRemotes });
  assert.equal(elements.get(remoteAudioElementKey("E1", "s1"))!.paused, true);
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("E1", "s2")]);
  assert.equal(s2.playCalls, 1);

  const helper = readFileSync("lib/voximplant/remote-audio-playback.ts", "utf-8");
  const hook = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const attach = hook.match(/const attachRemoteAudioStream = useCallback\([\s\S]*?\n  \);/);
  assert.ok(attach);
  assert.doesNotMatch(helper, /\bsetTimeout\b/);
  assert.doesNotMatch(helper, /\bsetInterval\b/);
  assert.doesNotMatch(attach[0]!, /\bsetTimeout\b/);
  assert.doesNotMatch(attach[0]!, /\bsetInterval\b/);
  assert.doesNotMatch(attach[0]!, /resyncEndpoints/);
  assert.doesNotMatch(attach[0]!, /fetch\s*\(/);
});

test("R9-10 autoplay block on current S2 leaves obsolete S1 paused", async () => {
  const blocked = Object.assign(new Error("NotAllowedError: play()"), { name: "NotAllowedError" });
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  const s1 = fakeAudio(false);
  const s2 = fakeAudio(true, blocked);
  bindElement(elements, ownership, "E1", "s1", s1);
  bindElement(elements, ownership, "E1", "s2", s2);
  owner.commit([remote("E1", { audioStream: liveAudio("s1") })]);
  const previousRemotes = [...owner.remotes];
  const commit = owner.commit((current) =>
    upsertVoxRoomRemoteParticipant(current, {
      id: "E1",
      displayName: "A",
      endpointUsername: USER_A,
      audioStream: liveAudio("s2"),
    }),
  );
  const outcome = reconcileCommit(commit, elements, ownership, {
    previousRemotes,
    newlyAttachedKeys: new Set([remoteAudioElementKey("E1", "s2")]),
  });
  assert.deepEqual(outcome.playKeys, [remoteAudioElementKey("E1", "s2")]);
  const playError = await outcome.playResults[0]!.result.then(
    () => null,
    (error: unknown) => error,
  );
  assert.equal(isRemoteAudioAutoplayBlock(playError), true);
  assert.equal(s1.paused, true);
  assert.equal(s1.playCalls, 0);
  assert.equal(s2.playCalls, 1);
  assert.equal(s2.paused, true);
});

test("R9-11 multiple logical participants play one current stream each and keep stale streams paused", () => {
  const owner = createPeerMediaSelectionOwner<PeerMediaRemote>();
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  const aStale = fakeAudio(true);
  const aCurrent = fakeAudio(true);
  const bStale = fakeAudio(true);
  const bCurrent = fakeAudio(true);
  bindElement(elements, ownership, "EA", "stale", aStale);
  bindElement(elements, ownership, "EA", "live", aCurrent);
  bindElement(elements, ownership, "EB", "old", bStale);
  bindElement(elements, ownership, "EB", "now", bCurrent);
  const commit = owner.commit([
    remote("EA", { endpointUsername: USER_A, audioStream: liveAudio("live") }),
    remote("EB", {
      displayName: "B",
      endpointUsername: USER_B,
      audioStream: liveAudio("now"),
    }),
  ]);
  const outcome = reconcileCommit(commit, elements, ownership, {
    previousRemotes: [],
    newlyAttachedKeys: new Set([
      remoteAudioElementKey("EA", "live"),
      remoteAudioElementKey("EB", "now"),
    ]),
  });
  assert.equal(commit.projection.selectedIds.has("EA"), true);
  assert.equal(commit.projection.selectedIds.has("EB"), true);
  assert.deepEqual(
    [...outcome.playKeys].sort(),
    [remoteAudioElementKey("EA", "live"), remoteAudioElementKey("EB", "now")].sort(),
  );
  assert.equal(aCurrent.playCalls, 1);
  assert.equal(bCurrent.playCalls, 1);
  assert.equal(aStale.playCalls, 0);
  assert.equal(bStale.playCalls, 0);
  assert.equal(aStale.paused, true);
  assert.equal(bStale.paused, true);
});

test("R9-12 hyphenated endpoint and stream ids cannot confuse ownership", () => {
  const collidingConcat = "ep-z-a-b";
  assert.equal(`${"ep-z"}-${"a-b"}`, collidingConcat);
  assert.equal(`${"ep-z-a"}-${"b"}`, collidingConcat);
  assert.notEqual(remoteAudioElementKey("ep-z", "a-b"), remoteAudioElementKey("ep-z-a", "b"));

  const current = fakeAudio(true);
  const other = fakeAudio(true);
  const elements = new Map<string, FakeAudio>();
  const ownership = new Map<string, RemoteAudioElementOwnership>();
  bindElement(elements, ownership, "ep-z", "a-b", current);
  bindElement(elements, ownership, "ep-z-a", "b", other);
  const remotes = [
    remote("ep-z", { audioStream: liveAudio("a-b") }),
    remote("ep-z-a", { audioStream: liveAudio("b") }),
  ];
  const plan = planRemoteAudioPlayback({
    selectedEndpointIds: new Set(["ep-z"]),
    selectedAudioStreamIdsByEndpoint: selectedRemoteAudioStreamIdsByEndpoint(
      remotes,
      new Set(["ep-z"]),
    ),
    newlyAttachedKeys: new Set([remoteAudioElementKey("ep-z", "a-b")]),
    elements: [
      {
        key: remoteAudioElementKey("ep-z", "a-b"),
        endpointId: "ep-z",
        streamId: "a-b",
        paused: true,
      },
      {
        key: remoteAudioElementKey("ep-z-a", "b"),
        endpointId: "ep-z-a",
        streamId: "b",
        paused: true,
      },
    ],
  });
  assert.deepEqual(plan.playKeys, [remoteAudioElementKey("ep-z", "a-b")]);
  assert.deepEqual(plan.pauseKeys, [remoteAudioElementKey("ep-z-a", "b")]);

  const found = findRemoteAudioElementKey(ownership, "ep-z", "a-b");
  assert.equal(found, remoteAudioElementKey("ep-z", "a-b"));
  assert.notEqual(found, remoteAudioElementKey("ep-z-a", "b"));
});

test("session-room hook wiring registers audio before commit and unlocks selected current stream only", () => {
  const hook = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const attach = hook.match(
    /const attachRemoteAudioStream = useCallback\([\s\S]*?\n  \);/,
  );
  assert.ok(attach);
  const setIndex = attach[0]!.indexOf("rt.remoteAudioElements.set(key, audio)");
  const commitIndex = attach[0]!.indexOf("commitRemoteParticipants");
  assert.ok(setIndex >= 0 && commitIndex > setIndex);
  assert.match(attach[0]!, /newlyAttachedAudioKeys/);
  assert.match(attach[0]!, /remoteAudioElementKey/);
  assert.match(attach[0]!, /audioStream:\s*ms/);
  assert.doesNotMatch(attach[0]!, /remoteParticipantsRef\.current/);
  assert.doesNotMatch(attach[0]!, /\bawait\b/);

  const reconcileSelected = hook.match(
    /const reconcileSelectedRemoteAudioPlayback = useCallback\([\s\S]*?\n  \);/,
  );
  assert.ok(reconcileSelected);
  assert.match(reconcileSelected[0]!, /remotes:\s*input\.remotes/);
  assert.match(reconcileSelected[0]!, /elementOwnership:\s*runtime\.remoteAudioOwnership/);
  assert.match(hook, /previousRemotes/);

  const helper = readFileSync("lib/voximplant/remote-audio-playback.ts", "utf-8");
  assert.doesNotMatch(helper, /\bawait\b/);
  assert.doesNotMatch(helper, /\bfetch\s*\(/);
  assert.doesNotMatch(helper, /\bsetTimeout\b/);
  assert.doesNotMatch(helper, /startsWith/);
  assert.match(helper, /selectedRemoteAudioStreamIdsByEndpoint/);
  assert.match(hook, /unlock:\s*true/);
  assert.doesNotMatch(hook, /for \(const audio of rt\.remoteAudioElements\.values\(\)\)/);
  assert.doesNotMatch(hook, /const prefix = `\$\{endpointId\}-/);
});
