import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decide408Action,
  fenceGeneration,
  isSdkReconnecting,
  isTerminalConferenceIncident,
  layer3AfterSdkReconnectSettled,
  layer3BannerKind,
  LAYER3_RECOVERY_RECORDING_CONTROL,
  observeSdkReconnectTransition,
  sessionRoomProviderBannerKind,
} from "@/lib/voximplant/layer3-media-connectivity";
import {
  isAutomaticStopReceivingReason,
  isLiveMediaTrack,
  mediaStreamFromLiveVoxStream,
} from "@/lib/voximplant/media-liveness";
import { LAYER3_RECOVERY_MUST_NOT_DISPATCH_RECORDING } from "@/lib/voximplant/recording-start-guard";
import { createSessionRoomRecoveryRuntime } from "@/lib/voximplant/session-room-recovery.runtime";

function seeded() {
  const room = createSessionRoomRecoveryRuntime({
    sessionId: "bug04-session",
    connectionId: "conn-stable-1",
  });
  const generation = room.beginGeneration();
  room.markJoined(generation);
  room.upsertRemote(generation, {
    id: "ep-a",
    displayName: "A",
    endpointUsername: "ng_u_a",
  });
  return { room, generation };
}

test("A01 SDK RECONNECTING: no app join/connect/hangup; heartbeat/shell survive; Layer 3 recovering", () => {
  const { room } = seeded();
  const before = room.getState();
  room.observeSdkClientState("RECONNECTING");
  assert.equal(room.tryAppJoin(), false);
  assert.equal(room.tryAppConnect(), false);
  assert.equal(room.tryAppHangup(), false);
  assert.equal(room.tryAppDisconnect(), false);
  const after = room.getState();
  assert.equal(after.layer3, "reconnecting");
  assert.equal(after.shellMounted, true);
  assert.equal(after.heartbeatActive, true);
  assert.equal(after.conferenceJoinCount, before.conferenceJoinCount);
  assert.equal(after.clientConnectCount, before.clientConnectCount);
  assert.equal(after.conferenceHangupCount, before.conferenceHangupCount);
  assert.equal(after.clientDisconnectCount, before.clientDisconnectCount);
  assert.equal(layer3BannerKind({ status: "reconnecting", mediaUsable: true }), null);
  assert.equal(room.getBannerKind(), "reconnecting");
});

test("A02 SDK reconnect succeeds: Layer 3 connected; no full conference rejoin", () => {
  const { room } = seeded();
  room.observeSdkClientState("RECONNECTING");
  const joinsBefore = room.getState().conferenceJoinCount;
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  assert.equal(after.conferenceJoinCount, joinsBefore);
  assert.equal(isSdkReconnecting("LOGGED_IN", "CONNECTED"), false);
});

test("A03 connected-state transport 408 while media remains usable: no rejoin", () => {
  const { room } = seeded();
  const result = room.applyTransport408();
  assert.equal(result.action, "keep");
  assert.equal(result.rejoined, false);
  assert.equal(room.getState().rejoinAttempts, 0);
  assert.equal(decide408Action({
    sdkReconnecting: false,
    mediaUsable: true,
    conferenceTerminal: false,
  }), "keep");
});

test("A04 connected-state 408 while SDK RECONNECTING: SDK owns recovery; no app rejoin", () => {
  const { room } = seeded();
  room.observeSdkClientState("RECONNECTING");
  const result = room.applyTransport408();
  assert.equal(result.action, "observe_sdk");
  assert.equal(result.rejoined, false);
  assert.equal(room.getState().rejoinAttempts, 0);
  assert.equal(room.tryAppJoin(), false);
});

test("A05 conference Failed: old generation fenced BEFORE reset; new Conference; same connectionId", () => {
  const { room, generation } = seeded();
  const connectionId = room.getState().connectionId;
  const result = room.applyConferenceFailed(generation, "FAILED");
  assert.equal(result.rejoined, true);
  const after = room.getState();
  assert.ok(after.generation > generation);
  assert.deepEqual(after.eventOrder.slice(0, 2), ["fence", "reset"]);
  assert.equal(after.connectionId, connectionId);
  assert.equal(after.conferenceCreateCount, 1);
  assert.equal(after.conferenceJoinCount, 1);
  assert.equal(after.heartbeatActive, true);
  assert.equal(after.shellMounted, true);
  const fence = fenceGeneration(generation);
  assert.equal(fence.nextGeneration, generation + 1);
});

test("A06 unexpected terminal Disconnected CONNECTION_LOST: same terminal recovery contract", () => {
  const { room, generation } = seeded();
  const connectionId = room.getState().connectionId;
  const result = room.applyConnectionLost(generation);
  assert.equal(result.rejoined, true);
  const after = room.getState();
  assert.equal(after.eventOrder[0], "fence");
  assert.equal(after.connectionId, connectionId);
  assert.equal(after.heartbeatActive, true);
});

test("A07 second independent terminal incident after successful recovery still recovers", () => {
  const { room, generation } = seeded();
  room.applyConferenceFailed(generation, "FAILED");
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  const second = room.applyConferenceFailed(recovered, "FAILED");
  assert.equal(second.rejoined, true);
  assert.equal(room.getState().rejoinAttempts, 2);
});

test("A08 explicit Leave never auto-rejoins", () => {
  const { room, generation } = seeded();
  const result = room.applyDisconnect(generation, "explicit_leave");
  assert.equal(result.rejoined, false);
  assert.equal(room.getState().rejoinAttempts, 0);
});

test("A09 stale/superseded connection never auto-rejoins", () => {
  const room = createSessionRoomRecoveryRuntime({
    getStale: () => true,
  });
  const generation = room.beginGeneration();
  room.markJoined(generation);
  const result = room.applyDisconnect(generation, "stale_connection");
  assert.equal(result.rejoined, false);
  assert.equal(room.getState().rejoinAttempts, 0);
});

test("A10 late old-generation EndpointAdded after recovery begins is ignored", () => {
  const { room, generation } = seeded();
  room.applyConferenceFailed(generation, "FAILED");
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  room.upsertRemote(generation, { id: "ep-stale", displayName: "ghost" });
  assert.equal(
    room.getState().remotes.some((remote) => remote.id === "ep-stale"),
    false,
  );
});

test("A11 late old-generation RemoteMediaAdded / track callback is ignored", () => {
  const { room, generation } = seeded();
  room.applyConferenceFailed(generation, "FAILED");
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  room.applyLiveRemoteMedia(generation, { id: "ep-late", displayName: "late" });
  assert.equal(
    room.getState().healthyFastPathSteps.includes("ignored_fenced_generation"),
    true,
  );
  assert.equal(
    room.getState().remotes.some((remote) => remote.id === "ep-late"),
    false,
  );
});

test("A12 RemoteMediaRemoved / Stream Ended / native track ended hide media without Leave", () => {
  const { room, generation } = seeded();
  room.applyRemoteMediaRemoved(generation, "ep-a");
  room.applyStreamEnded(generation, "ep-a", "video");
  room.applyNativeTrackEnded(generation, "ep-a");
  const after = room.getState();
  assert.equal(after.remotes.some((remote) => remote.id === "ep-a"), true);
  assert.equal(after.remotes.find((remote) => remote.id === "ep-a")?.streamLive, false);
  assert.equal(after.rejoinAttempts, 0);
  assert.equal(after.heartbeatActive, true);
});

