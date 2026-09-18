import { createHash, randomUUID } from "node:crypto";

import { AiAnalysisStatus, Prisma, TranscriptStatus } from "@/app/generated/prisma/client";
import { isAiAnalysisRunLeaseActive } from "@/lib/ai/analysis-operation";
import {
  computeTranscriptEnhancementT3Ms,
  getTranscriptEnhancementHeartbeatMs,
  getTranscriptEnhancementLeaseTtlMs,
  getTranscriptEnhancementMaxConcurrency,
  getTranscriptEnhancementOutputMode,
  getYandexTranscriptEnhancementModel,
  isTranscriptEnhancementAutoTriggerEnabled,
  isYandexTranscriptEnhancementEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  notifyEnhancementProviderCall,
  resolveEnhancementProviderCallObserver,
  type EnhancementProviderCallObserver,
} from "@/lib/services/transcript-enhancement-provider-observation";
import { getTranscriptEnhancementLimiter } from "@/lib/services/transcript-enhancement-limiter";
import {
  ProviderSlotUnavailableError,
  withProviderSlotLease,
} from "@/lib/services/transcript-enhancement-provider-slots";
import {
  getProviderPostAttemptBudget,
  isRetryableProviderCategory,
  parseRetryAfterMs,
  resolveChunkAttemptPlan,
  resolveChunkStatusAfterAttempt,
  resolveRetryDelayMs,
  retryBackoffMs,
} from "@/lib/services/transcript-enhancement-retry";
import {
  chunkKey,
  computeEnhancementProgress,
  ENHANCEMENT_D1_SCHEMA_VERSION,
  isExecutionInFlight,
  isUnfinishedChunkStatus,
  mergeEnhancementJobIntoMetadata,
  parseTranscriptEnhancementJob,
  toDurableEnhancementPieces,
  type TranscriptEnhancementDurableChunk,
  type TranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";
import {
  authorizeEnhancementChunkStart,
  checkpointEnhancementChunk,
  heartbeatEnhancementLease,
  markEnhancementExecutionFailed,
  patchEnhancementJob,
  publishEnhancementIfEligible,
} from "@/lib/services/transcript-enhancement-state";
import { resolveEnhancementOriginalText } from "@/lib/services/transcript-enhancement-persistence";
import { preserveTranscriptEnhancementPublication } from "@/lib/services/transcript-enhancement-publication";
import {
  buildTranscriptEnhancementChunks,
  enhanceTranscriptWithYandexAi,
  type EnhancementChunk,
  type TranscriptEnhancementInputSegment,
  type TranscriptEnhancementResult,
} from "@/lib/services/yandex-transcript-enhancement";
import {
  asProcessingMetadata,
  mergeProcessingMetadata,
  type ProcessingMetadata,
} from "@/lib/transcription/processing-metadata";
import {
  lockAiAnalysisRowForUpdate,
  lockTranscriptRowForUpdate,
} from "@/lib/transcription/transcript-row-lock";

const ENHANCEMENT_SCHEMA_VERSION = "v1";
const ENHANCEMENT_PROMPT_VERSION = "stage-3.9f-auto-enhancement-v1";

export type TranscriptEnhancementTriggerSource =
  | "automatic_initial_transcription"
  | "automatic_retranscription"
  | "manual"
  | "manual_reenhancement";

type TranscriptEnhancementIdempotencyDecision =
  | "started_new"
  | "skip_completed_same_identity"
  | "coalesced_running_same_identity"
  | "recovered_stale_running"
  | "timed_out"
  | "manual_forced_rerun"
  | "skipped_not_yandex"
  | "skipped_disabled"
  | "skipped_auto_run_disabled"
  | "skipped_empty_transcript"
  | "skipped_empty_raw_text"
  | "lock_lost"
  | "skipped_transcript_not_completed"
  | "skipped_ai_in_progress";

type TranscriptSegmentForEnhancement = {
  id: string;
  orderIndex: number;
  speakerLabel: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  mappedParticipantId: string | null;
  text: string;
  qualityText: string | null;
};

type LoadedTranscriptForEnhancement = {
  id: string;
  sessionId: string;
  status: TranscriptStatus;
  text: string;
  diarizedText: string | null;
  updatedAt: Date;
  processingMetadata: unknown;
  retranscribeCount: number | null;
  speakerMapping?: unknown;
  session?: {
    participants: Array<{
      id: string;
      displayName: string;
      type: string;
      sessionRole: { name: string } | null;
    }>;
  };
  segments: TranscriptSegmentForEnhancement[];
};

export type TranscriptEnhancementDbClient = {
  transcript: {
    findUnique: typeof prisma.transcript.findUnique;
    update: typeof prisma.transcript.update;
    updateMany: typeof prisma.transcript.updateMany;
  };
  transcriptSegment: {
    update: typeof prisma.transcriptSegment.update;
  };
  aiAnalysis?: {
    findUnique: typeof prisma.aiAnalysis.findUnique;
  };
  $transaction: typeof prisma.$transaction;
  $queryRaw?: typeof prisma.$queryRaw;
};

export type TranscriptEnhancementDependencies = {
  db: TranscriptEnhancementDbClient;
  enhance?: typeof enhanceTranscriptWithYandexAi;
  runChunkedEnhancement?: typeof enhanceTranscriptWithYandexAi;
  now?: () => number;
  schedule?: (work: () => Promise<void>) => void;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  waitForTimeout?: (timeoutMs: number, signal: AbortSignal) => Promise<void>;
  onProviderCall?: EnhancementProviderCallObserver;
};

export type TranscriptEnhancementRunResult =
  | {
      outcome: "started";
      transcriptId: string;
      inputIdentity: string;
      triggerSource: TranscriptEnhancementTriggerSource;
    }
  | {
      outcome: "already_running";
      transcriptId: string;
      inputIdentity: string | null;
      triggerSource: TranscriptEnhancementTriggerSource;
    }
  | {
      outcome: "skipped";
      transcriptId: string;
      inputIdentity: string | null;
      triggerSource: TranscriptEnhancementTriggerSource;
      reason: TranscriptEnhancementIdempotencyDecision;
    }
  | {
      outcome: "not_found";
      transcriptId: string;
      triggerSource: TranscriptEnhancementTriggerSource;
    }
  | {
      outcome: "conflict";
      transcriptId: string;
      inputIdentity: string | null;
      triggerSource: TranscriptEnhancementTriggerSource;
      reason: "skipped_ai_in_progress" | "skipped_transcript_not_completed";
    };

async function lockTranscriptRowIfSupported(
  db: { $queryRaw?: typeof prisma.$queryRaw },
  transcriptId: string,
) {
  await lockTranscriptRowForUpdate(db, transcriptId);
}

function mapSegmentsToEnhancementInput(
  segments: TranscriptSegmentForEnhancement[],
): TranscriptEnhancementInputSegment[] {
  return segments.map((segment) => ({
    index: segment.orderIndex,
    speakerLabel: segment.speakerLabel ?? "Speaker",
    startMs:
      segment.startSeconds !== null ? Math.round(segment.startSeconds * 1000) : null,
    endMs:
      segment.endSeconds !== null ? Math.round(segment.endSeconds * 1000) : null,
    originalText: resolveEnhancementOriginalText(segment),
    segmentId: segment.id,
    mappedParticipantId: segment.mappedParticipantId,
  }));
}

function canonicalRawTextHash(
  enhancementInput: TranscriptEnhancementInputSegment[],
): string {
  const normalized = enhancementInput
    .map((segment) => `${segment.index}:${segment.originalText.trim()}`)
    .join("\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function buildTranscriptEnhancementInputIdentity(params: {
  transcriptId: string;
  rawSegmentsHash: string;
  model: string;
  outputMode: string;
  schemaVersion: string;
  promptVersion: string;
}): string {
  const payload = [
    params.transcriptId,
    params.rawSegmentsHash,
    params.model,
    params.outputMode,
    params.schemaVersion,
    params.promptVersion,
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

function buildSkipMetadata(params: {
  metadata: ProcessingMetadata;
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string | null;
  reason: TranscriptEnhancementIdempotencyDecision;
}): ProcessingMetadata {
  const nowIso = new Date().toISOString();
  const current = asProcessingMetadata(params.metadata.transcriptEnhancement);
  return mergeProcessingMetadata(params.metadata, {
    transcriptEnhancement: {
      ...current,
      schemaVersion: ENHANCEMENT_D1_SCHEMA_VERSION,
      executionStatus: "NOT_STARTED",
      publicationEligible: false,
      terminalQuality: null,
      status: "SKIPPED",
      triggerSource: params.triggerSource,
      inputIdentity: params.inputIdentity,
      runId: null,
      jobId: null,
      idempotencyDecision: params.reason,
      queuedAt: nowIso,
      startedAt: nowIso,
      finishedAt: nowIso,
      completedAt: nowIso,
      durationMs: 0,
      skipReason: params.reason,
      error: null,
      model: getYandexTranscriptEnhancementModel(),
      outputMode: getTranscriptEnhancementOutputMode(),
      promptVersion: ENHANCEMENT_PROMPT_VERSION,
    },
  });
}

function logEnhancement(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      area: "transcript_enhancement",
      event,
      ...data,
    }),
  );
}

