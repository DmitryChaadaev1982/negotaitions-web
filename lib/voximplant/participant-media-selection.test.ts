import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { upsertLiveRemoteMedia } from "@/lib/voximplant/layer3-media-connectivity";
import { reconcileRemoteParticipantsFromSnapshot } from "@/lib/voximplant/endpoint-reconciliation";
import {
  inspectParticipantMediaCandidate,
  normalizeParticipantMediaIdentity,
  PARTICIPANT_MEDIA_TIE_BREAK,
  participantMediaCandidateFromRemote,
  projectSelectedPeerEndpoints,
  selectParticipantMediaByLogicalIdentity,
  selectParticipantMediaCandidate,
  type ParticipantMediaCandidate,
} from "@/lib/voximplant/participant-media-selection";
import { normalizeParticipantPresenceMedia } from "@/lib/voximplant/participant-presence-media-model";
import { createSessionRoomRecoveryRuntime } from "@/lib/voximplant/session-room-recovery.runtime";

const USER_A = "ng_u_aaaaaaaaaaaaaaaa";
const USER_A_SDK = `${USER_A}@app.voximplant.com`;

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

function liveVideo(id = "video-live"): MediaStream {
  return makeStream([makeTrack("video", "live")], id);
}

function liveAudio(id = "audio-live"): MediaStream {
  return makeStream([makeTrack("audio", "live")], id);
}

function endedVideo(id = "video-ended"): MediaStream {
  return makeStream([makeTrack("video", "ended")], id);
}

function endedAudio(id = "audio-ended"): MediaStream {
  return makeStream([makeTrack("audio", "ended")], id);
}

function candidate(
  endpointId: string,
  overrides: Partial<ParticipantMediaCandidate> = {},
): ParticipantMediaCandidate {
  return {
    endpointId,
    endpointUsername: USER_A,
    ...overrides,
  };
}

function selectedEndpoint(
  candidates: readonly ParticipantMediaCandidate[],
  previouslySelectedEndpointId?: string | null,
): string | null {
  return (
    selectParticipantMediaCandidate(candidates, { previouslySelectedEndpointId }).selected
      ?.endpointId ?? null
  );
}

function observerSelectedEndpoint(
  remotes: Array<{
    id: string;
    endpointUsername?: string | null;
    generation?: number;
    streamLive?: boolean;
    audioLive?: boolean;
  }>,
  username = USER_A,
): string | null {
  const identity = normalizeParticipantMediaIdentity(username);
  const grouped = selectParticipantMediaByLogicalIdentity(
    remotes.map(participantMediaCandidateFromRemote),
  );
  return grouped.get(identity ?? "")?.selected?.endpointId ?? null;
}

function seededObserverPair() {
  const recovering = createSessionRoomRecoveryRuntime({
    sessionId: "session-bug04-b",
    connectionId: "conn-a",
  });
  const observer = createSessionRoomRecoveryRuntime({
    sessionId: "session-bug04-b",
    connectionId: "conn-b",
  });
  const recoveringGen = recovering.beginGeneration();
  const observerGen = observer.beginGeneration();
  recovering.markJoined(recoveringGen);
  observer.markJoined(observerGen);
  return { recovering, observer, recoveringGen, observerGen };
}

test("logical participant identity is normalized Vox username, not endpoint id", () => {
  assert.equal(normalizeParticipantMediaIdentity(USER_A_SDK), USER_A);
  assert.equal(normalizeParticipantMediaIdentity(` ${USER_A.toUpperCase()} `), USER_A);
  const grouped = selectParticipantMediaByLogicalIdentity([
    candidate("ep-old", { endpointUsername: USER_A_SDK, videoStream: endedVideo() }),
    candidate("ep-new", { endpointUsername: USER_A, videoStream: liveVideo() }),
  ]);
  assert.equal(grouped.size, 1);
  assert.equal(grouped.get(USER_A)?.selected?.endpointId, "ep-new");
});

