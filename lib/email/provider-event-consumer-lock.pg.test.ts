import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

import {
  acquireProviderEventConsumerLock,
  PROVIDER_EVENT_CONSUMER_LOCK_KEY,
  ProviderEventConsumerError,
} from "@/lib/email/provider-event-consumer";
import {
  getSanitizedE2eDatabaseDescriptor,
  isE2eDatabaseConfigured,
  resolveE2eDatabaseUrl,
} from "../../tests/e2e/helpers/e2e-database";

/**
 * Advisory-lock integration tests against the canonical E2E PostgreSQL.
 *
 * These tests use separate connections to the same database to exercise
 * production session advisory locks. `E2E_DATABASE_URL` is the only accepted
 * input; `DATABASE_URL` is set process-locally only while production code runs.
 */
const SKIP_REASON =
  "canonical E2E PostgreSQL not configured (E2E_DATABASE_URL)";
const REQUIRE_REAL_POSTGRES =
  process.env.STAGE313C_PROVIDER_EVENT_LOCK_TEST_REQUIRED === "true";
const RUN_ID = `stage313c-lock-${randomUUID()}`;

function resolveDbUrl(): string | null {
  if (!isE2eDatabaseConfigured()) {
    if (REQUIRE_REAL_POSTGRES) {
      return resolveE2eDatabaseUrl();
    }
    return null;
  }
  const url = resolveE2eDatabaseUrl();
  const descriptor = getSanitizedE2eDatabaseDescriptor(url);
  console.log(
    `[stage313c-lock-db] host=${descriptor.normalizedHost} port=${descriptor.port} database=${descriptor.database}`,
  );
  return url;
}

/**
 * The production code reads DATABASE_URL, so point it at E2E_DATABASE_URL for
 * the duration of the test and restore it afterwards.
 */
async function withDatabaseUrl<T>(
  url: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url;
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

async function assertLeaseTableExists(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name = 'EmailProviderConsumerLease'
       ) AS exists`,
    );
    assert.equal(
      result.rows[0]?.exists,
      true,
      "E2E database must already contain EmailProviderConsumerLease",
    );
  } finally {
    await client.end();
  }
}

async function cleanupLeaseRows(url: string, streamName: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "EmailProviderConsumerLease"
       WHERE "provider" = $1 AND "streamName" = $2`,
      ["yandex_postbox", streamName],
    );
  } finally {
    await client.end();
  }
}

async function tryAcquireFromSeparateConnection(url: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [PROVIDER_EVENT_CONSUMER_LOCK_KEY],
    );
    const acquired = Boolean(result.rows[0]?.acquired);
    if (acquired) {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        PROVIDER_EVENT_CONSUMER_LOCK_KEY,
      ]);
    }
    return acquired;
  } finally {
    await client.end();
  }
}

test("the lock key derivation is stable", () => {
  assert.equal(
    PROVIDER_EVENT_CONSUMER_LOCK_KEY,
    "negotaitions:email-provider-event-consumer:yandex-postbox",
  );
});

test("the session lock never borrows a Prisma pool connection", () => {
  const source = readFileSync("lib/email/provider-event-consumer.ts", "utf8");
  const start = source.indexOf(
    "export async function acquireProviderEventConsumerLock",
  );
  assert.ok(start >= 0, "lock acquisition function not found");
  const acquireBody = source.slice(start, start + 10_000);
  assert.match(acquireBody, /new PgClient\(/);
  assert.equal(
    /\bprisma\b/.test(acquireBody),
    false,
    "the dedicated lock must not use the Prisma pool",
  );
});

test("a second connection cannot acquire the lock until the first releases", async (t) => {
  const url = resolveDbUrl();
  if (!url) return t.skip(SKIP_REASON);
  const streamName = `${RUN_ID}-contention`;

  await withDatabaseUrl(url, async () => {
    await assertLeaseTableExists(url);
    await cleanupLeaseRows(url, streamName);
    const lock = await acquireProviderEventConsumerLock({ streamName });
    try {
      assert.equal(await tryAcquireFromSeparateConnection(url), false);

      await assert.rejects(
        () => acquireProviderEventConsumerLock({ streamName }),
        (error: unknown) =>
          error instanceof ProviderEventConsumerError &&
          error.code === "CONSUMER_LOCK_HELD" &&
          error.kind === "lock_contention",
      );
    } finally {
      await lock.release();
    }

    assert.equal(await tryAcquireFromSeparateConnection(url), true);
    await cleanupLeaseRows(url, streamName);
  });
});

test("release is idempotent", async (t) => {
  const url = resolveDbUrl();
  if (!url) return t.skip(SKIP_REASON);
  const streamName = `${RUN_ID}-idempotent`;

  await withDatabaseUrl(url, async () => {
    await assertLeaseTableExists(url);
    await cleanupLeaseRows(url, streamName);
    try {
      const lock = await acquireProviderEventConsumerLock({ streamName });
      await lock.release();
      await lock.release();
    } finally {
      await cleanupLeaseRows(url, streamName);
    }
  });
});

test("liveness succeeds while held and does not reacquire the lock", async (t) => {
  const url = resolveDbUrl();
  if (!url) return t.skip(SKIP_REASON);
  const streamName = `${RUN_ID}-liveness`;

  await withDatabaseUrl(url, async () => {
    await assertLeaseTableExists(url);
    await cleanupLeaseRows(url, streamName);
    const lock = await acquireProviderEventConsumerLock({ streamName });
    const assertAlive = lock.assertAlive;
    assert.ok(assertAlive, "the production lock must expose a liveness probe");
    try {
      for (let index = 0; index < 3; index += 1) {
        await assertAlive();
      }
    } finally {
      // A reentrant reacquire would have incremented the lock count, so a
      // single release proves the liveness probe did not reacquire.
      await lock.release();
    }
    assert.equal(await tryAcquireFromSeparateConnection(url), true);
    await cleanupLeaseRows(url, streamName);
  });
});

test("forced termination of the lock connection stops the consumer", async (t) => {
  const url = resolveDbUrl();
  if (!url) return t.skip(SKIP_REASON);
  const streamName = `${RUN_ID}-termination`;

  await withDatabaseUrl(url, async () => {
    await assertLeaseTableExists(url);
    await cleanupLeaseRows(url, streamName);
    const lock = await acquireProviderEventConsumerLock({ streamName });
    const assertAlive = lock.assertAlive;
    const onLost = lock.onLost;
    assert.ok(assertAlive && onLost, "the production lock must expose liveness hooks");

    let lostError: unknown = null;
    onLost((error) => {
      lostError = error;
    });

    assert.ok(lock.backendPid, "lock did not expose its backend pid");
    const terminator = new pg.Client({ connectionString: url });
    await terminator.connect();
    try {
      // Terminates only the dedicated lock session, never any other connection.
      await terminator.query("SELECT pg_terminate_backend($1::int)", [
        lock.backendPid,
      ]);
    } finally {
      await terminator.end();
    }

    // Either the connection error surfaces or the bounded liveness probe fails.
    // Both must stop the consumer instead of letting it keep checkpointing.
    let livenessFailed = false;
    for (let attempt = 0; attempt < 40 && !lostError && !livenessFailed; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      try {
        await assertAlive();
      } catch (error) {
        livenessFailed = error instanceof ProviderEventConsumerError;
      }
    }

    assert.ok(lostError || livenessFailed, "lock loss was not detected");
    await lock.release();
    assert.equal(await tryAcquireFromSeparateConnection(url), true);
    await cleanupLeaseRows(url, streamName);
  });
});
