import { randomUUID } from "node:crypto";

import { Prisma } from "@/app/generated/prisma/client";
import {
  getTranscriptEnhancementChunkTimeoutMs,
  getTranscriptEnhancementGlobalConcurrency,
  getTranscriptEnhancementMaxConcurrency,
  TRANSCRIPT_ENHANCEMENT_HARD_GLOBAL_CONCURRENCY,
  TRANSCRIPT_ENHANCEMENT_HARD_PER_JOB_CONCURRENCY,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";

/**
 * Cross-process provider admission authority.
 *
 * The fixed `TranscriptEnhancementProviderSlot` inventory is the only global
 * concurrency authority for Yandex enhancement requests. Every real Product
 * execution path (application enhancement, automatic enhancement, Repeat
 * Improve, recovery, maintenance) acquires a leased slot row before its HTTP
 * POST, so the aggregate cap holds across processes.
 *
 * The in-process `FairGlobalLimiter` is only a local waiter/fairness helper and
 * is no longer authoritative.
 *
 * A slot lease is independent of the D1 job lease: it protects provider
 * capacity, not job ownership. Slots are never held while waiting for backoff,
 * and the Transcript row lock is never held while a slot is in use for HTTP.
 */
export const TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT = 10;

/**
 * Shared cross-process identity for the GLOBAL admission advisory lock.
 * Two-key `pg_advisory_xact_lock(hashtext(id), 0)` so this cannot collide
 * with the existing single-key per-job lock `pg_advisory_xact_lock(hashtext(jobId))`.
 * Never derive this from a jobId.
 */
export const PROVIDER_SLOT_GLOBAL_ADMISSION_LOCK_ID =
  "transcript-enhancement-provider-slot-global-admission";

/** Slack over the provider request timeout so a crashed holder expires. */
export const PROVIDER_SLOT_LEASE_SLACK_MS = 15_000;

const SLOT_WAIT_POLL_MIN_MS = 50;
const SLOT_WAIT_POLL_MAX_MS = 400;

export class ProviderSlotUnavailableError extends Error {
  readonly slotInfrastructure = true as const;

  constructor(message = "Provider slot unavailable: global enhancement capacity is saturated.") {
    super(message);
    this.name = "ProviderSlotUnavailableError";
  }
}

export type ProviderSlotDbClient = {
  $queryRaw?: typeof prisma.$queryRaw;
  $executeRaw?: typeof prisma.$executeRaw;
  $transaction?: typeof prisma.$transaction;
};

export type ProviderSlotLease = {
  slotIndex: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};

export function getProviderSlotLeaseTtlMs(): number {
  return getTranscriptEnhancementChunkTimeoutMs() + PROVIDER_SLOT_LEASE_SLACK_MS;
}

export function reservedSlotSafePerJobCap(globalCap: number): number {
  if (globalCap <= 1) return 1;
  return Math.max(1, globalCap - 1);
}

function clampAdmissionCap(params: {
  requested: number;
  product: number;
  hardMax: number;
}): number {
  return Math.max(1, Math.min(params.hardMax, params.product, params.requested));
}

export function getProviderSlotGlobalCap(): number {
  return Math.min(
    TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT,
    TRANSCRIPT_ENHANCEMENT_HARD_GLOBAL_CONCURRENCY,
    getTranscriptEnhancementGlobalConcurrency(),
  );
}

export function getProviderSlotPerJobCap(): number {
  const globalCap = getProviderSlotGlobalCap();
  return Math.min(
    TRANSCRIPT_ENHANCEMENT_HARD_PER_JOB_CONCURRENCY,
    getTranscriptEnhancementMaxConcurrency(),
    reservedSlotSafePerJobCap(globalCap),
  );
}

export function resolveProviderSlotAdmissionCaps(params?: {
  globalCap?: number;
  perJobCap?: number;
}): { globalCap: number; perJobCap: number } {
  const productGlobal = getProviderSlotGlobalCap();
  const productPerJob = getProviderSlotPerJobCap();
  const globalCap = clampAdmissionCap({
    requested: params?.globalCap ?? productGlobal,
    product: productGlobal,
    hardMax: Math.min(
      TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT,
      TRANSCRIPT_ENHANCEMENT_HARD_GLOBAL_CONCURRENCY,
    ),
  });
  const perJobCap = clampAdmissionCap({
    requested: params?.perJobCap ?? productPerJob,
    product: productPerJob,
    hardMax: Math.min(
      TRANSCRIPT_ENHANCEMENT_HARD_PER_JOB_CONCURRENCY,
      reservedSlotSafePerJobCap(globalCap),
    ),
  });
  return { globalCap, perJobCap };
}

/**
 * Mock clients used by deterministic in-memory unit tests do not implement raw
 * SQL. Real Product clients always do, so this is a test seam, not a bypass.
 */
function supportsRawSql(db: ProviderSlotDbClient): boolean {
  return typeof db.$queryRaw === "function" && typeof db.$transaction === "function";
}

/**
 * True when this client can enforce global admission. Real Product clients
 * always can; deterministic in-memory fixtures cannot.
 */
export function providerSlotAuthorityAvailable(db?: ProviderSlotDbClient): boolean {
  return supportsRawSql(db ?? (prisma as ProviderSlotDbClient));
}

/** Idempotent fixed inventory bootstrap. Safe to call repeatedly. */
export async function ensureProviderSlotInventory(params?: {
  db?: ProviderSlotDbClient;
}): Promise<number> {
  const db = params?.db ?? (prisma as ProviderSlotDbClient);
  if (!supportsRawSql(db) || typeof db.$executeRaw !== "function") return 0;
  const values = Prisma.join(
    Array.from({ length: TRANSCRIPT_ENHANCEMENT_PROVIDER_SLOT_COUNT }, (_unused, index) =>
      Prisma.sql`(${index}, NOW())`,
    ),
  );
  return db.$executeRaw(
    Prisma.sql`
      INSERT INTO "TranscriptEnhancementProviderSlot" ("slotIndex", "updatedAt")
      VALUES ${values}
      ON CONFLICT ("slotIndex") DO NOTHING
    `,
  );
}

export async function countActiveProviderSlots(params: {
  db?: ProviderSlotDbClient;
  nowMs?: number;
  jobId?: string;
}): Promise<number> {
  const db = params.db ?? (prisma as ProviderSlotDbClient);
  if (!supportsRawSql(db)) return 0;
  const now = new Date(params.nowMs ?? Date.now());
  const rows = (await db.$queryRaw!(
    params.jobId
      ? Prisma.sql`
          SELECT COUNT(*)::int AS "count"
          FROM "TranscriptEnhancementProviderSlot"
          WHERE "leaseExpiresAt" > ${now} AND "jobId" = ${params.jobId}
        `
      : Prisma.sql`
          SELECT COUNT(*)::int AS "count"
          FROM "TranscriptEnhancementProviderSlot"
          WHERE "leaseExpiresAt" > ${now}
        `,
  )) as Array<{ count: number }>;
  return rows[0]?.count ?? 0;
}

/**
 * Canonical admission lock order, held only inside the short claim
 * transaction (never across provider HTTP, Retry-After, polling, or release):
 *
 *   GLOBAL → JOB → SLOT ROW
 *
 * Never JOB → GLOBAL. Different jobs still serialize on GLOBAL so a lowered
 * configured global cap cannot be exceeded by concurrent SKIP LOCKED claims.
 */
async function acquireProviderSlotAdmissionLocks(
  raw: Required<Pick<ProviderSlotDbClient, "$queryRaw" | "$executeRaw">>,
  jobId: string,
): Promise<void> {
  // `$executeRaw` is used because the lock functions return void.
  await raw.$executeRaw(
    Prisma.sql`
      SELECT pg_advisory_xact_lock(
        hashtext(${PROVIDER_SLOT_GLOBAL_ADMISSION_LOCK_ID}),
        0
      )
    `,
  );
  await raw.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${jobId}))`);
}

/**
 * One short transaction: GLOBAL advisory lock, then per-job advisory lock,
 * reread live leases, enforce effective caps, take a free/expired slot with
 * `FOR UPDATE SKIP LOCKED`, write ownership, commit. The provider request
 * happens only after this commits.
 */
export async function acquireProviderSlot(params: {
  db?: ProviderSlotDbClient;
  jobId: string;
  runId: string;
  nowMs?: number;
  ttlMs?: number;
  globalCap?: number;
  perJobCap?: number;
}): Promise<ProviderSlotLease | null> {
  const db = params.db ?? (prisma as ProviderSlotDbClient);
  if (!supportsRawSql(db)) return null;
  const nowMs = params.nowMs ?? Date.now();
  const now = new Date(nowMs);
  const ttlMs = params.ttlMs ?? getProviderSlotLeaseTtlMs();
  const { globalCap, perJobCap } = resolveProviderSlotAdmissionCaps({
    globalCap: params.globalCap,
    perJobCap: params.perJobCap,
  });
  const leaseExpiresAt = new Date(nowMs + ttlMs);
  const leaseToken = randomUUID();

  return db.$transaction!(async (tx) => {
    const raw = tx as unknown as Required<
      Pick<ProviderSlotDbClient, "$queryRaw" | "$executeRaw">
    >;
    await acquireProviderSlotAdmissionLocks(raw, params.jobId);

    const counts = (await raw.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*)::int AS "globalLive",
        COUNT(*) FILTER (WHERE "jobId" = ${params.jobId})::int AS "jobLive"
      FROM "TranscriptEnhancementProviderSlot"
      WHERE "leaseExpiresAt" > ${now}
    `)) as Array<{ globalLive: number; jobLive: number }>;
    const globalLive = counts[0]?.globalLive ?? 0;
    const jobLive = counts[0]?.jobLive ?? 0;
    if (globalLive >= globalCap || jobLive >= perJobCap) {
      return null;
    }

    const candidates = (await raw.$queryRaw(Prisma.sql`
      SELECT "slotIndex"
      FROM "TranscriptEnhancementProviderSlot"
      WHERE "leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= ${now}
      ORDER BY "slotIndex"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `)) as Array<{ slotIndex: number }>;
    const slotIndex = candidates[0]?.slotIndex;
    if (slotIndex == null) {
      return null;
    }

    const claimed = (await raw.$queryRaw(Prisma.sql`
      UPDATE "TranscriptEnhancementProviderSlot"
      SET "jobId" = ${params.jobId},
          "runId" = ${params.runId},
          "leaseToken" = ${leaseToken},
          "acquiredAt" = ${now},
          "leaseExpiresAt" = ${leaseExpiresAt},
          "updatedAt" = ${now}
      WHERE "slotIndex" = ${slotIndex}
      RETURNING "slotIndex"
    `)) as Array<{ slotIndex: number }>;
    if (claimed.length !== 1) {
      return null;
    }
    return { slotIndex, leaseToken, leaseExpiresAt };
  });
}

