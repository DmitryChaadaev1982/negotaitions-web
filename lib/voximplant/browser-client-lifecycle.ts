"use client";

/**
 * Cross-surface coordination for the single Voximplant WebSDK client.
 *
 * The Session room and the Event lobby share one `Core` instance, so their
 * connect and disconnect operations must be serialised. Every wait here is
 * bounded: a Session teardown that never completes (dead transport behind a
 * reverse tunnel) must not keep the Event lobby waiting for media, and must not
 * be able to tear down the transport the lobby has already claimed.
 */

type VoxLifecycleStore = {
  disconnectPromise: Promise<void> | null;
  ownerSeq: number;
  currentOwnerId: number | null;
  handoffDepth: number;
  handoffUntilMs: number;
};

const STORE_KEY = "__negotaitionsVoxLifecycleStore";
const IDLE_STABILITY_CHECKS = 2;

/** Upper bound the lobby will wait for a previous teardown before proceeding. */
export const VOX_CLIENT_IDLE_WAIT_TIMEOUT_MS = 4000;
/** Upper bound a teardown may occupy the shared-client barrier. */
export const VOX_CLIENT_DISCONNECT_TIMEOUT_MS = 4000;
/**
 * Self-healing bound on the intentional-handoff window. Provider errors are
 * only downgraded as "expected teardown noise" inside this window, so it must
 * expire even if a surface never releases it.
 */
export const VOX_HANDOFF_WINDOW_MS = 15000;

function getStore(): VoxLifecycleStore {
  const globalScope = globalThis as typeof globalThis & {
    [STORE_KEY]?: VoxLifecycleStore;
  };
  if (!globalScope[STORE_KEY]) {
    globalScope[STORE_KEY] = {
      disconnectPromise: null,
      ownerSeq: 0,
      currentOwnerId: null,
      handoffDepth: 0,
      handoffUntilMs: 0,
    };
  }
  return globalScope[STORE_KEY]!;
}

function raceWithTimeout(
  task: Promise<unknown>,
  timeoutMs: number,
): Promise<"settled" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  return Promise.race([
    task.then(
      () => "settled" as const,
      () => "settled" as const,
    ),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export type VoxClientIdleResult = {
  /** True when the shared client reached an idle state within the budget. */
  idle: boolean;
  timedOut: boolean;
  waitedMs: number;
};

/**
 * Wait until no teardown is in flight on the shared client.
 *
 * Returns instead of throwing on timeout: the caller is expected to continue
 * and claim ownership, because a stuck teardown must degrade media, not block
 * the page.
 */
export async function waitForVoxClientIdle(
  options: { timeoutMs?: number } = {},
): Promise<VoxClientIdleResult> {
  const store = getStore();
  const timeoutMs = options.timeoutMs ?? VOX_CLIENT_IDLE_WAIT_TIMEOUT_MS;
  const startedAt = Date.now();
  let stableChecks = 0;
  let timedOut = false;

  while (stableChecks < IDLE_STABILITY_CHECKS) {
    const pending = store.disconnectPromise;
    if (pending) {
      const remaining = timeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        timedOut = true;
        break;
      }
      stableChecks = 0;
      const outcome = await raceWithTimeout(pending, remaining);
      if (outcome === "timeout") {
        timedOut = true;
        break;
      }
      continue;
    }

    stableChecks += 1;
    await Promise.resolve();
  }

  return { idle: !timedOut, timedOut, waitedMs: Date.now() - startedAt };
}

/**
 * Publish a teardown on the shared-client barrier.
 *
 * The tracked promise settles at the earlier of the real disconnect and
 * {@link VOX_CLIENT_DISCONNECT_TIMEOUT_MS} so a hung provider call releases the
 * barrier for the next surface.
 */
export function registerVoxClientDisconnect(
  disconnectTask: Promise<unknown>,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const store = getStore();
  const timeoutMs = options.timeoutMs ?? VOX_CLIENT_DISCONNECT_TIMEOUT_MS;
  const tracked: Promise<void> = raceWithTimeout(disconnectTask, timeoutMs)
    .then(() => undefined)
    .finally(() => {
      if (store.disconnectPromise === tracked) {
        store.disconnectPromise = null;
      }
    });
  store.disconnectPromise = tracked;
  return tracked;
}

export type VoxClientOwnership = {
  id: number;
  surface: string;
  /** False once another surface has claimed the shared client. */
  isCurrent: () => boolean;
  release: () => void;
};

/**
 * Claim the shared WebSDK client for a surface.
 *
 * Ownership is what stops a superseded Session room from disconnecting the
 * transport the Event lobby has already connected: the late teardown checks
 * `isCurrent()` and skips the provider call while still releasing its own
 * local media.
 */
export function acquireVoxClientOwnership(surface: string): VoxClientOwnership {
  const store = getStore();
  store.ownerSeq += 1;
  const id = store.ownerSeq;
  store.currentOwnerId = id;
  return {
    id,
    surface,
    isCurrent: () => getStore().currentOwnerId === id,
    release: () => {
      const current = getStore();
      if (current.currentOwnerId === id) {
        current.currentOwnerId = null;
      }
    },
  };
}

export function getCurrentVoxClientOwnerId(): number | null {
  return getStore().currentOwnerId;
}

/**
 * Mark the start of an intentional Session -> lobby provider handoff.
 *
 * Provider transport errors raised inside this window are classified as
 * expected teardown noise rather than recoverable faults.
 */
export function beginIntentionalProviderHandoff(
  options: { windowMs?: number } = {},
): () => void {
  const store = getStore();
  const windowMs = options.windowMs ?? VOX_HANDOFF_WINDOW_MS;
  store.handoffDepth += 1;
  store.handoffUntilMs = Date.now() + windowMs;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = getStore();
    current.handoffDepth = Math.max(0, current.handoffDepth - 1);
    if (current.handoffDepth === 0) {
      current.handoffUntilMs = 0;
    }
  };
}

/**
 * Close the handoff window from the receiving side. The Session room that
 * opened it has usually unmounted by the time the Event lobby has media, so the
 * lobby ends it explicitly instead of waiting for the TTL.
 */
export function endIntentionalProviderHandoff(): void {
  const store = getStore();
  store.handoffDepth = 0;
  store.handoffUntilMs = 0;
}

export function isIntentionalProviderHandoffActive(): boolean {
  const store = getStore();
  if (store.handoffDepth <= 0) return false;
  if (Date.now() >= store.handoffUntilMs) {
    store.handoffDepth = 0;
    store.handoffUntilMs = 0;
    return false;
  }
  return true;
}

/** Test-only reset so unit tests do not leak lifecycle state between cases. */
export function __resetVoxClientLifecycleForTests(): void {
  const store = getStore();
  store.disconnectPromise = null;
  store.ownerSeq = 0;
  store.currentOwnerId = null;
  store.handoffDepth = 0;
  store.handoffUntilMs = 0;
}
