import { Prisma } from "@/app/generated/prisma/client";
import {
  DEFAULT_TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS,
  getTranscriptEnhancementTimeoutMs,
} from "@/lib/env";
import {
  asProcessingMetadata,
  getTranscriptEnhancementNamespace,
  isTranscriptEnhancementRunning,
  mergeProcessingMetadata,
  type ProcessingMetadata,
} from "@/lib/transcription/processing-metadata";

export { DEFAULT_TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS };

export const ENHANCEMENT_TIMEOUT_SKIP_REASON = "timeout";

export type TranscriptEnhancementTimeoutDbClient = {
  transcript: {
    findUnique: (args: {
      where: { id: string };
      select?: { processingMetadata?: true; retranscribeCount?: true };
    }) => Promise<{
      processingMetadata?: unknown;
      retranscribeCount?: number | null;
    } | null>;
    update: (args: {
      where: { id: string };
      data: { processingMetadata: Prisma.InputJsonValue };
    }) => Promise<unknown>;
  };
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

export function isEnhancementRunTimedOut(
  processingMetadata: unknown,
  nowMs = Date.now(),
  timeoutMs = getTranscriptEnhancementTimeoutMs(),
): boolean {
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
  return mergeProcessingMetadata(params.metadata, {
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
    },
  });
}

async function lockTranscriptRowIfSupported(
  db: { $queryRaw?: TranscriptEnhancementTimeoutDbClient["$queryRaw"] },
  transcriptId: string,
) {
  if (typeof db.$queryRaw !== "function") {
    return;
  }
  await db.$queryRaw`SELECT "id" FROM "Transcript" WHERE "id" = ${transcriptId} FOR UPDATE`;
}

export async function persistEnhancementTimeoutSkip(params: {
  db: TranscriptEnhancementTimeoutDbClient;
  transcriptId: string;
  runId?: string | null;
  inputIdentity?: string | null;
  retranscribeCount?: number | null;
  nowMs?: number;
}): Promise<boolean> {
  const nowMs = params.nowMs ?? Date.now();
  return params.db.$transaction(async (tx) => {
    await lockTranscriptRowIfSupported(tx, params.transcriptId);
    const latest = await tx.transcript.findUnique({
      where: { id: params.transcriptId },
      select: { processingMetadata: true, retranscribeCount: true },
    });
    if (!latest) return false;
    const latestMetadata = asProcessingMetadata(latest.processingMetadata);
    const latestEnhancement = getTranscriptEnhancementNamespace(latestMetadata);
    if (!isEnhancementStatusRunningAlias(latestEnhancement.status)) {
      return false;
    }
    if (params.runId != null && latestEnhancement.runId !== params.runId) {
      return false;
    }
    if (
      params.inputIdentity != null &&
      latestEnhancement.inputIdentity !== params.inputIdentity
    ) {
      return false;
    }
    if (
      params.retranscribeCount !== undefined &&
      latest.retranscribeCount !== params.retranscribeCount
    ) {
      return false;
    }
    await tx.transcript.update({
      where: { id: params.transcriptId },
      data: {
        processingMetadata: buildTimeoutSkipMetadata({
          metadata: latestMetadata,
          nowMs,
        }) as Prisma.InputJsonValue,
      },
    });
    return true;
  });
}

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
  if (!isTranscriptEnhancementRunning(metadata)) {
    return { metadata, running: false, timedOut: false };
  }
  if (
    !isEnhancementRunTimedOut(
      metadata,
      params.nowMs ?? Date.now(),
      params.timeoutMs ?? getTranscriptEnhancementTimeoutMs(),
    )
  ) {
    return { metadata, running: true, timedOut: false };
  }
  await persistEnhancementTimeoutSkip({
    db: params.db,
    transcriptId: params.transcriptId,
    nowMs: params.nowMs,
  });
  const after = await params.db.transcript.findUnique({
    where: { id: params.transcriptId },
    select: { processingMetadata: true },
  });
  const nextMetadata = asProcessingMetadata(after?.processingMetadata);
  return {
    metadata: nextMetadata,
    running: isTranscriptEnhancementRunning(nextMetadata),
    timedOut: true,
  };
}

export async function isAuthoritativeEnhancementLockActive(params: {
  db?: TranscriptEnhancementTimeoutDbClient;
  transcriptId: string;
  nowMs?: number;
}): Promise<boolean> {
  const db = params.db ?? (await import("@/lib/prisma")).prisma;
  const result = await reconcileTranscriptEnhancementTimeout({
    db: db as TranscriptEnhancementTimeoutDbClient,
    transcriptId: params.transcriptId,
    nowMs: params.nowMs,
  });
  return result.running;
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
