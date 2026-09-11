import assert from "node:assert/strict";
import test from "node:test";

import {
  excludeCurrentLobbySelfRemotes,
  isCurrentLobbySelfEndpoint,
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

const localSdk = "ng_u_aaaaaaaaaaaaaaaa@app.voximplant.com";

test("D1 same stable provider username as local is not a remote tile", () => {
  assert.equal(
    isCurrentLobbySelfEndpoint({
      localSdkUsername: localSdk,
      endpointUserName: "ng_u_aaaaaaaaaaaaaaaa",
    }),
    true,
  );
  const next = excludeCurrentLobbySelfRemotes(
    [
      {
        id: "ep-self",
        displayName: "Alex",
        endpointUsername: "ng_u_aaaaaaaaaaaaaaaa",
      },
    ],
    localSdk,
  );
  assert.deepEqual(next, []);
});

test("D2 same displayName with a different stable username remains remote", () => {
  assert.equal(
    isCurrentLobbySelfEndpoint({
      localSdkUsername: localSdk,
      endpointUserName: "ng_u_bbbbbbbbbbbbbbbb",
    }),
    false,
  );
  const next = excludeCurrentLobbySelfRemotes(
    [
      {
        id: "ep-other",
        displayName: "Alex",
        endpointUsername: "ng_u_bbbbbbbbbbbbbbbb",
      },
    ],
    localSdk,
  );
  assert.equal(next.length, 1);
  assert.equal(next[0]?.id, "ep-other");
});

test("D3 distinct remote participant remains visible", () => {
  const next = excludeCurrentLobbySelfRemotes(
    [
      {
        id: "ep-remote",
        displayName: "Masha",
        endpointUsername: "ng_u_cccccccccccccccc",
      },
    ],
    localSdk,
  );
  assert.equal(next.length, 1);
  assert.equal(next[0]?.id, "ep-remote");
});

test("D4 early-video replay for a legitimate remote is not treated as self", () => {
  assert.equal(
    isCurrentLobbySelfEndpoint({
      localSdkUsername: localSdk,
      endpointUserName: "ng_u_dddddddddddddddd",
    }),
    false,
  );
});

test("D5 same-user takeover leftover endpoint is not a second local tile", () => {
  const next = excludeCurrentLobbySelfRemotes(
    [
      {
        id: "ep-browser-a",
        displayName: "Alex",
        endpointUsername: "NG_U_AAAAAAAAAAAAAAAA@app.voximplant.com",
      },
      {
        id: "ep-browser-b-self",
        displayName: "Alex",
        endpointUsername: "ng_u_aaaaaaaaaaaaaaaa",
      },
    ],
    localSdk,
  );
  assert.deepEqual(next, []);
});

test("missing endpoint username cannot prove self and is kept", () => {
  const next = excludeCurrentLobbySelfRemotes(
    [{ id: "ep-unknown", displayName: "Alex", endpointUsername: null }],
    localSdk,
  );
  assert.equal(next.length, 1);
});