test("A13 Automatic StopReceiving: video paused on same stream; NO Layer3/rejoin", () => {
  const { room, generation } = seeded();
  assert.equal(isAutomaticStopReceivingReason("Automatic"), true);
  const beforeId = room.getState().remotes[0]?.videoStreamId;
  const result = room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(result.fullRejoin, false);
  assert.equal(room.getState().rejoinAttempts, 0);
  assert.equal(room.getState().remotes[0]?.streamLive, false);
  assert.equal(room.getState().remotes[0]?.videoReceiving, false);
  assert.equal(room.getState().remotes[0]?.videoStreamId, beforeId);
  assert.equal(room.getState().remotes[0]?.audioLive, true);
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  assert.equal(room.getState().transportRecoveryStatus, "stable");
});

test("A14 new live media after pause is restored immediately without Layer3 mutation", () => {
  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  room.applyLiveRemoteMedia(generation, { id: "ep-a", displayName: "A" });
  const after = room.getState();
  assert.deepEqual(after.healthyFastPathSteps, [
    "usable_media",
    "remote_state_update",
    "tile_eligible",
  ]);
  assert.equal(after.remotes[0]?.streamLive, true);
  assert.equal(after.remotes[0]?.videoReceiving, true);
  assert.equal(after.layer3, "connected");
  assert.equal(room.getBannerKind(), null);
});

test("A15 recoverable media failure keeps SharedRoomShell / heartbeat mounted", () => {
  const { room, generation } = seeded();
  room.applyConferenceFailed(generation, "FAILED");
  const after = room.getState();
  assert.equal(after.shellMounted, true);
  assert.equal(after.heartbeatActive, true);
  assert.equal(after.layer3, "recovering");
});

test("A16 terminal recovery does not re-fire recording START", () => {
  const { room, generation } = seeded();
  assert.equal(LAYER3_RECOVERY_RECORDING_CONTROL.start, false);
  assert.equal(LAYER3_RECOVERY_MUST_NOT_DISPATCH_RECORDING.start, false);
  room.requestRecordingStart();
  assert.equal(room.getState().recordingStartCount, 1);
  room.applyConferenceFailed(generation, "FAILED");
  room.requestRecordingStart();
  room.requestRecordingStop();
  assert.equal(room.getState().recordingStartCount, 1);
  assert.equal(room.getState().recordingStopCount, 0);
});

test("A17 healthy live RemoteMediaAdded path has no blocking recovery/reconciliation await", () => {
  const { room, generation } = seeded();
  const resyncBefore = room.getState().lastResyncCount;
  room.applyLiveRemoteMedia(generation, { id: "ep-b", displayName: "B" });
  const after = room.getState();
  assert.deepEqual(after.healthyFastPathSteps, [
    "usable_media",
    "remote_state_update",
    "tile_eligible",
  ]);
  assert.equal(after.lastResyncCount, resyncBefore);
  assert.equal(after.rejoinAttempts, 0);
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const onAdded = source.match(
    /const onAdded = \(event: VoxEndpointMediaEvent\) => \{[\s\S]*?\n      \};/,
  );
  assert.ok(onAdded, "RemoteMediaAdded handler must exist");
  assert.doesNotMatch(onAdded[0], /\bawait\b/);
  assert.doesNotMatch(onAdded[0], /fetch\(/);
  assert.doesNotMatch(onAdded[0], /resyncEndpoints/);
  assert.doesNotMatch(onAdded[0], /setTimeout/);
  assert.match(onAdded[0], /attachRemoteAudioStream|applyRemoteVideoStream/);
});

test("A18 Event child session and standalone session share session-room recovery", () => {
  const roomPage = readFileSync("app/room/[sessionId]/page.tsx", "utf-8");
  assert.match(roomPage, /VoximplantNegotiationRoomPage/);
  const sessionPage = readFileSync(
    "components/voximplant-negotiation-room-page.tsx",
    "utf-8",
  );
  assert.match(sessionPage, /useVoximplantRoom/);
  assert.match(sessionPage, /hasEnteredRoom/);
  assert.match(sessionPage, /SharedRoomShell/);
  const lobby = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.doesNotMatch(lobby, /createBoundedProviderRejoin/);
  assert.doesNotMatch(lobby, /recoverTerminalConference/);
});

test("live Vox stream helper rejects ended tracks", () => {
  assert.equal(isLiveMediaTrack({ readyState: "ended" } as MediaStreamTrack), false);
  assert.equal(isLiveMediaTrack({ readyState: "live" } as MediaStreamTrack), true);
  assert.equal(
    mediaStreamFromLiveVoxStream({
      track: { readyState: "ended" } as MediaStreamTrack,
    }),
    null,
  );
});

test("in-flight terminal recovery does not start a second join", () => {
  const { room, generation } = seeded();
  room.applyConferenceFailed(generation, "FAILED");
  const mid = room.getState().generation;
  const second = room.applyConferenceFailed(mid, "FAILED");
  assert.equal(second.rejoined, false);
  assert.equal(room.getState().rejoinAttempts, 1);
});

test("R1-01 CONNECTION_LOST while SDK RECONNECTING retains pending incident and does not join", () => {
  const { room, generation } = seeded();
  room.observeSdkClientState("RECONNECTING");
  const joinsBefore = room.getState().conferenceJoinCount;
  const result = room.applyConnectionLost(generation);
  assert.equal(result.rejoined, false);
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, true);
  assert.equal(after.conferenceJoinCount, joinsBefore);
  assert.equal(after.conferenceCreateCount, 0);
  assert.equal(room.tryAppJoin(), false);
  assert.equal(isTerminalConferenceIncident({
    kind: "disconnected",
    disconnectReason: "CONNECTION_LOST",
  }), true);
});

test("R1-02 SDK settle after deferred CONNECTION_LOST creates exactly one Conference with same connectionId", () => {
  const { room, generation } = seeded();
  const connectionId = room.getState().connectionId;
  room.observeSdkClientState("RECONNECTING");
  room.applyConnectionLost(generation);
  assert.equal(room.getState().pendingTerminalRecovery, true);
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, false);
  assert.equal(after.conferenceCreateCount, 1);
  assert.equal(after.conferenceJoinCount, 1);
  assert.equal(after.rejoinAttempts, 1);
  assert.equal(after.connectionId, connectionId);
  assert.equal(after.heartbeatActive, true);
});

test("R1-03 client and conference settle orders still recover exactly once", () => {
  const run = (order: "client-first" | "conference-first") => {
    const { room, generation } = seeded();
    room.observeSdkClientState("RECONNECTING");
    room.observeSdkConferenceState("RECONNECTING");
    room.applyConnectionLost(generation);
    assert.equal(room.getState().conferenceJoinCount, 0);
    if (order === "client-first") {
      room.observeSdkClientState("LOGGED_IN");
      assert.equal(room.getState().conferenceJoinCount, 0);
      room.observeSdkConferenceState("CONNECTED");
    } else {
      room.observeSdkConferenceState("CONNECTED");
      assert.equal(room.getState().conferenceJoinCount, 0);
      room.observeSdkClientState("LOGGED_IN");
    }
    const after = room.getState();
    assert.equal(after.conferenceJoinCount, 1);
    assert.equal(after.conferenceCreateCount, 1);
    assert.equal(after.sdkReconnectSettledCount, 1);
  };
  run("client-first");
  run("conference-first");
});