test("B01 observer selects live E2 after E1 media becomes unusable without Refresh", () => {
  const { observer, observerGen } = seededObserverPair();
  observer.upsertRemote(observerGen, {
    id: "E1",
    displayName: "A",
    endpointUsername: USER_A,
    streamLive: true,
    audioLive: true,
  });
  observer.applyStreamEnded(observerGen, "E1", "video");
  observer.applyStreamEnded(observerGen, "E1", "audio");
  observer.applyLiveRemoteMedia(observerGen, {
    id: "E2",
    displayName: "A",
    endpointUsername: USER_A,
    streamLive: true,
    audioLive: true,
  });
  assert.equal(observerSelectedEndpoint(observer.getState().remotes), "E2");
  assert.equal(
    observer.getState().remotes.map((remote) => remote.id).sort().join(","),
    "E1,E2",
  );
  assert.deepEqual(observer.getState().healthyFastPathSteps, [
    "usable_media",
    "remote_state_update",
    "tile_eligible",
  ]);
});

test("B02 E2 appears before E1 EndpointRemoved: one logical participant and live E2 wins", () => {
  const overlap = selectParticipantMediaCandidate([
    candidate("E1", { videoStream: endedVideo(), audioStream: endedAudio() }),
    candidate("E2", { videoStream: liveVideo(), audioStream: liveAudio() }),
  ]);
  assert.equal(overlap.logicalIdentity, USER_A);
  assert.equal(overlap.selected?.endpointId, "E2");
  assert.deepEqual(overlap.suppressedEndpointIds, ["E1"]);
  const grouped = selectParticipantMediaByLogicalIdentity([
    candidate("E1", { videoStream: endedVideo(), audioStream: endedAudio() }),
    candidate("E2", { videoStream: liveVideo(), audioStream: liveAudio() }),
  ]);
  assert.equal(grouped.size, 1);
});

test("B03 late E1 EndpointRemoved leaves selected E2 stable", () => {
  const { observer, observerGen } = seededObserverPair();
  observer.upsertRemote(observerGen, {
    id: "E1",
    displayName: "A",
    endpointUsername: USER_A,
    streamLive: false,
    audioLive: false,
  });
  observer.applyLiveRemoteMedia(observerGen, {
    id: "E2",
    displayName: "A",
    endpointUsername: USER_A,
  });
  assert.equal(observerSelectedEndpoint(observer.getState().remotes), "E2");
  observer.applyEndpointRemoved(observerGen, "E1");
  assert.equal(observerSelectedEndpoint(observer.getState().remotes), "E2");
  assert.deepEqual(
    observer.getState().remotes.map((remote) => remote.id),
    ["E2"],
  );
});

test("B04 E1 remaining with ended tracks cannot beat live E2", () => {
  assert.equal(
    selectedEndpoint([
      candidate("E1", { videoStream: endedVideo(), audioStream: endedAudio() }),
      candidate("E2", { videoStream: liveVideo(), audioStream: liveAudio() }),
    ]),
    "E2",
  );
  assert.equal(
    inspectParticipantMediaCandidate(
      candidate("E1", { videoStream: endedVideo() }),
    ).quality,
    "unusable",
  );
  assert.notEqual(
    inspectParticipantMediaCandidate(
      candidate("E1", { videoStream: endedVideo() }),
    ).quality,
    inspectParticipantMediaCandidate(
      candidate("E2", { videoStream: liveVideo() }),
    ).quality,
  );
});

test("B05 same endpoint id replacement live stream wins immediately", () => {
  let remotes = [
    {
      id: "E1",
      endpointUsername: USER_A,
      stream: endedVideo("old"),
      audioStream: endedAudio("old-a"),
    },
  ];
  remotes = upsertLiveRemoteMedia({
    current: remotes,
    next: {
      id: "E1",
      endpointUsername: USER_A,
      stream: liveVideo("new"),
      audioStream: liveAudio("new-a"),
    },
  });
  assert.equal(remotes.length, 1);
  assert.equal(selectedEndpoint(remotes.map(participantMediaCandidateFromRemote)), "E1");
  assert.equal(
    inspectParticipantMediaCandidate(participantMediaCandidateFromRemote(remotes[0]!)).quality,
    "live_video",
  );
});

