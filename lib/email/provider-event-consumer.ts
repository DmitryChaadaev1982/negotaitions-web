import crypto from "node:crypto";

import {
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  ListShardsCommand,
  type ShardIteratorType,
} from "@aws-sdk/client-kinesis";
import { Client as PgClient } from "pg";

import {
  EmailProviderIngestionFailureStatus,
  EmailProviderEventProcessingStatus,
} from "@/app/generated/prisma/client";
import { getEmailConfig, type EmailConfig } from "@/lib/email/config";
import { logEmailEvent } from "@/lib/email/observability";
import { processEmailProviderEvent } from "@/lib/email/provider-events";
import {
  parseYandexPostboxProviderEvent,
  YandexPostboxProviderEventParseError,
} from "@/lib/email/yandex-postbox-provider-event-parser";
import { prisma } from "@/lib/prisma";

type ProviderEventIngestionConfig = EmailConfig["providerEventIngestion"];

export type ProviderEventStreamShard = {
  shardId: string;
  closed: boolean;
};

export type ProviderEventStreamRecord = {
  sequenceNumber: string;
  data: Uint8Array;
  approximateArrivalTimestamp?: Date;
};

export type ProviderEventStreamAdapter = {
  listShards(streamName: string): Promise<ProviderEventStreamShard[]>;
  getShardIterator(params: {
    streamName: string;
    shardId: string;
    iteratorType: "LATEST" | "TRIM_HORIZON" | "AFTER_SEQUENCE_NUMBER";
    startingSequenceNumber?: string;
  }): Promise<string | null>;
  getRecords(params: {
    shardIterator: string;
    limit: number;
  }): Promise<{
    records: ProviderEventStreamRecord[];
    nextShardIterator: string | null;
    millisBehindLatest?: number;
  }>;
};

export type ProviderEventConsumerLock = {
  release(): Promise<void>;
};

export type ProviderEventCheckpoint = {
  lastSuccessfullyHandledSequenceNumber: string | null;
};

export type ProviderEventConsumerStore = {
  loadCheckpoint(params: {
    provider: string;
    streamName: string;
    shardId: string;
  }): Promise<ProviderEventCheckpoint | null>;
  recordIngestionFailure(params: {
    provider: string;
    streamName: string;
    shardId: string;
    sequenceNumber: string;
    approximateArrivalTimestamp?: Date;
    payloadSha256: string;
    errorCode: string;
    sanitizedErrorMessage: string;
  }): Promise<void>;
  advanceCheckpoint(params: {
    provider: string;
    streamName: string;
    shardId: string;
    sequenceNumber: string;
    approximateArrivalTimestamp?: Date;
    providerEventId?: string | null;
  }): Promise<void>;
};

export type ProviderEventConsumerCounters = {
  recordsRead: number;
  processed: number;
  duplicates: number;
  ignored: number;
  ingestionFailures: number;
  checkpointsAdvanced: number;
  transientRetries: number;
  lagMillis: number | null;
};

export class ProviderEventConsumerError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PROVIDER = "yandex_postbox";
const LOCK_KEY = "negotaitions:email-provider-event-consumer:yandex-postbox";

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isIteratorExpired(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "ExpiredIteratorException"
  );
}

function isTransientStreamError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  return [
    "LimitExceededException",
    "ProvisionedThroughputExceededException",
    "ThrottlingException",
    "InternalFailure",
    "InternalServerError",
    "TimeoutError",
  ].includes(String(error.name));
}

function isTerminalStreamAuthError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("name" in error)) return false;
  return [
    "UnrecognizedClientException",
    "InvalidSignatureException",
    "AccessDeniedException",
    "AccessDenied",
    "CredentialsProviderError",
  ].includes(String(error.name));
}