function planDurableChunks(
  enhancementInput: TranscriptEnhancementInputSegment[],
): TranscriptEnhancementDurableChunk[] {
  const planned = buildTranscriptEnhancementChunks(enhancementInput);
  if (planned.length === 0) {
    return [
      {
        chunkIndex: 0,
        status: "PENDING",
        targetIndexes: enhancementInput.map((segment) => segment.index),
        targetPieces: [],
        attemptCount: 0,
        unpublishedByOrderIndex: {},
        lastErrorClass: null,
        lastHttpClass: null,
        lastSchemaResult: null,
        providerDurationMs: null,
        usageInputTokens: null,
        usageOutputTokens: null,
        usageTotalTokens: null,
        usageClassification: null,
        startedAt: null,
        finishedAt: null,
      },
    ];
  }
  return planned.map((chunk) => ({
    chunkIndex: chunk.chunkIndex,
    status: "PENDING" as const,
    targetIndexes: [...new Set(chunk.targets.map((target) => target.sourceIndex))],
    targetPieces: toDurableEnhancementPieces(chunk.targets),
    attemptCount: 0,
    unpublishedByOrderIndex: {},
    lastErrorClass: null,
    lastHttpClass: null,
    lastSchemaResult: null,
    providerDurationMs: null,
    usageInputTokens: null,
    usageOutputTokens: null,
    usageTotalTokens: null,
    usageClassification: null,
    startedAt: null,
    finishedAt: null,
  }));
}

