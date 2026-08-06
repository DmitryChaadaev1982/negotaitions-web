import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import pg from "pg";

import {
  acquireProviderEventConsumerLock,
  PROVIDER_EVENT_CONSUMER_LOCK_KEY,
  ProviderEventConsumerError,
} from "@/lib/email/provider-event-consumer";
import { resolveApprovedStage313cTestDatabase } from "../../scripts/stage-3-13c-test-database";

/**
 * Advisory-lock integration tests against a real, disposable local PostgreSQL.
 *
 * These tests need no schema and create no rows: they only exercise session
 * advisory locks. They therefore reuse the repository's approved disposable
 * database gate (`STAGE313C_TEST_DATABASE_URL` plus explicit approval) so a
 * plain `npm run test:unit` never touches the development database, and they
 * skip when that gate is not satisfied.
 */
const SKIP_REASON =
  "approved disposable PostgreSQL not configured (STAGE313C_TEST_DATABASE_*)";

function resolveDbUrl(): string | null {
  try {
    return resolveApprovedStage313cTestDatabase(process.env).baseDatabaseUrl;
  } catch {
    return null;
  }
}

/**
 * The production code reads DATABASE_URL, so point it at the disposable
 * database for the duration of the test and restore it afterwards.
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
  const acquireBody = source.slice(start, source.indexOf("\n}", start) + 2);
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

  await withDatabaseUrl(url, async () => {
    const lock = await acquireProviderEventConsumerLock();
    try {
      assert.equal(await tryAcquireFromSeparateConnection(url), false);

      await assert.rejects(
        () => acquireProviderEventConsumerLock(),
        (error: unknown) =>
          error instanceof ProviderEventConsumerError &&
          error.code === "CONSUMER_LOCK_HELD" &&
          error.kind === "lock_contention",
      );
    } finally {
      await lock.release();
    }

    assert.equal(await tryAcquireFromSeparateConnection(url), true);
  });
});

test("release is idempotent", async (t) => {
  const url = resolveDbUrl();
  if (!url) return t.skip(SKIP_REASON);

  await withDatabaseUrl(url, async () => {
    const lock = await acquireProviderEventConsumerLock();
    await lock.release();
    await lock.release();
  });
});

test("liveness succeeds while held and does not reacquire the lock", async (t) => {
  const url = resolveDbUrl();
  if (!url) return t.skip(SKIP_REASON);

  await withDatabaseUrl(url, async () => {
    const lock = await acquireProviderEventConsumerLock();
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
  });
});

test("forced termination of the lock connection stops the consumer", async (t) => {
  const url = resolveDbUrl();
  if (!url) return t.skip(SKIP_REASON);

  await withDatabaseUrl(url, async () => {
    const lock = await acquireProviderEventConsumerLock();
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
  });
});
