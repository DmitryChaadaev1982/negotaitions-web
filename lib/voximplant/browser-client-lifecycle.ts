"use client";

type VoxLifecycleStore = {
  disconnectPromise: Promise<void> | null;
};

const STORE_KEY = "__negotaitionsVoxLifecycleStore";
const IDLE_STABILITY_CHECKS = 2;

function getStore(): VoxLifecycleStore {
  const globalScope = globalThis as typeof globalThis & {
    [STORE_KEY]?: VoxLifecycleStore;
  };
  if (!globalScope[STORE_KEY]) {
    globalScope[STORE_KEY] = { disconnectPromise: null };
  }
  return globalScope[STORE_KEY]!;
}

export async function waitForVoxClientIdle(): Promise<void> {
  const store = getStore();
  let stableChecks = 0;

  while (stableChecks < IDLE_STABILITY_CHECKS) {
    const pending = store.disconnectPromise;
    if (pending) {
      stableChecks = 0;
      await pending;
      continue;
    }

    stableChecks += 1;
    await Promise.resolve();
  }
}

export function registerVoxClientDisconnect(disconnectTask: Promise<unknown>): Promise<void> {
  const store = getStore();
  const wrapped = disconnectTask.then(
    () => undefined,
    () => undefined,
  );
  const tracked = wrapped.finally(() => {
    if (store.disconnectPromise === tracked) {
      store.disconnectPromise = null;
    }
  });
  store.disconnectPromise = tracked;
  return tracked;
}
