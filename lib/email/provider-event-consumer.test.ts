import assert from "node:assert/strict";
import test from "node:test";

import { EmailProviderEventProcessingStatus } from "@/app/generated/prisma/client";
import {
  ProviderEventConsumerError,
  runEmailProviderEventConsumer,
  type ProviderEventConsumerStore,
  type ProviderEventStreamAdapter,
} from "@/lib/email/provider-event-consumer";
import type { EmailConfig } from "@/lib/email/config";
import type { NormalizedProviderEventInput } from "@/lib/email/types";

type ProviderEventConfig = EmailConfig["providerEventIngestion"];

const config: ProviderEventConfig = {
  enabled: true,
  endpoint: "https://yds.serverless.yandexcloud.net",
  region: "ru-central1",
  streamName: "postbox-events",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret",
  initialPosition: "LATEST",
  recordLimit: 100,
  pollIntervalMs: 1,
  shardRefreshSeconds: 1,
  errorBackoffMs: 1,
  maxPayloadBytes: 4096,
  shutdownTimeoutMs: 1000,
};

function payload(eventId: string, eventType = "Delivery") {
  return Buffer.from(
    JSON.stringify({
      eventId,
      eventType,
      mail: {
        messageId: `provider-${eventId}`,
        timestamp: "2026-08-06T08:00:00.000Z",
      },
      delivery: {},
    }),
  );
}

function store(checkpoint?: string): ProviderEventConsumerStore & {
  failures: Array<{ sequenceNumber: string; errorCode: string; sanitizedErrorMessage: string }>;
  checkpoints: string[];
} {
  const state = {
    checkpoint: checkpoint ?? null,
    failures: [] as Array<{
      sequenceNumber: string;
      errorCode: string;
      sanitizedErrorMessage: string;
    }>,
    checkpoints: [] as string[],
  };
  return {
    failures: state.failures,
    checkpoints: state.checkpoints,
    async loadCheckpoint() {
      return state.checkpoint
        ? { lastSuccessfullyHandledSequenceNumber: state.checkpoint }
        : null;
    },
    async recordIngestionFailure(params) {
      const existing = state.failures.find(
        (failure) => failure.sequenceNumber === params.sequenceNumber,
      );
      if (existing) {
        existing.errorCode = params.errorCode;
        existing.sanitizedErrorMessage = params.sanitizedErrorMessage;
      } else {
        state.failures.push({
          sequenceNumber: params.sequenceNumber,
          errorCode: params.errorCode,
          sanitizedErrorMessage: params.sanitizedErrorMessage,
        });
      }
    },
    async advanceCheckpoint(params) {
      state.checkpoint = params.sequenceNumber;
      state.checkpoints.push(params.sequenceNumber);
    },
  };
}

function adapter(records: Array<{ sequenceNumber: string; data: Uint8Array }>, options?: {
  checkpoint?: string;
  getRecordsError?: Error & { name: string };
}): ProviderEventStreamAdapter & {
  iteratorCalls: Array<{ iteratorType: string; startingSequenceNumber?: string }>;
} {
  const state = {
    served: false,
    iteratorCalls: [] as Array<{
      iteratorType: string;
      startingSequenceNumber?: string;
    }>,
  };
  return {
    iteratorCalls: state.iteratorCalls,
    async listShards() {
      return [{ shardId: "shard-000", closed: true }];
    },
    async getShardIterator(params) {
      state.iteratorCalls.push({
        iteratorType: params.iteratorType,
        startingSequenceNumber: params.startingSequenceNumber,
      });
      return "iterator-1";
    },
    async getRecords() {
      if (options?.getRecordsError) throw options.getRecordsError;
      if (state.served) return { records: [], nextShardIterator: null };
      state.served = true;
      return { records, nextShardIterator: null, millisBehindLatest: 0 };
    },
  };
}

const releaseLock = { released: false };
function lock() {
  releaseLock.released = false;
  return async () => ({
    async release() {
      releaseLock.released = true;
    },
  });
}

