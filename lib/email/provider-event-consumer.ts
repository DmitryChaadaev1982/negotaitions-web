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
  type Prisma,
} from "@/app/generated/prisma/client";
import { readServerRuntimeSettingRaw } from "@/lib/config/server-runtime-settings";
import { getEmailConfig, type EmailConfig } from "@/lib/email/config";
import { logEmailEvent } from "@/lib/email/observability";
import { processEmailProviderEvent } from "@/lib/email/provider-events";
import {
  parseYandexPostboxProviderEvent,
  YandexPostboxProviderEventParseError,
} from "@/lib/email/yandex-postbox-provider-event-parser";
import { prisma } from "@/lib/prisma";

type ProviderEventIngestionConfig = EmailConfig["providerEventIngestion"];

export type ProviderEventShardIteratorType =
  | "LATEST"
  | "TRIM_HORIZON"
  | "AFTER_SEQUENCE_NUMBER"
  | "AT_TIMESTAMP";

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
  listShards(
    streamName: string,
    options?: { signal?: AbortSignal },
  ): Promise<ProviderEventStreamShard[]>;
  getShardIterator(params: {
    streamName: string;
    shardId: string;
    iteratorType: ProviderEventShardIteratorType;
    startingSequenceNumber?: string;
    timestamp?: Date;
    signal?: AbortSignal;
  }): Promise<string | null>;
  getRecords(params: {
    shardIterator: string;
    limit: number;
    signal?: AbortSignal;
  }): Promise<{
    records: ProviderEventStreamRecord[];
    nextShardIterator: string | null;
    millisBehindLatest?: number;
  }>;
  destroy?(): void | Promise<void>;
};

export type ProviderEventConsumerLock = {
  release(): Promise<void>;
  forceClose?: () => Promise<void>;
  /** PostgreSQL backend pid of the dedicated lock session, for diagnostics. */
  backendPid?: number;
  provider: string;
  streamName: string;
  generation: bigint;
  holderId: string;
  /**
   * Bounded liveness probe on the same dedicated connection that holds the
   * advisory lock. Must never reacquire the lock.
   */
  assertAlive?: () => Promise<void>;
  /** Notifies when the dedicated lock connection is lost or errors. */
  onLost?: (listener: (error: Error) => void) => void;
};

export type ProviderEventCheckpoint = {
  lastSuccessfullyHandledSequenceNumber: string | null;
  initialReadAt?: Date | null;
  revision: bigint;
};

export type ProviderEventShardKey = {
  provider: string;
  streamName: string;
  shardId: string;
};

export type ProviderEventConsumerStore = {
  loadCheckpoint(params: ProviderEventShardKey): Promise<ProviderEventCheckpoint | null>;
  /**
   * Persists the durable initial-read boundary for a shard that has no sequence
   * checkpoint yet and returns the effective value. Idempotent.
   */
  ensureInitialReadAt?: (
    params: ProviderEventShardKey & {
      initialReadAt: Date;
      owner: ProviderEventConsumerOwner;
      expectedRevision: bigint | null;
      signal?: AbortSignal;
    },
  ) => Promise<Date>;
  /**
   * Atomically records a deterministic poison record and advances the
   * checkpoint past it. Either both are durable or neither is.
   */
  recordPoisonRecord(
    params: ProviderEventShardKey & {
      sequenceNumber: string;
      approximateArrivalTimestamp?: Date;
      payloadSha256: string;
      errorCode: string;
      sanitizedErrorMessage: string;
      owner: ProviderEventConsumerOwner;
      expectedRevision: bigint | null;
      signal?: AbortSignal;
    },
  ): Promise<void>;
  advanceCheckpoint(
    params: ProviderEventShardKey & {
      sequenceNumber: string;
      approximateArrivalTimestamp?: Date;
      providerEventId?: string | null;
      owner: ProviderEventConsumerOwner;
      expectedRevision: bigint | null;
      signal?: AbortSignal;
    },
  ): Promise<void>;
};

export type ProviderEventConsumerOwner = {
  provider: string;
  streamName: string;
  generation: bigint;
  holderId: string;
};

export type ProviderEventConsumerCounters = {
  recordsRead: number;
  processed: number;
  duplicates: number;
  ignored: number;
  ingestionFailures: number;
  checkpointsAdvanced: number;
  transientRetries: number;
  shardsDiscovered: number;
  shardsRetired: number;
  iteratorReacquisitions: number;
  rounds: number;
  lagMillis: number | null;
};

/**
 * Failure kinds drive process exit codes so systemd can distinguish a terminal
 * misconfiguration from a retryable runtime fault.
 */
export type ProviderEventConsumerFailureKind =
  | "invalid_config"
  | "authentication"
  | "lock_contention"
  | "retryable";

export class ProviderEventConsumerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly kind: ProviderEventConsumerFailureKind = "retryable",
  ) {
    super(message);
    this.name = "ProviderEventConsumerError";
  }
}

export class ProviderEventCheckpointFenceError extends ProviderEventConsumerError {
  constructor(
    readonly fenceCode: "FENCE_LOST" | "CHECKPOINT_CONFLICT",
    message = "Provider-event checkpoint ownership fence rejected the write.",
  ) {
    super(fenceCode, message, "retryable");
    this.name = "ProviderEventCheckpointFenceError";
  }
}

const PROVIDER = "yandex_postbox";
export const PROVIDER_EVENT_CONSUMER_LOCK_KEY =
  "negotaitions:email-provider-event-consumer:yandex-postbox";
