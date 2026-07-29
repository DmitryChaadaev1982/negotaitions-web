import assert from "node:assert/strict";
import test from "node:test";

import { createHeartbeatStaleGate } from "@/components/session-room-presence-heartbeat";

test("stale heartbeat gate notifies once", () => {
  let staleCallbacks = 0;
  const gate = createHeartbeatStaleGate(() => {
    staleCallbacks += 1;
  });

  const first = gate.markStale();
  const second = gate.markStale();

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(gate.isStale(), true);
  assert.equal(staleCallbacks, 1);
});