export function classifyEnhancementRetry(error: unknown): {
  retryable: boolean;
  errorClass: string;
} {
  return classifyRetryable(error);
}

function classifyRetryable(error: unknown): { retryable: boolean; errorClass: string } {
  if (error instanceof ProviderSlotUnavailableError) {
    return { retryable: true, errorClass: "provider_slot_unavailable" };
  }
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) {
    return { retryable: true, errorClass: "timeout" };
  }
  if (message.includes("http 429") || message.includes("provider_rate_limit")) {
    return { retryable: true, errorClass: "429" };
  }
  if (message.includes("http 5") || message.includes("provider_http_5xx")) {
    return { retryable: true, errorClass: "5xx" };
  }
  if (message.includes("network") || message.includes("fetch failed")) {
    return { retryable: true, errorClass: "network" };
  }
  if (
    message.includes("schema") ||
    message.includes("invalid json") ||
    message.includes("unknown segment") ||
    message.includes("malformed")
  ) {
    return { retryable: true, errorClass: "schema_invalid" };
  }
  return { retryable: false, errorClass: "non_retryable" };
}

async function defaultSleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function scheduleDetached(
  work: () => Promise<void>,
  schedule?: (work: () => Promise<void>) => void,
) {
  if (schedule) {
    schedule(work);
    return;
  }
  try {
    const { after } = await import("next/server");
    try {
      after(() => {
        void work();
      });
      return;
    } catch {
      void work();
    }
  } catch {
    void work();
  }
}

function isSameIdentityCompleted(job: TranscriptEnhancementJob, inputIdentity: string): boolean {
  if (job.inputIdentity !== inputIdentity) return false;
  return (
    (job.executionStatus === "COMPLETED" && job.terminalQuality === "COMPLETED") ||
    job.status === "COMPLETED"
  );
}

function buildAdmittedJob(params: {
  metadata: ProcessingMetadata;
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string;
  runId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  retranscribeCount: number | null;
  chunks: TranscriptEnhancementDurableChunk[];
  idempotencyDecision: TranscriptEnhancementIdempotencyDecision;
  nowMs: number;
}): ProcessingMetadata {
  const nowIso = new Date(params.nowMs).toISOString();
  const chunks: Record<string, TranscriptEnhancementDurableChunk> = {};
  for (const chunk of params.chunks) {
    chunks[chunkKey(chunk.chunkIndex)] = chunk;
  }
  const progress = computeEnhancementProgress(chunks);
  const t3Ms = computeTranscriptEnhancementT3Ms(progress.totalChunks);
  const job: TranscriptEnhancementJob = {
    schemaVersion: ENHANCEMENT_D1_SCHEMA_VERSION,
    jobId: params.runId,
    runId: params.runId,
    leaseToken: params.leaseToken,
    leaseExpiresAt: params.leaseExpiresAt,
    executionStatus: "QUEUED",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: params.inputIdentity,
    retranscribeCount: params.retranscribeCount,
    triggerSource: params.triggerSource,
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress,
    chunks,
    unpublishedByOrderIndex: {},
    queuedAt: nowIso,
    startedAt: nowIso,
    finishedAt: null,
    safetyDeadlineAt: new Date(params.nowMs + t3Ms).toISOString(),
    skipReason: null,
    status: "RUNNING",
  };
  return mergeEnhancementJobIntoMetadata(params.metadata, job, {
    idempotencyDecision: params.idempotencyDecision,
    model: getYandexTranscriptEnhancementModel(),
    outputMode: getTranscriptEnhancementOutputMode(),
    promptVersion: ENHANCEMENT_PROMPT_VERSION,
  });
}

