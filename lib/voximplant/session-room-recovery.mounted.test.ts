import assert from "node:assert/strict";
import test from "node:test";

import { normalizeParticipantPresenceMedia } from "@/lib/voximplant/participant-presence-media-model";
import { createSessionRoomRecoveryRuntime } from "@/lib/voximplant/session-room-recovery.runtime";

function liveTileEligible(input: {
  joined: boolean;
  matchedRemote: boolean;
  isLogicallyAbsent?: boolean;
}) {
  return normalizeParticipantPresenceMedia({
    displayName: "Remote",
    connectedSignal:
      Boolean(input.joined && input.matchedRemote) && input.isLogicallyAbsent !== true,
    allowConnectedWithoutMediaTile: true,
  }).shouldRenderActiveTile;
}

function mountRoomWithTwoRemotes() {
  const room = createSessionRoomRecoveryRuntime({
    sessionId: "cmt8lfu7w0000w9m1xq6hlfpj",
  });
  const generation = room.beginGeneration();
  room.markJoined(generation);
  room.upsertRemote(generation, {
    id: "ep-masha",
    displayName: "Masha",
    endpointUsername: "ng_u_723f1edf72e3eabe",
  });
  room.upsertRemote(generation, {
    id: "ep-dmitry",
    displayName: "Dmitry",
    endpointUsername: "ng_u_fc343e6eb09ad230",
  });
  return { room, generation };
}

test("M01 unexpected provider disconnect hides both remote tiles immediately", () => {
  const { room, generation } = mountRoomWithTwoRemotes();
  assert.equal(room.getState().remotes.length, 2);
  assert.equal(
    liveTileEligible({ joined: true, matchedRemote: true }),
    true,
  );

  room.applyDisconnect(generation, "none");
  const state = room.getState();
  assert.equal(state.joined, false);
  assert.equal(state.remotes.length, 0);
  assert.equal(
    liveTileEligible({ joined: state.joined, matchedRemote: state.remotes.length > 0 }),
    false,
  );
});

test("M02 bounded recovery rebuilds remotes from new endpoints", () => {
  const { room, generation } = mountRoomWithTwoRemotes();
  room.applyDisconnect(generation, "none");
  const recoveredGeneration = room.getState().generation;
  room.completeRejoin(true, recoveredGeneration);
  room.upsertRemote(recoveredGeneration, {
    id: "ep-masha-new",
    displayName: "Masha",
    endpointUsername: "ng_u_723f1edf72e3eabe",
  });
  room.upsertRemote(recoveredGeneration, {
    id: "ep-dmitry-new",
    displayName: "Dmitry",
    endpointUsername: "ng_u_fc343e6eb09ad230",
  });
  const state = room.getState();
  assert.equal(state.joined, true);
  assert.equal(state.generation !== generation, true);
  assert.deepEqual(
    state.remotes.map((remote) => remote.id),
    ["ep-masha-new", "ep-dmitry-new"],
  );
});

test("M03 old endpoint callback after recovery is ignored", () => {
  const { room, generation } = mountRoomWithTwoRemotes();
  room.applyDisconnect(generation, "none");
  const recoveredGeneration = room.getState().generation;
  room.completeRejoin(true, recoveredGeneration);
  room.upsertRemote(recoveredGeneration, {
    id: "ep-live",
    displayName: "Live",
  });
  room.upsertRemote(generation, {
    id: "ep-stale",
    displayName: "Stale ghost",
  });
  room.applyEndpointRemoved(generation, "ep-live");
  assert.deepEqual(
    room.getState().remotes.map((remote) => remote.id),
    ["ep-live"],
  );
});

test("M04 IceRestart timeout while connected does not clear or full-rejoin", () => {
  const { room, generation } = mountRoomWithTwoRemotes();
  const before = room.getState();
  const result = room.applyMediaRecoverySignal(
    generation,
    "media_recovery_failed:IceRestartAction",
  );
  const after = room.getState();
  assert.equal(result.fullRejoin, false);
  assert.equal(result.resync, true);
  assert.equal(after.joined, true);
  assert.equal(after.rejoinAttempts, 0);
  assert.equal(after.remotes.length, before.remotes.length);
  assert.equal(after.lastResyncCount, 1);
});

test("M05 camera Device in use leaves remotes intact", () => {
  const { room, generation } = mountRoomWithTwoRemotes();
  const result = room.applyMediaRecoverySignal(
    generation,
    "local_media_device_failure:NotReadableError",
  );
  const state = room.getState();
  assert.equal(result.fullRejoin, false);
  assert.equal(result.resync, false);
  assert.equal(state.cameraUnavailable, true);
  assert.equal(state.joined, true);
  assert.equal(state.remotes.length, 2);
});
