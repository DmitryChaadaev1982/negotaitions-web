import assert from "node:assert/strict";
import test from "node:test";

import {
  registerVoxClientDisconnect,
  waitForVoxClientIdle,
} from "@/lib/voximplant/browser-client-lifecycle";

function createDeferred() {
  let resolve: (() => void) | null = null;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return {
    promise,
    resolve: () => resolve?.(),
  };
}

test("waitForVoxClientIdle waits for registered teardown", async () => {
  const deferred = createDeferred();
  registerVoxClientDisconnect(deferred.promise);

  let settled = false;
  const waitTask = waitForVoxClientIdle().then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);
  deferred.resolve();
  await waitTask;
  assert.equal(settled, true);
});

test("latest registration becomes current wait target", async () => {
  const first = createDeferred();
  const second = createDeferred();
  registerVoxClientDisconnect(first.promise);
  registerVoxClientDisconnect(second.promise);

  let settled = false;
  const waitTask = waitForVoxClientIdle().then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);
  second.resolve();
  await waitTask;
  assert.equal(settled, true);
});

test("waitForVoxClientIdle catches late registration in next microtask", async () => {
  const deferred = createDeferred();
  let settled = false;
  const waitTask = waitForVoxClientIdle().then(() => {
    settled = true;
  });

  queueMicrotask(() => {
    registerVoxClientDisconnect(deferred.promise);
  });

  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);

  deferred.resolve();
  await waitTask;
  assert.equal(settled, true);
});

test("waitForVoxClientIdle waits through cascaded registrations", async () => {
  const first = createDeferred();
  const second = createDeferred();
  registerVoxClientDisconnect(
    first.promise.then(() => {
      registerVoxClientDisconnect(second.promise);
    }),
  );

  let settled = false;
  const waitTask = waitForVoxClientIdle().then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);

  first.resolve();
  await Promise.resolve();
  assert.equal(settled, false);

  second.resolve();
  await waitTask;
  assert.equal(settled, true);
});
