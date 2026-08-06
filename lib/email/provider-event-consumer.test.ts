import assert from "node:assert/strict";
import test from "node:test";

import { EmailProviderEventProcessingStatus } from "@/app/generated/prisma/client";
import {
  ProviderEventConsumerError,
  runEmailProviderEventConsumer,
} from "@/lib/email/provider-event-consumer";
import {
  baseProviderEventConfig,
  makeFakeAdapter,
  makeFakeLock,
  makeFakeStore,
  providerEventPayload,
  record,
  type ProviderEventConfig,
} from "@/lib/email/provider-event-consumer-harness";
import type { NormalizedProviderEventInput } from "@/lib/email/types";

const OPEN = (shardId: string) => ({ shardId, closed: false });
const CLOSED = (shardId: string) => ({ shardId, closed: true });

function okProcessor() {
  return async () => ({
    created: true,
    processed: true,
    messageId: "message",
    processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
  });
}

/** Aborts the consumer as soon as the scripted condition is satisfied. */
function stopWhen(predicate: () => boolean): AbortController {
  const controller = new AbortController();
  const timer = setInterval(() => {
    if (predicate()) {
      clearInterval(timer);
      controller.abort();
    }
  }, 2);
  timer.unref?.();
  controller.signal.addEventListener("abort", () => clearInterval(timer), {
    once: true,
  });
  return controller;
}

function config(overrides: Partial<ProviderEventConfig> = {}): ProviderEventConfig {
  return { ...baseProviderEventConfig, ...overrides };
}

test("uses initial position without checkpoint and AFTER_SEQUENCE_NUMBER with checkpoint", async () => {
  const withoutCheckpoint = makeFakeAdapter({
    shardPages: [[CLOSED("shard-000")]],
    respond: () => ({ records: [], nextShardIterator: null }),
  });
  await runEmailProviderEventConsumer({
    config: config(),
    adapter: withoutCheckpoint,
    store: makeFakeStore(),
    acquireLock: makeFakeLock().acquire,
    once: true,
  });
  assert.equal(withoutCheckpoint.iteratorCalls[0]?.iteratorType, "LATEST");

  const withCheckpoint = makeFakeAdapter({
    shardPages: [[CLOSED("shard-000")]],
    respond: () => ({ records: [], nextShardIterator: null }),
  });
  await runEmailProviderEventConsumer({
    config: config({ initialPosition: "TRIM_HORIZON" }),
    adapter: withCheckpoint,
    store: makeFakeStore({ seed: { "shard-000": { sequence: "42" } } }),
    acquireLock: makeFakeLock().acquire,
    once: true,
  });
  assert.deepEqual(
    {
      iteratorType: withCheckpoint.iteratorCalls[0]?.iteratorType,
      startingSequenceNumber: withCheckpoint.iteratorCalls[0]?.startingSequenceNumber,
    },
    { iteratorType: "AFTER_SEQUENCE_NUMBER", startingSequenceNumber: "42" },
  );
});

test("processes ordered records and advances checkpoint after processing", async () => {
  const seen: string[] = [];
  const store = makeFakeStore();
  const result = await runEmailProviderEventConsumer({
    config: config(),
    adapter: makeFakeAdapter({
      shardPages: [[CLOSED("shard-000")]],
      respond: ({ call }) =>
        call === 1
          ? {
              records: [
                record("1", providerEventPayload("evt-1")),
                record("2", providerEventPayload("evt-2")),
              ],
              nextShardIterator: null,
              millisBehindLatest: 0,
            }
          : { records: [], nextShardIterator: null },
    }),
    store,
    processor: async (input: NormalizedProviderEventInput) => {
      seen.push(input.providerEventId);
      return {
        created: true,
        processed: true,
        messageId: "message",
        processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
      };
    },
    acquireLock: makeFakeLock().acquire,
    once: true,
  });

  assert.deepEqual(seen, ["evt-1", "evt-2"]);
  assert.deepEqual(
    store.checkpoints.map((entry) => entry.sequenceNumber),
    ["1", "2"],
  );
  assert.equal(result.processed, 2);
  assert.equal(result.checkpointsAdvanced, 2);
});

