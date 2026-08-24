import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Debrief automatic close does not claim a recording stop", () => {
  const occupancy = readFileSync("lib/session-room-occupancy.ts", "utf8");
  const reconciliation = readFileSync(
    "lib/session-empty-room-reconciliation.ts",
    "utf8",
  );
  const policy = readFileSync("lib/session-lifecycle-policy.ts", "utf8");
  const selector = readFileSync(
    "lib/session-lifecycle-candidate-selection.ts",
    "utf8",
  );
  for (const source of [reconciliation, policy, selector]) {
    assert.equal(source.includes("completeSessionCanonical"), false);
    assert.equal(source.includes("claimRecordingStopIntent"), false);
    assert.equal(source.includes("stopRecording("), false);
  }
  assert.equal(occupancy.includes("claimRecordingStopIntent"), false);
  assert.equal(occupancy.includes("stopRecording("), false);
});

test("abandoned automatic close reuses completeSessionCanonical rather than a second finisher", () => {
  const occupancy = readFileSync("lib/session-room-occupancy.ts", "utf8");
  const completion = readFileSync("lib/session-completion-core.ts", "utf8");
  assert.match(occupancy, /completeSessionCanonical/);
  assert.match(occupancy, /SESSION_ABANDONED_TIMEOUT/);
  assert.match(completion, /mode === "SESSION_ABANDONED_TIMEOUT"/);
  assert.match(completion, /lockSessionRowForLifecycleWrite/);
  assert.match(completion, /claimRecordingStopIntent/);
  assert.equal(completion.includes("stopRecording("), true);
});

test("canonical finalizer remains the shared closer and supports the new reasons", () => {
  const occupancy = readFileSync("lib/session-room-occupancy.ts", "utf8");
  const lease = readFileSync("lib/session-room-connection-lease.ts", "utf8");
  assert.match(occupancy, /export async function finalizeSessionCanonicalClose/);
  assert.match(occupancy, /DEBRIEF_MAX_DURATION/);
  assert.match(occupancy, /SESSION_ABANDONED_TIMEOUT/);
  assert.match(occupancy, /authority: policy\.reason/);
  assert.match(occupancy, /FOR UPDATE OF s/);
  assert.match(occupancy, /sqlParentEventStillOperableGuard/);
  assert.match(lease, /FOR UPDATE OF s/);
  assert.match(lease, /runAfterSessionRowLockedForClaimHook/);
});