async function persistInjectedResult(params: {
  db: TranscriptEnhancementDbClient;
  transcriptId: string;
  owner: {
    runId: string;
    leaseToken: string;
    inputIdentity: string;
    retranscribeCount: number | null;
  };
  enhancementInput: TranscriptEnhancementInputSegment[];
  enhanced: TranscriptEnhancementResult;
  nowMs: number;
}): Promise<void> {
  const overall = params.enhanced.meta?.overallStatus ?? "COMPLETED";
  const byIndex = new Map(
    params.enhanced.segments.map((segment) => [segment.index, segment.cleanedText]),
  );
  const latest = await params.db.transcript.findUnique({
    where: { id: params.transcriptId },
    select: { processingMetadata: true },
  });
  const existing = Object.values(parseTranscriptEnhancementJob(latest?.processingMetadata).chunks);
  const planned = existing.length > 0 ? existing : planDurableChunks(params.enhancementInput);
  const nowIso = new Date(params.nowMs).toISOString();
  for (const chunk of planned) {
    const unpublishedByOrderIndex: Record<string, string> = {};
    let complete = overall === "COMPLETED";
    for (const index of chunk.targetIndexes) {
      const text = byIndex.get(index);
      if (typeof text === "string" && text.trim()) {
        unpublishedByOrderIndex[String(index)] = text;
      } else if (overall === "COMPLETED") {
        complete = false;
      }
    }
    await checkpointEnhancementChunk({
      db: params.db,
      transcriptId: params.transcriptId,
      owner: params.owner,
      nowMs: params.nowMs,
      chunk: {
        ...chunk,
        status: complete ? "COMPLETED" : "FAILED",
        attemptCount: 1,
        unpublishedByOrderIndex,
        lastErrorClass: complete ? null : "schema_invalid",
        finishedAt: nowIso,
        startedAt: nowIso,
      },
    });
  }
  await publishEnhancementIfEligible({
    db: params.db,
    transcriptId: params.transcriptId,
    owner: params.owner,
    nowMs: params.nowMs,
  });
}