function payloadSha256(data: Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function boundedErrorMessage(error: unknown): string {
  if (error instanceof YandexPostboxProviderEventParseError) {
    return error.message.slice(0, 500);
  }
  if (error instanceof Error) {
    return error.message.replace(/[\r\n]+/g, " ").slice(0, 500);
  }
  return "Provider event ingestion failed.";
}

function errorCode(error: unknown): string {
  if (error instanceof YandexPostboxProviderEventParseError) return error.code;
  if (error instanceof ProviderEventConsumerError) return error.code;
  if (typeof error === "object" && error !== null && "name" in error) {
    return String(error.name).slice(0, 80);
  }
  return "INGESTION_FAILURE";
}

async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export class YandexDataStreamsKinesisAdapter implements ProviderEventStreamAdapter {
  private readonly client: KinesisClient;

  constructor(config: ProviderEventIngestionConfig) {
    if (
      !config.endpoint ||
      !config.accessKeyId ||
      !config.secretAccessKey
    ) {
      throw new ProviderEventConsumerError(
        "INVALID_PROVIDER_EVENT_CONFIG",
        "Yandex Data Streams consumer configuration is incomplete.",
      );
    }
    this.client = new KinesisClient({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async listShards(streamName: string): Promise<ProviderEventStreamShard[]> {
    const output = await this.client.send(
      new ListShardsCommand({ StreamName: streamName }),
    );
    return (output.Shards ?? [])
      .filter((shard) => shard.ShardId)
      .map((shard) => ({
        shardId: shard.ShardId!,
        closed: Boolean(shard.SequenceNumberRange?.EndingSequenceNumber),
      }));
  }

  async getShardIterator(params: {
    streamName: string;
    shardId: string;
    iteratorType: "LATEST" | "TRIM_HORIZON" | "AFTER_SEQUENCE_NUMBER";
    startingSequenceNumber?: string;
  }): Promise<string | null> {
    const output = await this.client.send(
      new GetShardIteratorCommand({
        StreamName: params.streamName,
        ShardId: params.shardId,
        ShardIteratorType: params.iteratorType as ShardIteratorType,
        StartingSequenceNumber: params.startingSequenceNumber,
      }),
    );
    return output.ShardIterator ?? null;
  }

  async getRecords(params: { shardIterator: string; limit: number }) {
    const output = await this.client.send(
      new GetRecordsCommand({
        ShardIterator: params.shardIterator,
        Limit: params.limit,
      }),
    );
    return {
      records: (output.Records ?? []).flatMap((record) =>
        record.SequenceNumber && record.Data
          ? [
              {
                sequenceNumber: record.SequenceNumber,
                data: record.Data,
                approximateArrivalTimestamp:
                  record.ApproximateArrivalTimestamp,
              },
            ]
          : [],
      ),
      nextShardIterator: output.NextShardIterator ?? null,
      millisBehindLatest: output.MillisBehindLatest,
    };
  }
}

export const prismaProviderEventConsumerStore: ProviderEventConsumerStore = {
  async loadCheckpoint(params) {
    return prisma.emailProviderStreamCheckpoint.findUnique({
      where: {
        provider_streamName_shardId: {
          provider: params.provider,
          streamName: params.streamName,
          shardId: params.shardId,
        },
      },
      select: { lastSuccessfullyHandledSequenceNumber: true },
    });
  },

  async recordIngestionFailure(params) {
    await prisma.emailProviderIngestionFailure.upsert({
      where: {
        provider_streamName_shardId_sequenceNumber: {
          provider: params.provider,
          streamName: params.streamName,
          shardId: params.shardId,
          sequenceNumber: params.sequenceNumber,
        },
      },
      create: {
        provider: params.provider,
        streamName: params.streamName,
        shardId: params.shardId,
        sequenceNumber: params.sequenceNumber,
        approximateArrivalTimestamp: params.approximateArrivalTimestamp,
        payloadSha256: params.payloadSha256,
        errorCode: params.errorCode.slice(0, 80),
        sanitizedErrorMessage: params.sanitizedErrorMessage.slice(0, 500),
        status: EmailProviderIngestionFailureStatus.RECORDED,
      },
      update: {
        approximateArrivalTimestamp: params.approximateArrivalTimestamp,
        payloadSha256: params.payloadSha256,
        errorCode: params.errorCode.slice(0, 80),
        sanitizedErrorMessage: params.sanitizedErrorMessage.slice(0, 500),
      },
    });
  },

  async advanceCheckpoint(params) {
    await prisma.emailProviderStreamCheckpoint.upsert({
      where: {
        provider_streamName_shardId: {
          provider: params.provider,
          streamName: params.streamName,
          shardId: params.shardId,
        },
      },
      create: {
        provider: params.provider,
        streamName: params.streamName,
        shardId: params.shardId,
        lastSuccessfullyHandledSequenceNumber: params.sequenceNumber,
        approximateArrivalTimestamp: params.approximateArrivalTimestamp,
        lastProcessedProviderEventId: params.providerEventId ?? null,
      },
      update: {
        lastSuccessfullyHandledSequenceNumber: params.sequenceNumber,
        approximateArrivalTimestamp: params.approximateArrivalTimestamp,
        lastProcessedProviderEventId: params.providerEventId ?? null,
      },
    });
  },
};

export async function acquireProviderEventConsumerLock(): Promise<ProviderEventConsumerLock> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new ProviderEventConsumerError(
      "DATABASE_URL_MISSING",
      "DATABASE_URL is required for provider-event consumer locking.",
    );
  }
  const client = new PgClient({ connectionString });
  await client.connect();
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
    [LOCK_KEY],
  );
  if (!result.rows[0]?.acquired) {
    await client.end().catch(() => undefined);
    throw new ProviderEventConsumerError(
      "CONSUMER_LOCK_HELD",
      "Another provider-event consumer already holds the advisory lock.",
    );
  }
  return {
    async release() {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [LOCK_KEY])
        .catch(() => undefined);
      await client.end().catch(() => undefined);
    },
  };
}