test("B06 RemoteMediaRemoved then RemoteMediaAdded keeps logical presence and restores media", () => {
  const { observer, observerGen } = seededObserverPair();
  observer.upsertRemote(observerGen, {
    id: "E1",
    displayName: "A",
    endpointUsername: USER_A,
  });
  observer.applyRemoteMediaRemoved(observerGen, "E1");
  const afterRemoved = observer.getState().remotes[0];
  assert.equal(afterRemoved?.id, "E1");
  assert.equal(afterRemoved?.streamLive, false);
  assert.equal(afterRemoved?.audioLive, false);
  assert.equal(observerSelectedEndpoint(observer.getState().remotes), "E1");
  const presentWithoutMedia = normalizeParticipantPresenceMedia({
    displayName: "A",
    connectedSignal: true,
    allowConnectedWithoutMediaTile: true,
    videoStream: endedVideo(),
    audioStream: endedAudio(),
  });
  assert.equal(presentWithoutMedia.connectionStatus, "connected");
  assert.equal(presentWithoutMedia.shouldRenderActiveTile, true);
  observer.applyLiveRemoteMedia(observerGen, {
    id: "E1",
    displayName: "A",
    endpointUsername: USER_A,
  });
  assert.equal(observerSelectedEndpoint(observer.getState().remotes), "E1");
  assert.equal(observer.getState().remotes[0]?.streamLive, true);
});

test("B07 old audio ending after replacement audio is live keeps replacement selected", () => {
  const first = selectParticipantMediaCandidate([
    candidate("E1", { audioStream: liveAudio("old"), videoStream: null }),
    candidate("E2", { audioStream: liveAudio("new"), videoStream: null }),
  ]);
  assert.equal(first.selected?.endpointId, "E1");
  const afterOldEnds = selectParticipantMediaCandidate(
    [
      candidate("E1", { audioStream: endedAudio("old"), videoStream: null }),
      candidate("E2", { audioStream: liveAudio("new"), videoStream: null }),
    ],
    { previouslySelectedEndpointId: first.selected?.endpointId },
  );
  assert.equal(afterOldEnds.selected?.endpointId, "E2");
  assert.equal(afterOldEnds.quality, "live_audio");
});

test("B08 old video ending after replacement video is live keeps replacement selected", () => {
  const afterOldEnds = selectParticipantMediaCandidate([
    candidate("E1", { videoStream: endedVideo("old") }),
    candidate("E2", { videoStream: liveVideo("new") }),
  ]);
  assert.equal(afterOldEnds.selected?.endpointId, "E2");
  assert.equal(afterOldEnds.quality, "live_video");
});

test("B09 both healthy candidates use a stable tie-break without flapping", () => {
  const healthy = [
    candidate("ep-z", { videoStream: liveVideo("z"), audioStream: liveAudio("z-a") }),
    candidate("ep-a", { videoStream: liveVideo("a"), audioStream: liveAudio("a-a") }),
  ];
  const first = selectedEndpoint(healthy);
  const reversed = selectedEndpoint([...healthy].reverse());
  assert.equal(first, "ep-a");
  assert.equal(reversed, "ep-a");
  assert.equal(selectedEndpoint(healthy, "ep-a"), "ep-a");
  assert.equal(selectedEndpoint(healthy, "ep-z"), "ep-z");
  assert.match(PARTICIPANT_MEDIA_TIE_BREAK, /lexicographic endpoint id/);
  assert.match(PARTICIPANT_MEDIA_TIE_BREAK, /previously selected/);
});

