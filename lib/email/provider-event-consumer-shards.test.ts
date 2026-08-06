import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";

import {
  abortableSleep,
  collectShardPages,
  computeBackoffDelayMs,
  MAX_BACKOFF_MS,
  ProviderEventConsumerError,
  type ProviderEventStreamShard,
} from "@/lib/email/provider-event-consumer";

const OPEN = (shardId: string): ProviderEventStreamShard => ({ shardId, closed: false });

// ---------------------------------------------------------------------------
// F-05 complete ListShards pagination
// ---------------------------------------------------------------------------

test("a single page is returned unchanged", async () => {
  const shards = await collectShardPages({
    fetchPage: async () => ({ shards: [OPEN("a"), OPEN("b")], nextToken: null }),
  });
  assert.deepEqual(shards.map((shard) => shard.shardId), ["a", "b"]);
});

test("pagination follows NextToken until exhausted", async () => {
  const tokens: Array<string | undefined> = [];
  const shards = await collectShardPages({
    fetchPage: async (nextToken) => {
      tokens.push(nextToken);
      if (!nextToken) return { shards: [OPEN("a")], nextToken: "t1" };
      if (nextToken === "t1") return { shards: [OPEN("b")], nextToken: "t2" };
      return { shards: [OPEN("c")], nextToken: null };
    },
  });
  assert.deepEqual(tokens, [undefined, "t1", "t2"]);
  assert.deepEqual(shards.map((shard) => shard.shardId), ["a", "b", "c"]);
});

test("an empty final page terminates pagination without losing earlier shards", async () => {
  const shards = await collectShardPages({
    fetchPage: async (nextToken) =>
      nextToken
        ? { shards: [], nextToken: null }
        : { shards: [OPEN("a"), OPEN("b")], nextToken: "t1" },
  });
  assert.deepEqual(shards.map((shard) => shard.shardId), ["a", "b"]);
});

test("a shard id repeated across pages is deduplicated", async () => {
  const shards = await collectShardPages({
    fetchPage: async (nextToken) =>
      nextToken
        ? { shards: [OPEN("a"), OPEN("c")], nextToken: null }
        : { shards: [OPEN("a"), OPEN("b")], nextToken: "t1" },
  });
  assert.deepEqual(shards.map((shard) => shard.shardId), ["a", "b", "c"]);
});

test("authentication failures during pagination are classified terminally", async () => {
  const authError = new Error("denied");
  authError.name = "AccessDeniedException";

  await assert.rejects(
    () =>
      collectShardPages({
        fetchPage: async () => {
          throw authError;
        },
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "STREAM_AUTH_FAILURE" &&
      error.kind === "authentication",
  );
});

test("a transient pagination failure is retried and then succeeds", async () => {
  const transient = new Error("throttled");
  transient.name = "ThrottlingException";
  let attempts = 0;
  let retries = 0;

  const shards = await collectShardPages({
    onTransientRetry: async () => {
      retries += 1;
    },
    fetchPage: async () => {
      attempts += 1;
      if (attempts < 3) throw transient;
      return { shards: [OPEN("a")], nextToken: null };
    },
  });

  assert.equal(attempts, 3);
  assert.equal(retries, 2);
  assert.deepEqual(shards.map((shard) => shard.shardId), ["a"]);
});

test("exhausted pagination retries fail closed instead of returning a partial list", async () => {
  const transient = new Error("throttled");
  transient.name = "ThrottlingException";

  await assert.rejects(
    () =>
      collectShardPages({
        fetchPage: async () => {
          throw transient;
        },
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "SHARD_DISCOVERY_FAILED",
  );
});

test("abort during pagination stops immediately", async () => {
  const controller = new AbortController();
  await assert.rejects(
    () =>
      collectShardPages({
        signal: controller.signal,
        fetchPage: async () => {
          controller.abort();
          return { shards: [OPEN("a")], nextToken: "t1" };
        },
      }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

test("unbounded pagination is rejected rather than looping forever", async () => {
  await assert.rejects(
    () =>
      collectShardPages({
        maxPages: 5,
        fetchPage: async () => ({ shards: [], nextToken: "always-more" }),
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "SHARD_PAGINATION_LIMIT",
  );
});

// ---------------------------------------------------------------------------
// F-06 abort listener cleanup
// ---------------------------------------------------------------------------

test("repeated normal sleeps do not accumulate abort listeners", async () => {
  const controller = new AbortController();
  for (let index = 0; index < 50; index += 1) {
    await abortableSleep(1, controller.signal);
  }
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("aborted sleeps clean up their listener", async () => {
  for (let index = 0; index < 20; index += 1) {
    const controller = new AbortController();
    const pending = abortableSleep(10_000, controller.signal);
    controller.abort();
    await assert.rejects(pending, (error: unknown) => (error as Error).name === "AbortError");
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("a long idle polling loop keeps the listener count stable", async () => {
  const controller = new AbortController();
  for (let index = 0; index < 200; index += 1) {
    await abortableSleep(0, controller.signal);
    await abortableSleep(1, controller.signal);
  }
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("an already-aborted signal rejects before scheduling a timer", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    abortableSleep(10_000, controller.signal),
    (error: unknown) => (error as Error).name === "AbortError",
  );
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

// ---------------------------------------------------------------------------
// F-15 backoff bounds
// ---------------------------------------------------------------------------

test("backoff grows exponentially, stays within jitter bounds, and is capped", () => {
  const base = 2_000;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const expectedCap = Math.min(base * 2 ** Math.min(attempt - 1, 20), MAX_BACKOFF_MS);
    const low = computeBackoffDelayMs(attempt, base, () => 0);
    const high = computeBackoffDelayMs(attempt, base, () => 0.999999);
    assert.equal(low, Math.round(expectedCap / 2));
    assert.ok(high <= expectedCap, `attempt ${attempt} exceeded cap`);
    assert.ok(high >= low, `attempt ${attempt} jitter inverted`);
    assert.ok(expectedCap <= MAX_BACKOFF_MS);
  }
});

test("backoff jitter never collapses to zero", () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.ok(computeBackoffDelayMs(attempt, 100, () => 0) >= 50);
  }
});