async function runDurableChunkFanout(params: {
  db: TranscriptEnhancementDbClient;
  transcriptId: string;
  owner: {
    runId: string;
    leaseToken: string;
    inputIdentity: string;
    retranscribeCount: number | null;
  };
  enhancementInput: TranscriptEnhancementInputSegment[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  enhanceImpl?: typeof enhanceTranscriptWithYandexAi;
  onProviderCall?: EnhancementProviderCallObserver;
}): Promise<void> {
  const limiter = getTranscriptEnhancementLimiter();
  const attemptBudget = getProviderPostAttemptBudget();
  const jobId = params.owner.runId;
  const enhanceImpl = params.enhanceImpl ?? enhanceTranscriptWithYandexAi;
  const onProviderCall = resolveEnhancementProviderCallObserver(params.onProviderCall);

  const readDurableJob = async () => {
    const latestMeta = await params.db.transcript.findUnique({
      where: { id: params.transcriptId },
      select: { processingMetadata: true },
    });
    return parseTranscriptEnhancementJob(latestMeta?.processingMetadata);
  };

  /**
   * Global provider admission. The DB slot inventory is authority; the local
   * limiter is only a process-local waiter in front of it. The slot is held
   * only around the request, never across backoff.
   */
  const withProviderSlot = <T,>(fn: () => Promise<T>): Promise<T> =>
    limiter.withSlot(jobId, () =>
      withProviderSlotLease(
        {
          db: params.db,
          jobId,
          runId: params.owner.runId,
          now: params.now,
          sleep: params.sleep,
        },
        fn,
      ),
    );

  const checkpointFinish = async (
    result: {
      chunkIndex: number;
      enhancedByIndex: Map<number, string>;
      retryCount: number;
      status: string;
      errorCategory: string | null;
      schemaValidationPassed?: boolean;
      latencyMs: number | null;
      startedAt: string | null;
      finishedAt: string | null;
      usageInputTokens?: number | null;
      usageOutputTokens?: number | null;
      usageTotalTokens?: number | null;
      usageClassification?: "provider" | "unknown" | null;
      attemptNumber?: number;
      retryableFailure?: boolean;
      retryAfterHeader?: string | null;
    },
    chunk: EnhancementChunk,
    attemptNumber: number,
  ): Promise<number> => {
    const unpublishedByOrderIndex: Record<string, string> = {};
    for (const [index, text] of result.enhancedByIndex) {
      unpublishedByOrderIndex[String(index)] = text;
    }
    const providerCompleted = result.status === "COMPLETED";
    const retryable =
      !providerCompleted &&
      (result.retryableFailure ?? isRetryableProviderCategory(result.errorCategory));
    const attemptCount = Math.max(1, result.attemptNumber ?? attemptNumber);
    const status = resolveChunkStatusAfterAttempt({
      providerCompleted,
      retryable,
      attemptNumber: attemptCount,
      budget: attemptBudget,
    });
    const patched = await checkpointEnhancementChunk({
      db: params.db,
      transcriptId: params.transcriptId,
      owner: params.owner,
      nowMs: params.now(),
      chunk: {
        chunkIndex: chunk.chunkIndex,
        status,
        targetIndexes: [...new Set(chunk.targets.map((target) => target.sourceIndex))],
        targetPieces: toDurableEnhancementPieces(chunk.targets),
        attemptCount,
        unpublishedByOrderIndex,
        lastErrorClass: result.errorCategory,
        lastHttpClass: result.errorCategory === "provider_rate_limit" ? "429" : null,
        lastSchemaResult:
          result.schemaValidationPassed == null
            ? null
            : result.schemaValidationPassed
              ? "valid"
              : "invalid",
        providerDurationMs: result.latencyMs,
        usageInputTokens: result.usageInputTokens ?? null,
        usageOutputTokens: result.usageOutputTokens ?? null,
        usageTotalTokens: result.usageTotalTokens ?? null,
        usageClassification: result.usageClassification ?? null,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      },
    });
    await notifyEnhancementProviderCall(onProviderCall, {
      runId: params.owner.runId,
      transcriptId: params.transcriptId,
      chunkIndex: chunk.chunkIndex,
      attemptNumber: attemptCount,
      requestStartedAt: result.startedAt,
      responseReceivedAt: result.finishedAt,
      httpClass: result.errorCategory === "provider_rate_limit" ? "429" : result.errorCategory,
      schemaValid: result.schemaValidationPassed ?? null,
      checkpointAccepted: patched != null,
      checkpointRejectionReason: patched == null ? "execution_not_in_flight" : null,
    });
    if (status !== "RETRYABLE_FAILED") {
      return 0;
    }
    return resolveRetryDelayMs({
      backoffMs: retryBackoffMs(attemptCount),
      retryAfterMs: parseRetryAfterMs(result.retryAfterHeader, params.now()),
    });
  };

  // Single retry owner: at most `attemptBudget` HTTP POSTs per chunk per runId,
  // derived from the durable ledger so a restart cannot add a hidden attempt.
  let pendingRetryDelayMs = 0;
  for (let pass = 0; pass < attemptBudget; pass += 1) {
    const durable = await readDurableJob();
    const plan = resolveChunkAttemptPlan({
      chunks: Object.values(durable.chunks).map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        status: chunk.status,
        attemptCount: chunk.attemptCount,
        lastErrorClass: chunk.lastErrorClass,
      })),
      budget: attemptBudget,
    });
    if (plan.length === 0) break;

    if (pendingRetryDelayMs > 0) {
      // Backoff / Retry-After waiting happens with no Transcript lock and no
      // provider slot held. The job heartbeat keeps running.
      await params.sleep(pendingRetryDelayMs);
      pendingRetryDelayMs = 0;
    }

    const attemptByChunkIndex = new Map(
      plan.map((decision) => [
        decision.chunkIndex,
        { attemptNumber: decision.attemptNumber, flavor: decision.flavor },
      ]),
    );
    const skipChunkIndexes = new Set(
      Object.values(durable.chunks)
        .filter((chunk) => !attemptByChunkIndex.has(chunk.chunkIndex))
        .map((chunk) => chunk.chunkIndex),
    );
    let nextRetryDelayMs = 0;

    await enhanceImpl(params.enhancementInput, {
      jobId,
      skipChunkIndexes,
      restoredEnhancedByIndex: new Map(
        Object.entries(durable.unpublishedByOrderIndex).map(([key, text]) => [Number(key), text]),
      ),
      attemptByChunkIndex,
      withProviderSlot,
      onChunkStart: async (chunk) => {
        const attemptNumber = attemptByChunkIndex.get(chunk.chunkIndex)?.attemptNumber ?? 1;
        const requestStartedAt = new Date(params.now()).toISOString();
        const decision = await authorizeEnhancementChunkStart({
          db: params.db,
          transcriptId: params.transcriptId,
          owner: params.owner,
          nowMs: params.now(),
          attemptBudget,
          extra: { executionStatus: "RUNNING" },
          chunk: {
            chunkIndex: chunk.chunkIndex,
            status: "RUNNING",
            targetIndexes: [...new Set(chunk.targets.map((target) => target.sourceIndex))],
            targetPieces: toDurableEnhancementPieces(chunk.targets),
            attemptCount: attemptNumber,
            unpublishedByOrderIndex: {},
            lastErrorClass: null,
            lastHttpClass: null,
            lastSchemaResult: null,
            providerDurationMs: null,
            usageInputTokens: null,
            usageOutputTokens: null,
            usageTotalTokens: null,
            usageClassification: null,
            startedAt: requestStartedAt,
            finishedAt: null,
          },
        });
        if (decision.status !== "ACCEPTED") {
          return decision;
        }
        await notifyEnhancementProviderCall(onProviderCall, {
          runId: params.owner.runId,
          transcriptId: params.transcriptId,
          chunkIndex: chunk.chunkIndex,
          attemptNumber,
          requestStartedAt,
          responseReceivedAt: null,
          httpClass: null,
          schemaValid: null,
          checkpointAccepted: true,
          checkpointRejectionReason: null,
        });
        return decision;
      },
      onChunkFinish: async (result, chunk) => {
        const attemptNumber = attemptByChunkIndex.get(chunk.chunkIndex)?.attemptNumber ?? 1;
        const delayMs = await checkpointFinish(result, chunk, attemptNumber);
        nextRetryDelayMs = Math.max(nextRetryDelayMs, delayMs);
      },
    });

    pendingRetryDelayMs = nextRetryDelayMs;
  }

  const published = await publishEnhancementIfEligible({
    db: params.db,
    transcriptId: params.transcriptId,
    owner: params.owner,
    nowMs: params.now(),
  });
  if (published.outcome === "still_running") {
    // The retry budget is spent and no further POST can arrive for this run.
    // Terminalize through the Slice A canonical failure path.
    await markEnhancementExecutionFailed({
      db: params.db,
      transcriptId: params.transcriptId,
      owner: params.owner,
      errorMessage: "provider retry budget exhausted",
      nowMs: params.now(),
    });
  }
}