test("R1-04 pending terminal incident plus Leave before settle does not recover", () => {
  const { room, generation } = seeded();
  room.observeSdkClientState("RECONNECTING");
  room.applyConnectionLost(generation);
  const current = room.getState().generation;
  room.applyDisconnect(current, "explicit_leave");
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, false);
  assert.equal(after.rejoinAttempts, 0);
  assert.equal(after.conferenceJoinCount, 0);
});

test("R1-05 pending terminal incident plus stale takeover before settle does not recover", () => {
  const { room, generation } = seeded();
  room.observeSdkClientState("RECONNECTING");
  room.applyConnectionLost(generation);
  const current = room.getState().generation;
  room.applyDisconnect(current, "stale_connection");
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, false);
  assert.equal(after.rejoinAttempts, 0);
  assert.equal(after.conferenceJoinCount, 0);
});

test("R1-06 old generation callback after pending terminal incident is ignored", () => {
  const { room, generation } = seeded();
  room.observeSdkClientState("RECONNECTING");
  room.applyConnectionLost(generation);
  room.upsertRemote(generation, { id: "ep-ghost", displayName: "ghost" });
  room.applyLiveRemoteMedia(generation, { id: "ep-ghost", displayName: "ghost" });
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, true);
  assert.equal(after.remotes.some((remote) => remote.id === "ep-ghost"), false);
  assert.equal(after.conferenceJoinCount, 0);
});

test("R2-01 EndpointRemoved then late Stream ENDED cannot resurrect the endpoint", () => {
  const { room, generation } = seeded();
  assert.equal(room.attachStreamLiveness(generation, "ep-a", "stream-a"), true);
  room.applyEndpointRemoved(generation, "ep-a");
  assert.equal(room.getState().remotes.some((remote) => remote.id === "ep-a"), false);
  room.emitStreamEnded("ep-a", "stream-a");
  assert.equal(room.getState().remotes.some((remote) => remote.id === "ep-a"), false);
});

test("R2-02 EndpointRemoved then late native track ended cannot resurrect the endpoint", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "stream-a");
  room.applyEndpointRemoved(generation, "ep-a");
  room.emitNativeTrackEnded("ep-a", "stream-a");
  assert.equal(room.getState().remotes.some((remote) => remote.id === "ep-a"), false);
});

test("R2-03 same stream encountered twice does not duplicate liveness listeners", () => {
  const { room, generation } = seeded();
  assert.equal(room.attachStreamLiveness(generation, "ep-a", "stream-a"), true);
  assert.equal(room.attachStreamLiveness(generation, "ep-a", "stream-a"), false);
  assert.equal(room.getState().streamLivenessCount, 1);
});

test("R2-04 terminal Conference teardown removes all endpoint-owned liveness subscriptions", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "stream-a");
  room.attachStreamLiveness(generation, "ep-b", "stream-b");
  room.applyConferenceFailed(generation, "FAILED");
  assert.equal(room.getState().streamLivenessCount, 0);
  room.emitStreamEnded("ep-a", "stream-a");
  room.emitNativeTrackEnded("ep-b", "stream-b");
  assert.equal(room.getState().remotes.length, 0);
});

test("R2-05 old endpoint liveness cannot mutate a new endpoint with the same username", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "stream-old");
  room.applyEndpointRemoved(generation, "ep-a");
  room.upsertRemote(generation, {
    id: "ep-a-new",
    displayName: "A",
    endpointUsername: "ng_u_a",
  });
  room.attachStreamLiveness(generation, "ep-a-new", "stream-new");
  room.emitStreamEnded("ep-a", "stream-old");
  const after = room.getState();
  assert.equal(after.remotes.some((remote) => remote.id === "ep-a"), false);
  assert.equal(after.remotes.some((remote) => remote.id === "ep-a-new"), true);
});

test("R3-01 initial SDK state sequence with zero remotes stays non-degraded and is not recovery", () => {
  const room = createSessionRoomRecoveryRuntime();
  room.beginGeneration();
  room.observeSdkClientState("CREATED");
  room.observeSdkClientState("CONNECTING");
  room.observeSdkClientState("CONNECTED");
  room.observeSdkClientState("LOGGED_IN");
  room.observeSdkConferenceState("CREATED");
  room.observeSdkConferenceState("CONNECTING");
  room.observeSdkConferenceState("CONNECTED");
  const layer3 = room.getLayer3();
  const after = room.getState();
  assert.equal(layer3.hasEnteredRoom, false);
  assert.equal(layer3.status, "connected");
  assert.equal(after.sdkReconnectSettledCount, 0);
  assert.equal(after.sdkReconnectedLogCount, 0);
  assert.equal(after.lastResyncCount, 0);
  assert.equal(room.getBannerKind(), null);
});

test("R3-02 initial SDK sequence with remotes does not require recovery resync before media render", () => {
  const { room, generation } = seeded();
  const resyncBefore = room.getState().lastResyncCount;
  room.observeSdkClientState("CONNECTED");
  room.observeSdkClientState("LOGGED_IN");
  room.observeSdkConferenceState("CONNECTED");
  room.applyLiveRemoteMedia(generation, { id: "ep-b", displayName: "B" });
  const after = room.getState();
  assert.equal(after.lastResyncCount, resyncBefore);
  assert.equal(after.sdkReconnectSettledCount, 0);
  assert.deepEqual(after.healthyFastPathSteps, [
    "usable_media",
    "remote_state_update",
    "tile_eligible",
  ]);
});

test("R3-03 RECONNECTING to CONNECTED settles recovery exactly once", () => {
  const { room } = seeded();
  room.observeSdkClientState("RECONNECTING");
  room.observeSdkClientState("CONNECTED");
  const after = room.getState();
  assert.equal(after.sdkReconnectSettledCount, 1);
  assert.equal(after.sdkReconnectedLogCount, 1);
  assert.equal(after.layer3, "connected");
  assert.equal(after.lastResyncCount, 1);
});

test("R3-04 client and conference settle callbacks do not duplicate the reconnect episode", () => {
  const { room } = seeded();
  room.observeSdkClientState("RECONNECTING");
  room.observeSdkConferenceState("RECONNECTING");
  room.observeSdkClientState("LOGGED_IN");
  room.observeSdkConferenceState("CONNECTED");
  const after = room.getState();
  assert.equal(after.sdkReconnectSettledCount, 1);
  assert.equal(after.sdkReconnectedLogCount, 1);
});

test("R3-05 healthy single-user room with no remotes is not DEGRADED", () => {
  const room = createSessionRoomRecoveryRuntime();
  const generation = room.beginGeneration();
  room.markJoined(generation);
  room.observeSdkClientState("LOGGED_IN");
  room.observeSdkConferenceState("CONNECTED");
  const layer3 = room.getLayer3();
  assert.equal(layer3.status, "connected");
  assert.equal(room.getBannerKind(), null);
  assert.equal(
    layer3AfterSdkReconnectSettled({
      ...layer3,
      status: "reconnecting",
      reason: null,
    }).status,
    "connected",
  );
});

