import assert from "node:assert/strict";
import test from "node:test";

import { createBoundedProviderRejoin } from "@/lib/voximplant/provider-disconnect-recovery";

test("already_in_flight does not fail a paused recovery attempt", () => {
  const rejoin = createBoundedProviderRejoin();
  rejoin.begin();
  rejoin.pause();
  assert.equal(rejoin.getStatus(), "recovering");
  assert.equal(rejoin.getAttempt(), "paused_for_sdk_reconnect");
  const decision = rejoin.decide("unexpected");
  assert.equal(decision.shouldRejoin, false);
  assert.equal(decision.reason, "already_in_flight");
  assert.equal(rejoin.getStatus(), "recovering");
  assert.equal(rejoin.resume(), true);
  assert.equal(rejoin.getAttempt(), "resuming");
  rejoin.succeed();
  assert.equal(rejoin.getStatus(), "recovered");
});

test("Leave cancel of a paused attempt does not mark it failed", () => {
  const rejoin = createBoundedProviderRejoin();
  rejoin.begin();
  rejoin.pause();
  rejoin.cancel();
  assert.equal(rejoin.getStatus(), "idle");
  assert.equal(rejoin.getAttempt(), "ready");
  assert.equal(rejoin.resume(), false);
});

test("a later independent incident may begin after success", () => {
  const rejoin = createBoundedProviderRejoin();
  rejoin.begin();
  rejoin.succeed();
  const decision = rejoin.decide("unexpected");
  assert.equal(decision.shouldRejoin, true);
  rejoin.begin();
  assert.equal(rejoin.getStatus(), "recovering");
});