export const MAX_SHARD_PAGES = 100;
export const MAX_BACKOFF_MS = 60_000;
const MAX_TRACKED_SHARDS = 1_000;
const LOCK_LIVENESS_STATEMENT_TIMEOUT_MS = 5_000;
const CHECKPOINT_STATEMENT_TIMEOUT_MS = 5_000;
const HOLDER_ID_BYTES = 18;
const FORCED_DISCONNECT_TIMEOUT_MS = 5_000;
const MAX_LOGGED_IDENTIFIER_LENGTH = 128;

const activeRuntimeResources = new Set<{
  adapter: ProviderEventStreamAdapter;
  lock: ProviderEventConsumerLock;
}>();

/**
 * Deterministic ingestion failures. Only these may be acknowledged as poison
 * records; each maps to a static message so no provider or exception text is
 * ever persisted.
 */
export const DETERMINISTIC_INGESTION_FAILURE_MESSAGES: Readonly<
  Record<string, string>
> = Object.freeze({
  PAYLOAD_TOO_LARGE: "Provider event payload exceeded the configured size limit.",
  INVALID_ENCODING: "Provider event payload was not valid UTF-8.",
  MALFORMED_JSON: "Provider event payload was not valid JSON.",
  INVALID_OBJECT: "Provider event payload structure was invalid.",
  INVALID_STRING:
    "Provider event payload contained an invalid bounded string field.",
  INVALID_TIMESTAMP: "Provider event payload contained an invalid timestamp.",
});

export const UNEXPECTED_INGESTION_ERROR_CODE = "UNEXPECTED_INGESTION_ERROR";
export const UNEXPECTED_INGESTION_ERROR_MESSAGE =
  "Provider event ingestion failed deterministic validation.";

function abortError(): Error {
  return new DOMException("Aborted", "AbortError");
}

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
    "ServiceUnavailable",
    "TimeoutError",
    "NetworkingError",
  ].includes(String(error.name));
}

export function isTerminalStreamAuthError(error: unknown): boolean {
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

/**
 * Bounded, non-free-form error class label safe for operational logs. Only the
 * exception class name survives; never the message, arguments, or stack.
 */
export function errorClassLabel(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : typeof error;
  return raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 60) || "Unknown";
}

function boundedIdentifier(value: string): string {
  return value.replace(/[^\w.:-]/g, "").slice(0, MAX_LOGGED_IDENTIFIER_LENGTH);
}

/**
 * Removes the AbortSignal listener on timeout resolution, abort, and error.
 * Cleanup is unconditional rather than relying on `{ once: true }`.
 */
export async function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  if (ms <= 0) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(resolve, ms);
      if (signal) {
        onAbort = () => reject(abortError());
        signal.addEventListener("abort", onAbort);
      }
    });
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Exponential backoff capped at MAX_BACKOFF_MS with jitter bounded to
 * [base/2, base] so retries never collapse to a hot loop or grow unbounded.
 */
export function computeBackoffDelayMs(
  attempt: number,
  baseMs: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(Math.max(attempt, 1) - 1, 20);
  const capped = Math.min(baseMs * 2 ** exponent, MAX_BACKOFF_MS);
  const jitterFloor = capped / 2;
  return Math.round(jitterFloor + random() * jitterFloor);
}

async function boundedPrismaDisconnect(): Promise<void> {
  await Promise.race([
    prisma.$disconnect().catch(() => undefined),
    new Promise<void>((resolve) => {
      setTimeout(resolve, FORCED_DISCONNECT_TIMEOUT_MS).unref?.();
    }),
  ]);
}

export async function forceCloseActiveProviderEventConsumerResources(): Promise<void> {
  const resources = [...activeRuntimeResources];
  await Promise.all(
    resources.map(async ({ adapter, lock }) => {
      await Promise.all([
        Promise.resolve(adapter.destroy?.()).catch(() => undefined),
        Promise.resolve(lock.forceClose?.()).catch(() => undefined),
      ]);
    }),
  );
  await boundedPrismaDisconnect();
}

/**
 * Follows NextToken until exhausted, deduplicating shard ids and bounding both
 * page count and per-page retries. Never returns a partial list silently.
 */
export async function collectShardPages(params: {
  fetchPage: (nextToken?: string) => Promise<{
    shards: ProviderEventStreamShard[];
    nextToken?: string | null;
  }>;
  maxPages?: number;
  maxAttemptsPerPage?: number;
  signal?: AbortSignal;
  onTransientRetry?: (attempt: number) => Promise<void>;
}): Promise<ProviderEventStreamShard[]> {
  const maxPages = params.maxPages ?? MAX_SHARD_PAGES;
  const maxAttempts = params.maxAttemptsPerPage ?? 3;
  const seen = new Set<string>();
  const shards: ProviderEventStreamShard[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    if (params.signal?.aborted) throw abortError();

    let output: { shards: ProviderEventStreamShard[]; nextToken?: string | null } | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        output = await params.fetchPage(nextToken);
        break;
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (isTerminalStreamAuthError(error)) {
          throw new ProviderEventConsumerError(
            "STREAM_AUTH_FAILURE",
            "Provider-event stream authentication failed.",
            "authentication",
          );
        }
        if (attempt >= maxAttempts) {
          throw new ProviderEventConsumerError(
            "SHARD_DISCOVERY_FAILED",
            "Provider-event shard discovery failed after bounded retries.",
            "retryable",
          );
        }
        await params.onTransientRetry?.(attempt);
      }
    }

    for (const shard of output?.shards ?? []) {
      if (!shard.shardId || seen.has(shard.shardId)) continue;
      seen.add(shard.shardId);
      shards.push(shard);
    }

    nextToken = output?.nextToken ?? undefined;
    if (!nextToken) return shards;
  }

  throw new ProviderEventConsumerError(
    "SHARD_PAGINATION_LIMIT",
    "Provider-event shard pagination exceeded the bounded page limit.",
    "retryable",
  );
}