test("R3-06 remote stream ended does not keep Layer3 degraded after SDK settle", () => {
  const { room, generation } = seeded();
  room.applyStreamEnded(generation, "ep-a", "video");
  room.applyStreamEnded(generation, "ep-a", "audio");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  room.observeSdkClientState("RECONNECTING");
  assert.equal(room.getBannerKind(), "reconnecting");
  room.observeSdkClientState("LOGGED_IN");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  room.applyLiveRemoteMedia(generation, { id: "ep-a", displayName: "A" });
  assert.equal(room.getState().layer3, "connected");
});

test("actual hook R1: onDisconnected retains terminal recovery instead of dropping it during SDK reconnect", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const onDisconnected = source.match(
    /const onDisconnected = \(event: VoxConferenceEvent\) => \{[\s\S]*?\n          \};/,
  );
  assert.ok(onDisconnected, "onDisconnected handler must exist");
  assert.match(onDisconnected[0], /isTerminalConferenceIncident/);
  assert.match(onDisconnected[0], /fenceCurrentGeneration/);
  assert.match(onDisconnected[0], /recoverTerminalConferenceRef/);
  assert.doesNotMatch(onDisconnected[0], /sdkReconnecting,/);
  assert.doesNotMatch(
    onDisconnected[0],
    /if \(!terminal\) \{[\s\S]*hasEnteredRoom: true[\s\S]*return;/,
  );
  assert.match(source, /retainPendingTerminalIncident/);
  assert.match(source, /shouldDeferTerminalRecovery/);
});

test("actual hook R2: unsubscribeEndpoint disposes endpoint-owned liveness listeners", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const unsubscribe = source.match(
    /const unsubscribeEndpoint = useCallback\(\(runtime: RuntimeState, endpointId: string\) => \{[\s\S]*?\}, \[detachRemoteAudioStreams\]\);/,
  );
  assert.ok(unsubscribe, "unsubscribeEndpoint must exist");
  assert.match(unsubscribe[0], /disposeEndpointStreamLiveness/);
  assert.match(source, /bindEndpointStreamLiveness/);
  assert.match(source, /streamLivenessByEndpoint/);
  assert.doesNotMatch(source, /streamLivenessCleanups/);
});

test("actual hook R3: watchSdkStates treats only RECONNECTING edges as recovery", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  assert.match(source, /observeSdkReconnectTransition/);
  const handleChange = source.match(/const handleChange = \(\) => \{[\s\S]*?\n      \};/);
  assert.ok(handleChange, "SDK state handleChange must exist");
  const beforeSettled = handleChange[0].split("episodeSettled")[0];
  assert.doesNotMatch(beforeSettled, /event: "sdk_reconnected"/);
  assert.match(handleChange[0], /episodeStarted/);
  assert.match(handleChange[0], /episodeSettled/);
  assert.doesNotMatch(handleChange[0], /hasEnteredRoom: true/);
  assert.doesNotMatch(handleChange[0], /mediaUsable/);
  assert.match(handleChange[0], /layer3AfterSdkReconnectSettled/);
});

test("healthy fast path remains event-driven with no Connected-state render gate", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const onAdded = source.match(
    /const onAdded = \(event: VoxEndpointMediaEvent\) => \{[\s\S]*?\n      \};/,
  );
  assert.ok(onAdded, "RemoteMediaAdded handler must exist");
  assert.doesNotMatch(onAdded[0], /\bawait\b/);
  assert.doesNotMatch(onAdded[0], /fetch\(/);
  assert.doesNotMatch(onAdded[0], /resyncEndpoints/);
  assert.doesNotMatch(onAdded[0], /episodeSettled/);
  assert.doesNotMatch(onAdded[0], /conferenceConnected/);
  assert.equal(
    observeSdkReconnectTransition({
      wasReconnecting: false,
      clientState: "CONNECTED",
      conferenceState: "CONNECTED",
    }).episodeSettled,
    false,
  );
});

test("R4-01 late generation N Connected after N+1 is current does not mutate conferenceConnected", () => {
  const { room, generation } = seeded();
  const oldConference = room.getCurrentConference();
  const oldCallbacks = room.getConferenceCallbacks(oldConference);
  assert.ok(oldCallbacks);
  room.applyConferenceFailed(generation, "FAILED");
  const before = room.getState().conferenceConnected;
  assert.equal(before, false);
  oldCallbacks.onConnected();
  assert.equal(room.getState().conferenceConnected, before);
});

test("R4-02 late generation N Disconnected after N+1 is healthy leaves conferenceConnected true", () => {
  const { room, generation } = seeded();
  const oldConference = room.getCurrentConference();
  const oldCallbacks = room.getConferenceCallbacks(oldConference);
  assert.ok(oldCallbacks);
  room.applyConferenceFailed(generation, "FAILED");
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  assert.equal(room.getState().conferenceConnected, true);
  oldCallbacks.onDisconnected("CONNECTION_LOST");
  assert.equal(room.getState().conferenceConnected, true);
});

test("R4-03 late generation N Failed after N+1 starts does not start or fail recovery", () => {
  const { room, generation } = seeded();
  const oldConference = room.getCurrentConference();
  const oldCallbacks = room.getConferenceCallbacks(oldConference);
  assert.ok(oldCallbacks);
  room.applyConferenceFailed(generation, "FAILED");
  const attempts = room.getState().rejoinAttempts;
  const recovery = room.getState().recovery;
  oldCallbacks.onFailed("FAILED");
  const after = room.getState();
  assert.equal(after.rejoinAttempts, attempts);
  assert.equal(after.recovery, recovery);
  assert.notEqual(after.recovery, "failed");
});

test("R4-04 old conference-state watcher cannot overwrite the new Conference projection", () => {
  const { room, generation } = seeded();
  const oldConference = room.getCurrentConference();
  const oldWatch = room.getConferenceCallbacks(oldConference)?.watch;
  assert.ok(oldWatch);
  room.applyConferenceFailed(generation, "FAILED");
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  const live = room.getCurrentConference();
  assert.ok(live);
  assert.notEqual(live.id, oldConference?.id);
  room.getConferenceCallbacks(live)?.watch("CONNECTED");
  assert.equal(room.getState().sdkConferenceState, "CONNECTED");
  oldWatch("RECONNECTING");
  assert.equal(room.getState().sdkConferenceState, "CONNECTED");
});

test("R4-05 late old watcher cannot create a false RECONNECTING or false settle edge", () => {
  const { room, generation } = seeded();
  const oldConference = room.getCurrentConference();
  const oldWatch = room.getConferenceCallbacks(oldConference)?.watch;
  assert.ok(oldWatch);
  room.applyConferenceFailed(generation, "FAILED");
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  const settledBefore = room.getState().sdkReconnectSettledCount;
  oldWatch("RECONNECTING");
  oldWatch("CONNECTED");
  const after = room.getState();
  assert.equal(after.sdkReconnectSettledCount, settledBefore);
  assert.notEqual(after.layer3, "reconnecting");
  assert.equal(after.sdkConferenceState !== "RECONNECTING", true);
});

test("R4-06 pending terminal incident during SDK reconnect still flushes exactly once", () => {
  const { room, generation } = seeded();
  const stillCurrent = room.getCurrentConference();
  const currentWatch = room.getConferenceCallbacks(stillCurrent)?.watch;
  assert.ok(currentWatch);
  room.observeSdkClientState("RECONNECTING");
  room.applyConnectionLost(generation);
  assert.equal(room.getState().pendingTerminalRecovery, true);
  assert.equal(room.getState().conferenceJoinCount, 0);
  currentWatch("DISCONNECTED");
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, false);
  assert.equal(after.conferenceCreateCount, 1);
  assert.equal(after.conferenceJoinCount, 1);
  assert.equal(after.rejoinAttempts, 1);
});