/**
 * Release only our own lease. A stale process whose lease already expired and
 * was re-acquired must not clear the new owner's slot.
 */
export async function releaseProviderSlot(params: {
  db?: ProviderSlotDbClient;
  slotIndex: number;
  leaseToken: string;
}): Promise<boolean> {
  const db = params.db ?? (prisma as ProviderSlotDbClient);
  if (!supportsRawSql(db)) return false;
  const released = (await db.$queryRaw!(Prisma.sql`
    UPDATE "TranscriptEnhancementProviderSlot"
    SET "jobId" = NULL,
        "runId" = NULL,
        "leaseToken" = NULL,
        "acquiredAt" = NULL,
        "leaseExpiresAt" = NULL,
        "updatedAt" = NOW()
    WHERE "slotIndex" = ${params.slotIndex} AND "leaseToken" = ${params.leaseToken}
    RETURNING "slotIndex"
  `)) as Array<{ slotIndex: number }>;
  return released.length === 1;
}

export type ProviderSlotWaitOptions = {
  db?: ProviderSlotDbClient;
  jobId: string;
  runId: string;
  ttlMs?: number;
  globalCap?: number;
  perJobCap?: number;
  maxWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bounded wait for global capacity. Fails closed with
 * `ProviderSlotUnavailableError` instead of calling the provider without a
 * slot; the caller classifies that through the existing failure architecture.
 */
export async function acquireProviderSlotWithWait(
  options: ProviderSlotWaitOptions,
): Promise<ProviderSlotLease | null> {
  if (!providerSlotAuthorityAvailable(options.db)) {
    return null;
  }
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const maxWaitMs = options.maxWaitMs ?? getProviderSlotLeaseTtlMs();
  const startedAtMs = now();
  const maxPolls = Math.max(
    1,
    Math.ceil(maxWaitMs / (SLOT_WAIT_POLL_MIN_MS + SLOT_WAIT_POLL_MAX_MS)) + 1,
  );
  for (let poll = 0; poll <= maxPolls; poll += 1) {
    const lease = await acquireProviderSlot({
      db: options.db,
      jobId: options.jobId,
      runId: options.runId,
      nowMs: now(),
      ttlMs: options.ttlMs,
      globalCap: options.globalCap,
      perJobCap: options.perJobCap,
    });
    if (lease) return lease;
    if (now() - startedAtMs >= maxWaitMs) {
      break;
    }
    const jitter = SLOT_WAIT_POLL_MIN_MS + Math.floor(random() * SLOT_WAIT_POLL_MAX_MS);
    await sleep(jitter);
  }
  throw new ProviderSlotUnavailableError();
}

/**
 * Acquire immediately around one provider request and always release in
 * `finally`. Never wrap backoff sleeps or Transcript-lock work in this.
 */
export async function withProviderSlotLease<T>(
  options: ProviderSlotWaitOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const lease = await acquireProviderSlotWithWait(options);
  if (!lease) {
    // Raw SQL seam unavailable (in-memory unit fixture): no global authority to
    // enforce, so run without a lease rather than failing a deterministic test.
    return fn();
  }
  try {
    return await fn();
  } finally {
    await releaseProviderSlot({
      db: options.db,
      slotIndex: lease.slotIndex,
      leaseToken: lease.leaseToken,
    });
  }
}