test("duplicate provider event counts as duplicate and still checkpoints replay", async () => {
  const result = await runEmailProviderEventConsumer({
    config: config(),
    adapter: makeFakeAdapter({
      shardPages: [[CLOSED("shard-000")]],
      respond: ({ call }) =>
        call === 1
          ? {
              records: [record("10", providerEventPayload("evt-dup"))],
              nextShardIterator: null,
            }
          : { records: [], nextShardIterator: null },
    }),
    store: makeFakeStore(),
    processor: async () => ({
      created: false,
      processed: true,
      messageId: "message",
      processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
    }),
    acquireLock: makeFakeLock().acquire,
    once: true,
  });
  assert.equal(result.duplicates, 1);
  assert.equal(result.checkpointsAdvanced, 1);
});

test("terminal auth failure and lock contention fail closed with typed kinds", async () => {
  const authError = new Error("bad signature");
  authError.name = "InvalidSignatureException";

  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config: config(),
        adapter: makeFakeAdapter({
          shardPages: [[OPEN("shard-000")]],
          respond: () => ({ throws: authError }),
        }),
        store: makeFakeStore(),
        acquireLock: makeFakeLock().acquire,
        once: true,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "STREAM_AUTH_FAILURE" &&
      error.kind === "authentication",
  );

  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config: config(),
        adapter: makeFakeAdapter({
          shardPages: [[OPEN("shard-000")]],
          respond: () => ({ records: [] }),
        }),
        store: makeFakeStore(),
        acquireLock: async () => {
          throw new ProviderEventConsumerError(
            "CONSUMER_LOCK_HELD",
            "held",
            "lock_contention",
          );
        },
        once: true,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "CONSUMER_LOCK_HELD",
  );
});

test("disabled config refuses to run", async () => {
  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config: config({ enabled: false }),
        adapter: makeFakeAdapter({ shardPages: [[]], respond: () => ({ records: [] }) }),
        store: makeFakeStore(),
        acquireLock: makeFakeLock().acquire,
        once: true,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "PROVIDER_EVENT_INGESTION_DISABLED" &&
      error.kind === "invalid_config",
  );
});

// ---------------------------------------------------------------------------
// F-01 fair multi-shard consumption
// ---------------------------------------------------------------------------