test("actual hook R4: Conference callbacks guard ownership before conferenceConnected mutation", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  for (const name of ["onConnected", "onFailed", "onDisconnected"] as const) {
    const block = source.match(
      new RegExp(`const ${name} = [\\s\\S]*?runtime\\.conferenceConnected =`),
    );
    assert.ok(block, `${name} must assign conferenceConnected`);
    const guardAt = block[0].indexOf("shouldApplyConferenceCallback");
    const mutateAt = block[0].indexOf("conferenceConnected =");
    assert.ok(guardAt >= 0 && guardAt < mutateAt, `${name} must guard before mutation`);
  }
  assert.match(source, /isAuthoritativeConferenceStateWatcher/);
  const watchAssign = source.match(
    /isAuthoritativeConferenceStateWatcher[\s\S]*?sdkConferenceStateRef\.current = next/,
  );
  assert.ok(watchAssign, "conference watcher must validate ownership before writing");
});

test("R5-01 SDK reconnect before join pauses the same attempt instead of failing", () => {
  const { room, generation } = seeded();
  room.onRecoveryPhase((phase) => {
    if (phase === "created") {
      room.observeSdkClientState("RECONNECTING");
    }
  });
  const result = room.applyConferenceFailed(generation, "FAILED");
  assert.equal(result.rejoined, false);
  const after = room.getState();
  assert.equal(after.conferenceCreateCount, 1);
  assert.equal(after.conferenceJoinCount, 0);
  assert.equal(after.recovery, "recovering");
  assert.equal(after.recoveryAttempt, "paused_for_sdk_reconnect");
  assert.notEqual(after.recovery, "failed");
  assert.equal(after.pendingTerminalRecovery, true);
  assert.equal(room.tryAppJoin(), false);
});

test("R5-02 SDK settle resumes the same incident exactly once and joins", () => {
  const { room, generation } = seeded();
  const connectionId = room.getState().connectionId;
  room.onRecoveryPhase((phase) => {
    if (phase === "created") {
      room.observeSdkClientState("RECONNECTING");
    }
  });
  room.applyConferenceFailed(generation, "FAILED");
  room.onRecoveryPhase(null);
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, false);
  assert.equal(after.conferenceCreateCount, 1);
  assert.equal(after.conferenceJoinCount, 1);
  assert.equal(after.rejoinAttempts, 1);
  assert.equal(after.connectionId, connectionId);
  assert.equal(after.heartbeatActive, true);
});

test("R5-03 SDK reconnect after audio add and before video/join stays paused", () => {
  const { room, generation } = seeded();
  room.onRecoveryPhase((phase) => {
    if (phase === "audio_added") {
      room.observeSdkClientState("RECONNECTING");
    }
  });
  room.applyConferenceFailed(generation, "FAILED");
  const paused = room.getState();
  assert.equal(paused.conferenceJoinCount, 0);
  assert.equal(paused.recoveryAttempt, "paused_for_sdk_reconnect");
  assert.deepEqual(paused.eventOrder.includes("audio_added"), true);
  room.onRecoveryPhase(null);
  room.observeSdkClientState("LOGGED_IN");
  assert.equal(room.getState().conferenceJoinCount, 1);
  assert.equal(room.getState().rejoinAttempts, 1);
});

test("R5-04 two SDK reconnects during one incident stay bounded with one join", () => {
  const { room, generation } = seeded();
  let reconnects = 0;
  room.onRecoveryPhase((phase) => {
    if (phase === "created" && reconnects === 0) {
      reconnects = 1;
      room.observeSdkClientState("RECONNECTING");
      return;
    }
    if (phase === "before_join" && reconnects === 1) {
      reconnects = 2;
      room.observeSdkClientState("RECONNECTING");
    }
  });
  room.applyConferenceFailed(generation, "FAILED");
  assert.equal(room.getState().conferenceJoinCount, 0);
  room.observeSdkClientState("LOGGED_IN");
  assert.equal(room.getState().conferenceJoinCount, 0);
  assert.equal(room.getState().recoveryAttempt, "paused_for_sdk_reconnect");
  room.observeSdkClientState("RECONNECTING");
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.conferenceCreateCount, 1);
  assert.equal(after.conferenceJoinCount, 1);
  assert.equal(after.rejoinAttempts, 1);
});

test("R5-05 Leave while recovery is paused cancels resume", () => {
  const { room, generation } = seeded();
  room.onRecoveryPhase((phase) => {
    if (phase === "created") room.observeSdkClientState("RECONNECTING");
  });
  room.applyConferenceFailed(generation, "FAILED");
  const current = room.getState().generation;
  room.applyDisconnect(current, "explicit_leave");
  room.onRecoveryPhase(null);
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, false);
  assert.equal(after.conferenceJoinCount, 0);
  assert.equal(after.recoveryAttempt, "ready");
});

test("R5-06 stale takeover while paused does not resume", () => {
  const { room, generation } = seeded();
  room.onRecoveryPhase((phase) => {
    if (phase === "created") room.observeSdkClientState("RECONNECTING");
  });
  room.applyConferenceFailed(generation, "FAILED");
  const current = room.getState().generation;
  room.applyDisconnect(current, "stale_connection");
  room.onRecoveryPhase(null);
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, false);
  assert.equal(after.conferenceJoinCount, 0);
  assert.equal(after.recoveryAttempt, "ready");
});

test("R5-07 stable provider plus join failure is one bounded FAILED result", () => {
  const { room, generation } = seeded();
  room.setRecoveryJoinFailure(true);
  const result = room.applyConferenceFailed(generation, "FAILED");
  assert.equal(result.rejoined, false);
  const after = room.getState();
  assert.equal(after.recovery, "failed");
  assert.equal(after.recoveryAttempt, "failed");
  assert.equal(after.rejoinAttempts, 1);
  assert.equal(after.conferenceJoinCount, 1);
  const second = room.applyConferenceFailed(after.generation, "FAILED");
  assert.equal(second.rejoined, false);
  assert.equal(room.getState().rejoinAttempts, 1);
  assert.equal(room.getState().conferenceJoinCount, 1);
});

test("R5-08 successful recovery still allows a later independent incident", () => {
  const { room, generation } = seeded();
  room.applyConferenceFailed(generation, "FAILED");
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  const second = room.applyConferenceFailed(recovered, "FAILED");
  assert.equal(second.rejoined, true);
  assert.equal(room.getState().rejoinAttempts, 2);
});

test("R5-09 pause and resume do not dispatch recording START/STOP", () => {
  const { room, generation } = seeded();
  room.requestRecordingStart();
  assert.equal(room.getState().recordingStartCount, 1);
  room.onRecoveryPhase((phase) => {
    if (phase === "created") room.observeSdkClientState("RECONNECTING");
  });
  room.applyConferenceFailed(generation, "FAILED");
  room.requestRecordingStart();
  room.requestRecordingStop();
  room.onRecoveryPhase(null);
  room.observeSdkClientState("LOGGED_IN");
  room.requestRecordingStart();
  room.requestRecordingStop();
  assert.equal(room.getState().recordingStartCount, 1);
  assert.equal(room.getState().recordingStopCount, 0);
});