export async function runAdmittedEnhancementJob(params: {
  transcriptId: string;
  runId: string;
  leaseToken: string;
  inputIdentity: string;
  retranscribeCount: number | null;
  enhancementInput: TranscriptEnhancementInputSegment[];
  dependencies?: Partial<TranscriptEnhancementDependencies>;
}): Promise<void> {
  const db = params.dependencies?.db ?? prisma;
  const now = params.dependencies?.now ?? Date.now;
  const sleep = params.dependencies?.sleep ?? defaultSleep;
  const owner = {
    runId: params.runId,
    leaseToken: params.leaseToken,
    inputIdentity: params.inputIdentity,
    retranscribeCount: params.retranscribeCount,
  };
  const heartbeatMs = getTranscriptEnhancementHeartbeatMs();
  const leaseTtlMs = getTranscriptEnhancementLeaseTtlMs();
  let stopped = false;
  logEnhancement("job_started", {
    transcriptId: params.transcriptId,
    runId: params.runId,
    perJobConcurrency: getTranscriptEnhancementMaxConcurrency(),
    globalInFlight: getTranscriptEnhancementLimiter().snapshot().globalInFlight,
  });
  await patchEnhancementJob({
    db,
    transcriptId: params.transcriptId,
    owner,
    requireOwner: true,
    nowMs: now(),
    build: (job) => {
      if (!isExecutionInFlight(job.executionStatus)) return null;
      return {
        ...job,
        executionStatus: "RUNNING",
        startedAt: job.startedAt ?? new Date(now()).toISOString(),
      };
    },
  });
  const heartbeat =
    params.dependencies?.enhance ||
    params.dependencies?.runChunkedEnhancement ||
    heartbeatMs <= 0
      ? null
      : setInterval(() => {
          if (stopped) return;
          void heartbeatEnhancementLease({
            db,
            transcriptId: params.transcriptId,
            owner,
            leaseExpiresAt: new Date(now() + leaseTtlMs).toISOString(),
            nowMs: now(),
          });
        }, heartbeatMs);
  try {
    if (params.dependencies?.enhance) {
      const enhanced = await params.dependencies.enhance(params.enhancementInput);
      await persistInjectedResult({
        db,
        transcriptId: params.transcriptId,
        owner,
        enhancementInput: params.enhancementInput,
        enhanced,
        nowMs: now(),
      });
      return;
    }

    await runDurableChunkFanout({
      db,
      transcriptId: params.transcriptId,
      owner,
      enhancementInput: params.enhancementInput,
      now,
      sleep,
      enhanceImpl: params.dependencies?.runChunkedEnhancement,
      onProviderCall: params.dependencies?.onProviderCall,
    });
  } catch (error) {
    logEnhancement("job_failed", {
      transcriptId: params.transcriptId,
      runId: params.runId,
      errorClass: classifyRetryable(error).errorClass,
    });
    await markEnhancementExecutionFailed({
      db,
      transcriptId: params.transcriptId,
      owner,
      errorMessage: error instanceof Error ? error.message : "enhancement failed",
      nowMs: now(),
    });
  } finally {
    stopped = true;
    if (heartbeat) clearInterval(heartbeat);
  }
}

