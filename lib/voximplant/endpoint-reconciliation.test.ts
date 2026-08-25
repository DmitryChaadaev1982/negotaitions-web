import assert from "node:assert/strict";
import test from "node:test";

import {
  reconcileRemoteParticipantsFromSnapshot,
  remotesAfterEndpointRemoved,
  remotesAfterProviderDisconnect,
} from "@/lib/voximplant/endpoint-reconciliation";

const remotes = [
  { id: "endpoint-a", displayName: "A" },
  { id: "endpoint-b", displayName: "B" },
];

test("U09 EndpointRemoved removes that remote", () => {
  assert.deepEqual(remotesAfterEndpointRemoved(remotes, "endpoint-a"), [
    { id: "endpoint-b", displayName: "B" },
  ]);
});

test("U10 transient empty snapshot while connected does not wipe remotes", () => {
  const result = reconcileRemoteParticipantsFromSnapshot({
    current: remotes,
    snapshotIds: new Set(),
    conferenceConnected: true,
  });
  assert.deepEqual(result.next, remotes);
  assert.equal(result.keptDespiteEmptySnapshot, true);
  assert.deepEqual(result.removedIds, []);
});

test("U11 actual provider disconnect wipes remotes", () => {
  assert.deepEqual(remotesAfterProviderDisconnect(), []);
  const result = reconcileRemoteParticipantsFromSnapshot({
    current: remotes,
    snapshotIds: new Set(),
    conferenceConnected: false,
  });
  assert.deepEqual(result.next, []);
  assert.deepEqual(result.removedIds, ["endpoint-a", "endpoint-b"]);
});

test("U12 valid authoritative snapshot removes an endpoint that is gone", () => {
  const result = reconcileRemoteParticipantsFromSnapshot({
    current: remotes,
    snapshotIds: new Set(["endpoint-a"]),
    conferenceConnected: true,
  });
  assert.deepEqual(result.next, [{ id: "endpoint-a", displayName: "A" }]);
  assert.deepEqual(result.removedIds, ["endpoint-b"]);
  assert.equal(result.keptDespiteEmptySnapshot, false);
});
