import { createHash } from "node:crypto";

import { Prisma } from "@/app/generated/prisma/client";
import {
  getTranscriptEnhancementOutputMode,
  getYandexTranscriptEnhancementModel,
  isTranscriptEnhancementAutoRunEnabled,
  isYandexTranscriptEnhancementEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
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
import { maybeRequestAutomaticAiAnalysis } from "@/lib/services/auto-ai-analysis-trigger";
import { buildDiarizedText } from "@/lib/transcription/speaker-labels";

const ENHANCEMENT_SCHEMA_VERSION = "v1";
const ENHANCEMENT_PROMPT_VERSION = "stage-3.9f-auto-enhancement-v1";
const ENHANCEMENT_RUNNING_STALE_MS = 10 * 60 * 1000;

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
  | "manual_forced_rerun"
  | "skipped_not_yandex"
  | "skipped_disabled"
  | "skipped_auto_run_disabled"
  | "skipped_empty_transcript"
  | "skipped_empty_raw_text"
  | "lock_lost";

type ProcessingMetadata = Record<string, unknown>;
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
  text: string;
  diarizedText: string | null;
  updatedAt: Date;
  processingMetadata: unknown;
  retranscribeCount: number | null;
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
};

type TranscriptEnhancementDependencies = {
  db: TranscriptEnhancementDbClient;
  enhance: typeof enhanceTranscriptWithYandexAi;
  maybeRequestAutoAi: typeof maybeRequestAutomaticAiAnalysis;
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

function isAutomaticTriggerSource(triggerSource: TranscriptEnhancementTriggerSource): boolean {
  return (
    triggerSource === "automatic_initial_transcription" ||
    triggerSource === "automatic_retranscription"
  );
}

function asMetadata(value: unknown): ProcessingMetadata {
  return value && typeof value === "object" ? (value as ProcessingMetadata) : {};
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

async function runEnhancementExecution(params: {
  db: TranscriptEnhancementDbClient;
  enhance: typeof enhanceTranscriptWithYandexAi;
  maybeRequestAutoAi: typeof maybeRequestAutomaticAiAnalysis;
  transcript: LoadedTranscriptForEnhancement;
  enhancementInput: TranscriptEnhancementInputSegment[];
  triggerSource: TranscriptEnhancementTriggerSource;
  inputIdentity: string;
  startedAtMs: number;
  idempotencyDecision: TranscriptEnhancementIdempotencyDecision;
}): Promise<void> {
  const {
    db,
    enhance,
    maybeRequestAutoAi,
    transcript,
    enhancementInput,
    triggerSource,
    inputIdentity,
    startedAtMs,
    idempotencyDecision,
  } = params;

  try {
    const enhanced = await enhance(enhancementInput);
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
    const enhancedDiarizedText =
      normalizedSegments.length > 0
        ? buildDiarizedText(normalizedSegments)
        : transcript.diarizedText;

    await db.$transaction(async (tx) => {
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

      const latest = await tx.transcript.findUnique({
        where: { id: transcript.id },
        select: { processingMetadata: true },
      });
      const latestMetadata = asMetadata(latest?.processingMetadata);
      const completedMetadata = buildCompletedMetadata({
        metadata: latestMetadata,
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
    await maybeRequestAutoAi({
      sessionId: transcript.sessionId,
      triggerSource: "enhancement_terminal",
    });
  } catch (error) {
    const latest = await db.transcript.findUnique({
      where: { id: transcript.id },
      select: { processingMetadata: true },
    });
    const latestMetadata = asMetadata(latest?.processingMetadata);
    const failedMetadata = buildFailedMetadata({
      metadata: latestMetadata,
      triggerSource,
      inputIdentity,
      startedAtMs,
      idempotencyDecision,
      error,
    });
    await db.transcript.update({
      where: { id: transcript.id },
      data: {
        processingMetadata: failedMetadata as Prisma.InputJsonValue,
      },
    });
    await maybeRequestAutoAi({
      sessionId: transcript.sessionId,
      triggerSource: "enhancement_terminal",
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
  const maybeRequestAutoAi =
    dependencies?.maybeRequestAutoAi ?? maybeRequestAutomaticAiAnalysis;

  const transcript = (await db.transcript.findUnique({
    where: { id: transcriptId },
    select: {
      id: true,
      sessionId: true,
      text: true,
      diarizedText: true,
      updatedAt: true,
      processingMetadata: true,
      retranscribeCount: true,
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
    const nextMetadata = buildSkipMetadata({
      metadata,
      triggerSource,
      inputIdentity: null,
      reason: "skipped_not_yandex",
    });
    await db.transcript.update({
      where: { id: transcript.id },
      data: { processingMetadata: nextMetadata as Prisma.InputJsonValue },
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
    const nextMetadata = buildSkipMetadata({
      metadata,
      triggerSource,
      inputIdentity: null,
      reason: "skipped_disabled",
    });
    await db.transcript.update({
      where: { id: transcript.id },
      data: { processingMetadata: nextMetadata as Prisma.InputJsonValue },
    });
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity: null,
      triggerSource,
      reason: "skipped_disabled",
    };
  }

  if (isAutomaticTriggerSource(triggerSource) && !isTranscriptEnhancementAutoRunEnabled()) {
    const nextMetadata = buildSkipMetadata({
      metadata,
      triggerSource,
      inputIdentity: null,
      reason: "skipped_auto_run_disabled",
    });
    await db.transcript.update({
      where: { id: transcript.id },
      data: { processingMetadata: nextMetadata as Prisma.InputJsonValue },
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
    const nextMetadata = buildSkipMetadata({
      metadata,
      triggerSource,
      inputIdentity: null,
      reason: "skipped_empty_transcript",
    });
    await db.transcript.update({
      where: { id: transcript.id },
      data: { processingMetadata: nextMetadata as Prisma.InputJsonValue },
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
    const nextMetadata = buildSkipMetadata({
      metadata,
      triggerSource,
      inputIdentity: null,
      reason: "skipped_empty_raw_text",
    });
    await db.transcript.update({
      where: { id: transcript.id },
      data: { processingMetadata: nextMetadata as Prisma.InputJsonValue },
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
    runningStartedAt !== null &&
    Date.now() - runningStartedAt.getTime() > ENHANCEMENT_RUNNING_STALE_MS;
  const sameIdentity = currentIdentity === inputIdentity;

  if (sameIdentity && currentStatus === "COMPLETED" && !forceReenhancement) {
    const skippedMetadata = buildSkipMetadata({
      metadata,
      triggerSource,
      inputIdentity,
      reason: "skip_completed_same_identity",
    });
    await db.transcript.update({
      where: { id: transcript.id },
      data: { processingMetadata: skippedMetadata as Prisma.InputJsonValue },
    });
    return {
      outcome: "skipped",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
      reason: "skip_completed_same_identity",
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

  const idempotencyDecision: TranscriptEnhancementIdempotencyDecision =
    sameIdentity && isStaleRunning
      ? "recovered_stale_running"
      : forceReenhancement
        ? "manual_forced_rerun"
        : "started_new";

  const runningMetadata = buildRunningMetadata({
    metadata,
    triggerSource,
    inputIdentity,
    idempotencyDecision,
  });

  const lockResult = await db.transcript.updateMany({
    where: {
      id: transcript.id,
      updatedAt: transcript.updatedAt,
    },
    data: {
      processingMetadata: runningMetadata as Prisma.InputJsonValue,
    },
  });

  if (lockResult.count === 0) {
    return {
      outcome: "already_running",
      transcriptId: transcript.id,
      inputIdentity,
      triggerSource,
    };
  }

  const startedAtMs = Date.now();
  if (runInBackground) {
    void runEnhancementExecution({
      db,
      enhance,
      maybeRequestAutoAi,
      transcript,
      enhancementInput,
      triggerSource,
      inputIdentity,
      startedAtMs,
      idempotencyDecision,
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
      maybeRequestAutoAi,
      transcript,
      enhancementInput,
      triggerSource,
      inputIdentity,
      startedAtMs,
      idempotencyDecision,
    });
  }

  return {
    outcome: "started",
    transcriptId: transcript.id,
    inputIdentity,
    triggerSource,
  };
}