export class YandexDataStreamsKinesisAdapter implements ProviderEventStreamAdapter {
  private readonly client: KinesisClient;
  private readonly retryBaseMs: number;

  constructor(config: ProviderEventIngestionConfig) {
    if (!config.endpoint || !config.accessKeyId || !config.secretAccessKey) {
      throw new ProviderEventConsumerError(
        "INVALID_PROVIDER_EVENT_CONFIG",
        "Yandex Data Streams consumer configuration is incomplete.",
        "invalid_config",
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
    this.retryBaseMs = config.errorBackoffMs;
  }

  async listShards(
    streamName: string,
    options?: { signal?: AbortSignal },
  ): Promise<ProviderEventStreamShard[]> {
    return collectShardPages({
      signal: options?.signal,
      onTransientRetry: (attempt) =>
        abortableSleep(computeBackoffDelayMs(attempt, this.retryBaseMs), options?.signal),
      fetchPage: async (nextToken) => {
        const output = await this.client.send(
          new ListShardsCommand(
            nextToken ? { NextToken: nextToken } : { StreamName: streamName },
          ),
          { abortSignal: options?.signal },
        );
        return {
          shards: (output.Shards ?? [])
            .filter((shard) => shard.ShardId)
            .map((shard) => ({
              shardId: shard.ShardId!,
              closed: Boolean(shard.SequenceNumberRange?.EndingSequenceNumber),
            })),
          nextToken: output.NextToken ?? null,
        };
      },
    });
  }

  async getShardIterator(params: {
    streamName: string;
    shardId: string;
    iteratorType: ProviderEventShardIteratorType;
    startingSequenceNumber?: string;
    timestamp?: Date;
    signal?: AbortSignal;
  }): Promise<string | null> {
    const output = await this.client.send(
      new GetShardIteratorCommand({
        StreamName: params.streamName,
        ShardId: params.shardId,
        ShardIteratorType: params.iteratorType as ShardIteratorType,
        StartingSequenceNumber: params.startingSequenceNumber,
        Timestamp: params.timestamp,
      }),
      { abortSignal: params.signal },
    );
    return output.ShardIterator ?? null;
  }

  async getRecords(params: { shardIterator: string; limit: number; signal?: AbortSignal }) {
    const output = await this.client.send(
      new GetRecordsCommand({
        ShardIterator: params.shardIterator,
        Limit: params.limit,
      }),
      { abortSignal: params.signal },
    );
    return {
      records: (output.Records ?? []).flatMap((record) =>
        record.SequenceNumber && record.Data
          ? [
              {
                sequenceNumber: record.SequenceNumber,
                data: record.Data,
                approximateArrivalTimestamp: record.ApproximateArrivalTimestamp,
              },
            ]
          : [],
      ),
      nextShardIterator: output.NextShardIterator ?? null,
      millisBehindLatest: output.MillisBehindLatest,
    };
  }

  destroy() {
    this.client.destroy();
  }
}

type ConsumerTx = Prisma.TransactionClient;

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

async function setBoundedTransactionTimeout(tx: ConsumerTx): Promise<void> {
  await tx.$executeRawUnsafe(
    `SET LOCAL statement_timeout = ${CHECKPOINT_STATEMENT_TIMEOUT_MS}`,
  );
  await tx.$executeRawUnsafe(
    `SET LOCAL lock_timeout = ${CHECKPOINT_STATEMENT_TIMEOUT_MS}`,
  );
}

async function assertLeaseHeld(
  tx: ConsumerTx,
  owner: ProviderEventConsumerOwner,
): Promise<void> {
  const rows = await tx.$queryRaw<
    Array<{ generation: bigint; holderId: string }>
  >`SELECT "generation", "holderId"
      FROM "EmailProviderConsumerLease"
     WHERE "provider" = ${owner.provider}
       AND "streamName" = ${owner.streamName}
     FOR UPDATE`;
  const lease = rows[0];
  if (
    !lease ||
    lease.generation !== owner.generation ||
    lease.holderId !== owner.holderId
  ) {
    throw new ProviderEventCheckpointFenceError("FENCE_LOST");
  }
}

async function loadCheckpointForUpdate(
  tx: ConsumerTx,
  key: ProviderEventShardKey,
): Promise<
  | {
      id: string;
      revision: bigint;
      initialReadAt: Date | null;
      lastSuccessfullyHandledSequenceNumber: string | null;
    }
  | null
> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      revision: bigint;
      initialReadAt: Date | null;
      lastSuccessfullyHandledSequenceNumber: string | null;
    }>
  >`SELECT "id",
           "revision",
           "initialReadAt",
           "lastSuccessfullyHandledSequenceNumber"
      FROM "EmailProviderStreamCheckpoint"
     WHERE "provider" = ${key.provider}
       AND "streamName" = ${key.streamName}
       AND "shardId" = ${key.shardId}
     FOR UPDATE`;
  return rows[0] ?? null;
}

