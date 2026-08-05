import { createHash } from "node:crypto";

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

export type CredentialDispatchFenceHooks = {
  /** Invoked after the advisory lock is acquired, before the operation body. */
  afterFenceAcquired?: (userId: string) => Promise<void> | void;
};

let fenceHooks: CredentialDispatchFenceHooks = {};

/** Test-only barrier injection. Never call from production paths. */
export function setCredentialDispatchFenceHooksForTests(
  hooks: CredentialDispatchFenceHooks,
): void {
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

/**
 * Serialize credential mutation and reset-email dispatch for one user.
 * Linearization point: fence held from revalidation through provider outcome
 * recording (worker) or through password/token mutation commit (mutations).
 */
export async function withCredentialDispatchFence<T>(
  userId: string,
  operation: () => Promise<T>,
  options?: { connectionString?: string },
): Promise<T> {
  const connectionString = resolveConnectionString(options?.connectionString);
  const [key1, key2] = credentialDispatchAdvisoryKeys(userId);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::int, $2::int)", [key1, key2]);
    try {
      await fenceHooks.afterFenceAcquired?.(userId);
      return await operation();
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1::int, $2::int)", [key1, key2])
        .catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
