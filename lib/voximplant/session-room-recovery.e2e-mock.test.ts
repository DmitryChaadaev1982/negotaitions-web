import assert from "node:assert/strict";
import test from "node:test";

import { createSessionRoomRecoveryRuntime } from "@/lib/voximplant/session-room-recovery.runtime";

/**
 * E2E-01 — 3-client equivalent mock provider state.
 * Facilitator + participant A + participant B. No real ICE.
 */
test("E2E-01 stale remotes disappear on disconnect and recovery rebuilds live set", () => {
  const facilitator = createSessionRoomRecoveryRuntime({
    sessionId: "cmt8lfu7w0000w9m1xq6hlfpj",
    surface: "session-room",
  });
  const participantA = createSessionRoomRecoveryRuntime({
    sessionId: "cmt8lfu7w0000w9m1xq6hlfpj",
  });
  const participantB = createSessionRoomRecoveryRuntime({
    sessionId: "cmt8lfu7w0000w9m1xq6hlfpj",
  });

  const facGen = facilitator.beginGeneration();
  const aGen = participantA.beginGeneration();
  const bGen = participantB.beginGeneration();
  facilitator.markJoined(facGen);
  participantA.markJoined(aGen);
  participantB.markJoined(bGen);

  facilitator.upsertRemote(facGen, { id: "ep-a", displayName: "A" });
  facilitator.upsertRemote(facGen, { id: "ep-b", displayName: "B" });
  participantA.upsertRemote(aGen, { id: "ep-fac", displayName: "Facilitator" });
  participantA.upsertRemote(aGen, { id: "ep-b", displayName: "B" });
  participantB.upsertRemote(bGen, { id: "ep-fac", displayName: "Facilitator" });
  participantB.upsertRemote(bGen, { id: "ep-a", displayName: "A" });

  participantB.applyDisconnect(bGen, "none");
  assert.equal(participantB.getState().joined, false);
  assert.deepEqual(participantB.getState().remotes, []);

  facilitator.applyEndpointRemoved(facGen, "ep-b");
  participantA.applyEndpointRemoved(aGen, "ep-b");
  assert.deepEqual(
    facilitator.getState().remotes.map((remote) => remote.id),
    ["ep-a"],
  );

  participantA.applyDisconnect(aGen, "none");
  assert.deepEqual(participantA.getState().remotes, []);
  facilitator.applyEndpointRemoved(facGen, "ep-a");
  assert.deepEqual(facilitator.getState().remotes, []);

  const recoveredB = participantB.getState().generation;
  participantB.completeRejoin(true, recoveredB);
  participantB.upsertRemote(recoveredB, { id: "ep-fac-live", displayName: "Facilitator" });
  assert.equal(participantB.getState().joined, true);
  assert.deepEqual(
    participantB.getState().remotes.map((remote) => remote.id),
    ["ep-fac-live"],
  );
  assert.notEqual(recoveredB, bGen);
});
