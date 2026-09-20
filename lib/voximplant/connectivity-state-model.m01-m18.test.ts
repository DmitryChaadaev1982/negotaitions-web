import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { inspectParticipantMediaCandidate } from "@/lib/voximplant/participant-media-selection";
import {
  isUsableRemoteVideo,
  projectRemoteVideoStream,
  resolveRemoteVideoReceiving,
} from "@/lib/voximplant/remote-media-receive-state";
import { resolveRoleSlotPresentation } from "@/lib/voximplant/room-layout-model";
import { createSessionRoomRecoveryRuntime } from "@/lib/voximplant/session-room-recovery.runtime";

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

function seeded(extra?: { id?: string; displayName?: string }) {
  const room = createSessionRoomRecoveryRuntime({
    sessionId: "bug04-state-model",
    connectionId: "conn-stable-1",
  });
  const generation = room.beginGeneration();
  room.markJoined(generation);
  room.observeSdkClientState("LOGGED_IN");
  room.observeSdkConferenceState("CONNECTED");
  room.upsertRemote(generation, {
    id: extra?.id ?? "ep-a",
    displayName: extra?.displayName ?? "A",
    endpointUsername: "ng_u_a",
    videoStreamId: `${extra?.id ?? "ep-a"}:video`,
    videoReceiving: true,
    streamLive: true,
    audioLive: true,
  });
  return { room, generation };
}

test("M01 remote Automatic Stop pauses video, keeps identity, no global banner", () => {
  const { room, generation } = seeded();
  const streamId = room.getState().remotes[0]?.videoStreamId;
  room.applyAutomaticStopReceiving(generation, "ep-a");
  const remote = room.getState().remotes[0];
  assert.equal(remote?.id, "ep-a");
  assert.equal(remote?.videoStreamId, streamId);
  assert.equal(remote?.videoReceiving, false);
  assert.equal(remote?.streamLive, false);
  assert.equal(remote?.audioLive, true);
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getState().transportRecoveryStatus, "stable");
  assert.equal(room.getBannerKind(), null);
});

test("M02 same-stream StartReceiving restores RECEIVING without Layer3 change", () => {
  const { room, generation } = seeded();
  const streamId = room.getState().remotes[0]?.videoStreamId;
  room.applyAutomaticStopReceiving(generation, "ep-a");
  const layer3Before = room.getLayer3();
  room.applyStartReceivingVideo(generation, "ep-a", { videoStreamId: streamId ?? undefined });
  const remote = room.getState().remotes[0];
  assert.equal(remote?.videoReceiving, true);
  assert.equal(remote?.streamLive, true);
  assert.equal(remote?.videoStreamId, streamId);
  assert.equal(room.getLayer3().status, layer3Before.status);
  assert.equal(room.getBannerKind(), null);
});

test("M03 paused live track cannot win live_video or be resurrected by reconcile", () => {
  const livePaused = makeStream([makeTrack("video", "live")], "paused-v");
  const inspected = inspectParticipantMediaCandidate({
    endpointId: "ep-a",
    videoStream: livePaused,
    videoReceiving: false,
  });
  assert.equal(inspected.quality, "media_absent");
  assert.equal(inspected.liveVideo, false);
  assert.equal(
    isUsableRemoteVideo({
      currentGeneration: true,
      trackLive: true,
      isReceiving: false,
    }),
    false,
  );
  const pausedSdkStream = projectRemoteVideoStream({
    streams: [
      {
        id: "ep-a:video",
        isReceiving: { value: false },
        sourceStream: livePaused,
      },
    ],
    currentGeneration: true,
  });
  assert.equal(pausedSdkStream.isReceiving, false);
  assert.equal(pausedSdkStream.usable, false);
  assert.equal(pausedSdkStream.streamId, "ep-a:video");

  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  room.reconcileRemoteVideoFromSdk(generation, "ep-a", {
    streamId: "ep-a:video",
    trackLive: true,
    sdkIsReceiving: undefined,
  });
  assert.equal(room.getState().remotes[0]?.videoReceiving, false);
  assert.equal(room.getState().remotes[0]?.streamLive, false);
});

