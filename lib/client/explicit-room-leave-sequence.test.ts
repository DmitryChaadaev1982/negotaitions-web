import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runExplicitLeaveSequence } from "@/lib/client/explicit-room-leave-sequence";

function createDeferred<T>() {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
  };
}

test("navigation waits until bounded leave persistence completes", async () => {
  const deferred = createDeferred<{
    ok: true;
    disconnected: boolean;
    alreadyFinalized: boolean;
    roomClosed: boolean;
    finalState: "DISCONNECTED";
  }>();
  const callOrder: string[] = [];

  const task = runExplicitLeaveSequence({
    persistLeave: async () => deferred.promise,
    markLocalInactive: () => {
      callOrder.push("markLocalInactive");
    },
    disconnectProvider: async () => {
      callOrder.push("disconnectProvider");
    },
    navigate: () => {
      callOrder.push("navigate");
    },
  });

  await Promise.resolve();
  assert.deepEqual(callOrder, []);

  deferred.resolve({
    ok: true,
    disconnected: true,
    alreadyFinalized: false,
    roomClosed: false,
    finalState: "DISCONNECTED",
  });
  const result = await task;

  assert.equal(result.ok, true);
  assert.deepEqual(callOrder, [
    "markLocalInactive",
    "navigate",
    "disconnectProvider",
  ]);
});

test("leave persistence failure prevents provider disconnect and navigation", async () => {
  const callOrder: string[] = [];

  const result = await runExplicitLeaveSequence({
    persistLeave: async () => ({
      ok: false,
      reason: "not_persisted",
      statusCode: 200,
      finalState: "ACTIVE",
      error: null,
    }),
    markLocalInactive: () => {
      callOrder.push("markLocalInactive");
    },
    disconnectProvider: async () => {
      callOrder.push("disconnectProvider");
    },
    navigate: () => {
      callOrder.push("navigate");
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(callOrder, []);
});

test("provider disconnect failure does not cancel successful leave navigation", async () => {
  const callOrder: string[] = [];

  const result = await runExplicitLeaveSequence({
    persistLeave: async () => ({
      ok: true,
      disconnected: true,
      alreadyFinalized: false,
      roomClosed: false,
      finalState: "DISCONNECTED",
    }),
    markLocalInactive: () => {
      callOrder.push("markLocalInactive");
    },
    disconnectProvider: async () => {
      callOrder.push("disconnectProvider");
      throw new Error("provider hangup failed");
    },
    navigate: () => {
      callOrder.push("navigate");
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.providerDisconnectError, "provider hangup failed");
  assert.deepEqual(callOrder, [
    "markLocalInactive",
    "navigate",
    "disconnectProvider",
  ]);
});

test("LiveKit and Voximplant room surfaces use the strict leave sequence", () => {
  for (const sourcePath of [
    "components/video-room-page.tsx",
    "components/voximplant-negotiation-room-page.tsx",
  ]) {
    const source = readFileSync(sourcePath, "utf8");
    assert.match(
      source,
      /runExplicitLeaveSequence\(\{/,
      `${sourcePath} must persist leave before provider teardown and navigation`,
    );
  }
});
