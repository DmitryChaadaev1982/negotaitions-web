import { createHash, randomUUID } from "node:crypto";

import { Prisma } from "@/app/generated/prisma/client";
import {
  getTranscriptEnhancementOutputMode,
  getTranscriptEnhancementTimeoutMs,
  getYandexTranscriptEnhancementModel,
  isTranscriptEnhancementAutoTriggerEnabled,
  isYandexTranscriptEnhancementEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  persistEnhancementTimeoutSkip,
  waitForEnhancementTimeout,
  buildTimeoutSkipMetadata,
} from "@/lib/services/transcript-enhancement-timeout";
import {
  buildSegmentEnhancementUpdates,
  resolveEnhancementOriginalText,
  shouldPersistEnhancedText,
} from "@/lib/services/transcript-enhancement-persistence";
import {
  enhanceTranscriptWithYandexAi,
  type TranscriptEnhancementInputSegment,
  type TranscriptEnhancementMeta,
  type TranscriptEnhancementOverallStatus,
} from "@/lib/services/yandex-transcript-enhancement";
import {
  buildCanonicalDiarizedText,
  toParticipantDisplayInfo,
} from "@/lib/transcription/canonical-diarized-text";
import {
  asProcessingMetadata,
  mergeProcessingMetadata,
} from "@/lib/transcription/processing-metadata";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

const ENHANCEMENT_SCHEMA_VERSION = "v1";
const ENHANCEMENT_PROMPT_VERSION = "stage-3.9f-auto-enhancement-v1";

export type TranscriptEnhancementTriggerSource =
  | "automatic_initial_transcription"
  | "automatic_retranscription"
  | "manual"
  | "manual_reenhancement";

type TranscriptEnhancementExecutionStatus =
  | "RUNNING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED";

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
  | "lock_lost";

type ProcessingMetadata = Record<string, unknown>;

class TranscriptEnhancementOwnershipLostError extends Error {
  constructor() {
    super("Transcript enhancement ownership was lost.");
    this.name = "TranscriptEnhancementOwnershipLostError";
  }
}
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

type TranscriptEnhancementDbClient = {
  transcript: {
    findUnique: typeof prisma.transcript.findUnique;
    update: typeof prisma.transcript.update;
    updateMany: typeof prisma.transcript.updateMany;
  };
  transcriptSegment: {
    update: typeof prisma.transcriptSegment.update;
  };
  $transaction: typeof prisma.$transaction;
  $queryRaw?: typeof prisma.$queryRaw;
};

type TranscriptEnhancementDependencies = {
  db: TranscriptEnhancementDbClient;
  enhance: typeof enhanceTranscriptWithYandexAi;
  timeoutMs?: number;
  now?: () => number;
  waitForTimeout?: (timeoutMs: number, signal: AbortSignal) => Promise<void>;
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
    };

function asMetadata(value: unknown): ProcessingMetadata {
  return asProcessingMetadata(value);
}

async function lockTranscriptRowIfSupported(
  db: { $queryRaw?: typeof prisma.$queryRaw },
  transcriptId: string,
) {
  if (typeof db.$queryRaw !== "function") {
    return;
  }
  await db.$queryRaw`SELECT "id" FROM "Transcript" WHERE "id" = ${transcriptId} FOR UPDATE`;
}

async function writeMergedEnhancementMetadata(params: {
  db: TranscriptEnhancementDbClient;
  transcriptId: string;
  build: (current: ProcessingMetadata) => ProcessingMetadata;
}): Promise<void> {
  const latest = await params.db.transcript.findUnique({
    where: { id: params.transcriptId },
    select: { processingMetadata: true },
  });
  if (!latest) return;
  const current = asMetadata(latest.processingMetadata);
  await params.db.transcript.update({
    where: { id: params.transcriptId },
    data: {
      processingMetadata: params.build(current) as Prisma.InputJsonValue,
    },
  });
}