test("M04 RemoteMediaAdded replacement becomes usable from SDK state", () => {
  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  room.applyLiveRemoteMedia(generation, {
    id: "ep-a",
    displayName: "A",
    videoStreamId: "ep-a:video-2",
    videoReceiving: true,
    streamLive: true,
  });
  const remote = room.getState().remotes[0];
  assert.equal(remote?.videoStreamId, "ep-a:video-2");
  assert.equal(remote?.videoReceiving, true);
  assert.equal(remote?.streamLive, true);
});

test("M05 RemoteMediaRemoved is lifecycle removal, not StopReceiving pause", () => {
  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(room.getState().remotes[0]?.videoStreamId, "ep-a:video");
  room.applyRemoteMediaRemoved(generation, "ep-a", {
    streamId: "ep-a:video",
    remainingStreamLive: false,
    remainingAudioLive: true,
  });
  const remote = room.getState().remotes[0];
  assert.equal(remote?.id, "ep-a");
  assert.equal(remote?.videoStreamId, null);
  assert.equal(remote?.streamLive, false);
  assert.equal(remote?.audioLive, true);
});

test("M06 logically present without endpoint is reconnecting; no global banner", () => {
  const { room } = seeded();
  room.applyEndpointRemoved(room.getState().generation, "ep-a");
  const slot = resolveRoleSlotPresentation({
    activeTile: null,
    logicallyPresentTile: { id: "participant-a" },
  });
  assert.equal(slot.kind, "media_unavailable");
  assert.equal(room.getBannerKind(), null);
  const layout = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  assert.match(layout, /room\.mediaReconnecting/);
});

test("M07 lease expiry / logical absence empties the slot without a global banner", () => {
  const { room } = seeded();
  const slot = resolveRoleSlotPresentation({
    activeTile: null,
    logicallyPresentTile: null,
  });
  assert.equal(slot.kind, "empty");
  assert.equal(room.getBannerKind(), null);
});

test("M08 remote EndpointRemoved is absent locally and does not raise the banner", () => {
  const { room, generation } = seeded();
  room.applyEndpointRemoved(generation, "ep-a");
  assert.equal(room.getState().remotes.some((remote) => remote.id === "ep-a"), false);
  assert.equal(room.getBannerKind(), null);
  assert.equal(room.getState().rejoinAttempts, 0);
});

test("M09 local SDK/Connection reconnecting shows the global banner", () => {
  const { room } = seeded();
  room.observeSdkClientState("RECONNECTING");
  assert.equal(room.getState().layer3, "reconnecting");
  assert.equal(room.getBannerKind(), "reconnecting");
});

test("M10 local Conference reconnecting/disconnected shows the global banner", () => {
  const { room } = seeded();
  room.observeSdkConferenceState("RECONNECTING");
  assert.equal(room.getBannerKind(), "reconnecting");
});

test("M11 local recovery clears the global banner automatically", () => {
  const { room } = seeded();
  room.observeSdkClientState("RECONNECTING");
  assert.equal(room.getBannerKind(), "reconnecting");
  room.observeSdkClientState("LOGGED_IN");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
});

test("M12 REMOTE_ENDED still performs one bounded fresh Conference recovery", () => {
  const { room, generation } = seeded();
  const result = room.applyRemoteEnded(generation);
  assert.equal(result.rejoined, true);
  assert.equal(room.getState().conferenceCreateCount, 1);
  assert.equal(room.getState().conferenceJoinCount, 1);
  assert.equal(room.getState().rejoinAttempts, 1);
});

test("M13 Automatic Stop while LOGGED_IN + CONNECTED does not mutate transportRecovery", () => {
  const { room, generation } = seeded();
  assert.equal(room.getState().sdkClientState, "LOGGED_IN");
  assert.equal(room.getState().sdkConferenceState, "CONNECTED");
  room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(room.getState().transportRecoveryStatus, "stable");
  assert.equal(room.getBannerKind(), null);
  assert.equal(room.getState().layer3, "connected");
});

test("M14 paused video keeps audio active and exposes tile copy", () => {
  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(room.getState().remotes[0]?.audioLive, true);
  const en = readFileSync("lib/i18n/dictionaries/en.ts", "utf-8");
  const ru = readFileSync("lib/i18n/dictionaries/ru.ts", "utf-8");
  assert.match(en, /videoTemporarilyUnavailable:\s*"Video temporarily unavailable"/);
  assert.match(ru, /videoTemporarilyUnavailable:\s*"Видео временно недоступно"/);
  const tile = readFileSync("components/voximplant-participant-tile.tsx", "utf-8");
  assert.match(tile, /vox-tile-video-unavailable/);
  const layout = readFileSync("components/voximplant-video-layout.tsx", "utf-8");
  assert.match(layout, /room\.videoTemporarilyUnavailable/);
});