function assertExpectedRevision(
  checkpoint: { revision: bigint } | null,
  expectedRevision: bigint | null,
) {
  const actualRevision = checkpoint?.revision ?? null;
  if (actualRevision !== expectedRevision) {
    throw new ProviderEventCheckpointFenceError("CHECKPOINT_CONFLICT");
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
      select: {
        lastSuccessfullyHandledSequenceNumber: true,
        initialReadAt: true,
        revision: true,
      },
    });
  },

  async ensureInitialReadAt(params) {
    assertNotAborted(params.signal);
    return prisma.$transaction(async (tx) => {
      assertNotAborted(params.signal);
      await setBoundedTransactionTimeout(tx);
      await assertLeaseHeld(tx, params.owner);
      const checkpoint = await loadCheckpointForUpdate(tx, params);
      assertExpectedRevision(checkpoint, params.expectedRevision);
      if (checkpoint?.initialReadAt) return checkpoint.initialReadAt;

      if (!checkpoint) {
        const created = await tx.emailProviderStreamCheckpoint.create({
          data: {
            provider: params.provider,
            streamName: params.streamName,
            shardId: params.shardId,
            initialReadAt: params.initialReadAt,
            revision: BigInt(1),
            lastWriterGeneration: params.owner.generation,
            lastWriterHolderId: params.owner.holderId,
          },
          select: { initialReadAt: true },
        });
        return created.initialReadAt ?? params.initialReadAt;
      }

      // Row predates this migration or was created by an older disabled runtime;
      // backfill the boundary exactly once under the ownership fence.
      const updated = await tx.emailProviderStreamCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
          initialReadAt: params.initialReadAt,
          revision: { increment: 1 },
          lastWriterGeneration: params.owner.generation,
          lastWriterHolderId: params.owner.holderId,
        },
        select: { initialReadAt: true },
      });
      return updated.initialReadAt ?? params.initialReadAt;
    });
  },

  async recordPoisonRecord(params) {
    const key = {
      provider: params.provider,
      streamName: params.streamName,
      shardId: params.shardId,
    };
    assertNotAborted(params.signal);
    await prisma.$transaction(async (tx) => {
      assertNotAborted(params.signal);
      await setBoundedTransactionTimeout(tx);
      await assertLeaseHeld(tx, params.owner);
      const checkpoint = await loadCheckpointForUpdate(tx, key);
      assertExpectedRevision(checkpoint, params.expectedRevision);

      await tx.emailProviderIngestionFailure.upsert({
        where: {
          provider_streamName_shardId_sequenceNumber: {
            ...key,
            sequenceNumber: params.sequenceNumber,
          },
        },
        create: {
          ...key,
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

      if (!checkpoint) {
        await tx.emailProviderStreamCheckpoint.create({
          data: {
            ...key,
            revision: BigInt(1),
            lastSuccessfullyHandledSequenceNumber: params.sequenceNumber,
            approximateArrivalTimestamp: params.approximateArrivalTimestamp,
            lastWriterGeneration: params.owner.generation,
            lastWriterHolderId: params.owner.holderId,
          },
        });
        return;
      }

      await tx.emailProviderStreamCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
          lastSuccessfullyHandledSequenceNumber: params.sequenceNumber,
          approximateArrivalTimestamp: params.approximateArrivalTimestamp,
          revision: { increment: 1 },
          lastWriterGeneration: params.owner.generation,
          lastWriterHolderId: params.owner.holderId,
        },
      });
    });
  },

  async advanceCheckpoint(params) {
    const key = {
      provider: params.provider,
      streamName: params.streamName,
      shardId: params.shardId,
    };
    assertNotAborted(params.signal);
    await prisma.$transaction(async (tx) => {
      assertNotAborted(params.signal);
      await setBoundedTransactionTimeout(tx);
      await assertLeaseHeld(tx, params.owner);
      const checkpoint = await loadCheckpointForUpdate(tx, key);
      assertExpectedRevision(checkpoint, params.expectedRevision);

      if (!checkpoint) {
        await tx.emailProviderStreamCheckpoint.create({
          data: {
            ...key,
            revision: BigInt(1),
            lastSuccessfullyHandledSequenceNumber: params.sequenceNumber,
            approximateArrivalTimestamp: params.approximateArrivalTimestamp,
            lastProcessedProviderEventId: params.providerEventId ?? null,
            lastWriterGeneration: params.owner.generation,
            lastWriterHolderId: params.owner.holderId,
          },
        });
        return;
      }

      await tx.emailProviderStreamCheckpoint.update({
        where: { id: checkpoint.id },
        data: {
          lastSuccessfullyHandledSequenceNumber: params.sequenceNumber,
          approximateArrivalTimestamp: params.approximateArrivalTimestamp,
          lastProcessedProviderEventId: params.providerEventId ?? null,
          revision: { increment: 1 },
          lastWriterGeneration: params.owner.generation,
          lastWriterHolderId: params.owner.holderId,
        },
      });
    });
  },
};