async function processRecord(params: {
  config: ProviderEventIngestionConfig;
  streamName: string;
  shardId: string;
  record: ProviderEventStreamRecord;
  store: ProviderEventConsumerStore;
  processor: typeof processEmailProviderEvent;
  counters: ProviderEventConsumerCounters;
}) {
  let providerEventId: string | null = null;
  try {
    const normalized = parseYandexPostboxProviderEvent(params.record.data, {
      maxPayloadBytes: params.config.maxPayloadBytes,
    });
    providerEventId = normalized.providerEventId;
    const result = await params.processor(normalized);
    if (result.created === false) params.counters.duplicates += 1;
    else if (result.processingStatus === EmailProviderEventProcessingStatus.IGNORED) {
      params.counters.ignored += 1;
    } else {
      params.counters.processed += 1;
    }
  } catch (error) {
    await params.store.recordIngestionFailure({
      provider: PROVIDER,
      streamName: params.streamName,
      shardId: params.shardId,
      sequenceNumber: params.record.sequenceNumber,
      approximateArrivalTimestamp: params.record.approximateArrivalTimestamp,
      payloadSha256: payloadSha256(params.record.data),
      errorCode: errorCode(error),
      sanitizedErrorMessage: boundedErrorMessage(error),
    });
    params.counters.ingestionFailures += 1;
  }

  await params.store.advanceCheckpoint({
    provider: PROVIDER,
    streamName: params.streamName,
    shardId: params.shardId,
    sequenceNumber: params.record.sequenceNumber,
    approximateArrivalTimestamp: params.record.approximateArrivalTimestamp,
    providerEventId,
  });
  params.counters.checkpointsAdvanced += 1;
}