test("uses initial position without checkpoint and AFTER_SEQUENCE_NUMBER with checkpoint", async () => {
  const withoutCheckpointAdapter = adapter([]);
  await runEmailProviderEventConsumer({
    config,
    adapter: withoutCheckpointAdapter,
    store: store(),
    acquireLock: lock(),
    once: true,
  });
  assert.equal(withoutCheckpointAdapter.iteratorCalls[0]?.iteratorType, "LATEST");

  const withCheckpointAdapter = adapter([]);
  await runEmailProviderEventConsumer({
    config: { ...config, initialPosition: "TRIM_HORIZON" },
    adapter: withCheckpointAdapter,
    store: store("42"),
    acquireLock: lock(),
    once: true,
  });
  assert.deepEqual(withCheckpointAdapter.iteratorCalls[0], {
    iteratorType: "AFTER_SEQUENCE_NUMBER",
    startingSequenceNumber: "42",
  });
});

test("processes ordered records and advances checkpoint after processing", async () => {
  const seen: string[] = [];
  const backingStore = store();
  const result = await runEmailProviderEventConsumer({
    config,
    adapter: adapter([
      { sequenceNumber: "1", data: payload("evt-1") },
      { sequenceNumber: "2", data: payload("evt-2") },
    ]),
    store: backingStore,
    processor: async (input: NormalizedProviderEventInput) => {
      seen.push(input.providerEventId);
      return {
        created: true,
        processed: true,
        messageId: "message",
        processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
      };
    },
    acquireLock: lock(),
    once: true,
  });

  assert.deepEqual(seen, ["evt-1", "evt-2"]);
  assert.deepEqual(backingStore.checkpoints, ["1", "2"]);
  assert.equal(result.processed, 2);
  assert.equal(result.checkpointsAdvanced, 2);
});

test("poison record is durably classified before checkpoint and does not leak payload", async () => {
  const backingStore = store();
  const result = await runEmailProviderEventConsumer({
    config: { ...config, maxPayloadBytes: 4096 },
    adapter: adapter([
      {
        sequenceNumber: "9",
        data: Buffer.from(
          JSON.stringify({
            eventId: "",
            eventType: "Delivery",
            mail: {
              messageId: "provider",
              timestamp: "2026-08-06T08:00:00.000Z",
            },
            destination: ["user@example.com"],
            delivery: {},
          }),
        ),
      },
    ]),
    store: backingStore,
    acquireLock: lock(),
    once: true,
  });

  assert.equal(result.ingestionFailures, 1);
  assert.equal(backingStore.failures[0]?.sequenceNumber, "9");
  assert.equal(backingStore.failures[0]?.errorCode, "INVALID_STRING");
  assert.doesNotMatch(
    backingStore.failures[0]?.sanitizedErrorMessage ?? "",
    /user@example\.com/,
  );
  assert.deepEqual(backingStore.checkpoints, ["9"]);
});

test("duplicate provider event counts as duplicate and still checkpoints replay", async () => {
  const result = await runEmailProviderEventConsumer({
    config,
    adapter: adapter([{ sequenceNumber: "10", data: payload("evt-dup") }]),
    store: store(),
    processor: async () => ({
      created: false,
      processed: true,
      messageId: "message",
      processingStatus: EmailProviderEventProcessingStatus.PROCESSED,
    }),
    acquireLock: lock(),
    once: true,
  });
  assert.equal(result.duplicates, 1);
  assert.equal(result.checkpointsAdvanced, 1);
});

test("terminal auth failure and lock contention fail closed", async () => {
  const authError = new Error("bad signature") as Error & { name: string };
  authError.name = "InvalidSignatureException";
  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config,
        adapter: adapter([], { getRecordsError: authError }),
        store: store(),
        acquireLock: lock(),
        once: true,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "STREAM_AUTH_FAILURE",
  );

  await assert.rejects(
    () =>
      runEmailProviderEventConsumer({
        config,
        adapter: adapter([]),
        store: store(),
        acquireLock: async () => {
          throw new ProviderEventConsumerError("CONSUMER_LOCK_HELD", "held");
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
        config: { ...config, enabled: false },
        adapter: adapter([]),
        store: store(),
        acquireLock: lock(),
        once: true,
      }),
    (error: unknown) =>
      error instanceof ProviderEventConsumerError &&
      error.code === "PROVIDER_EVENT_INGESTION_DISABLED",
  );
});