test("B10 no remote media with live Layer-1 lease is not logically absent", () => {
  const model = normalizeParticipantPresenceMedia({
    displayName: "A",
    connectedSignal: true,
    allowConnectedWithoutMediaTile: true,
    videoStream: endedVideo(),
    audioStream: endedAudio(),
  });
  assert.equal(model.connectionStatus, "connected");
  assert.equal(model.shouldRenderActiveTile, true);
  const layout = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  assert.match(layout, /isLogicallyPresent === false/);
  assert.match(layout, /allowConnectedWithoutMediaTile: true/);
  assert.doesNotMatch(
    layout,
    /isLogicallyPresent:\s*(?:track|readyState|streamLive)/,
  );
});

test("B11 healthy observer converges without scripted EndpointRemoved and without Refresh", () => {
  const { observer, observerGen } = seededObserverPair();
  observer.upsertRemote(observerGen, {
    id: "E1",
    displayName: "A",
    endpointUsername: USER_A,
    streamLive: true,
    audioLive: true,
  });
  observer.applyNativeTrackEnded(observerGen, "E1");
  observer.applyLiveRemoteMedia(observerGen, {
    id: "E2",
    displayName: "A",
    endpointUsername: USER_A,
    streamLive: true,
    audioLive: true,
  });
  const remotes = observer.getState().remotes;
  assert.equal(remotes.some((remote) => remote.id === "E1"), true);
  assert.equal(observerSelectedEndpoint(remotes), "E2");
  assert.equal(observer.getState().lastResyncCount, 0);
  assert.equal(observer.getState().rejoinAttempts, 0);
});

test("B12 two independent recovery episodes both converge", () => {
  const { observer, observerGen } = seededObserverPair();
  observer.upsertRemote(observerGen, {
    id: "E1",
    displayName: "A",
    endpointUsername: USER_A,
  });
  observer.applyStreamEnded(observerGen, "E1", "video");
  observer.applyStreamEnded(observerGen, "E1", "audio");
  observer.applyLiveRemoteMedia(observerGen, {
    id: "E2",
    displayName: "A",
    endpointUsername: USER_A,
  });
  assert.equal(observerSelectedEndpoint(observer.getState().remotes), "E2");
  observer.applyStreamEnded(observerGen, "E2", "video");
  observer.applyStreamEnded(observerGen, "E2", "audio");
  observer.applyLiveRemoteMedia(observerGen, {
    id: "E3",
    displayName: "A",
    endpointUsername: USER_A,
  });
  assert.equal(observerSelectedEndpoint(observer.getState().remotes), "E3");
});

test("B13 stale old-generation media cannot reclaim selection after newer generation is live", () => {
  const selected = selectParticipantMediaCandidate([
    candidate("E1", {
      generation: 4,
      videoLive: true,
      audioLive: true,
    }),
    candidate("E2", {
      generation: 5,
      videoLive: true,
      audioLive: true,
    }),
  ]);
  assert.equal(selected.selected?.endpointId, "E2");
  const reclaim = selectParticipantMediaCandidate(
    [
      candidate("E1", { generation: 4, videoLive: true, audioLive: true }),
      candidate("E2", { generation: 5, videoLive: true, audioLive: true }),
    ],
    { previouslySelectedEndpointId: "E2" },
  );
  assert.equal(reclaim.selected?.endpointId, "E2");
  const { observer } = seededObserverPair();
  const gen1 = observer.getState().generation;
  observer.upsertRemote(gen1, {
    id: "E2",
    displayName: "A",
    endpointUsername: USER_A,
  });
  observer.applyLiveRemoteMedia(gen1 - 1, {
    id: "E1",
    displayName: "A",
    endpointUsername: USER_A,
    streamLive: true,
    audioLive: true,
  });
  assert.equal(observerSelectedEndpoint(observer.getState().remotes), "E2");
  assert.equal(
    observer.getState().remotes.some((remote) => remote.id === "E1"),
    false,
  );
});