test("two continuously open shards both receive iterators and records", async () => {
  const counts = new Map<string, number>();
  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a"), OPEN("shard-b")]],
    respond: ({ shardId, call }) => {
      counts.set(shardId, call);
      return {
        records: [
          record(`${shardId}-${call}`, providerEventPayload(`${shardId}-${call}`)),
        ],
      };
    },
  });

  const controller = stopWhen(
    () => (counts.get("shard-a") ?? 0) >= 3 && (counts.get("shard-b") ?? 0) >= 3,
  );

  const result = await runEmailProviderEventConsumer({
    config: config({ shardConcurrency: 2 }),
    adapter,
    store: makeFakeStore(),
    processor: okProcessor(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  const iteratorShards = new Set(adapter.iteratorCalls.map((call) => call.shardId));
  assert.deepEqual([...iteratorShards].sort(), ["shard-a", "shard-b"]);
  assert.ok((adapter.recordsByShard.get("shard-a") ?? 0) >= 3);
  assert.ok((adapter.recordsByShard.get("shard-b") ?? 0) >= 3);
  assert.ok(result.rounds >= 1);
});

test("more open shards than configured concurrency all make progress", async () => {
  const counts = new Map<string, number>();
  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a"), OPEN("shard-b"), OPEN("shard-c")]],
    respond: ({ shardId, call }) => {
      counts.set(shardId, call);
      return { records: [record(`${shardId}-${call}`, providerEventPayload(`${shardId}-${call}`))] };
    },
  });

  const controller = stopWhen(() =>
    ["shard-a", "shard-b", "shard-c"].every((id) => (counts.get(id) ?? 0) >= 2),
  );

  await runEmailProviderEventConsumer({
    config: config({ shardConcurrency: 1 }),
    adapter,
    store: makeFakeStore(),
    processor: okProcessor(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  for (const shardId of ["shard-a", "shard-b", "shard-c"]) {
    assert.ok(
      (adapter.recordsByShard.get(shardId) ?? 0) >= 2,
      `${shardId} did not progress`,
    );
  }
});

test("a busy shard cannot starve a low-volume shard", async () => {
  let idleCalls = 0;
  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-busy"), OPEN("shard-idle")]],
    respond: ({ shardId, call }) => {
      if (shardId === "shard-busy") {
        return {
          records: Array.from({ length: 5 }, (_, index) =>
            record(
              `busy-${call}-${index}`,
              providerEventPayload(`busy-${call}-${index}`),
            ),
          ),
        };
      }
      idleCalls = call;
      // Idle for the first three polls, then finally produces one record.
      return call < 4
        ? { records: [] }
        : { records: [record(`idle-${call}`, providerEventPayload(`idle-${call}`))] };
    },
  });

  const controller = stopWhen(() => (adapter.recordsByShard.get("shard-idle") ?? 0) >= 1);

  await runEmailProviderEventConsumer({
    // Concurrency 1 makes starvation possible if scheduling were unfair.
    config: config({ shardConcurrency: 1, shardSliceMaxPolls: 4 }),
    adapter,
    store: makeFakeStore(),
    processor: okProcessor(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  // The no-starvation property: the idle shard kept receiving slices while the
  // busy shard always had a full page waiting, and its record was consumed.
  // The exact count is not asserted because the abort can land mid-slice.
  assert.ok(idleCalls >= 4, `idle shard was polled only ${idleCalls} times`);
  assert.ok((adapter.recordsByShard.get("shard-idle") ?? 0) >= 1);
  assert.ok((adapter.recordsByShard.get("shard-busy") ?? 0) > 0);
});

test("a shard discovered during refresh starts processing", async () => {
  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a")], [OPEN("shard-a"), OPEN("shard-late")]],
    respond: ({ shardId, call }) => ({
      records: [record(`${shardId}-${call}`, providerEventPayload(`${shardId}-${call}`))],
    }),
  });

  const controller = stopWhen(() => (adapter.recordsByShard.get("shard-late") ?? 0) >= 1);

  const result = await runEmailProviderEventConsumer({
    config: config({ shardRefreshSeconds: 0 }),
    adapter,
    store: makeFakeStore(),
    processor: okProcessor(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  assert.ok((adapter.recordsByShard.get("shard-late") ?? 0) >= 1);
  assert.equal(result.shardsDiscovered, 2);
});

test("a closed shard drains and retires without blocking open shards", async () => {
  const adapter = makeFakeAdapter({
    shardPages: [[CLOSED("shard-closed"), OPEN("shard-open")]],
    respond: ({ shardId, call }) => {
      if (shardId === "shard-closed") {
        return call === 1
          ? {
              records: [record("closed-1", providerEventPayload("closed-1"))],
              nextShardIterator: null,
            }
          : { records: [], nextShardIterator: null };
      }
      return {
        records: [record(`open-${call}`, providerEventPayload(`open-${call}`))],
      };
    },
  });

  const controller = stopWhen(() => (adapter.recordsByShard.get("shard-open") ?? 0) >= 4);

  const result = await runEmailProviderEventConsumer({
    config: config({ shardConcurrency: 1, shardRefreshSeconds: 3600 }),
    adapter,
    store: makeFakeStore(),
    processor: okProcessor(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  assert.equal(result.shardsRetired, 1);
  assert.equal(adapter.recordsByShard.get("shard-closed"), 1);
  assert.ok((adapter.recordsByShard.get("shard-open") ?? 0) >= 4);
});

test("cancellation stops every active shard slice cleanly and releases the lock", async () => {
  const lock = makeFakeLock();
  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a"), OPEN("shard-b"), OPEN("shard-c")]],
    respond: ({ shardId, call }) => ({
      records: [record(`${shardId}-${call}`, providerEventPayload(`${shardId}-${call}`))],
    }),
  });

  const controller = stopWhen(() => adapter.getRecordsCalls.length >= 6);
  const counters = await runEmailProviderEventConsumer({
    config: config({ shardConcurrency: 3 }),
    adapter,
    store: makeFakeStore(),
    processor: okProcessor(),
    acquireLock: lock.acquire,
    signal: controller.signal,
  });

  assert.ok(counters.recordsRead >= 6);
  assert.equal(lock.released(), true);
});

test("lock connection loss aborts the consumer and prevents further checkpoints", async () => {
  const lock = makeFakeLock();
  const store = makeFakeStore();
  let served = 0;
  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a")]],
    respond: ({ call }) => {
      served = call;
      if (call === 2) lock.loseLock(new Error("connection terminated"));
      return { records: [record(`seq-${call}`, providerEventPayload(`evt-${call}`))] };
    },
  });

  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config: config(),
        adapter,
        store,
        processor: okProcessor(),
        acquireLock: lock.acquire,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError && error.code === "CONSUMER_LOCK_LOST",
  );

  assert.ok(served >= 2);
  assert.equal(lock.released(), true);
});

// ---------------------------------------------------------------------------
// F-02 checkpoint safety
// ---------------------------------------------------------------------------

const PROCESSOR_FAILURES: Array<[string, Error]> = [
  ["prisma connection reset", Object.assign(new Error("connection reset"), {
    name: "PrismaClientInitializationError",
  })],
  ["deadlock / serialization failure", Object.assign(new Error("deadlock detected"), {
    name: "PrismaClientKnownRequestError",
    code: "P2034",
  })],
  ["statement timeout", Object.assign(new Error("canceling statement due to statement timeout"), {
    name: "PrismaClientKnownRequestError",
    code: "P1008",
  })],
  [
    "suppression reconciliation failure",
    Object.assign(new Error("suppression write rejected"), {
      name: "PrismaClientKnownRequestError",
      code: "P2004",
    }),
  ],
  ["generic unexpected exception", Object.assign(new Error("boom"), { name: "TypeError" })],
];

for (const [label, failure] of PROCESSOR_FAILURES) {
  test(`processor failure (${label}) never advances the checkpoint`, async () => {
    const store = makeFakeStore();
    await assert.rejects(
      () =>
        runEmailProviderEventConsumer({
          config: config({ maxConsecutiveFailures: 2 }),
          adapter: makeFakeAdapter({
            shardPages: [[OPEN("shard-a")]],
            respond: () => ({
              records: [record("1", providerEventPayload("evt-1"))],
            }),
          }),
          store,
          processor: async () => {
            throw failure;
          },
          acquireLock: makeFakeLock().acquire,
          once: true,
        }),
      (error: unknown) =>
        error instanceof ProviderEventConsumerError &&
        error.code === "PROVIDER_EVENT_PROCESSOR_FAILED",
    );

    assert.deepEqual(store.checkpoints, []);
    assert.deepEqual(store.poisonRecords, []);
  });
}

test("processor commit followed by a checkpoint write failure leaves the record replayable", async () => {
  let processorCalls = 0;
  const store = makeFakeStore({
    failCheckpoint: () => new Error("checkpoint write failed"),
  });

  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config: config(),
        adapter: makeFakeAdapter({
          shardPages: [[OPEN("shard-a")]],
          respond: () => ({ records: [record("1", providerEventPayload("evt-1"))] }),
        }),
        store,
        processor: async () => {
          processorCalls += 1;
          return {
            created: true,
            processed: true,
            messageId: "message",
            processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
          };
        },
        acquireLock: makeFakeLock().acquire,
        once: true,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "CHECKPOINT_WRITE_FAILED",
  );

  assert.equal(processorCalls, 1);
  assert.deepEqual(store.checkpoints, []);

  // Replay: the same sequence is re-read and deduplicated by the processor.
  const replayStore = makeFakeStore();
  const replay = await runEmailProviderEventConsumer({
    config: config(),
    adapter: makeFakeAdapter({
      shardPages: [[CLOSED("shard-a")]],
      respond: ({ call }) =>
        call === 1
          ? {
              records: [record("1", providerEventPayload("evt-1"))],
              nextShardIterator: null,
            }
          : { records: [], nextShardIterator: null },
    }),
    store: replayStore,
    processor: async () => ({
      created: false,
      processed: true,
      messageId: "message",
      processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
    }),
    acquireLock: makeFakeLock().acquire,
    once: true,
  });

  assert.equal(replay.duplicates, 1);
  assert.deepEqual(
    replayStore.checkpoints.map((entry) => entry.sequenceNumber),
    ["1"],
  );
});

test("failure-ledger write failure does not advance the checkpoint", async () => {
  const store = makeFakeStore({
    failPoisonRecord: () => new Error("ledger write failed"),
  });

  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config: config(),
        adapter: makeFakeAdapter({
          shardPages: [[OPEN("shard-a")]],
          respond: () => ({ records: [record("1", Buffer.from("not json"))] }),
        }),
        store,
        acquireLock: makeFakeLock().acquire,
        once: true,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "INGESTION_FAILURE_LEDGER_WRITE_FAILED",
  );

  assert.deepEqual(store.checkpoints, []);
  assert.deepEqual(store.poisonRecords, []);
});

