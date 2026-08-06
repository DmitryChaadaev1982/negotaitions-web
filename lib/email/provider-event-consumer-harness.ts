/**
 * Deterministic in-memory harness for provider-event consumer tests.
 *
 * Nothing here contacts Yandex Data Streams, Postbox, or any cloud endpoint;
 * every adapter is a local fake driven by scripted callbacks.
 */
import type { EmailConfig } from "@/lib/email/config";
import type {
  ProviderEventCheckpoint,
  ProviderEventConsumerLock,
  ProviderEventConsumerStore,
  ProviderEventShardIteratorType,
  ProviderEventStreamAdapter,
  ProviderEventStreamRecord,
  ProviderEventStreamShard,
} from "@/lib/email/provider-event-consumer";

export type ProviderEventConfig = EmailConfig["providerEventIngestion"];

export const baseProviderEventConfig: ProviderEventConfig = {
  enabled: true,
  endpoint: "https://yds.serverless.yandexcloud.net",
  region: "ru-central1",
  streamName: "postbox-events",
  accessKeyId: "test-access",
  secretAccessKey: "test-secret",
  initialPosition: "LATEST",
  recordLimit: 100,
  pollIntervalMs: 1,
  shardRefreshSeconds: 0,
  errorBackoffMs: 1,
  maxPayloadBytes: 4096,
  shutdownTimeoutMs: 1000,
  shardConcurrency: 2,
  shardSliceMaxPolls: 4,
  maxConsecutiveFailures: 3,
};

export function providerEventPayload(
  eventId: string,
  eventType = "Delivery",
  extra: Record<string, unknown> = {},
): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      eventId,
      eventType,
      mail: {
        messageId: `provider-${eventId}`,
        timestamp: "2026-08-06T08:00:00.000Z",
      },
      delivery: {},
      ...extra,
    }),
  );
}

export type IteratorCall = {
  shardId: string;
  iteratorType: ProviderEventShardIteratorType;
  startingSequenceNumber?: string;
  timestamp?: Date;
};

export type GetRecordsCall = {
  shardId: string;
  atMs: number;
};

export type FakeAdapterOptions = {
  /** Shard pages returned by successive listShards calls. */
  shardPages: Array<Array<ProviderEventStreamShard>>;
  /**
   * Produces one GetRecords response. `call` is the 1-based per-shard call
   * index so scripts can model idle, busy, and draining shards.
   */
  respond: (params: {
    shardId: string;
    call: number;
  }) =>
    | {
        records: ProviderEventStreamRecord[];
        nextShardIterator?: string | null;
        millisBehindLatest?: number;
      }
    | { throws: Error };
  onListShards?: (call: number) => void | Error;
  onGetShardIterator?: (call: IteratorCall) => void | Error;
};

export type FakeAdapter = ProviderEventStreamAdapter & {
  iteratorCalls: IteratorCall[];
  getRecordsCalls: GetRecordsCall[];
  listShardsCalls: number;
  recordsByShard: Map<string, number>;
};

export function makeFakeAdapter(options: FakeAdapterOptions): FakeAdapter {
  const iteratorCalls: IteratorCall[] = [];
  const getRecordsCalls: GetRecordsCall[] = [];
  const recordsByShard = new Map<string, number>();
  const perShardCalls = new Map<string, number>();
  let listShardsCalls = 0;
  let iteratorSeq = 0;

  const adapter: FakeAdapter = {
    iteratorCalls,
    getRecordsCalls,
    recordsByShard,
    get listShardsCalls() {
      return listShardsCalls;
    },

    async listShards() {
      listShardsCalls += 1;
      const hook = options.onListShards?.(listShardsCalls);
      if (hook instanceof Error) throw hook;
      const page =
        options.shardPages[Math.min(listShardsCalls - 1, options.shardPages.length - 1)];
      return page ?? [];
    },

    async getShardIterator(params) {
      const call: IteratorCall = {
        shardId: params.shardId,
        iteratorType: params.iteratorType,
        startingSequenceNumber: params.startingSequenceNumber,
        timestamp: params.timestamp,
      };
      iteratorCalls.push(call);
      const hook = options.onGetShardIterator?.(call);
      if (hook instanceof Error) throw hook;
      iteratorSeq += 1;
      return `${params.shardId}::${iteratorSeq}`;
    },

    async getRecords(params) {
      const shardId = params.shardIterator.split("::")[0] ?? "unknown";
      getRecordsCalls.push({ shardId, atMs: Date.now() });
      const call = (perShardCalls.get(shardId) ?? 0) + 1;
      perShardCalls.set(shardId, call);

      const response = options.respond({ shardId, call });
      if ("throws" in response) throw response.throws;

      recordsByShard.set(
        shardId,
        (recordsByShard.get(shardId) ?? 0) + response.records.length,
      );
      iteratorSeq += 1;
      return {
        records: response.records,
        nextShardIterator:
          response.nextShardIterator === undefined
            ? `${shardId}::${iteratorSeq}`
            : response.nextShardIterator,
        millisBehindLatest: response.millisBehindLatest,
      };
    },
  };

  return adapter;
}

