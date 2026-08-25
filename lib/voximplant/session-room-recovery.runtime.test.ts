import assert from "node:assert/strict";
import test from "node:test";

import { createSessionRoomRecoveryRuntime } from "@/lib/voximplant/session-room-recovery.runtime";

function seededRoom(options?: Parameters<typeof createSessionRoomRecoveryRuntime>[0]) {
  const room = createSessionRoomRecoveryRuntime(options ?? {});
  const generation = room.beginGeneration();
  room.markJoined(generation);
  room.upsertRemote(generation, { id: "ep-a", displayName: "A", endpointUsername: "ng_u_a" });
  room.upsertRemote(generation, { id: "ep-b", displayName: "B", endpointUsername: "ng_u_b" });
  return { room, generation };
}

test("U01 unexpected current-generation disconnect clears joined and remotes", () => {
  const { room, generation } = seededRoom({ getIntent: () => "none" });
  const result = room.applyDisconnect(generation, "none");
  const state = room.getState();
  assert.equal(state.joined, false);
  assert.equal(state.conferenceConnected, false);
  assert.deepEqual(state.remotes, []);
  assert.equal(result.kind, "unexpected");
});

test("U02 explicit Leave clears remotes and does not rejoin", () => {
  let rejoinCalls = 0;
  const { room, generation } = seededRoom({
    getIntent: () => "explicit_leave",
    onRejoin: () => {
      rejoinCalls += 1;
      return true;
    },
  });
  const result = room.applyDisconnect(generation, "explicit_leave");
  assert.equal(result.rejoined, false);
  assert.equal(rejoinCalls, 0);
  assert.deepEqual(room.getState().remotes, []);
  assert.equal(room.getState().recovery, "idle");
});

test("U03 unmount teardown does not rejoin", () => {
  let rejoinCalls = 0;
  const { room, generation } = seededRoom({
    onRejoin: () => {
      rejoinCalls += 1;
      return true;
    },
  });
  const result = room.applyDisconnect(generation, "unmount");
  assert.equal(result.rejoined, false);
  assert.equal(rejoinCalls, 0);
});

test("U04 Session non-operable does not rejoin", () => {
  let rejoinCalls = 0;
  const { room, generation } = seededRoom({
    getCloseState: () => ({
      isClosed: true,
      closeMessageKey: "events.sessionClosedByEvent",
    }),
    onRejoin: () => {
      rejoinCalls += 1;
      return true;
    },
  });
  const result = room.applyDisconnect(generation, "none");
  assert.equal(result.rejoined, false);
  assert.equal(rejoinCalls, 0);
  assert.deepEqual(room.getState().remotes, []);
});

test("U05 unexpected disconnect + operable Session starts exactly one rejoin", () => {
  let rejoinCalls = 0;
  const { room, generation } = seededRoom({
    getCloseState: () => ({ isClosed: false }),
    onRejoin: (nextGeneration) => {
      rejoinCalls += 1;
      room.completeRejoin(true, nextGeneration);
      return true;
    },
  });
  const first = room.applyDisconnect(generation, "none");
  assert.equal(first.rejoined, true);
  assert.equal(rejoinCalls, 1);

  const recoveredGeneration = room.getState().generation;
  room.upsertRemote(recoveredGeneration, {
    id: "ep-new",
    displayName: "New",
  });
  const second = room.applyDisconnect(recoveredGeneration, "none");
  assert.equal(second.rejoined, false);
  assert.equal(rejoinCalls, 1);
});

test("U06 rejoin success makes the new generation authoritative", () => {
  const { room, generation } = seededRoom({
    onRejoin: (nextGeneration) => {
      room.completeRejoin(true, nextGeneration);
      room.upsertRemote(nextGeneration, {
        id: "ep-rebuilt",
        displayName: "Rebuilt",
        endpointUsername: "ng_u_rebuilt",
      });
      return true;
    },
  });
  room.applyDisconnect(generation, "none");
  const state = room.getState();
  assert.equal(state.recovery, "recovered");
  assert.equal(state.joined, true);
  assert.equal(state.generation > generation, true);
  assert.equal(state.remotes[0]?.id, "ep-rebuilt");
});

test("U07 late disconnect from old generation does not clear recovered state", () => {
  const { room, generation } = seededRoom({
    onRejoin: (nextGeneration) => {
      room.completeRejoin(true, nextGeneration);
      room.upsertRemote(nextGeneration, {
        id: "ep-live",
        displayName: "Live",
      });
      return true;
    },
  });
  room.applyDisconnect(generation, "none");
  room.applyDisconnect(generation, "none");
  const state = room.getState();
  assert.equal(state.joined, true);
  assert.equal(state.remotes[0]?.id, "ep-live");
});

test("U08 bounded rejoin failure does not retry and remotes stay cleared", () => {
  let rejoinCalls = 0;
  const { room, generation } = seededRoom({
    onRejoin: (nextGeneration) => {
      rejoinCalls += 1;
      room.completeRejoin(false, nextGeneration);
      return false;
    },
  });
  room.applyDisconnect(generation, "none");
  room.applyDisconnect(room.getState().generation, "none");
  assert.equal(rejoinCalls, 1);
  assert.equal(room.getState().recovery, "failed");
  assert.deepEqual(room.getState().remotes, []);
  assert.equal(room.getState().joined, false);
});

test("U09-U12 snapshot reconciliation through the runtime", () => {
  const { room, generation } = seededRoom();
  room.applyEndpointRemoved(generation, "ep-a");
  assert.deepEqual(
    room.getState().remotes.map((remote) => remote.id),
    ["ep-b"],
  );

  room.upsertRemote(generation, { id: "ep-a", displayName: "A" });
  room.applySnapshot(generation, new Set(), true);
  assert.equal(room.getState().remotes.length, 2);

  room.applyDisconnect(generation, "explicit_leave");
  assert.deepEqual(room.getState().remotes, []);

  const { room: pruneRoom, generation: pruneGeneration } = seededRoom();
  pruneRoom.applySnapshot(pruneGeneration, new Set(["ep-a"]), true);
  assert.deepEqual(
    pruneRoom.getState().remotes.map((remote) => remote.id),
    ["ep-a"],
  );
});