test("deterministic poison record is classified atomically and replays idempotently", async () => {
  const store = makeFakeStore();
  const poison = Buffer.from(
    JSON.stringify({
      eventId: "",
      eventType: "Delivery",
      mail: { messageId: "provider", timestamp: "2026-08-06T08:00:00.000Z" },
      destination: ["user@example.com"],
      delivery: {},
    }),
  );

  for (let run = 0; run < 2; run += 1) {
    const result = await runEmailProviderEventConsumer({
      config: config(),
      adapter: makeFakeAdapter({
        shardPages: [[CLOSED("shard-a")]],
        respond: ({ call }) =>
          call === 1
            ? { records: [record("9", poison)], nextShardIterator: null }
            : { records: [], nextShardIterator: null },
      }),
      store,
      acquireLock: makeFakeLock().acquire,
      once: true,
    });
    assert.equal(result.ingestionFailures, 1);
  }

  assert.equal(store.poisonRecords.length, 1);
  assert.equal(store.poisonRecords[0]?.errorCode, "INVALID_STRING");
  assert.equal(
    store.poisonRecords[0]?.sanitizedErrorMessage,
    "Provider event payload contained an invalid bounded string field.",
  );
  assert.doesNotMatch(
    store.poisonRecords[0]?.sanitizedErrorMessage ?? "",
    /user@example\.com/,
  );
});