test("M15 peer A pause does not contaminate peer B or global Layer3", () => {
  const { room, generation } = seeded();
  room.upsertRemote(generation, {
    id: "ep-b",
    displayName: "B",
    endpointUsername: "ng_u_b",
    videoStreamId: "ep-b:video",
    videoReceiving: true,
    streamLive: true,
    audioLive: true,
  });
  room.applyAutomaticStopReceiving(generation, "ep-a");
  const a = room.getState().remotes.find((remote) => remote.id === "ep-a");
  const b = room.getState().remotes.find((remote) => remote.id === "ep-b");
  assert.equal(a?.videoReceiving, false);
  assert.equal(b?.videoReceiving, true);
  assert.equal(b?.streamLive, true);
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
});

test("M16 paused alternate stream cannot win live-video over a receiving current stream", () => {
  const paused = {
    endpointId: "ep-old",
    endpointUsername: "ng_u_a",
    generation: 1,
    videoStream: makeStream([makeTrack("video", "live")], "old"),
    videoReceiving: false,
  };
  const current = {
    endpointId: "ep-new",
    endpointUsername: "ng_u_a",
    generation: 1,
    videoStream: makeStream([makeTrack("video", "live")], "new"),
    videoReceiving: true,
  };
  assert.equal(inspectParticipantMediaCandidate(paused).quality, "media_absent");
  assert.equal(inspectParticipantMediaCandidate(current).quality, "live_video");
  const projected = projectRemoteVideoStream({
    streams: [
      { id: "old", isReceiving: { value: false }, sourceStream: paused.videoStream },
      { id: "new", isReceiving: { value: true }, sourceStream: current.videoStream },
    ],
    currentGeneration: true,
  });
  assert.equal(projected.streamId, "new");
  assert.equal(projected.usable, true);
});

test("M17 stale old-generation Stop/Start cannot mutate current media state", () => {
  const { room, generation } = seeded();
  const next = room.beginGeneration();
  room.markJoined(next);
  room.upsertRemote(next, {
    id: "ep-a",
    displayName: "A",
    videoStreamId: "ep-a:video",
    videoReceiving: true,
    streamLive: true,
    audioLive: true,
  });
  room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(room.getState().remotes[0]?.videoReceiving, true);
  room.applyStartReceivingVideo(generation, "ep-a", { videoReceiving: false });
  assert.equal(room.getState().remotes[0]?.videoReceiving, true);
});

test("M18 Event Lobby uses the same Stop/Start receive-state model", () => {
  const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(source, /StopReceivingVideoStream/);
  assert.match(source, /StartReceivingVideoStream/);
  assert.match(source, /applyAutomaticStopReceivingOverlay/);
  assert.match(source, /applyStartReceivingOverlay/);
  assert.match(source, /projectRemoteVideoStream/);
  assert.match(source, /videoReceiving/);
  assert.match(source, /room\.videoTemporarilyUnavailable/);
  assert.match(source, /isReceiving\?: VoxWatchable<boolean>/);
  assert.doesNotMatch(source, /layer3AfterMediaDegraded/);
  assert.doesNotMatch(source, /createSessionTransportRecovery/);
});

test("receive-state overlay wins over unknown SDK isReceiving", () => {
  assert.equal(
    resolveRemoteVideoReceiving({ overlayIsReceiving: false, sdkIsReceiving: undefined }),
    false,
  );
  assert.equal(
    resolveRemoteVideoReceiving({ overlayIsReceiving: true, sdkIsReceiving: false }),
    true,
  );
  const overlayPaused = projectRemoteVideoStream({
    streams: [
      {
        id: "s1",
        isReceiving: { value: true },
        sourceStream: makeStream([makeTrack("video", "live")], "s1"),
      },
    ],
    currentGeneration: true,
    overlayByStreamId: new Map([["s1", false]]),
  });
  assert.equal(overlayPaused.isReceiving, false);
  assert.equal(overlayPaused.usable, false);
});
