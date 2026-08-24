import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";

/**
 * Test-only barriers for Session automatic-close vs rejoin linearization.
 * Production callers must never install these hooks.
 */
export type SessionLifecycleConcurrencyHooks = {
  /**
   * After the automatic policy has already decided `due`, before the
   * Session-row write lock / UPDATE.
   */
  afterAutomaticPolicyDue?: () => Promise<void> | void;
  /**
   * After `SELECT ... FROM "Session" FOR UPDATE` in the claim transaction,
   * before INSERT/upsert of `SessionRoomConnection`.
   */
  afterSessionRowLockedForClaim?: () => Promise<void> | void;
  /**
   * After `SELECT ... FROM "Session" FOR UPDATE` in the automatic/manual
   * finalizer transaction, before the fenced UPDATE.
   */
  afterSessionRowLockedForFinalize?: () => Promise<void> | void;
};

let activeHooks: SessionLifecycleConcurrencyHooks = {};

function assertNotProduction(): void {
  if (parseServerRuntimeSetting("NODE_ENV") === "production") {
    throw new Error(
      "Session lifecycle concurrency test hooks are unavailable in production.",
    );
  }
}

/** Test-only barrier injection. Never call from production paths. */
export function setSessionLifecycleConcurrencyHooksForTests(
  hooks: SessionLifecycleConcurrencyHooks,
): void {
  assertNotProduction();
  activeHooks = hooks;
}

export function clearSessionLifecycleConcurrencyHooksForTests(): void {
  activeHooks = {};
}

export async function runAfterAutomaticPolicyDueHook(): Promise<void> {
  await activeHooks.afterAutomaticPolicyDue?.();
}

export async function runAfterSessionRowLockedForClaimHook(): Promise<void> {
  await activeHooks.afterSessionRowLockedForClaim?.();
}

export async function runAfterSessionRowLockedForFinalizeHook(): Promise<void> {
  await activeHooks.afterSessionRowLockedForFinalize?.();
}