// ---------------------------------------------------------------------------
// F-11 failure-ledger sanitization
// ---------------------------------------------------------------------------

test("attacker-controlled and infrastructure error text never reaches the ledger", async () => {
  const hostile = new Error(
    `Invalid \`prisma.emailProviderEvent.create()\` invocation: recipient victim@example.com\r\nAuthorization: Bearer sk-secret ${"A".repeat(5000)}`,
  );
  hostile.name = "PrismaClientValidationError";

  const store = makeFakeStore();
  await assert.rejects(() =>
    runEmailProviderEventConsumer({
      config: config({ maxConsecutiveFailures: 1 }),
      adapter: makeFakeAdapter({
        shardPages: [[OPEN("shard-a")]],
        respond: () => ({ records: [record("1", providerEventPayload("evt-1"))] }),
      }),
      store,
      processor: async () => {
        throw hostile;
      },
      acquireLock: makeFakeLock().acquire,
      once: true,
    }),
  );

  // Post-parse processor failures are never acknowledged at all.
  assert.deepEqual(store.poisonRecords, []);
  assert.deepEqual(store.checkpoints, []);

  const serialized = JSON.stringify(store.poisonRecords);
  assert.doesNotMatch(serialized, /victim@example\.com/);
  assert.doesNotMatch(serialized, /sk-secret/);
});