test("actual hook R5: paused already_in_flight does not fail the attempt", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  assert.match(source, /boundedRejoinRef\.current\.pause\(/);
  assert.match(source, /boundedRejoinRef\.current\.resume\(/);
  assert.match(source, /decision\.reason !== "already_in_flight"/);
  assert.match(source, /continueTerminalRecoveryJoin/);
});

test("R6-01 RemoteMediaRemoved disposes the exact S1 liveness binding", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "s1");
  room.attachStreamLiveness(generation, "ep-a", "s2");
  room.applyRemoteMediaRemoved(generation, "ep-a", {
    streamId: "s1",
    remainingStreamLive: true,
    remainingAudioLive: true,
  });
  assert.equal(room.hasStreamLiveness("ep-a", "s1"), false);
  assert.equal(room.hasStreamLiveness("ep-a", "s2"), true);
});

test("R6-02 late S1 Stream ENDED cannot degrade replacement S2 video", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "s1");
  room.attachStreamLiveness(generation, "ep-a", "s2");
  room.applyRemoteMediaRemoved(generation, "ep-a", {
    streamId: "s1",
    remainingStreamLive: true,
    remainingAudioLive: true,
  });
  room.emitStreamEnded("ep-a", "s1");
  const after = room.getState();
  assert.equal(after.remotes.find((remote) => remote.id === "ep-a")?.streamLive, true);
  assert.equal(after.layer3, "connected");
  assert.equal(after.rejoinAttempts, 0);
});

test("R6-03 late S1 native ended cannot degrade replacement S2 video", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "s1");
  room.attachStreamLiveness(generation, "ep-a", "s2");
  room.applyRemoteMediaRemoved(generation, "ep-a", {
    streamId: "s1",
    remainingStreamLive: true,
    remainingAudioLive: true,
  });
  room.emitNativeTrackEnded("ep-a", "s1");
  const after = room.getState();
  assert.equal(after.remotes.find((remote) => remote.id === "ep-a")?.streamLive, true);
  assert.equal(after.layer3, "connected");
});

test("R6-04 late removed audio S1 cannot suppress replacement audio S2", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "audio-s1");
  room.attachStreamLiveness(generation, "ep-a", "audio-s2");
  room.applyRemoteMediaRemoved(generation, "ep-a", {
    streamId: "audio-s1",
    remainingStreamLive: true,
    remainingAudioLive: true,
  });
  room.emitStreamEnded("ep-a", "audio-s1");
  room.emitNativeTrackEnded("ep-a", "audio-s1");
  const remote = room.getState().remotes.find((item) => item.id === "ep-a");
  assert.equal(remote?.audioLive, true);
  assert.equal(room.hasStreamLiveness("ep-a", "audio-s2"), true);
});

test("R6-05 EndpointRemoved still disposes every endpoint stream binding", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "s1");
  room.attachStreamLiveness(generation, "ep-a", "s2");
  room.applyEndpointRemoved(generation, "ep-a");
  assert.equal(room.hasStreamLiveness("ep-a", "s1"), false);
  assert.equal(room.hasStreamLiveness("ep-a", "s2"), false);
  room.emitStreamEnded("ep-a", "s1");
  room.emitNativeTrackEnded("ep-a", "s2");
  assert.equal(room.getState().remotes.some((remote) => remote.id === "ep-a"), false);
});

test("R6-06 terminal Conference teardown still disposes every liveness binding", () => {
  const { room, generation } = seeded();
  room.attachStreamLiveness(generation, "ep-a", "s1");
  room.attachStreamLiveness(generation, "ep-a", "s2");
  room.applyConferenceFailed(generation, "FAILED");
  assert.equal(room.getState().streamLivenessCount, 0);
  room.emitStreamEnded("ep-a", "s1");
  room.emitNativeTrackEnded("ep-a", "s2");
  assert.equal(room.getState().remotes.length, 0);
});

