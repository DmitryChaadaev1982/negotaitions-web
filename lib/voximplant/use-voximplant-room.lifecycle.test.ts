import assert from "node:assert/strict";
import test from "node:test";

import {
  createSingleFlightAsync,
  createVoxGenerationTracker,
  shouldApplyVoxTakeoverMessage,
} from "@/lib/voximplant/use-voximplant-room";

test("generation remains stable during a normal join", () => {
  const tracker = createVoxGenerationTracker();
  const generation = tracker.begin();
  tracker.assertCurrent(generation);
  assert.equal(tracker.isCurrent(generation), true);
});

test("stale invalidates an in-flight join and blocks stale completion writes", () => {
  const tracker = createVoxGenerationTracker();
  const generation = tracker.begin();
  const writes: string[] = [];

  tracker.invalidate("stale_connection");

  if (tracker.isCurrent(generation)) {
    writes.push("joined");
  }

  assert.equal(writes.length, 0);
  assert.throws(
    () => tracker.assertCurrent(generation),
    (error: unknown) =>
      error instanceof Error &&
      error.name === "VoxLifecycleAbortError" &&
      error.message.includes("stale_connection"),
  );
});

test("later generation can join normally after stale invalidation", () => {
  const tracker = createVoxGenerationTracker();
  const generationA = tracker.begin();
  tracker.invalidate("stale_connection");
  const generationB = tracker.begin();

  assert.equal(generationA === generationB, false);
  tracker.assertCurrent(generationB);
  assert.equal(tracker.isCurrent(generationB), true);
});

test("single-flight cleanup deduplicates concurrent teardown calls", async () => {
  let handlerCalls = 0;
  const phases: string[] = [];

  const cleanup = createSingleFlightAsync(async () => {
    handlerCalls += 1;
    phases.push("invalidate");
    phases.push("detach-endpoint-listeners");
    phases.push("detach-conference-listeners");
    phases.push("hangup");
    phases.push("stop-local-media");
    phases.push("disconnect");
    phases.push("clear-state");
  });

  await Promise.all([cleanup(), cleanup(), cleanup()]);

  assert.equal(handlerCalls, 1);
  assert.deepEqual(phases, [
    "invalidate",
    "detach-endpoint-listeners",
    "detach-conference-listeners",
    "hangup",
    "stop-local-media",
    "disconnect",
    "clear-state",
  ]);
});

test("Strict Mode style start-cleanup-start does not leak first runtime", async () => {
  const tracker = createVoxGenerationTracker();
  const disposed: string[] = [];
  const liveRuntimeIds = new Set<string>();

  const cleanup = createSingleFlightAsync(async (runtimeId: string) => {
    if (liveRuntimeIds.has(runtimeId)) {
      disposed.push(runtimeId);
      liveRuntimeIds.delete(runtimeId);
    }
  });

  const firstGeneration = tracker.begin();
  const runtimeA = `runtime-${firstGeneration}`;
  liveRuntimeIds.add(runtimeA);
  tracker.invalidate("invalidated_generation");
  await cleanup(runtimeA);

  const secondGeneration = tracker.begin();
  const runtimeB = `runtime-${secondGeneration}`;
  liveRuntimeIds.add(runtimeB);

  assert.deepEqual(disposed, [runtimeA]);
  assert.equal(liveRuntimeIds.has(runtimeA), false);
  assert.equal(liveRuntimeIds.has(runtimeB), true);
});

test("endpoint removed then late update is ignored after generation invalidation", () => {
  const tracker = createVoxGenerationTracker();
  const generation = tracker.begin();
  const endpointState = new Map<string, { speaking: boolean }>();

  endpointState.set("endpoint-a", { speaking: false });
  endpointState.delete("endpoint-a");
  tracker.invalidate("invalidated_generation");

  const lateVadUpdate = () => {
    if (!tracker.isCurrent(generation)) return;
    endpointState.set("endpoint-a", { speaking: true });
  };
  lateVadUpdate();

  assert.equal(endpointState.has("endpoint-a"), false);
});

test("duplicate endpoint-added events stay idempotent", () => {
  const seen = new Map<string, number>();

  const onEndpointAdded = (id: string) => {
    if (!seen.has(id)) {
      seen.set(id, 1);
      return;
    }
    seen.set(id, seen.get(id)!);
  };

  onEndpointAdded("endpoint-a");
  onEndpointAdded("endpoint-a");

  assert.equal(seen.get("endpoint-a"), 1);
});

test("takeover message applies only to same identity in same session", () => {
  const base = {
    type: "lease_takeover_claimed" as const,
    sessionId: "session-1",
    connectionId: "conn-b",
    sdkUsername: "facilitator-1@app.local",
  };

  assert.equal(
    shouldApplyVoxTakeoverMessage({
      message: base,
      sessionId: "session-1",
      connectionId: "conn-a",
      sdkUsername: "facilitator-1@app.local",
    }),
    true,
  );
  assert.equal(
    shouldApplyVoxTakeoverMessage({
      message: base,
      sessionId: "session-1",
      connectionId: "conn-b",
      sdkUsername: "facilitator-1@app.local",
    }),
    false,
  );
  assert.equal(
    shouldApplyVoxTakeoverMessage({
      message: base,
      sessionId: "session-2",
      connectionId: "conn-a",
      sdkUsername: "facilitator-1@app.local",
    }),
    false,
  );
  assert.equal(
    shouldApplyVoxTakeoverMessage({
      message: base,
      sessionId: "session-1",
      connectionId: "conn-a",
      sdkUsername: "participant-a@app.local",
    }),
    false,
  );
});