test("every deterministic ledger message is a static allowlisted string", async () => {
  const cases: Array<[Uint8Array, string, string]> = [
    [
      Buffer.from("}{ not json victim@example.com"),
      "MALFORMED_JSON",
      "Provider event payload was not valid JSON.",
    ],
    [
      Buffer.from(JSON.stringify(["victim@example.com"])),
      "INVALID_OBJECT",
      "Provider event payload structure was invalid.",
    ],
    [
      Buffer.from(
        JSON.stringify({
          eventId: "evt",
          eventType: "Delivery",
          mail: { messageId: "m", timestamp: "not-a-timestamp" },
          delivery: {},
        }),
      ),
      "INVALID_TIMESTAMP",
      "Provider event payload contained an invalid timestamp.",
    ],
    [
      Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]),
      "INVALID_ENCODING",
      "Provider event payload was not valid UTF-8.",
    ],
  ];

  for (const [payload, expectedCode, expectedMessage] of cases) {
    const store = makeFakeStore();
    await runEmailProviderEventConsumer({
      config: config(),
      adapter: makeFakeAdapter({
        shardPages: [[CLOSED("shard-a")]],
        respond: ({ call }) =>
          call === 1
            ? { records: [record("1", payload)], nextShardIterator: null }
            : { records: [], nextShardIterator: null },
      }),
      store,
      acquireLock: makeFakeLock().acquire,
      once: true,
    });
    assert.equal(store.poisonRecords[0]?.errorCode, expectedCode);
    assert.equal(store.poisonRecords[0]?.sanitizedErrorMessage, expectedMessage);
  }

  const oversized = makeFakeStore();
  await runEmailProviderEventConsumer({
    config: config({ maxPayloadBytes: 16 }),
    adapter: makeFakeAdapter({
      shardPages: [[CLOSED("shard-a")]],
      respond: ({ call }) =>
        call === 1
          ? {
              records: [record("1", providerEventPayload("evt-oversized"))],
              nextShardIterator: null,
            }
          : { records: [], nextShardIterator: null },
    }),
    store: oversized,
    acquireLock: makeFakeLock().acquire,
    once: true,
  });
  assert.equal(oversized.poisonRecords[0]?.errorCode, "PAYLOAD_TOO_LARGE");
});

// ---------------------------------------------------------------------------
// F-15 pacing, backoff, and bounded retry
// ---------------------------------------------------------------------------

test("GetRecords calls for one shard respect the configured pacing interval", async () => {
  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a")]],
    respond: ({ call }) => ({
      records: [record(`seq-${call}`, providerEventPayload(`evt-${call}`))],
    }),
  });
  const controller = stopWhen(() => adapter.getRecordsCalls.length >= 4);

  await runEmailProviderEventConsumer({
    config: config({ pollIntervalMs: 60, shardConcurrency: 1 }),
    adapter,
    store: makeFakeStore(),
    processor: okProcessor(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  const shardCalls = adapter.getRecordsCalls.filter((call) => call.shardId === "shard-a");
  for (let index = 1; index < Math.min(shardCalls.length, 4); index += 1) {
    const delta = shardCalls[index]!.atMs - shardCalls[index - 1]!.atMs;
    assert.ok(delta >= 50, `pacing violated: ${delta}ms between GetRecords calls`);
  }
});

test("bounded consecutive transient failures stop the shard through the retryable path", async () => {
  const throttled = new Error("slow down");
  throttled.name = "ThrottlingException";

  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a")]],
    respond: () => ({ throws: throttled }),
  });

  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config: config({ maxConsecutiveFailures: 3, errorBackoffMs: 1 }),
        adapter,
        store: makeFakeStore(),
        acquireLock: makeFakeLock().acquire,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "STREAM_RETRY_EXHAUSTED" &&
      error.kind === "retryable",
  );
  assert.equal(adapter.getRecordsCalls.length, 3);
});