export type FakeStore = ProviderEventConsumerStore & {
  checkpoints: Array<{ shardId: string; sequenceNumber: string }>;
  poisonRecords: Array<{
    shardId: string;
    sequenceNumber: string;
    errorCode: string;
    sanitizedErrorMessage: string;
    payloadSha256: string;
  }>;
  initialReadAtCalls: Array<{ shardId: string; initialReadAt: Date }>;
  state: Map<
    string,
    { sequence: string | null; initialReadAt: Date | null; revision: bigint }
  >;
};

export function makeFakeStore(options?: {
  seed?: Record<string, { sequence?: string | null; initialReadAt?: Date | null }>;
  failCheckpoint?: (params: { shardId: string; sequenceNumber: string }) => Error | void;
  failPoisonRecord?: (params: { shardId: string; sequenceNumber: string }) => Error | void;
}): FakeStore {
  const state = new Map<
    string,
    { sequence: string | null; initialReadAt: Date | null; revision: bigint }
  >();
  for (const [shardId, seed] of Object.entries(options?.seed ?? {})) {
    state.set(shardId, {
      sequence: seed.sequence ?? null,
      initialReadAt: seed.initialReadAt ?? null,
      revision: BigInt(0),
    });
  }

  const checkpoints: FakeStore["checkpoints"] = [];
  const poisonRecords: FakeStore["poisonRecords"] = [];
  const initialReadAtCalls: FakeStore["initialReadAtCalls"] = [];

  function entry(shardId: string) {
    let value = state.get(shardId);
    if (!value) {
      value = { sequence: null, initialReadAt: null, revision: BigInt(0) };
      state.set(shardId, value);
    }
    return value;
  }

  return {
    checkpoints,
    poisonRecords,
    initialReadAtCalls,
    state,

    async loadCheckpoint(params): Promise<ProviderEventCheckpoint | null> {
      const value = state.get(params.shardId);
      if (!value) return null;
      return {
        lastSuccessfullyHandledSequenceNumber: value.sequence,
        initialReadAt: value.initialReadAt,
        revision: value.revision,
      };
    },

    async ensureInitialReadAt(params) {
      initialReadAtCalls.push({
        shardId: params.shardId,
        initialReadAt: params.initialReadAt,
      });
      const value = entry(params.shardId);
      if (!value.initialReadAt) {
        value.initialReadAt = params.initialReadAt;
        value.revision += BigInt(1);
      }
      return value.initialReadAt;
    },

    async recordPoisonRecord(params) {
      const failure = options?.failPoisonRecord?.({
        shardId: params.shardId,
        sequenceNumber: params.sequenceNumber,
      });
      if (failure) throw failure;

      const existing = poisonRecords.find(
        (record) =>
          record.shardId === params.shardId &&
          record.sequenceNumber === params.sequenceNumber,
      );
      if (existing) {
        existing.errorCode = params.errorCode;
        existing.sanitizedErrorMessage = params.sanitizedErrorMessage;
      } else {
        poisonRecords.push({
          shardId: params.shardId,
          sequenceNumber: params.sequenceNumber,
          errorCode: params.errorCode,
          sanitizedErrorMessage: params.sanitizedErrorMessage,
          payloadSha256: params.payloadSha256,
        });
      }
      const checkpoint = entry(params.shardId);
      checkpoint.sequence = params.sequenceNumber;
      checkpoint.revision += BigInt(1);
      checkpoints.push({
        shardId: params.shardId,
        sequenceNumber: params.sequenceNumber,
      });
    },

    async advanceCheckpoint(params) {
      const failure = options?.failCheckpoint?.({
        shardId: params.shardId,
        sequenceNumber: params.sequenceNumber,
      });
      if (failure) throw failure;
      const checkpoint = entry(params.shardId);
      checkpoint.sequence = params.sequenceNumber;
      checkpoint.revision += BigInt(1);
      checkpoints.push({
        shardId: params.shardId,
        sequenceNumber: params.sequenceNumber,
      });
    },
  } as FakeStore;
}

export function makeFakeLock(): {
  acquire: (params?: { provider: string; streamName: string }) => Promise<ProviderEventConsumerLock>;
  released: () => boolean;
  loseLock: (error: Error) => void;
  livenessCalls: () => number;
} {
  let released = false;
  let livenessCalls = 0;
  const listeners: Array<(error: Error) => void> = [];

  return {
    released: () => released,
    livenessCalls: () => livenessCalls,
    loseLock(error) {
      for (const listener of listeners) listener(error);
    },
    acquire: async (params?: { provider: string; streamName: string }) => ({
      provider: params?.provider ?? "yandex_postbox",
      streamName: params?.streamName ?? "postbox-events",
      generation: BigInt(1),
      holderId: "fake-holder",
      onLost(listener) {
        listeners.push(listener);
      },
      async assertAlive() {
        livenessCalls += 1;
      },
      async release() {
        released = true;
      },
    }),
  };
}

export function record(
  sequenceNumber: string,
  data: Uint8Array,
): ProviderEventStreamRecord {
  return { sequenceNumber, data };
}