function asIsoString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseTimestamp(value: unknown): Date | null {
  const iso = asIsoString(value);
  if (!iso) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapSegmentsToEnhancementInput(
  segments: Array<{
    id: string;
    orderIndex: number;
    speakerLabel: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    mappedParticipantId: string | null;
    text: string;
    qualityText: string | null;
  }>,
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

function resolveEnhancementStatus(value: unknown): TranscriptEnhancementExecutionStatus | null {
  if (value === "RUNNING") return "RUNNING";
  if (value === "IN_PROGRESS") return "RUNNING";
  if (value === "COMPLETED") return "COMPLETED";
  if (value === "PARTIAL") return "PARTIAL";
  if (value === "FAILED") return "FAILED";
  if (value === "SKIPPED") return "SKIPPED";
  return null;
}

function buildRunningMetadata(params: {
  metadata: ProcessingMetadata;
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string;
  runId: string;
  idempotencyDecision: TranscriptEnhancementIdempotencyDecision;
}): ProcessingMetadata {
  const nowIso = new Date().toISOString();
  const current = asMetadata(params.metadata.transcriptEnhancement);
  return {
    ...params.metadata,
    transcriptEnhancement: {
      ...current,
      status: "RUNNING",
      triggerSource: params.triggerSource,
      inputIdentity: params.inputIdentity,
      runId: params.runId,
      idempotencyDecision: params.idempotencyDecision,
      queuedAt: nowIso,
      startedAt: nowIso,
      finishedAt: null,
      completedAt: null,
      durationMs: null,
      skipReason: null,
      error: null,
      errorCategory: null,
      failureStage: null,
      model: getYandexTranscriptEnhancementModel(),
      outputMode: getTranscriptEnhancementOutputMode(),
      schemaVersion: ENHANCEMENT_SCHEMA_VERSION,
      promptVersion: ENHANCEMENT_PROMPT_VERSION,
    },
  };
}

function buildSkipMetadata(params: {
  metadata: ProcessingMetadata;
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string | null;
  reason: TranscriptEnhancementIdempotencyDecision;
}): ProcessingMetadata {
  const nowIso = new Date().toISOString();
  const current = asMetadata(params.metadata.transcriptEnhancement);
  return {
    ...params.metadata,
    transcriptEnhancement: {
      ...current,
      status: "SKIPPED",
      triggerSource: params.triggerSource,
      inputIdentity: params.inputIdentity,
      runId: null,
      idempotencyDecision: params.reason,
      queuedAt: nowIso,
      startedAt: nowIso,
      finishedAt: nowIso,
      completedAt: nowIso,
      durationMs: 0,
      skipReason: params.reason,
      error: null,
      errorCategory: null,
      failureStage: null,
      model: getYandexTranscriptEnhancementModel(),
      outputMode: getTranscriptEnhancementOutputMode(),
      schemaVersion: ENHANCEMENT_SCHEMA_VERSION,
      promptVersion: ENHANCEMENT_PROMPT_VERSION,
    },
  };
}

function inferErrorCategory(error: unknown): string {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout")) return "timeout";
  if (message.includes("http 429")) return "provider_rate_limit";
  if (message.includes("http 5")) return "provider_http_5xx";
  if (message.includes("empty")) return "empty_output";
  if (message.includes("json")) return "invalid_json";
  return "enhancement_failed";
}

function buildCompletedMetadata(params: {
  metadata: ProcessingMetadata;
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string;
  startedAtMs: number;
  overallStatus: TranscriptEnhancementOverallStatus;
  meta: TranscriptEnhancementMeta | undefined;
  idempotencyDecision: TranscriptEnhancementIdempotencyDecision;
}): ProcessingMetadata {
  const current = asMetadata(params.metadata.transcriptEnhancement);
  const nowIso = new Date().toISOString();
  const durationMs = Date.now() - params.startedAtMs;
  const meta = params.meta;
  const status: TranscriptEnhancementExecutionStatus =
    params.overallStatus === "COMPLETED"
      ? "COMPLETED"
      : params.overallStatus === "PARTIAL"
        ? "PARTIAL"
        : params.overallStatus === "FAILED"
          ? "FAILED"
          : "SKIPPED";

  return {
    ...params.metadata,
    transcriptEnhancementRecommendation: {
      ...(asMetadata(params.metadata.transcriptEnhancementRecommendation) ?? {}),
      suggested: false,
      reasons: [],
    },
    transcriptEnhancement: {
      ...current,
      status,
      triggerSource: params.triggerSource,
      inputIdentity: params.inputIdentity,
      idempotencyDecision: params.idempotencyDecision,
      queuedAt: asIsoString(current.queuedAt) ?? new Date(params.startedAtMs).toISOString(),
      startedAt: asIsoString(current.startedAt) ?? new Date(params.startedAtMs).toISOString(),
      finishedAt: nowIso,
      completedAt: nowIso,
      durationMs,
      skipReason: status === "SKIPPED" ? "provider_skipped" : null,
      error: status === "FAILED" ? "Transcript enhancement failed." : null,
      errorCategory: status === "FAILED" ? "provider_failed" : null,
      failureStage:
        status === "COMPLETED"
          ? null
          : status === "PARTIAL"
            ? "chunk_execution"
            : status === "SKIPPED"
              ? null
              : "provider_execution",
      lastValidationStage:
        status === "COMPLETED" || status === "PARTIAL"
          ? "integrity_validation"
          : null,
      model: meta?.model ?? getYandexTranscriptEnhancementModel(),
      outputMode: meta?.outputMode ?? getTranscriptEnhancementOutputMode(),
      schemaVersion: meta?.schemaVersion ?? ENHANCEMENT_SCHEMA_VERSION,
      promptVersion: ENHANCEMENT_PROMPT_VERSION,
      chunkCount: meta?.chunkCount ?? null,
      successfulChunkCount: meta?.successfulChunkCount ?? null,
      failedChunkCount: meta?.failedChunkCount ?? null,
      retryCount: meta?.retryCount ?? null,
      fallbackSegmentCount: meta?.fallbackSegmentCount ?? null,
      schemaValidationPassed:
        meta == null
          ? null
          : (meta.failedChunkCount ?? 0) === 0 && status !== "FAILED",
      enhancementTimingMs: durationMs,
      meta: meta ?? null,
    },
  };
}

function buildFailedMetadata(params: {
  metadata: ProcessingMetadata;
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string;
  startedAtMs: number;
  idempotencyDecision: TranscriptEnhancementIdempotencyDecision;
  error: unknown;
}): ProcessingMetadata {
  const current = asMetadata(params.metadata.transcriptEnhancement);
  const nowIso = new Date().toISOString();
  return {
    ...params.metadata,
    transcriptEnhancement: {
      ...current,
      status: "FAILED",
      triggerSource: params.triggerSource,
      inputIdentity: params.inputIdentity,
      idempotencyDecision: params.idempotencyDecision,
      queuedAt: asIsoString(current.queuedAt) ?? new Date(params.startedAtMs).toISOString(),
      startedAt: asIsoString(current.startedAt) ?? new Date(params.startedAtMs).toISOString(),
      finishedAt: nowIso,
      completedAt: nowIso,
      durationMs: Date.now() - params.startedAtMs,
      skipReason: null,
      error:
        params.error instanceof Error
          ? params.error.message
          : "Transcript enhancement failed.",
      errorCategory: inferErrorCategory(params.error),
      failureStage: "provider_execution",
      lastValidationStage: null,
      schemaValidationPassed: false,
      enhancementTimingMs: Date.now() - params.startedAtMs,
      model: getYandexTranscriptEnhancementModel(),
      outputMode: getTranscriptEnhancementOutputMode(),
      schemaVersion: ENHANCEMENT_SCHEMA_VERSION,
      promptVersion: ENHANCEMENT_PROMPT_VERSION,
    },
  };
}

function isAuthoritativeRunningEnhancement(params: {
  latest: { processingMetadata: unknown; retranscribeCount: number | null } | null;
  runId: string;
  inputIdentity: string;
  retranscribeCount: number | null;
}): boolean {
  if (!params.latest) return false;
  const latestEnhancement = asMetadata(
    asMetadata(params.latest.processingMetadata).transcriptEnhancement,
  );
  return (
    latestEnhancement.runId === params.runId &&
    latestEnhancement.inputIdentity === params.inputIdentity &&
    resolveEnhancementStatus(latestEnhancement.status) === "RUNNING" &&
    params.latest.retranscribeCount === params.retranscribeCount
  );
}

async function persistEnhancementFailureIfAuthoritative(params: {
  db: TranscriptEnhancementDbClient;
  transcript: LoadedTranscriptForEnhancement;
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string;
  runId: string;
  startedAtMs: number;
  idempotencyDecision: TranscriptEnhancementIdempotencyDecision;
  error: unknown;
}): Promise<void> {
  if (params.error instanceof TranscriptEnhancementOwnershipLostError) {
    return;
  }
  await params.db.$transaction(async (tx) => {
    await lockTranscriptRowIfSupported(tx, params.transcript.id);
    const latest = await tx.transcript.findUnique({
      where: { id: params.transcript.id },
      select: {
        processingMetadata: true,
        retranscribeCount: true,
      },
    });
    if (
      !isAuthoritativeRunningEnhancement({
        latest,
        runId: params.runId,
        inputIdentity: params.inputIdentity,
        retranscribeCount: params.transcript.retranscribeCount,
      })
    ) {
      return;
    }
    const failedMetadata = buildFailedMetadata({
      metadata: asMetadata(latest?.processingMetadata),
      triggerSource: params.triggerSource,
      inputIdentity: params.inputIdentity,
      startedAtMs: params.startedAtMs,
      idempotencyDecision: params.idempotencyDecision,
      error: params.error,
    });
    await tx.transcript.update({
      where: { id: params.transcript.id },
      data: {
        processingMetadata: failedMetadata as Prisma.InputJsonValue,
      },
    });
  });
}

async function persistEnhancementSuccessIfAuthoritative(params: {
  db: TranscriptEnhancementDbClient;
  transcript: LoadedTranscriptForEnhancement;
  enhancementInput: TranscriptEnhancementInputSegment[];
  enhanced: Awaited<ReturnType<typeof enhanceTranscriptWithYandexAi>>;
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string;
  runId: string;
  startedAtMs: number;
  idempotencyDecision: TranscriptEnhancementIdempotencyDecision;
}): Promise<void> {
  const {
    db,
    transcript,
    enhanced,
    triggerSource,
    inputIdentity,
    runId,
    startedAtMs,
    idempotencyDecision,
  } = params;
  const overallStatus =
    enhanced.meta?.overallStatus ??
    ("COMPLETED" satisfies TranscriptEnhancementOverallStatus);
  const persistEnhanced = shouldPersistEnhancedText(overallStatus);
  const byIndex = new Map(
    enhanced.segments.map((segment) => [segment.index, segment.cleanedText]),
  );
  const segmentUpdates = buildSegmentEnhancementUpdates(transcript.segments, byIndex);

  const normalizedSegments = transcript.segments.map((segment) => ({
    speakerLabel: segment.speakerLabel,
    displaySpeakerLabel: null,
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
    text: byIndex.get(segment.orderIndex)?.trim() || segment.text,
    orderIndex: segment.orderIndex,
  }));

  const enhancedTranscriptText = normalizedSegments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  const mapping =
    transcript.speakerMapping &&
    typeof transcript.speakerMapping === "object" &&
    !Array.isArray(transcript.speakerMapping)
      ? (transcript.speakerMapping as SpeakerMapping)
      : null;
  const participants = (transcript.session?.participants ?? []).map(
    toParticipantDisplayInfo,
  );
  const enhancedDiarizedText =
    normalizedSegments.length > 0
      ? buildCanonicalDiarizedText({
          segments: normalizedSegments,
          speakerMapping: mapping,
          participants,
        })
      : transcript.diarizedText;

  await db.$transaction(async (tx) => {
    await lockTranscriptRowIfSupported(tx, transcript.id);
    const latest = await tx.transcript.findUnique({
      where: { id: transcript.id },
      select: {
        processingMetadata: true,
        retranscribeCount: true,
      },
    });
    if (
      !isAuthoritativeRunningEnhancement({
        latest,
        runId,
        inputIdentity,
        retranscribeCount: transcript.retranscribeCount,
      })
    ) {
      return;
    }

    if (persistEnhanced) {
      for (const segmentUpdate of segmentUpdates) {
        await tx.transcriptSegment.update({
          where: { id: segmentUpdate.id },
          data: {
            text: segmentUpdate.text,
            qualityText: segmentUpdate.qualityText,
          },
        });
      }
    }

    const completedMetadata = buildCompletedMetadata({
      metadata: asMetadata(latest?.processingMetadata),
      triggerSource,
      inputIdentity,
      startedAtMs,
      overallStatus,
      meta: enhanced.meta,
      idempotencyDecision,
    });

    await tx.transcript.update({
      where: { id: transcript.id },
      data: {
        text:
          persistEnhanced && enhancedTranscriptText.length > 0
            ? enhancedTranscriptText
            : transcript.text,
        diarizedText:
          persistEnhanced && enhancedDiarizedText
            ? enhancedDiarizedText
            : transcript.diarizedText,
        processingMetadata: completedMetadata as Prisma.InputJsonValue,
      },
    });
  });
}

async function runEnhancementExecution(params: {
  db: TranscriptEnhancementDbClient;
  enhance: typeof enhanceTranscriptWithYandexAi;
  transcript: LoadedTranscriptForEnhancement;
  enhancementInput: TranscriptEnhancementInputSegment[];
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string;
  runId: string;
  startedAtMs: number;
  idempotencyDecision: TranscriptEnhancementIdempotencyDecision;
  timeoutMs?: number;
  waitForTimeout?: (timeoutMs: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const {
    db,
    enhance,
    transcript,
    enhancementInput,
    triggerSource,
    inputIdentity,
    runId,
    startedAtMs,
    idempotencyDecision,
  } = params;
  const timeoutMs = params.timeoutMs ?? getTranscriptEnhancementTimeoutMs();
  const waitForTimeout = params.waitForTimeout ?? waitForEnhancementTimeout;
  const timeoutAbort = new AbortController();

  const enhancePromise = enhance(enhancementInput).then(
    (result) => ({ kind: "result" as const, result }),
    (error: unknown) => ({ kind: "error" as const, error }),
  );
  const timeoutPromise = waitForTimeout(timeoutMs, timeoutAbort.signal).then(
    () => ({ kind: "timeout" as const }),
    () => ({ kind: "aborted" as const }),
  );

  const first = await Promise.race([enhancePromise, timeoutPromise]);
  if (first.kind === "timeout") {
    await persistEnhancementTimeoutSkip({
      db: db as never,
      transcriptId: transcript.id,
      runId,
      inputIdentity,
      retranscribeCount: transcript.retranscribeCount,
    });
    void enhancePromise.then((later) => {
      if (later.kind === "result") {
        return persistEnhancementSuccessIfAuthoritative({
          db,
          transcript,
          enhancementInput,
          enhanced: later.result,
          triggerSource,
          inputIdentity,
          runId,
          startedAtMs,
          idempotencyDecision,
        });
      }
      return persistEnhancementFailureIfAuthoritative({
        db,
        transcript,
        triggerSource,
        inputIdentity,
        runId,
        startedAtMs,
        idempotencyDecision,
        error: later.error,
      });
    });
    return;
  }

  timeoutAbort.abort();
  const outcome = first.kind === "aborted" ? await enhancePromise : first;
  if (outcome.kind === "error") {
    await persistEnhancementFailureIfAuthoritative({
      db,
      transcript,
      triggerSource,
      inputIdentity,
      runId,
      startedAtMs,
      idempotencyDecision,
      error: outcome.error,
    });
    return;
  }
  if (outcome.kind === "result") {
    await persistEnhancementSuccessIfAuthoritative({
      db,
      transcript,
      enhancementInput,
      enhanced: outcome.result,
      triggerSource,
      inputIdentity,
      runId,
      startedAtMs,
      idempotencyDecision,
    });
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
  const enhance = dependencies?.enhance ?? enhanceTranscriptWithYandexAi;
  const timeoutMs = dependencies?.timeoutMs ?? getTranscriptEnhancementTimeoutMs();
  const nowMs = (dependencies?.now ?? Date.now)();
  const waitForTimeout = dependencies?.waitForTimeout ?? waitForEnhancementTimeout;

  const transcript = (await db.transcript.findUnique({
    where: { id: transcriptId },
    select: {
      id: true,
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

  if (!transcript) {
    return { outcome: "not_found", transcriptId, triggerSource };
  }

  const metadata = asMetadata(transcript.processingMetadata);
  const provider =
    typeof metadata.transcriptionProvider === "string"
      ? metadata.transcriptionProvider
      : null;
  if (provider !== "yandex_speechkit") {
    await writeMergedEnhancementMetadata({
      db,
      transcriptId: transcript.id,
      build: (current) =>
        buildSkipMetadata({
          metadata: current,
          triggerSource,
          inputIdentity: null,
          reason: "skipped_not_yandex",
        }),
    });
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity: null,
      triggerSource,
      reason: "skipped_not_yandex",
    };
  }

  if (!isYandexTranscriptEnhancementEnabled()) {
    await writeMergedEnhancementMetadata({
      db,
      transcriptId: transcript.id,
      build: (current) =>
        buildSkipMetadata({
          metadata: current,
          triggerSource,
          inputIdentity: null,
          reason: "skipped_disabled",
        }),
    });
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity: null,
      triggerSource,
      reason: "skipped_disabled",
    };
  }

  if (
    triggerSource.startsWith("automatic_") &&
    !isTranscriptEnhancementAutoTriggerEnabled()
  ) {
    await writeMergedEnhancementMetadata({
      db,
      transcriptId: transcript.id,
      build: (current) =>
        buildSkipMetadata({
          metadata: current,
          triggerSource,
          inputIdentity: null,
          reason: "skipped_auto_run_disabled",
        }),
    });
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity: null,
      triggerSource,
      reason: "skipped_auto_run_disabled",
    };
  }

  const enhancementInput = mapSegmentsToEnhancementInput(transcript.segments);
  if (enhancementInput.length === 0) {
    await writeMergedEnhancementMetadata({
      db,
      transcriptId: transcript.id,
      build: (current) =>
        buildSkipMetadata({
          metadata: current,
          triggerSource,
          inputIdentity: null,
          reason: "skipped_empty_transcript",
        }),
    });
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity: null,
      triggerSource,
      reason: "skipped_empty_transcript",
    };
  }

  const hasCanonicalText = enhancementInput.some(
    (segment) => segment.originalText.trim().length > 0,
  );
  if (!hasCanonicalText) {
    await writeMergedEnhancementMetadata({
      db,
      transcriptId: transcript.id,
      build: (current) =>
        buildSkipMetadata({
          metadata: current,
          triggerSource,
          inputIdentity: null,
          reason: "skipped_empty_raw_text",
        }),
    });
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity: null,
      triggerSource,
      reason: "skipped_empty_raw_text",
    };
  }

  const rawHash = canonicalRawTextHash(enhancementInput);
  const inputIdentity = buildTranscriptEnhancementInputIdentity({
    transcriptId: transcript.id,
    rawSegmentsHash: rawHash,
    model: getYandexTranscriptEnhancementModel(),
    outputMode: getTranscriptEnhancementOutputMode(),
    schemaVersion: ENHANCEMENT_SCHEMA_VERSION,
    promptVersion: ENHANCEMENT_PROMPT_VERSION,
  });

  const currentEnhancement = asMetadata(metadata.transcriptEnhancement);
  const currentStatus = resolveEnhancementStatus(currentEnhancement.status);
  const currentIdentity = asIsoString(currentEnhancement.inputIdentity) ?? null;
  const runningStartedAt = parseTimestamp(currentEnhancement.startedAt);
  const isStaleRunning =
    currentStatus === "RUNNING" &&
    (runningStartedAt === null || nowMs - runningStartedAt.getTime() > timeoutMs);
  const sameIdentity = currentIdentity === inputIdentity;
  const alreadyTimedOutSkip =
    currentStatus === "SKIPPED" && currentEnhancement.skipReason === "timeout";

  if (sameIdentity && currentStatus === "COMPLETED" && !forceReenhancement) {
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
      reason: "skip_completed_same_identity",
    };
  }

  if (sameIdentity && alreadyTimedOutSkip && !forceReenhancement) {
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
      reason: "timed_out",
    };
  }

  if (sameIdentity && currentStatus === "RUNNING" && !isStaleRunning) {
    return {
      outcome: "already_running",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
    };
  }

  if (currentStatus === "RUNNING" && isStaleRunning && !forceReenhancement) {
    await persistEnhancementTimeoutSkip({
      db: db as never,
      transcriptId: transcript.id,
      runId: asIsoString(currentEnhancement.runId),
      inputIdentity: currentIdentity,
      retranscribeCount: transcript.retranscribeCount,
      nowMs,
    });
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
      reason: "timed_out",
    };
  }

  const idempotencyDecision: TranscriptEnhancementIdempotencyDecision =
    sameIdentity && isStaleRunning
      ? "recovered_stale_running"
      : forceReenhancement
        ? "manual_forced_rerun"
        : "started_new";

  const runId = randomUUID();
  const lockResult = await db.$transaction(async (tx) => {
    await lockTranscriptRowIfSupported(tx, transcript.id);
    const latest = await tx.transcript.findUnique({
      where: { id: transcript.id },
      select: { processingMetadata: true, updatedAt: true },
    });
    if (!latest) {
      return { count: 0 };
    }
    const latestEnhancement = asMetadata(
      asMetadata(latest.processingMetadata).transcriptEnhancement,
    );
    const latestStatus = resolveEnhancementStatus(latestEnhancement.status);
    if (
      latestStatus === "COMPLETED" &&
      latestEnhancement.inputIdentity === inputIdentity &&
      !forceReenhancement
    ) {
      return { count: 0, alreadyCompleted: true as const };
    }
    const latestRunningStartedAt = parseTimestamp(latestEnhancement.startedAt);
    const latestIsStaleRunning =
      latestStatus === "RUNNING" &&
      (latestRunningStartedAt === null ||
        nowMs - latestRunningStartedAt.getTime() > timeoutMs);
    if (
      latestStatus === "RUNNING" &&
      latestEnhancement.inputIdentity === inputIdentity &&
      !latestIsStaleRunning
    ) {
      return { count: 0 };
    }
    if (latestStatus === "RUNNING" && latestIsStaleRunning && !forceReenhancement) {
      await tx.transcript.update({
        where: { id: transcript.id },
        data: {
          processingMetadata: buildTimeoutSkipMetadata({
            metadata: asMetadata(latest.processingMetadata),
            nowMs,
          }) as Prisma.InputJsonValue,
        },
      });
      return { count: 0, timedOut: true as const };
    }
    const runningMetadata = buildRunningMetadata({
      metadata: asMetadata(latest.processingMetadata),
      triggerSource,
      inputIdentity,
      runId,
      idempotencyDecision,
    });
    return tx.transcript.updateMany({
      where: {
        id: transcript.id,
        updatedAt: latest.updatedAt,
      },
      data: {
        processingMetadata: runningMetadata as Prisma.InputJsonValue,
      },
    });
  });

  if ("alreadyCompleted" in lockResult && lockResult.alreadyCompleted) {
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
      reason: "skip_completed_same_identity",
    };
  }

  if ("timedOut" in lockResult && lockResult.timedOut) {
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
      reason: "timed_out",
    };
  }

  if (lockResult.count === 0) {
    return {
      outcome: "already_running",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
    };
  }

  const startedAtMs = nowMs;
  if (runInBackground) {
    void runEnhancementExecution({
      db,
      enhance,
      transcript,
      enhancementInput,
      triggerSource,
      inputIdentity,
      runId,
      startedAtMs,
      idempotencyDecision,
      timeoutMs,
      waitForTimeout,
    }).catch((backgroundError) => {
      console.warn(
        `[transcript-enhancement] background run failed for transcript ${transcript.id}: ${
          backgroundError instanceof Error
            ? backgroundError.message
            : "unknown error"
        }`,
      );
    });
  } else {
    await runEnhancementExecution({
      db,
      enhance,
      transcript,
      enhancementInput,
      triggerSource,
      inputIdentity,
      runId,
      startedAtMs,
      idempotencyDecision,
      timeoutMs,
      waitForTimeout,
    });
  }

  return {
    outcome: "started",
    transcriptId: transcript.id,
    inputIdentity,
    triggerSource,
  };
}