test("a successful poll resets the consecutive-failure counter", async () => {
  const throttled = new Error("slow down");
  throttled.name = "ThrottlingException";

  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a")]],
    // Fails on every odd poll; with maxConsecutiveFailures=2 this only
    // terminates if successes do not reset the counter.
    respond: ({ call }) =>
      call % 2 === 1
        ? { throws: throttled }
        : { records: [record(`seq-${call}`, providerEventPayload(`evt-${call}`))] },
  });

  const controller = stopWhen(() => adapter.getRecordsCalls.length >= 8);
  const result = await runEmailProviderEventConsumer({
    config: config({ maxConsecutiveFailures: 2, errorBackoffMs: 1 }),
    adapter,
    store: makeFakeStore(),
    processor: okProcessor(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  assert.ok(result.transientRetries >= 3);
  assert.ok(result.recordsRead >= 3);
});

test("abort during backoff returns promptly instead of waiting out the delay", async () => {
  const throttled = new Error("slow down");
  throttled.name = "ThrottlingException";
  const controller = new AbortController();

  const adapter = makeFakeAdapter({
    shardPages: [[OPEN("shard-a")]],
    respond: () => {
      setTimeout(() => controller.abort(), 5).unref?.();
      return { throws: throttled };
    },
  });

  const startedAt = Date.now();
  await runEmailProviderEventConsumer({
    config: config({ maxConsecutiveFailures: 10, errorBackoffMs: 30_000 }),
    adapter,
    store: makeFakeStore(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });
  assert.ok(Date.now() - startedAt < 3_000, "abort did not interrupt backoff");
});

// ---------------------------------------------------------------------------
// F-16 safe iterator reacquisition before the first checkpoint
// ---------------------------------------------------------------------------

test("LATEST shards persist a durable initial-read boundary and reacquire AT_TIMESTAMP", async () => {
  const store = makeFakeStore();
  const expired = new Error("iterator expired");
  expired.name = "ExpiredIteratorException";

  const adapter = makeFakeAdapter({
    shardPages: [[CLOSED("shard-a")]],
    respond: ({ call }) =>
      call === 1
        ? { throws: expired }
        : { records: [], nextShardIterator: null },
  });

  const controller = stopWhen(() => adapter.iteratorCalls.length >= 2);
  await runEmailProviderEventConsumer({
    config: config({ initialPosition: "LATEST", shardSliceMaxPolls: 4 }),
    adapter,
    store,
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  assert.equal(adapter.iteratorCalls[0]?.iteratorType, "LATEST");
  assert.equal(store.initialReadAtCalls.length >= 1, true);
  const boundary = store.state.get("shard-a")?.initialReadAt;
  assert.ok(boundary instanceof Date);
  assert.equal(adapter.iteratorCalls[1]?.iteratorType, "AT_TIMESTAMP");
  assert.equal(adapter.iteratorCalls[1]?.timestamp?.getTime(), boundary.getTime());
});

test("a restart before the first sequence checkpoint reuses the same durable timestamp", async () => {
  const boundary = new Date("2026-08-06T09:00:00.000Z");
  const store = makeFakeStore({ seed: { "shard-a": { initialReadAt: boundary } } });
  const adapter = makeFakeAdapter({
    shardPages: [[CLOSED("shard-a")]],
    respond: () => ({ records: [], nextShardIterator: null }),
  });

  await runEmailProviderEventConsumer({
    config: config({ initialPosition: "LATEST" }),
    adapter,
    store,
    acquireLock: makeFakeLock().acquire,
    once: true,
  });

  assert.equal(adapter.iteratorCalls[0]?.iteratorType, "AT_TIMESTAMP");
  assert.equal(adapter.iteratorCalls[0]?.timestamp?.getTime(), boundary.getTime());
  assert.deepEqual(store.initialReadAtCalls, []);
});

test("the first successful record establishes a sequence checkpoint used by later acquisitions", async () => {
  const store = makeFakeStore();
  const expired = new Error("iterator expired");
  expired.name = "ExpiredIteratorException";

  const adapter = makeFakeAdapter({
    shardPages: [[CLOSED("shard-a")]],
    respond: ({ call }) => {
      if (call === 1) {
        return { records: [record("seq-1", providerEventPayload("evt-1"))] };
      }
      if (call === 2) return { throws: expired };
      return { records: [], nextShardIterator: null };
    },
  });

  const controller = stopWhen(() => adapter.iteratorCalls.length >= 2);
  await runEmailProviderEventConsumer({
    config: config({ initialPosition: "LATEST", shardSliceMaxPolls: 5 }),
    adapter,
    store,
    processor: okProcessor(),
    acquireLock: makeFakeLock().acquire,
    signal: controller.signal,
  });

  const reacquisition = adapter.iteratorCalls[1];
  assert.equal(reacquisition?.iteratorType, "AFTER_SEQUENCE_NUMBER");
  assert.equal(reacquisition?.startingSequenceNumber, "seq-1");
});

test("TRIM_HORIZON behaviour is unchanged and stores no initial-read boundary", async () => {
  const store = makeFakeStore();
  const adapter = makeFakeAdapter({
    shardPages: [[CLOSED("shard-a")]],
    respond: () => ({ records: [], nextShardIterator: null }),
  });

  await runEmailProviderEventConsumer({
    config: config({ initialPosition: "TRIM_HORIZON" }),
    adapter,
    store,
    acquireLock: makeFakeLock().acquire,
    once: true,
  });

  assert.equal(adapter.iteratorCalls[0]?.iteratorType, "TRIM_HORIZON");
  assert.deepEqual(store.initialReadAtCalls, []);
});
