import { Prisma } from "@/app/generated/prisma/client";
import {
  asProcessingMetadata,
  getTranscriptEnhancementNamespace,
  isTranscriptEnhancementRunning,
  type ProcessingMetadata,
} from "@/lib/transcription/processing-metadata";
import {
  parseTranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";

export { DEFAULT_TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS } from "@/lib/env";

export const ENHANCEMENT_TIMEOUT_SKIP_REASON = "timeout";

export type TranscriptEnhancementTimeoutDbClient = {
  transcript: {
    findUnique: (args: {
      where: { id: string };
      select?: {
        processingMetadata?: true;
        retranscribeCount?: true;
        segments?: unknown;
      };
    }) => Promise<{
      processingMetadata?: unknown;
      retranscribeCount?: number | null;
      segments?: unknown;
    } | null>;
    update: (args: {
      where: { id: string };
      data: { processingMetadata: Prisma.InputJsonValue };
    }) => Promise<unknown>;
    updateMany?: unknown;
  };
  transcriptSegment?: unknown;
  $transaction: <T>(
    callback: (tx: TranscriptEnhancementTimeoutDbClient) => Promise<T>,
  ) => Promise<T>;
  $queryRaw?: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

export type EnhancementTimeoutReconcileResult = {
  metadata: ProcessingMetadata;
  running: boolean;
  timedOut: boolean;
};

function asIsoString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function parseEnhancementTimestamp(value: unknown): Date | null {
  const iso = asIsoString(value);
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isEnhancementStatusRunningAlias(status: unknown): boolean {
  return status === "RUNNING" || status === "IN_PROGRESS" || status === "QUEUED";
}

/**
 * Historical helper for old one-layer metadata. D1 jobs never become
 * SKIPPED because 7000 ms elapsed. Do not use this as publication authority.
 */
export function isEnhancementRunTimedOut(
  processingMetadata: unknown,
  nowMs = Date.now(),
  timeoutMs = 7000,
): boolean {
  const job = parseTranscriptEnhancementJob(processingMetadata);
  if (job.schemaVersion === "d1-v1") {
    return false;
  }
  const enhancement = getTranscriptEnhancementNamespace(processingMetadata);
  if (!isEnhancementStatusRunningAlias(enhancement.status)) {
    return false;
  }
  const startedAt =
    parseEnhancementTimestamp(enhancement.startedAt) ??
    parseEnhancementTimestamp(enhancement.queuedAt);
  if (!startedAt) {
    return true;
  }
  return nowMs - startedAt.getTime() > timeoutMs;
}

export function buildTimeoutSkipMetadata(params: {
  metadata: ProcessingMetadata;
  nowMs?: number;
}): ProcessingMetadata {
  const nowMs = params.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const current = getTranscriptEnhancementNamespace(params.metadata);
  const startedAt =
    parseEnhancementTimestamp(current.startedAt) ??
    parseEnhancementTimestamp(current.queuedAt);
  return {
    ...asProcessingMetadata(params.metadata),
    transcriptEnhancement: {
      ...current,
      status: "SKIPPED",
      skipReason: ENHANCEMENT_TIMEOUT_SKIP_REASON,
      idempotencyDecision: "timed_out",
      finishedAt: nowIso,
      completedAt: nowIso,
      durationMs: startedAt ? Math.max(0, nowMs - startedAt.getTime()) : 0,
      error: null,
      errorCategory: "timeout",
      failureStage: "timeout",
      executionStatus: "NOT_STARTED",
      publicationEligible: false,
    },
  };
}

/**
 * Historical writer retained only so first-read of old tests/fixtures can
 * inspect the previous skip shape. New enhancement correctness never calls
 * this for healthy in-progress D1 work.
 */
export async function persistEnhancementTimeoutSkip(params: {
  db: TranscriptEnhancementTimeoutDbClient;
  transcriptId: string;
  runId?: string | null;
  inputIdentity?: string | null;
  retranscribeCount?: number | null;
  nowMs?: number;
}): Promise<boolean> {
  const latest = await params.db.transcript.findUnique({
    where: { id: params.transcriptId },
    select: { processingMetadata: true },
  });
  const job = parseTranscriptEnhancementJob(latest?.processingMetadata);
  if (job.schemaVersion === "d1-v1") {
    return false;
  }
  return false;
}

/**
 * Status-read opportunistic healing: recover expired D1 leases.
 * Never writes SKIPPED/timeout for healthy D1 work.
 */
export async function reconcileTranscriptEnhancementTimeout(params: {
  db: TranscriptEnhancementTimeoutDbClient;
  transcriptId: string;
  nowMs?: number;
  timeoutMs?: number;
}): Promise<EnhancementTimeoutReconcileResult> {
  const latest = await params.db.transcript.findUnique({
    where: { id: params.transcriptId },
    select: { processingMetadata: true },
  });
  const metadata = asProcessingMetadata(latest?.processingMetadata);
  const job = parseTranscriptEnhancementJob(metadata);
  const running = isTranscriptEnhancementRunning(metadata) || job.executionStatus === "QUEUED" || job.executionStatus === "RUNNING";
  if (job.schemaVersion === "d1-v1" && job.publicationEligible && running) {
    try {
      const { runTranscriptEnhancementRecoveryTick } = await import(
        "@/lib/services/transcript-enhancement-recovery"
      );
      await runTranscriptEnhancementRecoveryTick({
        db: params.db as never,
        now: () => params.nowMs ?? Date.now(),
        transcriptIds: [params.transcriptId],
        resume: true,
      });
    } catch {
      // Opportunistic only.
    }
  }
  const after = await params.db.transcript.findUnique({
    where: { id: params.transcriptId },
    select: { processingMetadata: true },
  });
  const nextMetadata = asProcessingMetadata(after?.processingMetadata ?? metadata);
  const nextJob = parseTranscriptEnhancementJob(nextMetadata);
  return {
    metadata: nextMetadata,
    running: isTranscriptEnhancementRunning(nextMetadata) || isEnhancementStatusRunningAlias(nextJob.executionStatus) || nextJob.executionStatus === "QUEUED" || nextJob.executionStatus === "RUNNING",
    timedOut: false,
  };
}

export async function isAuthoritativeEnhancementLockActive(params: {
  db?: TranscriptEnhancementTimeoutDbClient;
  transcriptId: string;
  nowMs?: number;
}): Promise<boolean> {
  const db = params.db ?? (await import("@/lib/prisma")).prisma;
  const latest = await db.transcript.findUnique({
    where: { id: params.transcriptId },
    select: { processingMetadata: true },
  });
  return parseTranscriptEnhancementJob(latest?.processingMetadata).publicationEligible;
}

export function waitForEnhancementTimeout(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}