export async function acquireProviderEventConsumerLock(params?: {
  provider?: string;
  streamName?: string;
}): Promise<ProviderEventConsumerLock> {
  const connectionString = readServerRuntimeSettingRaw("DATABASE_URL");
  if (!connectionString) {
    throw new ProviderEventConsumerError(
      "DATABASE_URL_MISSING",
      "DATABASE_URL is required for provider-event consumer locking.",
      "invalid_config",
    );
  }

  const provider = params?.provider ?? PROVIDER;
  const streamName =
    params?.streamName ??
    readServerRuntimeSettingRaw("YANDEX_DATA_STREAMS_STREAM_NAME") ??
    "postbox-events";
  const client = new PgClient({ connectionString });
  const listeners: Array<(error: Error) => void> = [];
  let lost: Error | null = null;
  let released = false;
  let connected = false;

  const markLost = (error: Error) => {
    if (lost) return;
    lost = error;
    for (const listener of listeners) listener(error);
  };

  client.on("error", (error: Error) => {
    markLost(error instanceof Error ? error : new Error("lock connection error"));
  });
  client.on("end", () => {
    if (!released) markLost(new Error("lock connection ended"));
  });

  try {
    await client.connect();
    connected = true;
    await client.query(
      `SET statement_timeout = ${LOCK_LIVENESS_STATEMENT_TIMEOUT_MS}`,
    );

    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [PROVIDER_EVENT_CONSUMER_LOCK_KEY],
    );
    if (!result.rows[0]?.acquired) {
      throw new ProviderEventConsumerError(
        "CONSUMER_LOCK_HELD",
        "Another provider-event consumer already holds the advisory lock.",
        "lock_contention",
      );
    }

    const holderId = crypto.randomBytes(HOLDER_ID_BYTES).toString("base64url");
    const leaseId = crypto.randomUUID();
    const lease = await client.query<{ generation: string | bigint }>(
      `INSERT INTO "EmailProviderConsumerLease"
         ("id", "provider", "streamName", "generation", "holderId", "acquiredAt", "updatedAt")
       VALUES ($1, $2, $3, 1, $4, NOW(), NOW())
       ON CONFLICT ("provider", "streamName")
       DO UPDATE SET
         "generation" = "EmailProviderConsumerLease"."generation" + 1,
         "holderId" = EXCLUDED."holderId",
         "acquiredAt" = NOW(),
         "updatedAt" = NOW()
       RETURNING "generation"`,
      [leaseId, provider, streamName, holderId],
    );
    const generation = BigInt(lease.rows[0]?.generation ?? 0);
    if (generation < BigInt(1)) {
      throw new ProviderEventConsumerError(
        "CONSUMER_LEASE_ACQUIRE_FAILED",
        "Provider-event durable consumer lease was not acquired.",
        "retryable",
      );
    }

    const backend = await client.query<{ pid: number }>(
      "SELECT pg_backend_pid()::int AS pid",
    );

    return {
      backendPid: backend.rows[0]?.pid,
      provider,
      streamName,
      generation,
      holderId,

      onLost(listener) {
        listeners.push(listener);
        if (lost) listener(lost);
      },

      async assertAlive() {
        if (lost) {
          throw new ProviderEventConsumerError(
            "CONSUMER_LOCK_LOST",
            "The dedicated advisory-lock connection was lost.",
            "retryable",
          );
        }
        let held = 0;
        try {
          // Observes the existing lock without reacquiring it; a reentrant
          // pg_try_advisory_lock would succeed even after the lock was released.
          const liveness = await client.query<{ held: number }>(
            `SELECT count(*)::int AS held
             FROM pg_locks
            WHERE locktype = 'advisory'
              AND granted
              AND pid = pg_backend_pid()`,
          );
          held = liveness.rows[0]?.held ?? 0;
        } catch (error) {
          markLost(error instanceof Error ? error : new Error("liveness query failed"));
          throw new ProviderEventConsumerError(
            "CONSUMER_LOCK_LOST",
            "The advisory-lock liveness probe failed.",
            "retryable",
          );
        }
        if (held < 1) {
          markLost(new Error("advisory lock no longer held"));
          throw new ProviderEventConsumerError(
            "CONSUMER_LOCK_LOST",
            "PostgreSQL no longer reports the provider-event advisory lock.",
            "retryable",
          );
        }
      },

      async forceClose() {
        released = true;
        const rawClient = client as unknown as {
          connection?: { stream?: { destroy?: () => void } };
        };
        rawClient.connection?.stream?.destroy?.();
        await client.end().catch(() => undefined);
      },

      async release() {
        if (released) return;
        released = true;
        await client
          .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
            PROVIDER_EVENT_CONSUMER_LOCK_KEY,
          ])
          .catch(() => undefined);
        await client.end().catch(() => undefined);
      },
    };
  } catch (error) {
    released = true;
    if (connected) {
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
          PROVIDER_EVENT_CONSUMER_LOCK_KEY,
        ])
        .catch(() => undefined);
      await client.end().catch(() => undefined);
    }
    throw error;
  }
}

type ParseOutcome =
  | { ok: true; normalized: ReturnType<typeof parseYandexPostboxProviderEvent> }
  | { ok: false; code: string; message: string };

function parseRecord(data: Uint8Array, maxPayloadBytes: number): ParseOutcome {
  try {
    return {
      ok: true,
      normalized: parseYandexPostboxProviderEvent(data, { maxPayloadBytes }),
    };
  } catch (error) {
    if (error instanceof YandexPostboxProviderEventParseError) {
      const message = DETERMINISTIC_INGESTION_FAILURE_MESSAGES[error.code];
      return message
        ? { ok: false, code: error.code, message }
        : {
            ok: false,
            code: UNEXPECTED_INGESTION_ERROR_CODE,
            message: UNEXPECTED_INGESTION_ERROR_MESSAGE,
          };
    }
    // A non-deterministic throw from the parser is a code defect, not a poison
    // record. It must never be acknowledged.
    throw new ProviderEventConsumerError(
      "PROVIDER_EVENT_PARSER_DEFECT",
      "Provider-event parsing raised an unexpected error; the record remains replayable.",
      "retryable",
    );
  }
}

type ShardState = {
  shardId: string;
  closed: boolean;
  iterator: string | null;
  iteratorLoaded: boolean;
  checkpointRevision: bigint | null;
  retired: boolean;
  consecutiveFailures: number;
  nextPollAtMs: number;
};