export async function executeTranscriptEnhancement(params: {
  transcriptId: string;
  triggerSource: TranscriptEnhancementTriggerSource;
  forceReenhancement?: boolean;
  runInBackground?: boolean;
  dependencies?: Partial<TranscriptEnhancementDependencies>;
}): Promise<TranscriptEnhancementRunResult> {
  const {
    transcriptId,
    triggerSource,
    forceReenhancement = false,
    runInBackground = false,
    dependencies,
  } = params;
  const db = dependencies?.db ?? prisma;
  const nowMs = (dependencies?.now ?? Date.now)();

  type AdmissionDecision =
    | { kind: "not_found" }
    | {
        kind: "conflict";
        reason: "skipped_ai_in_progress" | "skipped_transcript_not_completed";
      }
    | {
        kind: "skipped";
        reason: TranscriptEnhancementIdempotencyDecision;
        inputIdentity: string | null;
      }
    | { kind: "already_running"; inputIdentity: string | null }
    | {
        kind: "admitted";
        runId: string;
        leaseToken: string;
        inputIdentity: string;
        retranscribeCount: number | null;
        enhancementInput: TranscriptEnhancementInputSegment[];
        plannedChunkCount: number;
      };

  const admission = await db.$transaction(async (tx): Promise<AdmissionDecision> => {
    await lockTranscriptRowIfSupported(tx, transcriptId);
    const latest = (await tx.transcript.findUnique({
      where: { id: transcriptId },
      select: {
        id: true,
        sessionId: true,
        status: true,
        text: true,
        diarizedText: true,
        updatedAt: true,
        processingMetadata: true,
        retranscribeCount: true,
        speakerMapping: true,
        session: {
          select: {
            participants: {
              select: {
                id: true,
                displayName: true,
                type: true,
                sessionRole: { select: { name: true } },
              },
            },
          },
        },
        segments: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            orderIndex: true,
            speakerLabel: true,
            startSeconds: true,
            endSeconds: true,
            mappedParticipantId: true,
            text: true,
            qualityText: true,
          },
        },
      },
    })) as LoadedTranscriptForEnhancement | null;

    if (!latest) {
      return { kind: "not_found" } satisfies AdmissionDecision;
    }

    if (latest.status !== TranscriptStatus.COMPLETED) {
      return {
        kind: "conflict",
        reason: "skipped_transcript_not_completed",
      } satisfies AdmissionDecision;
    }

    await lockAiAnalysisRowForUpdate(tx, latest.sessionId);

    const aiClient = (tx as TranscriptEnhancementDbClient).aiAnalysis;
    if (aiClient) {
      const analysis = await aiClient.findUnique({
        where: { sessionId: latest.sessionId },
        select: {
          status: true,
          runToken: true,
          leaseExpiresAt: true,
          updatedAt: true,
        },
      });
      if (
        analysis &&
        (analysis.status === AiAnalysisStatus.QUEUED ||
          analysis.status === AiAnalysisStatus.ANALYZING) &&
        isAiAnalysisRunLeaseActive(analysis)
      ) {
        return {
          kind: "conflict",
          reason: "skipped_ai_in_progress",
        } satisfies AdmissionDecision;
      }
    }

    const persistSkip = async (
      reason: TranscriptEnhancementIdempotencyDecision,
      inputIdentity: string | null,
    ): Promise<AdmissionDecision> => {
      const current = asProcessingMetadata(latest.processingMetadata);
      await tx.transcript.update({
        where: { id: latest.id },
        data: {
          processingMetadata: buildSkipMetadata({
            metadata: current,
            triggerSource,
            inputIdentity,
            reason,
          }) as Prisma.InputJsonValue,
        },
      });
      return { kind: "skipped", reason, inputIdentity };
    };

    const metadata = asProcessingMetadata(latest.processingMetadata);
    const provider =
      typeof metadata.transcriptionProvider === "string"
        ? metadata.transcriptionProvider
        : null;
    if (provider !== "yandex_speechkit") {
      return persistSkip("skipped_not_yandex", null);
    }

    if (!isYandexTranscriptEnhancementEnabled()) {
      return persistSkip("skipped_disabled", null);
    }

    if (triggerSource.startsWith("automatic_") && !isTranscriptEnhancementAutoTriggerEnabled()) {
      return persistSkip("skipped_auto_run_disabled", null);
    }

    const enhancementInput = mapSegmentsToEnhancementInput(latest.segments);
    if (enhancementInput.length === 0) {
      return persistSkip("skipped_empty_transcript", null);
    }

    const hasCanonicalText = enhancementInput.some(
      (segment) => segment.originalText.trim().length > 0,
    );
    if (!hasCanonicalText) {
      return persistSkip("skipped_empty_raw_text", null);
    }

    const rawHash = canonicalRawTextHash(enhancementInput);
    const inputIdentity = buildTranscriptEnhancementInputIdentity({
      transcriptId: latest.id,
      rawSegmentsHash: rawHash,
      model: getYandexTranscriptEnhancementModel(),
      outputMode: getTranscriptEnhancementOutputMode(),
      schemaVersion: ENHANCEMENT_SCHEMA_VERSION,
      promptVersion: ENHANCEMENT_PROMPT_VERSION,
    });

    const latestJob = parseTranscriptEnhancementJob(latest.processingMetadata);
    if (isSameIdentityCompleted(latestJob, inputIdentity) && !forceReenhancement) {
      return {
        kind: "skipped",
        reason: "skip_completed_same_identity",
        inputIdentity,
      };
    }

    if (
      isExecutionInFlight(latestJob.executionStatus) &&
      latestJob.publicationEligible &&
      !forceReenhancement
    ) {
      return { kind: "already_running", inputIdentity };
    }

    const historicalTimeoutSkip =
      latestJob.skipReason === "timeout" &&
      latestJob.inputIdentity === inputIdentity &&
      latestJob.schemaVersion === "legacy";
    if (
      historicalTimeoutSkip &&
      !forceReenhancement &&
      triggerSource.startsWith("automatic_")
    ) {
      return { kind: "skipped", reason: "timed_out", inputIdentity };
    }

    const idempotencyDecision: TranscriptEnhancementIdempotencyDecision = forceReenhancement
      ? "manual_forced_rerun"
      : "started_new";
    const runId = randomUUID();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(nowMs + getTranscriptEnhancementLeaseTtlMs()).toISOString();
    const plannedChunks = planDurableChunks(enhancementInput);
    const metadataWithPublication = preserveTranscriptEnhancementPublication({
      metadata,
      job: latestJob,
      retranscribeCount: latest.retranscribeCount ?? 0,
      segments: latest.segments,
    });
    const runningMetadata = buildAdmittedJob({
      metadata: metadataWithPublication,
      triggerSource,
      inputIdentity,
      runId,
      leaseToken,
      leaseExpiresAt,
      retranscribeCount: latest.retranscribeCount,
      chunks: plannedChunks,
      idempotencyDecision,
      nowMs,
    });
    await tx.transcript.update({
      where: { id: latest.id },
      data: {
        processingMetadata: runningMetadata as Prisma.InputJsonValue,
      },
    });
    return {
      kind: "admitted",
      runId,
      leaseToken,
      inputIdentity,
      retranscribeCount: latest.retranscribeCount,
      enhancementInput,
      plannedChunkCount: plannedChunks.length,
    } satisfies AdmissionDecision;
  });

  if (admission.kind === "not_found") {
    return { outcome: "not_found", transcriptId, triggerSource };
  }
  if (admission.kind === "conflict") {
    return {
      outcome: "conflict",
      transcriptId,
      inputIdentity: null,
      triggerSource,
      reason: admission.reason,
    };
  }
  if (admission.kind === "skipped") {
    return {
      outcome: "skipped",
      transcriptId,
      inputIdentity: admission.inputIdentity,
      triggerSource,
      reason: admission.reason,
    };
  }
  if (admission.kind === "already_running") {
    return {
      outcome: "already_running",
      transcriptId,
      inputIdentity: admission.inputIdentity,
      triggerSource,
    };
  }

  logEnhancement("job_admitted", {
    transcriptId,
    runId: admission.runId,
    inputIdentity: admission.inputIdentity,
    generation: admission.retranscribeCount,
    sourceSegmentCount: admission.enhancementInput.length,
    chars: admission.enhancementInput.reduce(
      (sum, segment) => sum + segment.originalText.length,
      0,
    ),
    chunkCount: admission.plannedChunkCount,
    perJobConcurrency: getTranscriptEnhancementMaxConcurrency(),
    executionStatus: "QUEUED",
    publicationEligible: true,
  });

  const work = () =>
    runAdmittedEnhancementJob({
      transcriptId,
      runId: admission.runId,
      leaseToken: admission.leaseToken,
      inputIdentity: admission.inputIdentity,
      retranscribeCount: admission.retranscribeCount,
      enhancementInput: admission.enhancementInput,
      dependencies,
    }).catch((backgroundError) => {
      console.warn(
        `[transcript-enhancement] detached run failed for transcript ${transcriptId}: ${
          backgroundError instanceof Error ? backgroundError.message : "unknown error"
        }`,
      );
    });

  if (runInBackground) {
    await scheduleDetached(work, dependencies?.schedule);
  } else {
    await work();
  }

  return {
    outcome: "started",
    transcriptId,
    inputIdentity: admission.inputIdentity,
    triggerSource,
  };
}

export function enhancementJobHasUnfinishedWork(processingMetadata: unknown): boolean {
  const job = parseTranscriptEnhancementJob(processingMetadata);
  return Object.values(job.chunks).some((chunk) => isUnfinishedChunkStatus(chunk.status));
}