test("B14 standalone session and Event child session share participant selection semantics", () => {
  const roomPage = readFileSync("app/room/[sessionId]/page.tsx", "utf-8");
  const sessionPage = readFileSync(
    "components/voximplant-negotiation-room-page.tsx",
    "utf-8",
  );
  const layout = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  const hook = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const lobby = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(roomPage, /VoximplantNegotiationRoomPage/);
  assert.match(sessionPage, /useVoximplantRoom/);
  assert.match(sessionPage, /VoximplantVideoLayout/);
  assert.match(sessionPage, /selectedPeerEndpointIds=\{selectedPeerEndpointIds\}/);
  assert.match(layout, /selectedRemotesByLogicalIdentity/);
  assert.match(layout, /selectedPeerEndpointIds/);
  assert.match(hook, /createPeerMediaSelectionOwner/);
  assert.match(hook, /reconcileRemoteAudioPlayback/);
  assert.doesNotMatch(layout, /projectSelectedPeerEndpoints\(/);
  assert.doesNotMatch(lobby, /createBoundedProviderRejoin/);
  assert.doesNotMatch(lobby, /projectSelectedPeerEndpoints/);
  assert.doesNotMatch(lobby, /createPeerMediaSelectionOwner/);
});

test("stream object with ended tracks does not beat a live candidate", () => {
  const staleObject = candidate("E1", { videoStream: endedVideo("stale-object") });
  const live = candidate("E2", { videoStream: liveVideo("live") });
  assert.equal(Boolean(staleObject.videoStream), true);
  assert.equal(selectedEndpoint([staleObject, live]), "E2");
});

test("live video is preferred over live audio only", () => {
  assert.equal(
    selectedEndpoint([
      candidate("audio-only", { audioStream: liveAudio(), videoStream: null }),
      candidate("video", { videoStream: liveVideo(), audioStream: null }),
    ]),
    "video",
  );
});

test("background snapshot reconcile feeds the same selection helper", () => {
  const current = [
    { id: "E1", endpointUsername: USER_A, streamLive: false, audioLive: false, generation: 1 },
    { id: "E2", endpointUsername: USER_A, streamLive: true, audioLive: true, generation: 1 },
  ];
  const reconciled = reconcileRemoteParticipantsFromSnapshot({
    current,
    snapshotIds: new Set(["E1", "E2"]),
    conferenceConnected: true,
  });
  assert.equal(reconciled.next.length, 2);
  assert.equal(observerSelectedEndpoint(reconciled.next), "E2");
});

test("healthy fast path: first live candidate is selected synchronously in the same turn", () => {
  const helperSource = readFileSync("lib/voximplant/participant-media-selection.ts", "utf-8");
  assert.doesNotMatch(helperSource, /\bawait\b/);
  assert.doesNotMatch(helperSource, /\bfetch\s*\(/);
  assert.doesNotMatch(helperSource, /\bsetTimeout\b/);
  const projected = projectSelectedPeerEndpoints([
    {
      id: "E1",
      endpointUsername: USER_A,
      stream: endedVideo(),
      audioStream: endedAudio(),
    },
    {
      id: "E2",
      endpointUsername: USER_A,
      stream: liveVideo(),
      audioStream: liveAudio(),
    },
  ]);
  assert.equal(projected.selectedIds.has("E2"), true);
  assert.equal(projected.selectedByIdentity.get(USER_A)?.id, "E2");
  const layout = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  assert.match(layout, /selectedRemotesByLogicalIdentity/);
  assert.match(layout, /selectedPeerEndpointIds/);
  assert.doesNotMatch(layout, /projectSelectedPeerEndpoints\(/);
  const onAdded = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8").match(
    /const onAdded = \(event: VoxEndpointMediaEvent\) => \{[\s\S]*?\n      \};/,
  );
  assert.ok(onAdded);
  assert.doesNotMatch(onAdded[0], /\bawait\b/);
  assert.doesNotMatch(onAdded[0], /fetch\(/);
  assert.doesNotMatch(onAdded[0], /setTimeout/);
});