export async function runEmailProviderEventConsumer(options?: {
  adapter?: ProviderEventStreamAdapter;
  config?: ProviderEventIngestionConfig;
  store?: ProviderEventConsumerStore;
  processor?: typeof processEmailProviderEvent;
  acquireLock?: (params: {
    provider: string;
    streamName: string;
  }) => Promise<ProviderEventConsumerLock>;
  signal?: AbortSignal;
  once?: boolean;
  now?: () => Date;
  random?: () => number;
}): Promise<ProviderEventConsumerCounters> {
  const config = options?.config ?? getEmailConfig().providerEventIngestion;
  if (!config.enabled) {
    throw new ProviderEventConsumerError(
      "PROVIDER_EVENT_INGESTION_DISABLED",
      "Provider-event ingestion is disabled by design.",
      "invalid_config",
    );
  }
  // Declared as a plain string so the hoisted helpers below do not depend on
  // control-flow narrowing that TypeScript resets for function declarations.
  const streamName: string = config.streamName ?? "";
  if (!streamName) {
    throw new ProviderEventConsumerError(
      "STREAM_NAME_MISSING",
      "Provider-event stream name is required.",
      "invalid_config",
    );
  }

  const once = Boolean(options?.once);
  const now = options?.now ?? (() => new Date());
  const random = options?.random ?? Math.random;
  const sliceMaxPolls = once ? 1 : config.shardSliceMaxPolls;

  const counters: ProviderEventConsumerCounters = {
    recordsRead: 0,
    processed: 0,
    duplicates: 0,
    ignored: 0,
    ingestionFailures: 0,
    checkpointsAdvanced: 0,
    transientRetries: 0,
    shardsDiscovered: 0,
    shardsRetired: 0,
    iteratorReacquisitions: 0,
    rounds: 0,
    lagMillis: null,
  };

  const adapter = options?.adapter ?? new YandexDataStreamsKinesisAdapter(config);
  const store = options?.store ?? prismaProviderEventConsumerStore;
  const processor = options?.processor ?? processEmailProviderEvent;
  const lock = await (options?.acquireLock ?? acquireProviderEventConsumerLock)({
    provider: PROVIDER,
    streamName,
  });
  const runtimeResource = { adapter, lock };
  activeRuntimeResources.add(runtimeResource);
  const owner: ProviderEventConsumerOwner = {
    provider: lock.provider,
    streamName: lock.streamName,
    generation: lock.generation,
    holderId: lock.holderId,
  };

  // Internal controller so a fatal fault stops every in-flight shard slice
  // without waiting for the caller's signal.
  const runController = new AbortController();
  const signal = runController.signal;
  let fatalError: unknown = null;

  const failRun = (error: unknown) => {
    if (!fatalError) fatalError = error;
    if (!runController.signal.aborted) runController.abort();
  };

  const externalAbort = () => runController.abort();
  options?.signal?.addEventListener("abort", externalAbort);
  if (options?.signal?.aborted) runController.abort();

  lock.onLost?.((error) => {
    logEmailEvent("error", "provider_event_lock_lost", {
      errorClass: errorClassLabel(error),
    });
    failRun(
      new ProviderEventConsumerError(
        "CONSUMER_LOCK_LOST",
        "The dedicated advisory-lock connection was lost.",
        "retryable",
      ),
    );
  });

  const shardKey = (shardId: string): ProviderEventShardKey => ({
    provider: PROVIDER,
    streamName,
    shardId,
  });

  const shards = new Map<string, ShardState>();
  let streamFailures = 0;

  function retire(shard: ShardState, reason: string) {
    if (shard.retired) return;
    shard.retired = true;
    counters.shardsRetired += 1;
    logEmailEvent("info", "provider_event_shard_retired", {
      shardId: boundedIdentifier(shard.shardId),
      reason,
    });
  }

  async function acquireIterator(shard: ShardState): Promise<void> {
    assertNotAborted(signal);
    const checkpoint = await store.loadCheckpoint(shardKey(shard.shardId));
    shard.checkpointRevision = checkpoint?.revision ?? null;
    const sequence = checkpoint?.lastSuccessfullyHandledSequenceNumber ?? null;

    if (sequence) {
      shard.iterator = await adapter.getShardIterator({
        streamName,
        shardId: shard.shardId,
        iteratorType: "AFTER_SEQUENCE_NUMBER",
        startingSequenceNumber: sequence,
        signal,
      });
      return;
    }

    if (config.initialPosition === "TRIM_HORIZON") {
      shard.iterator = await adapter.getShardIterator({
        streamName,
        shardId: shard.shardId,
        iteratorType: "TRIM_HORIZON",
        signal,
      });
      return;
    }

    // LATEST: persist a durable initial-read boundary so a reacquisition or a
    // restart before the first sequence checkpoint cannot skip the window.
    const existingBoundary = checkpoint?.initialReadAt ?? null;
    if (existingBoundary) {
      shard.iterator = await adapter.getShardIterator({
        streamName,
        shardId: shard.shardId,
        iteratorType: "AT_TIMESTAMP",
        timestamp: existingBoundary,
        signal,
      });
      return;
    }

    const boundary = now();
    const effective =
      (await store.ensureInitialReadAt?.({
        ...shardKey(shard.shardId),
        initialReadAt: boundary,
        owner,
        expectedRevision: shard.checkpointRevision,
        signal,
      })) ?? boundary;
    const reloaded = await store.loadCheckpoint(shardKey(shard.shardId));
    shard.checkpointRevision = reloaded?.revision ?? shard.checkpointRevision;

    shard.iterator = await adapter.getShardIterator(
      effective.getTime() === boundary.getTime()
        ? { streamName, shardId: shard.shardId, iteratorType: "LATEST", signal }
        : {
            streamName,
            shardId: shard.shardId,
            iteratorType: "AT_TIMESTAMP",
            timestamp: effective,
            signal,
          },
    );
  }

  async function handleStreamFailure(
    shard: ShardState | null,
    error: unknown,
  ): Promise<void> {
    if (isTerminalStreamAuthError(error)) {
      throw new ProviderEventConsumerError(
        "STREAM_AUTH_FAILURE",
        "Provider-event stream authentication failed.",
        "authentication",
      );
    }
    if (
      error instanceof ProviderEventConsumerError &&
      (error.kind === "authentication" || error.kind === "invalid_config")
    ) {
      throw error;
    }

    const attempt = shard ? (shard.consecutiveFailures += 1) : (streamFailures += 1);
    counters.transientRetries += 1;
    logEmailEvent("warn", "provider_event_transient_retry", {
      shardId: shard ? boundedIdentifier(shard.shardId) : null,
      attempt,
      transient: isTransientStreamError(error),
      errorClass: errorClassLabel(error),
    });

    if (attempt >= config.maxConsecutiveFailures) {
      logEmailEvent("error", "provider_event_retry_exhausted", {
        shardId: shard ? boundedIdentifier(shard.shardId) : null,
        attempts: attempt,
      });
      throw new ProviderEventConsumerError(
        "STREAM_RETRY_EXHAUSTED",
        "Provider-event stream failed after the bounded consecutive-failure limit.",
        "retryable",
      );
    }

    await abortableSleep(
      computeBackoffDelayMs(attempt, config.errorBackoffMs, random),
      signal,
    );
  }

  async function processRecord(
    shard: ShardState,
    record: ProviderEventStreamRecord,
  ): Promise<void> {
    assertNotAborted(signal);
    const parsed = parseRecord(record.data, config.maxPayloadBytes);
    const expectedRevision = shard.checkpointRevision;

    if (!parsed.ok) {
      // Deterministic: ledger row and checkpoint commit atomically.
      try {
        await store.recordPoisonRecord({
          ...shardKey(shard.shardId),
          sequenceNumber: record.sequenceNumber,
          approximateArrivalTimestamp: record.approximateArrivalTimestamp,
          payloadSha256: payloadSha256(record.data),
          errorCode: parsed.code,
          sanitizedErrorMessage: parsed.message,
          owner,
          expectedRevision,
          signal,
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error instanceof ProviderEventCheckpointFenceError) throw error;
        // The transaction covers both rows, so no checkpoint was written.
        throw new ProviderEventConsumerError(
          "INGESTION_FAILURE_LEDGER_WRITE_FAILED",
          "Provider-event failure ledger write failed; the checkpoint was not advanced.",
          "retryable",
        );
      }
      counters.ingestionFailures += 1;
      counters.checkpointsAdvanced += 1;
      shard.checkpointRevision = (expectedRevision ?? BigInt(0)) + BigInt(1);
      logEmailEvent("warn", "provider_event_poison_record_classified", {
        shardId: boundedIdentifier(shard.shardId),
        errorCode: parsed.code,
      });
      return;
    }

    let attempt = 0;
    for (;;) {
      try {
        const result = await processor(parsed.normalized);
        if (result.created === false) counters.duplicates += 1;
        else if (
          result.processingStatus === EmailProviderEventProcessingStatus.IGNORED
        ) {
          counters.ignored += 1;
        } else {
          counters.processed += 1;
        }
        break;
      } catch (error) {
        if (isAbortError(error)) throw error;
        attempt += 1;
        counters.transientRetries += 1;
        logEmailEvent("warn", "provider_event_processor_retry", {
          shardId: boundedIdentifier(shard.shardId),
          attempt,
          errorClass: errorClassLabel(error),
        });
        if (attempt >= config.maxConsecutiveFailures) {
          logEmailEvent("error", "provider_event_processor_retry_exhausted", {
            shardId: boundedIdentifier(shard.shardId),
            attempts: attempt,
          });
          // Fail closed without acknowledging: the record stays replayable.
          throw new ProviderEventConsumerError(
            "PROVIDER_EVENT_PROCESSOR_FAILED",
            "Provider-event processing failed after bounded retries; the checkpoint was not advanced.",
            "retryable",
          );
        }
        await abortableSleep(
          computeBackoffDelayMs(attempt, config.errorBackoffMs, random),
          signal,
        );
      }
    }

    try {
      await store.advanceCheckpoint({
        ...shardKey(shard.shardId),
        sequenceNumber: record.sequenceNumber,
        approximateArrivalTimestamp: record.approximateArrivalTimestamp,
        providerEventId: parsed.normalized.providerEventId,
        owner,
        expectedRevision,
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (error instanceof ProviderEventCheckpointFenceError) throw error;
      // The processor already committed. Replay is safe because provider-event
      // creation is deduplicated on (provider, providerEventId).
      throw new ProviderEventConsumerError(
        "CHECKPOINT_WRITE_FAILED",
        "Provider-event checkpoint write failed after successful processing; the record will be replayed.",
        "retryable",
      );
    }
    counters.checkpointsAdvanced += 1;
    shard.checkpointRevision = (expectedRevision ?? BigInt(0)) + BigInt(1);
  }

  /**
   * One bounded fair slice. Returns when the slice budget is spent, the shard
   * runs dry, or the shard retires, so the scheduler can serve other shards.
   */
  async function runSlice(shard: ShardState): Promise<void> {
    let polls = 0;
    let advancedInSlice = 0;

    while (polls < sliceMaxPolls && !signal.aborted && !shard.retired) {
      if (!shard.iteratorLoaded) {
        try {
          await acquireIterator(shard);
          shard.iteratorLoaded = true;
        } catch (error) {
          if (isAbortError(error)) return;
          polls += 1;
          await handleStreamFailure(shard, error);
          continue;
        }
      }

      if (!shard.iterator) {
        if (shard.closed) {
          retire(shard, "closed_and_drained");
          return;
        }
        polls += 1;
        shard.iteratorLoaded = false;
        await handleStreamFailure(
          shard,
          new ProviderEventConsumerError(
            "SHARD_ITERATOR_UNAVAILABLE",
            "Provider-event shard iterator was unavailable.",
            "retryable",
          ),
        );
        continue;
      }

      const waitMs = shard.nextPollAtMs - Date.now();
      if (waitMs > 0) await abortableSleep(waitMs, signal);
      if (signal.aborted) return;

      polls += 1;
      shard.nextPollAtMs = Date.now() + config.pollIntervalMs;

      let batch: Awaited<ReturnType<ProviderEventStreamAdapter["getRecords"]>>;
      try {
        batch = await adapter.getRecords({
          shardIterator: shard.iterator,
          limit: config.recordLimit,
          signal,
        });
      } catch (error) {
        if (isAbortError(error)) return;
        if (isIteratorExpired(error)) {
          shard.iteratorLoaded = false;
          shard.iterator = null;
          counters.iteratorReacquisitions += 1;
          logEmailEvent("warn", "provider_event_iterator_reacquired", {
            shardId: boundedIdentifier(shard.shardId),
          });
          continue;
        }
        await handleStreamFailure(shard, error);
        continue;
      }

      shard.consecutiveFailures = 0;
      counters.recordsRead += batch.records.length;
      if (batch.millisBehindLatest !== undefined) {
        counters.lagMillis = batch.millisBehindLatest;
      }

      const beforeCheckpoints = counters.checkpointsAdvanced;
      for (const record of batch.records) {
        if (signal.aborted) break;
        await processRecord(shard, record);
      }
      advancedInSlice += counters.checkpointsAdvanced - beforeCheckpoints;

      shard.iterator = batch.nextShardIterator;
      if (!shard.iterator) {
        if (shard.closed) {
          retire(shard, "closed_and_drained");
          break;
        }
        // An open shard should always return a next iterator; reacquire from
        // the durable checkpoint on the next slice rather than retiring it.
        shard.iteratorLoaded = false;
        break;
      }
      // Yield an idle shard immediately so busy shards never monopolise a round.
      if (batch.records.length === 0) break;
    }

    if (advancedInSlice > 0) {
      logEmailEvent("info", "provider_event_checkpoint_advanced", {
        shardId: boundedIdentifier(shard.shardId),
        advanced: advancedInSlice,
      });
    }
  }

  /**
   * Fair round: every shard in the snapshot receives exactly one bounded slice
   * before any shard receives a second one. Up to `shardConcurrency` slices run
   * at a time, so no shard can be queued behind an unbounded task.
   */
  async function runRound(round: ShardState[]): Promise<void> {
    const queue = [...round];
    const workerCount = Math.max(
      1,
      Math.min(config.shardConcurrency, queue.length),
    );

    const workers = Array.from({ length: workerCount }, async () => {
      while (!signal.aborted) {
        const shard = queue.shift();
        if (!shard) return;
        try {
          await runSlice(shard);
        } catch (error) {
          if (isAbortError(error)) return;
          failRun(error);
          return;
        }
      }
    });

    await Promise.all(workers);
  }

  function mergeDiscoveredShards(discovered: ProviderEventStreamShard[]) {
    for (const shard of discovered) {
      const existing = shards.get(shard.shardId);
      if (existing) {
        existing.closed = existing.closed || shard.closed;
        continue;
      }
      shards.set(shard.shardId, {
        shardId: shard.shardId,
        closed: shard.closed,
        iterator: null,
        iteratorLoaded: false,
        retired: false,
        consecutiveFailures: 0,
        checkpointRevision: null,
        nextPollAtMs: 0,
      });
      counters.shardsDiscovered += 1;
      logEmailEvent("info", "provider_event_shard_discovered", {
        shardId: boundedIdentifier(shard.shardId),
        closed: shard.closed,
      });
    }
  }

  async function discoverShards(): Promise<void> {
    for (;;) {
      try {
        const discovered = await adapter.listShards(streamName, { signal });
        streamFailures = 0;
        mergeDiscoveredShards(discovered);
        return;
      } catch (error) {
        if (isAbortError(error)) throw error;
        await handleStreamFailure(null, error);
      }
    }
  }

  logEmailEvent("info", "provider_event_consumer_started", {
    shardConcurrency: config.shardConcurrency,
    shardSliceMaxPolls: sliceMaxPolls,
    pollIntervalMs: config.pollIntervalMs,
    once,
  });

  try {
    const refreshIntervalMs = config.shardRefreshSeconds * 1000;
    let lastRefreshAtMs = Number.NEGATIVE_INFINITY;

    while (!signal.aborted) {
      if (Date.now() - lastRefreshAtMs >= refreshIntervalMs) {
        await lock.assertAlive?.();
        await discoverShards();
        lastRefreshAtMs = Date.now();
      }

      const round = [...shards.values()].filter((shard) => !shard.retired);
      if (round.length === 0) {
        if (once) break;
        // Floor the idle wait so a zero refresh interval cannot busy-loop.
        await abortableSleep(Math.max(50, Math.min(refreshIntervalMs, 1000)), signal);
        continue;
      }

      counters.rounds += 1;
      await runRound(round);
      if (fatalError) break;

      // Retired shards stay in the map so refresh does not rediscover them.
      // Bound the map for very long-lived consumers across many shard splits.
      if (shards.size > MAX_TRACKED_SHARDS) {
        for (const [shardId, shard] of shards) {
          if (shard.retired) shards.delete(shardId);
        }
      }

      if (once) break;
    }

    if (fatalError) throw fatalError;

    logEmailEvent("info", "provider_event_consumer_stopped", counters);
    return counters;
  } catch (error) {
    if (isAbortError(error) && !fatalError) {
      logEmailEvent("info", "provider_event_consumer_stopped", counters);
      return counters;
    }
    if (error instanceof ProviderEventConsumerError) {
      logEmailEvent("error", "provider_event_terminal_failure", {
        code: error.code,
        kind: error.kind,
      });
    }
    throw error;
  } finally {
    options?.signal?.removeEventListener("abort", externalAbort);
    if (!runController.signal.aborted) runController.abort();
    activeRuntimeResources.delete(runtimeResource);
    await lock.release();
  }
}
