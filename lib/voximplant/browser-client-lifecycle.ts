"use client";

type VoxLifecycleStore = {
  disconnectPromise: Promise<void> | null;
};

const STORE_KEY = "__negotaitionsVoxLifecycleStore";

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
  const pending = getStore().disconnectPromise;
  if (pending) {
    await pending;
  }
}

export function registerVoxClientDisconnect(disconnectTask: Promise<unknown>): Promise<void> {
  const store = getStore();
  const wrapped = disconnectTask.then(
    () => undefined,
    () => undefined,
  );
  store.disconnectPromise = wrapped.finally(() => {
    if (store.disconnectPromise === wrapped) {
      store.disconnectPromise = null;
    }
  });
  return store.disconnectPromise;
}
