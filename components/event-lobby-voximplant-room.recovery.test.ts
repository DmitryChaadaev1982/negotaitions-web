import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("event lobby shares conservative snapshot reconcile and clears remotes on disconnect", () => {
  const source = readFileSync("components/event-lobby-voximplant-room.tsx", "utf-8");
  assert.match(source, /reconcileRemoteParticipantsFromSnapshot/);
  assert.match(source, /remotesAfterProviderDisconnect/);
  assert.match(source, /lobbyConferenceConnectedRef/);
  assert.doesNotMatch(source, /createBoundedProviderRejoin/);
  assert.doesNotMatch(source, /setJoinEpoch/);
});