test("actual hook R6: RemoteMediaRemoved disposes the stream-scoped liveness binding", () => {
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const onRemoved = source.match(
    /const onRemoved = \(event: VoxEndpointMediaEvent\) => \{[\s\S]*?\n      \};/,
  );
  assert.ok(onRemoved, "RemoteMediaRemoved handler must exist");
  assert.match(onRemoved[0], /disposeEndpointStreamLivenessBinding/);
  assert.match(onRemoved[0], /pruneMissingEndpointStreamLiveness/);
  assert.doesNotMatch(onRemoved[0], /\bawait\b/);
  assert.doesNotMatch(onRemoved[0], /fetch\(/);
});

test("R10 reconnect state clears after recovered transport without Refresh", () => {
  const { room } = seeded();
  room.observeSdkClientState("RECONNECTING");
  assert.equal(room.getState().layer3, "reconnecting");
  assert.equal(room.getBannerKind(), "reconnecting");
  room.observeSdkClientState("LOGGED_IN");
  assert.equal(room.getState().layer3, "connected");
  room.markTransportLost();
  assert.equal(
    sessionRoomProviderBannerKind({
      layer3Status: "connected",
      layer3Banner: null,
      transportRecoveryStatus: "lost",
    }),
    null,
  );
  assert.equal(room.getBannerKind(), null);
});

test("R11 recovered conference topology converges on current remotes", () => {
  const { room, generation } = seeded();
  room.observeSdkClientState("RECONNECTING");
  room.observeSdkClientState("LOGGED_IN");
  room.applyLiveRemoteMedia(generation, {
    id: "ep-a",
    displayName: "A",
    endpointUsername: "ng_u_a",
    streamLive: true,
    audioLive: true,
  });
  const after = room.getState();
  assert.equal(after.layer3, "connected");
  assert.equal(after.remotes.length, 1);
  assert.equal(after.remotes[0]?.id, "ep-a");
  assert.equal(after.remotes[0]?.streamLive, true);
  room.upsertRemote(generation - 1, { id: "ep-stale", displayName: "ghost" });
  assert.equal(
    room.getState().remotes.some((remote) => remote.id === "ep-stale"),
    false,
  );
});

test("R12 stream replacement after recovery selects the current stream only", () => {
  const { room, generation } = seeded();
  room.observeSdkClientState("RECONNECTING");
  room.observeSdkClientState("LOGGED_IN");
  room.applyLiveRemoteMedia(generation, {
    id: "ep-a",
    displayName: "A",
    endpointUsername: "ng_u_a",
    streamLive: false,
    audioLive: false,
  });
  room.applyLiveRemoteMedia(generation, {
    id: "ep-a",
    displayName: "A",
    endpointUsername: "ng_u_a",
    streamLive: true,
    audioLive: true,
  });
  const remote = room.getState().remotes.find((item) => item.id === "ep-a");
  assert.equal(room.getState().remotes.filter((item) => item.id === "ep-a").length, 1);
  assert.equal(remote?.streamLive, true);
  assert.equal(remote?.audioLive, true);
  assert.equal(room.getBannerKind(), null);
});

test("R13 stale callbacks cannot re-enter reconnecting or overwrite current media", () => {
  const { room, generation } = seeded();
  room.applyConferenceFailed(generation, "FAILED");
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  room.observeSdkClientState("RECONNECTING");
  assert.equal(room.getState().layer3, "reconnecting");
  room.observeSdkClientState("LOGGED_IN");
  room.applyLiveRemoteMedia(recovered, {
    id: "ep-current",
    displayName: "current",
    endpointUsername: "ng_u_a",
  });
  room.upsertRemote(generation, { id: "ep-stale", displayName: "ghost" });
  room.applyLiveRemoteMedia(generation, { id: "ep-late", displayName: "late" });
  const after = room.getState();
  assert.equal(after.layer3, "connected");
  assert.equal(after.remotes.some((remote) => remote.id === "ep-stale"), false);
  assert.equal(after.remotes.some((remote) => remote.id === "ep-late"), false);
  assert.equal(after.remotes.some((remote) => remote.id === "ep-current"), true);
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  assert.match(source, /transportRecoveryRef\.current\?\.noteRecovered\(\)/);
});

test("R14 a later independent reconnect incident can recover after the first", () => {
  const { room } = seeded();
  room.observeSdkClientState("RECONNECTING");
  room.observeSdkClientState("LOGGED_IN");
  assert.equal(room.getBannerKind(), null);
  room.observeSdkClientState("RECONNECTING");
  assert.equal(room.getBannerKind(), "reconnecting");
  room.observeSdkClientState("LOGGED_IN");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  assert.equal(room.getState().sdkReconnectSettledCount, 2);
});

test("R15 reconnect UI does not replace or structurally displace room content", () => {
  const shell = readFileSync("components/shared-room-shell.tsx", "utf-8");
  assert.match(shell, /data-testid="room-provider-banner-overlay"/);
  assert.match(shell, /absolute inset-x-0 top-0 z-20/);
  const overlay = shell.match(
    /providerBanner \? \([\s\S]*?Left column: video \+ controls/,
  );
  assert.ok(overlay, "providerBanner must be wrapped before the room column");
  assert.match(overlay[0], /room-provider-banner-overlay/);
  assert.doesNotMatch(
    overlay[0],
    /\{providerBanner\}\s*\n\s*\{?\s*\/\* Left column/,
  );
  const page = readFileSync("components/voximplant-negotiation-room-page.tsx", "utf-8");
  assert.doesNotMatch(
    page,
    /transportRecovery\.status === "recovering" \|\|/,
  );
  assert.doesNotMatch(
    page,
    /transportRecovery\.status === "lost" \|\| layer3BannerKindValue === "failed"/,
  );
});

test("R16 conference-level REMOTE_ENDED is a terminal membership-recovery candidate", () => {
  const { room, generation } = seeded();
  const result = room.applyRemoteEnded(generation);
  assert.equal(result.rejoined, true);
  assert.equal(room.getState().rejoinAttempts, 1);
  assert.equal(room.getState().conferenceCreateCount, 1);
  assert.equal(room.getState().conferenceJoinCount, 1);
  assert.equal(
    isTerminalConferenceIncident({
      kind: "disconnected",
      disconnectReason: "REMOTE_ENDED",
    }),
    true,
  );
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const onDisconnected = source.match(
    /const onDisconnected = \(event: VoxConferenceEvent\) => \{[\s\S]*?\n          \};/,
  );
  assert.ok(onDisconnected, "onDisconnected handler must exist");
  assert.match(onDisconnected[0], /ConferenceDisconnectReason\.RemoteEnded/);
  assert.match(onDisconnected[0], /isTerminalConferenceIncident/);
  assert.match(onDisconnected[0], /isLocalEndedDisconnectReason/);
  assert.doesNotMatch(onDisconnected[0], /isRemoteEndedDisconnectReason/);
});

test("R17 membership-loss while SDK is RECONNECTING defers recovery and does not join", () => {
  const { room, generation } = seeded();
  room.observeSdkClientState("RECONNECTING");
  const before = room.getState();
  const result = room.applyRemoteEnded(generation);
  assert.equal("deferred" in result && result.deferred, true);
  assert.equal(result.rejoined, false);
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, true);
  assert.equal(after.conferenceJoinCount, before.conferenceJoinCount);
  assert.equal(after.conferenceCreateCount, before.conferenceCreateCount);
  assert.equal(room.tryAppJoin(), false);
  assert.equal(room.tryAppConnect(), false);
  assert.equal(room.tryAppHangup(), false);
  assert.equal(room.tryAppDisconnect(), false);
});

test("R18 SDK settle with unresolved membership incident performs exactly one fresh Conference join", () => {
  const { room, generation } = seeded();
  const connectionId = room.getState().connectionId;
  room.observeSdkClientState("RECONNECTING");
  room.applyRemoteEnded(generation);
  assert.equal(room.getState().pendingTerminalRecovery, true);
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.pendingTerminalRecovery, false);
  assert.equal(after.conferenceCreateCount, 1);
  assert.equal(after.conferenceJoinCount, 1);
  assert.equal(after.rejoinAttempts, 1);
  assert.ok(after.eventOrder.includes("audio_added"));
  assert.ok(after.eventOrder.includes("video_added"));
  assert.equal(after.connectionId, connectionId);
  assert.ok(after.generation > generation);
});

test("R19 duplicate terminal-membership signals for the same incident recover once", () => {
  const { room, generation } = seeded();
  const oldConference = room.getCurrentConference();
  const oldCallbacks = room.getConferenceCallbacks(oldConference);
  assert.ok(oldCallbacks);
  room.observeSdkClientState("RECONNECTING");
  room.applyRemoteEnded(generation);
  room.applyRemoteEnded(generation);
  oldCallbacks.onDisconnected("REMOTE_ENDED");
  assert.equal(room.getState().pendingTerminalRecovery, true);
  assert.equal(room.getState().conferenceJoinCount, 0);
  room.observeSdkClientState("LOGGED_IN");
  const after = room.getState();
  assert.equal(after.conferenceCreateCount, 1);
  assert.equal(after.conferenceJoinCount, 1);
  assert.equal(after.rejoinAttempts, 1);
});

test("R20 ordinary remote lifecycle does not local-rejoin the Conference", () => {
  const { room, generation } = seeded();
  room.applyEndpointRemoved(generation, "ep-a");
  room.applyStreamEnded(generation, "ep-a", "video");
  room.applyNativeTrackEnded(generation, "ep-a");
  const after = room.getState();
  assert.equal(after.rejoinAttempts, 0);
  assert.equal(after.conferenceCreateCount, 0);
  assert.equal(after.conferenceJoinCount, 0);
  const localEnded = room.applyDisconnect(generation, "none", "LOCAL_ENDED");
  assert.equal(localEnded.rejoined, false);
  assert.equal(room.getState().rejoinAttempts, 0);
});

test("R21 old Conference callbacks cannot mutate state after membership recovery", () => {
  const { room, generation } = seeded();
  const oldConference = room.getCurrentConference();
  const oldCallbacks = room.getConferenceCallbacks(oldConference);
  assert.ok(oldCallbacks);
  room.applyRemoteEnded(generation);
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  room.upsertRemote(recovered, {
    id: "ep-current",
    displayName: "current",
    endpointUsername: "ng_u_a",
  });
  const joinsBefore = room.getState().conferenceJoinCount;
  oldCallbacks.onEndpointAdded("ep-stale");
  oldCallbacks.onDisconnected("REMOTE_ENDED");
  oldCallbacks.onFailed("FAILED");
  const after = room.getState();
  assert.equal(after.remotes.some((remote) => remote.id === "ep-stale"), false);
  assert.equal(after.remotes.some((remote) => remote.id === "ep-current"), true);
  assert.equal(after.conferenceJoinCount, joinsBefore);
  assert.equal(after.rejoinAttempts, 1);
  assert.equal(after.conferenceConnected, true);
});

test("R22 provider Conference recovery preserves the logical connectionId", () => {
  const { room, generation } = seeded();
  const before = room.getState();
  room.applyRemoteEnded(generation);
  const after = room.getState();
  assert.equal(after.connectionId, before.connectionId);
  assert.equal(after.heartbeatActive, true);
  assert.equal(after.shellMounted, true);
  assert.ok(after.generation > generation);
  assert.equal(after.eventOrder.includes("reset"), true);
});

test("R23 a later independent REMOTE_ENDED incident recovers again", () => {
  const { room, generation } = seeded();
  room.applyRemoteEnded(generation);
  const recovered = room.getState().generation;
  room.completeRejoin(true, recovered);
  const second = room.applyRemoteEnded(recovered);
  assert.equal(second.rejoined, true);
  assert.equal(room.getState().rejoinAttempts, 2);
  assert.equal(room.getState().conferenceCreateCount, 2);
  assert.equal(room.getState().conferenceJoinCount, 2);
});

test("R26 Automatic StopReceiving pauses remote video only; Layer3 stays local", () => {
  const { room, generation } = seeded();
  const streamId = room.getState().remotes[0]?.videoStreamId;
  const result = room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(result.fullRejoin, false);
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getLayer3().reason, null);
  assert.equal(room.getState().remotes[0]?.streamLive, false);
  assert.equal(room.getState().remotes[0]?.videoReceiving, false);
  assert.equal(room.getState().remotes[0]?.videoStreamId, streamId);
  assert.equal(room.getState().remotes[0]?.audioLive, true);
  assert.equal(room.getBannerKind(), null);
  assert.equal(room.getState().transportRecoveryStatus, "stable");
  assert.equal(room.getState().rejoinAttempts, 0);
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const onStopVideo = source.match(
    /const onStopVideo = \(event: VoxEndpointMediaEvent\) => \{[\s\S]*?\n      \};/,
  );
  assert.ok(onStopVideo, "StopReceivingVideoStream handler must exist");
  assert.match(onStopVideo[0], /isAutomaticStopReceivingReason/);
  assert.match(onStopVideo[0], /applyAutomaticStopReceivingOverlay/);
  assert.doesNotMatch(onStopVideo[0], /layer3AfterMediaDegraded/);
  assert.doesNotMatch(onStopVideo[0], /stop_receiving_automatic/);
  assert.doesNotMatch(onStopVideo[0], /stream:\s*null/);
});