async function consumeShard(params: {
  adapter: ProviderEventStreamAdapter;
  config: ProviderEventIngestionConfig;
  streamName: string;
  shard: ProviderEventStreamShard;
  store: ProviderEventConsumerStore;
  processor: typeof processEmailProviderEvent;
  counters: ProviderEventConsumerCounters;
  signal?: AbortSignal;
  singleBatch?: boolean;
}) {
  const checkpoint = await params.store.loadCheckpoint({
    provider: PROVIDER,
    streamName: params.streamName,
    shardId: params.shard.shardId,
  });
  let iterator = await params.adapter.getShardIterator({
    streamName: params.streamName,
    shardId: params.shard.shardId,
    iteratorType: checkpoint?.lastSuccessfullyHandledSequenceNumber
      ? "AFTER_SEQUENCE_NUMBER"
      : params.config.initialPosition,
    startingSequenceNumber:
      checkpoint?.lastSuccessfullyHandledSequenceNumber ?? undefined,
  });

  while (iterator && !params.signal?.aborted) {
    try {
      const batch = await params.adapter.getRecords({
        shardIterator: iterator,
        limit: params.config.recordLimit,
      });
      params.counters.recordsRead += batch.records.length;
      params.counters.lagMillis = batch.millisBehindLatest ?? params.counters.lagMillis;
      for (const record of batch.records) {
        if (params.signal?.aborted) return;
        await processRecord({
          config: params.config,
          streamName: params.streamName,
          shardId: params.shard.shardId,
          record,
          store: params.store,
          processor: params.processor,
          counters: params.counters,
        });
      }
      iterator = batch.nextShardIterator;
      if (batch.records.length === 0) {
        await abortableSleep(params.config.pollIntervalMs, params.signal);
      }
      if (params.singleBatch) return;
      if (params.shard.closed && !iterator) return;
    } catch (error) {
      if (isAbortError(error)) return;
      if (isIteratorExpired(error)) {
        const latestCheckpoint = await params.store.loadCheckpoint({
          provider: PROVIDER,
          streamName: params.streamName,
          shardId: params.shard.shardId,
        });
        iterator = await params.adapter.getShardIterator({
          streamName: params.streamName,
          shardId: params.shard.shardId,
          iteratorType: latestCheckpoint?.lastSuccessfullyHandledSequenceNumber
            ? "AFTER_SEQUENCE_NUMBER"
            : params.config.initialPosition,
          startingSequenceNumber:
            latestCheckpoint?.lastSuccessfullyHandledSequenceNumber ?? undefined,
        });
        params.counters.transientRetries += 1;
        continue;
      }
      if (isTerminalStreamAuthError(error)) {
        throw new ProviderEventConsumerError(
          "STREAM_AUTH_FAILURE",
          "Provider-event stream authentication failed.",
        );
      }
      if (isTransientStreamError(error)) {
        params.counters.transientRetries += 1;
        await abortableSleep(params.config.errorBackoffMs, params.signal);
        continue;
      }
      throw error;
    }
  }
}

export async function runEmailProviderEventConsumer(options?: {
  adapter?: ProviderEventStreamAdapter;
  config?: ProviderEventIngestionConfig;
  store?: ProviderEventConsumerStore;
  processor?: typeof processEmailProviderEvent;
  acquireLock?: () => Promise<ProviderEventConsumerLock>;
  signal?: AbortSignal;
  once?: boolean;
}): Promise<ProviderEventConsumerCounters> {
  const config = options?.config ?? getEmailConfig().providerEventIngestion;
  if (!config.enabled) {
    throw new ProviderEventConsumerError(
      "PROVIDER_EVENT_INGESTION_DISABLED",
      "Provider-event ingestion is disabled by design.",
    );
  }
  if (!config.streamName) {
    throw new ProviderEventConsumerError(
      "STREAM_NAME_MISSING",
      "Provider-event stream name is required.",
    );
  }

  const counters: ProviderEventConsumerCounters = {
    recordsRead: 0,
    processed: 0,
    duplicates: 0,
    ignored: 0,
    ingestionFailures: 0,
    checkpointsAdvanced: 0,
    transientRetries: 0,
    lagMillis: null,
  };
  const adapter = options?.adapter ?? new YandexDataStreamsKinesisAdapter(config);
  const store = options?.store ?? prismaProviderEventConsumerStore;
  const processor = options?.processor ?? processEmailProviderEvent;
  const lock = await (options?.acquireLock ?? acquireProviderEventConsumerLock)();

  try {
    do {
      const shards = await adapter.listShards(config.streamName);
      for (const shard of shards) {
        if (options?.signal?.aborted) break;
        await consumeShard({
          adapter,
          config,
          streamName: config.streamName,
          shard,
          store,
          processor,
          counters,
          signal: options?.signal,
          singleBatch: options?.once,
        });
      }
      if (options?.once || options?.signal?.aborted) break;
      await abortableSleep(config.shardRefreshSeconds * 1000, options?.signal);
    } while (!options?.signal?.aborted);

    logEmailEvent("info", "provider_event_consumer_stopped", counters);
    return counters;
  } finally {
    await lock.release();
  }
}
