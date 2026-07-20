import assert from "node:assert/strict";
import test from "node:test";

import {
  createActiveConferenceCallTracker,
  createSingleFlightAsync,
  createVoxGenerationTracker,
  resolveConferenceCallReference,
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

test("active conference call tracker captures and confirms connected call", () => {
  const tracker = createActiveConferenceCallTracker(() => "2026-07-20T20:00:00.000Z");
  const call = {
    id: "call-1",
    conferenceName: "neg-poc-server-stop-run-1",
    sendMessage: () => undefined,
  };
  const captured = tracker.capture({
    call,
    conferenceName: "neg-poc-server-stop-run-1",
    generation: 7,
  });
  assert.equal(captured.connected, false);
  tracker.confirmConnected(call, 7);
  const current = tracker.getCurrent();
  assert.ok(current);
  assert.equal(current.connected, true);
  assert.equal(current.call, call);
  assert.equal(current.conferenceName, "neg-poc-server-stop-run-1");
});

test("active conference call tracker only clears exact matching call and generation", () => {
  const tracker = createActiveConferenceCallTracker();
  const oldCall = { id: "call-old", sendMessage: () => undefined };
  const newCall = { id: "call-new", sendMessage: () => undefined };
  tracker.capture({ call: oldCall, conferenceName: "conf-a", generation: 1 });
  tracker.confirmConnected(oldCall, 1);
  tracker.capture({ call: newCall, conferenceName: "conf-a", generation: 2 });
  tracker.confirmConnected(newCall, 2);

  const clearedOld = tracker.clearIfMatches(oldCall, 1);
  assert.equal(clearedOld, false);
  assert.equal(tracker.getCurrent()?.call, newCall);

  const clearedWrongGeneration = tracker.clearIfMatches(newCall, 1);
  assert.equal(clearedWrongGeneration, false);
  assert.equal(tracker.getCurrent()?.call, newCall);

  const clearedCurrent = tracker.clearIfMatches(newCall, 2);
  assert.equal(clearedCurrent, true);
  assert.equal(tracker.getCurrent(), null);
});

test("resolver prefers explicit active call ref before conference fallback", () => {
  const explicitCall = {
    id: "call-explicit-1234",
    conferenceName: "neg-poc-server-stop-run-explicit",
    state: { value: "CONNECTED" },
    sendMessage: () => undefined,
  };
  const fallbackConference = {
    id: "conference-id-9876",
    conferenceName: "neg-poc-server-stop-run-fallback",
    sendMessage: () => undefined,
  };

  const resolved = resolveConferenceCallReference({
    conference: fallbackConference as never,
    activeEntry: {
      call: explicitCall,
      conferenceName: "neg-poc-server-stop-run-explicit",
      generation: 4,
      connected: true,
      capturedAt: new Date().toISOString(),
    },
  });

  assert.equal(resolved.source, "EXPLICIT_ACTIVE_CALL_REF");
  assert.equal(resolved.lookupMethod, "activeConferenceCallRef.current");
  assert.equal(resolved.call, explicitCall);
  assert.equal(resolved.callId, "call-explicit-1234");
  assert.equal(resolved.callState, "CONNECTED");
  assert.equal(resolved.connectedHint, true);
});

test("resolver falls back to documented conference API when explicit ref missing", () => {
  const conference = {
    id: "conference-id-2222",
    conferenceName: "neg-poc-server-stop-run-doc",
    state: { value: "CONNECTED" },
    sendMessage: () => Promise.resolve(undefined),
  };
  const resolved = resolveConferenceCallReference({
    conference: conference as never,
    activeEntry: null,
  });

  assert.equal(resolved.source, "DOCUMENTED_CONFERENCE_API");
  assert.equal(resolved.lookupMethod, "conference.sendMessage");
  assert.equal(resolved.call, conference);
  assert.equal(resolved.callState, "CONNECTED");
});
