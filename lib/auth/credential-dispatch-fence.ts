import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { Client } from "pg";

/**
 * Session-level PostgreSQL advisory lock fencing credential mutations against
 * password-reset provider dispatch (M-03R).
 *
 * Uses a dedicated `pg` Client (not the Prisma pool) so the lock is held across
 * the provider network call and released on unlock, error, or process/connection
 * death. Never use Prisma pool connections for session advisory locks.
 */

const FENCE_NAMESPACE = "negotaitions:credential-dispatch-v1:";
export const CREDENTIAL_DISPATCH_FENCE_TIMEOUT_ENV =
  "CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS";
export const DEFAULT_CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS = 5_000;
const MIN_CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS = 50;
const MAX_CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS = 30_000;
const INITIAL_BACKOFF_MS = 25;
const MAX_BACKOFF_MS = 100;

export class CredentialDispatchFenceError extends Error {
  constructor(
    public readonly code:
      | "CREDENTIAL_DISPATCH_FENCE_TIMEOUT"
      | "CREDENTIAL_DISPATCH_FENCE_ABORTED"
      | "CREDENTIAL_DISPATCH_FENCE_CONFIGURATION",
  ) {
    super(code);
    this.name = "CredentialDispatchFenceError";
  }
}

export type CredentialDispatchFenceHooks = {
  /** Invoked after the advisory lock is acquired, before the operation body. */
  afterFenceAcquired?: (userId: string) => Promise<void> | void;
};

let fenceHooks: CredentialDispatchFenceHooks = {};

/** Test-only barrier injection. Never call from production paths. */
export function setCredentialDispatchFenceHooksForTests(
  hooks: CredentialDispatchFenceHooks,
): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Credential dispatch fence test hooks are unavailable in production.",
    );
  }
  fenceHooks = hooks;
}

export function clearCredentialDispatchFenceHooksForTests(): void {
  fenceHooks = {};
}

export function credentialDispatchAdvisoryKeys(userId: string): [number, number] {
  const digest = createHash("sha256")
    .update(FENCE_NAMESPACE)
    .update(userId)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

function resolveConnectionString(explicit?: string): string {
  const connectionString = explicit ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for credential dispatch fence.");
  }
  return connectionString;
}

export function resolveCredentialDispatchFenceTimeoutMs(
  value = process.env[CREDENTIAL_DISPATCH_FENCE_TIMEOUT_ENV],
): number {
  const trimmed = value?.trim();
  if (!trimmed) return DEFAULT_CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS;
  const parsed = Number(trimmed);
  if (
    !Number.isInteger(parsed) ||
    parsed < MIN_CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS ||
    parsed > MAX_CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS
  ) {
    throw new CredentialDispatchFenceError(
      "CREDENTIAL_DISPATCH_FENCE_CONFIGURATION",
    );
  }
  return parsed;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CredentialDispatchFenceError(
      "CREDENTIAL_DISPATCH_FENCE_ABORTED",
    );
  }
}

async function waitForRetry(ms: number, signal?: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, signal ? { signal } : undefined);
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new CredentialDispatchFenceError(
        "CREDENTIAL_DISPATCH_FENCE_ABORTED",
      );
    }
    throw error;
  }
}

/**
 * Serialize credential mutation and reset-email dispatch for one user.
 * Linearization point: fence held from revalidation through provider outcome
 * recording (worker) or through password/token mutation commit (mutations).
 *
 * Global resource order:
 *   credential-dispatch fence -> database transaction -> User row ->
 *   PasswordResetToken rows -> UserSession rows -> EmailMessage rows.
 * Never call this helper while holding a database row lock.
 */
export async function withCredentialDispatchFence<T>(
  userId: string,
  operation: () => Promise<T>,
  options?: {
    connectionString?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<T> {
  const connectionString = resolveConnectionString(options?.connectionString);
  const timeoutMs =
    options?.timeoutMs === undefined
      ? resolveCredentialDispatchFenceTimeoutMs()
      : resolveCredentialDispatchFenceTimeoutMs(String(options.timeoutMs));
  const [key1, key2] = credentialDispatchAdvisoryKeys(userId);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
  });
  const deadline = performance.now() + timeoutMs;
  let lockAcquired = false;
  let operationStarted = false;
  throwIfAborted(options?.signal);
  try {
    await client.connect();
    let attempt = 0;
    while (!lockAcquired) {
      throwIfAborted(options?.signal);
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock($1::int, $2::int) AS acquired",
        [key1, key2],
      );
      lockAcquired = result.rows[0]?.acquired === true;
      const remainingMs = deadline - performance.now();
      if (lockAcquired) {
        if (remainingMs < 0) {
          await client
            .query("SELECT pg_advisory_unlock($1::int, $2::int)", [key1, key2])
            .catch(() => undefined);
          lockAcquired = false;
          throw new CredentialDispatchFenceError(
            "CREDENTIAL_DISPATCH_FENCE_TIMEOUT",
          );
        }
        break;
      }
      if (remainingMs <= 0) {
        throw new CredentialDispatchFenceError(
          "CREDENTIAL_DISPATCH_FENCE_TIMEOUT",
        );
      }
      const backoffMs = Math.min(
        INITIAL_BACKOFF_MS * 2 ** attempt,
        MAX_BACKOFF_MS,
        Math.max(1, Math.floor(remainingMs)),
      );
      attempt += 1;
      await waitForRetry(backoffMs, options?.signal);
    }

    try {
      throwIfAborted(options?.signal);
      await fenceHooks.afterFenceAcquired?.(userId);
      operationStarted = true;
      return await operation();
    } finally {
      if (lockAcquired) {
        await client
          .query("SELECT pg_advisory_unlock($1::int, $2::int)", [key1, key2])
          .catch(() => undefined);
        lockAcquired = false;
      }
    }
  } catch (error) {
    if (
      !(error instanceof CredentialDispatchFenceError) &&
      !operationStarted &&
      performance.now() >= deadline
    ) {
      throw new CredentialDispatchFenceError(
        "CREDENTIAL_DISPATCH_FENCE_TIMEOUT",
      );
    }
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
