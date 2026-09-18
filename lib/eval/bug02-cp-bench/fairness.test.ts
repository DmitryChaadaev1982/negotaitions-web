import assert from "node:assert/strict";
import test from "node:test";

import {
  FairGlobalLimiter,
  assertNoMonopoly,
  resolveMaxPerJobShare,
  summarizeFairness,
} from "./fairness";

test("reserved_slot and half_share cannot monopolize a global cap > 1", () => {
  assert.equal(resolveMaxPerJobShare({ globalCap: 8, perJobCap: 8, policy: "reserved_slot" }), 7);
  assert.equal(resolveMaxPerJobShare({ globalCap: 8, perJobCap: 8, policy: "half_share" }), 4);
  assert.throws(() => assertNoMonopoly({ globalCap: 8, maxPerJob: 8 }));
});

test("limiter keeps leftover global capacity for a second job", async () => {
  const limiter = new FairGlobalLimiter(4, 4, "reserved_slot");
  const started: string[] = [];
  const large = Promise.all(
    Array.from({ length: 6 }, () =>
      limiter.withSlot("A", async () => {
        started.push("A");
        await new Promise((resolve) => setTimeout(resolve, 30));
      }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  const small = limiter.withSlot("B", async () => {
    started.push("B");
  });
  await Promise.all([large, small]);
  const fairness = summarizeFairness(limiter.samples, ["A", "B"]);
  assert.ok((fairness.maxPerJobInFlight.A ?? 0) <= 3);
  assert.ok((fairness.maxPerJobInFlight.B ?? 0) >= 1);
  assert.ok(fairness.maxGlobalInFlight <= 4);
  assert.ok(started.includes("B"));
});