test("R27 same-stream StartReceiving restores receive state without Layer3 mutation", () => {
  const { room, generation } = seeded();
  const streamId = room.getState().remotes[0]?.videoStreamId;
  room.applyAutomaticStopReceiving(generation, "ep-a");
  room.applyStartReceivingVideo(generation, "ep-a", {
    streamLive: true,
    audioLive: true,
    videoStreamId: streamId ?? undefined,
  });
  const after = room.getState();
  assert.equal(after.layer3, "connected");
  assert.equal(room.getLayer3().reason, null);
  assert.equal(after.remotes[0]?.streamLive, true);
  assert.equal(after.remotes[0]?.videoReceiving, true);
  assert.equal(after.remotes[0]?.videoStreamId, streamId);
  assert.equal(after.rejoinAttempts, 0);
  const source = readFileSync("lib/voximplant/use-voximplant-room.ts", "utf-8");
  const onStartVideo = source.match(
    /const onStartVideo = \(event: VoxEndpointMediaEvent\) => \{[\s\S]*?\n      \};/,
  );
  assert.ok(onStartVideo, "StartReceivingVideoStream handler must exist");
  assert.match(onStartVideo[0], /applyStartReceivingOverlay/);
  assert.match(onStartVideo[0], /applyRemoteVideoStream/);
  assert.doesNotMatch(onStartVideo[0], /layer3AfterUsableRemoteMedia/);
  assert.doesNotMatch(onStartVideo[0], /shouldClearAutomaticStopReceivingDegradation/);
  assert.doesNotMatch(onStartVideo[0], /\bawait\b/);
});

test("R28 old-generation StartReceiving cannot mutate current paused receive state", () => {
  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  room.applyStartReceivingVideo(generation - 1, "ep-a", {
    streamLive: true,
    audioLive: true,
  });
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getState().remotes[0]?.streamLive, false);
  assert.equal(room.getState().remotes[0]?.videoReceiving, false);
  const next = room.beginGeneration();
  room.markJoined(next);
  room.upsertRemote(next, { id: "ep-a", displayName: "A" });
  room.applyAutomaticStopReceiving(next, "ep-a");
  room.applyStartReceivingVideo(generation, "ep-a", {
    streamLive: true,
    audioLive: true,
  });
  assert.equal(room.getState().remotes[0]?.videoReceiving, false);
  assert.equal(room.getState().layer3, "connected");
});

test("R29 remote video pause never starts transportRecovery or a global banner", () => {
  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(room.getState().transportRecoveryStatus, "stable");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  room.observeSdkClientState("LOGGED_IN");
  room.observeSdkConferenceState("CONNECTED");
  assert.equal(room.getState().transportRecoveryStatus, "stable");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
});

test("R30 repeated StopReceiving → StartReceiving keeps Layer3 local and stream identity", () => {
  const { room, generation } = seeded();
  const streamId = room.getState().remotes[0]?.videoStreamId;
  room.applyAutomaticStopReceiving(generation, "ep-a");
  room.applyStartReceivingVideo(generation, "ep-a");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  assert.equal(room.getState().remotes[0]?.videoStreamId, streamId);
  room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getState().remotes[0]?.videoReceiving, false);
  room.applyStartReceivingVideo(generation, "ep-a");
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getState().remotes[0]?.videoReceiving, true);
  assert.equal(room.getState().rejoinAttempts, 0);
});

test("R31 remote StartReceiving does not own the global banner", () => {
  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(room.getBannerKind(), null);
  room.applyStartReceivingVideo(generation, "ep-a", {
    streamLive: true,
    audioLive: true,
  });
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  assert.equal(
    sessionRoomProviderBannerKind({
      layer3Status: "connected",
      layer3Banner: "degraded",
      transportRecoveryStatus: "stable",
    }),
    null,
  );
});

test("R32 paused video with healthy remote audio stays peer-local", () => {
  const { room, generation } = seeded();
  room.applyAutomaticStopReceiving(generation, "ep-a");
  assert.equal(room.getState().remotes[0]?.audioLive, true);
  assert.equal(room.getState().layer3, "connected");
  assert.equal(room.getBannerKind(), null);
  room.applyStartReceivingVideo(generation, "ep-a", {
    streamLive: false,
    audioLive: true,
    videoReceiving: true,
  });
  assert.equal(room.getState().remotes[0]?.streamLive, false);
  assert.equal(room.getState().layer3, "connected");
  room.applyStartReceivingVideo(generation, "ep-a", {
    streamLive: true,
    audioLive: true,
    videoReceiving: true,
  });
  assert.equal(room.getState().remotes[0]?.streamLive, true);
  assert.equal(room.getState().layer3, "connected");
});
