import { TranscriptStatus } from "@/app/generated/prisma/client";
import {
  isTranscriptEnhancementAutoRunEnabled,
  isYandexTranscriptEnhancementEnabled,
} from "@/lib/env";
import type {
  AiAnalysisRequestResult,
  AiAnalysisTriggerSource,
} from "@/lib/services/ai-analysis-orchestration";
import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";

type ProcessingMetadata = Record<string, unknown>;

function asMetadata(value: unknown): ProcessingMetadata {
  return value && typeof value === "object" ? (value as ProcessingMetadata) : {};
}

export type TranscriptEnhancementStatus =
  | "NOT_AVAILABLE"
  | "IDLE"
  | "SUGGESTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED";

type EnhancementRawStatus =
  | "RUNNING"
  | "IN_PROGRESS"
  | "QUEUED"
  | "PENDING"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED"
  | "UNKNOWN";

type EnhancementAttemptState =
  | "NOT_STARTED"
  | "QUEUED"
  | "RUNNING"
  | "TERMINAL"
  | "UNKNOWN";

type TerminalSkipReason =
  | "skipped_disabled"
  | "skipped_auto_run_disabled"
  | "skipped_not_yandex"
  | "skipped_empty_transcript"
  | "skipped_empty_raw_text"
  | "skip_completed_same_identity"
  | "provider_skipped";

const TERMINAL_SKIP_REASONS = new Set<TerminalSkipReason>([
  "skipped_disabled",
  "skipped_auto_run_disabled",
  "skipped_not_yandex",
  "skipped_empty_transcript",
  "skipped_empty_raw_text",
  "skip_completed_same_identity",
  "provider_skipped",
]);

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function resolveTranscriptEnhancementStatus(
  processingMetadata: unknown,
): TranscriptEnhancementStatus {
  const metadata = asMetadata(processingMetadata);
  const enhancement = asMetadata(metadata.transcriptEnhancement);
  const recommendation = asMetadata(metadata.transcriptEnhancementRecommendation);
  const status = enhancement.status;

  if (status === "IN_PROGRESS" || status === "RUNNING") return "IN_PROGRESS";
  if (status === "FAILED") return "FAILED";
  if (status === "PARTIAL") return "PARTIAL";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "SKIPPED") return "SKIPPED";
  if (recommendation.suggested === true) return "SUGGESTED";
  if (metadata.transcriptionProvider === "yandex_speechkit") return "IDLE";
  return "NOT_AVAILABLE";
}

function resolveEnhancementRawStatus(processingMetadata: unknown): EnhancementRawStatus {
  const metadata = asMetadata(processingMetadata);
  const enhancement = asMetadata(metadata.transcriptEnhancement);
  const raw = asString(enhancement.status)?.toUpperCase();
  if (raw === "RUNNING") return "RUNNING";
  if (raw === "IN_PROGRESS") return "IN_PROGRESS";
  if (raw === "QUEUED") return "QUEUED";
  if (raw === "PENDING") return "PENDING";
  if (raw === "COMPLETED") return "COMPLETED";
  if (raw === "PARTIAL") return "PARTIAL";
  if (raw === "FAILED") return "FAILED";
  if (raw === "SKIPPED") return "SKIPPED";
  return "UNKNOWN";
}

function resolveEnhancementAttemptState(processingMetadata: unknown): EnhancementAttemptState {
  const rawStatus = resolveEnhancementRawStatus(processingMetadata);
  if (rawStatus === "QUEUED" || rawStatus === "PENDING") return "QUEUED";
  if (rawStatus === "RUNNING" || rawStatus === "IN_PROGRESS") return "RUNNING";
  if (
    rawStatus === "COMPLETED" ||
    rawStatus === "PARTIAL" ||
    rawStatus === "FAILED" ||
    rawStatus === "SKIPPED"
  ) {
    return "TERMINAL";
  }
  const metadata = asMetadata(processingMetadata);
  const enhancement = asMetadata(metadata.transcriptEnhancement);
  if (
    asString(enhancement.queuedAt) ||
    asString(enhancement.startedAt) ||
    asString(enhancement.finishedAt) ||
    asString(enhancement.completedAt)
  ) {
    return "UNKNOWN";
  }
  return "NOT_STARTED";
}

function resolveEnhancementSkipReason(
  processingMetadata: unknown,
): string | null {
  const metadata = asMetadata(processingMetadata);
  const enhancement = asMetadata(metadata.transcriptEnhancement);
  return asString(enhancement.skipReason);
}

function hasTerminalFailurePersistence(processingMetadata: unknown): boolean {
  const metadata = asMetadata(processingMetadata);
  const enhancement = asMetadata(metadata.transcriptEnhancement);
  return Boolean(asString(enhancement.finishedAt) || asString(enhancement.completedAt));
}

export type EnhancementReadinessResult =
  | { code: "READY_ENHANCED"; canRequestAnalysis: true }
  | { code: "READY_PARTIAL"; canRequestAnalysis: true }
  | { code: "READY_ORIGINAL_AFTER_FAILURE"; canRequestAnalysis: true }
  | { code: "READY_ENHANCEMENT_DISABLED"; canRequestAnalysis: true }
  | { code: "READY_AUTO_RUN_DISABLED"; canRequestAnalysis: true }
  | { code: "READY_TERMINAL_SKIP"; canRequestAnalysis: true; skipReason: string | null }
  | { code: "READY_NOT_AVAILABLE_TERMINAL"; canRequestAnalysis: true; reason: string }
  | { code: "WAITING_FOR_ENHANCEMENT"; canRequestAnalysis: false }
  | { code: "ENHANCEMENT_RUNNING"; canRequestAnalysis: false }
  | { code: "ENHANCEMENT_QUEUED"; canRequestAnalysis: false }
  | { code: "INVALID_STATE"; canRequestAnalysis: false; reason: string };

export function getEnhancementReadinessForAnalysis(params: {
  enhancementEnabled: boolean;
  enhancementAutoRun: boolean;
  enhancementStatus: TranscriptEnhancementStatus;
  enhancementSkipReason: string | null;
  enhancementAttemptState: EnhancementAttemptState;
  transcriptionProvider: string | null;
  failureStatePersisted: boolean;
}): EnhancementReadinessResult {
  if (!params.enhancementEnabled) {
    return { code: "READY_ENHANCEMENT_DISABLED", canRequestAnalysis: true };
  }

  if (!params.enhancementAutoRun) {
    return { code: "READY_AUTO_RUN_DISABLED", canRequestAnalysis: true };
  }

  if (params.enhancementAttemptState === "QUEUED") {
    return { code: "ENHANCEMENT_QUEUED", canRequestAnalysis: false };
  }
  if (params.enhancementAttemptState === "RUNNING") {
    return { code: "ENHANCEMENT_RUNNING", canRequestAnalysis: false };
  }

  if (params.enhancementStatus === "COMPLETED") {
    return { code: "READY_ENHANCED", canRequestAnalysis: true };
  }
  if (params.enhancementStatus === "PARTIAL") {
    return { code: "READY_PARTIAL", canRequestAnalysis: true };
  }
  if (params.enhancementStatus === "FAILED") {
    if (!params.failureStatePersisted) {
      return {
        code: "INVALID_STATE",
        canRequestAnalysis: false,
        reason: "failed_without_terminal_persistence",
      };
    }
    return { code: "READY_ORIGINAL_AFTER_FAILURE", canRequestAnalysis: true };
  }
  if (params.enhancementStatus === "SKIPPED") {
    if (
      params.enhancementSkipReason &&
      TERMINAL_SKIP_REASONS.has(params.enhancementSkipReason as TerminalSkipReason)
    ) {
      return {
        code: "READY_TERMINAL_SKIP",
        canRequestAnalysis: true,
        skipReason: params.enhancementSkipReason,
      };
    }
    return {
      code: "INVALID_STATE",
      canRequestAnalysis: false,
      reason: `non_terminal_skip_reason:${params.enhancementSkipReason ?? "unknown"}`,
    };
  }
  if (params.enhancementStatus === "NOT_AVAILABLE") {
    if (params.transcriptionProvider !== "yandex_speechkit") {
      return {
        code: "READY_NOT_AVAILABLE_TERMINAL",
        canRequestAnalysis: true,
        reason: "provider_not_yandex",
      };
    }
    return {
      code: "INVALID_STATE",
      canRequestAnalysis: false,
      reason: "not_available_unresolved",
    };
  }
  if (
    params.enhancementStatus === "IDLE" ||
    params.enhancementStatus === "SUGGESTED"
  ) {
    return { code: "WAITING_FOR_ENHANCEMENT", canRequestAnalysis: false };
  }
  if (params.enhancementStatus === "IN_PROGRESS") {
    return { code: "ENHANCEMENT_RUNNING", canRequestAnalysis: false };
  }

  return {
    code: "INVALID_STATE",
    canRequestAnalysis: false,
    reason: "unclassified_state",
  };
}

export function getEnhancementReadinessForAnalysisFromMetadata(params: {
  processingMetadata: unknown;
  enhancementEnabled: boolean;
  enhancementAutoRun: boolean;
}): EnhancementReadinessResult {
  const metadata = asMetadata(params.processingMetadata);
  const transcriptionProvider = asString(metadata.transcriptionProvider);
  const enhancementStatus = resolveTranscriptEnhancementStatus(params.processingMetadata);
  return getEnhancementReadinessForAnalysis({
    enhancementEnabled: params.enhancementEnabled,
    enhancementAutoRun: params.enhancementAutoRun,
    enhancementStatus,
    enhancementSkipReason: resolveEnhancementSkipReason(params.processingMetadata),
    enhancementAttemptState: resolveEnhancementAttemptState(params.processingMetadata),
    transcriptionProvider,
    failureStatePersisted: hasTerminalFailurePersistence(params.processingMetadata),
  });
}

export type AutoAiTriggerResult =
  | { outcome: "started"; request: AiAnalysisRequestResult }
  | { outcome: "skipped"; reason: string; readiness?: EnhancementReadinessResult };

type RequestAnalysisFn = (args: {
  sessionId: string;
  triggerSource: AiAnalysisTriggerSource;
  runInBackground: boolean;
  forceRerun?: boolean;
  language?: string;
}) => Promise<AiAnalysisRequestResult>;

export async function maybeRequestAutomaticAiAnalysis(params: {
  sessionId: string;
  triggerSource: AiAnalysisTriggerSource;
  dependencies?: {
    findTranscript?: (args: {
      where: { sessionId: string };
      select: {
        status: true;
        hasSpeakerDiarization: true;
        speakerMappingStatus: true;
        speakerMapping: true;
        processingMetadata: true;
        segments: {
          select: {
            speakerLabel: true;
            mappedParticipantId: true;
            text: true;
          };
        };
      };
    }) => Promise<{
      status: TranscriptStatus;
      hasSpeakerDiarization: boolean;
      speakerMappingStatus: string | null;
      speakerMapping: unknown;
      processingMetadata: unknown;
      segments: Array<{
        speakerLabel: string | null;
        mappedParticipantId: string | null;
        text: string;
      }>;
    } | null>;
    requestAnalysis?: RequestAnalysisFn;
  };
}): Promise<AutoAiTriggerResult> {
  const findTranscript =
    params.dependencies?.findTranscript ??
    (async (args: {
      where: { sessionId: string };
      select: {
        status: true;
        hasSpeakerDiarization: true;
        speakerMappingStatus: true;
        speakerMapping: true;
        processingMetadata: true;
        segments: {
          select: {
            speakerLabel: true;
            mappedParticipantId: true;
            text: true;
          };
        };
      };
    }) => {
      const { prisma } = await import("@/lib/prisma");
      return prisma.transcript.findUnique(args);
    });
  const requestAnalysis =
    params.dependencies?.requestAnalysis ??
    (async (args) => {
      const { requestSessionAiAnalysis } = await import(
        "@/lib/services/ai-analysis-orchestration"
      );
      return requestSessionAiAnalysis(args);
    }) satisfies RequestAnalysisFn;

  const transcript = await findTranscript({
    where: { sessionId: params.sessionId },
    select: {
      status: true,
      hasSpeakerDiarization: true,
      speakerMappingStatus: true,
      speakerMapping: true,
      processingMetadata: true,
      segments: {
        select: {
          speakerLabel: true,
          mappedParticipantId: true,
          text: true,
        },
      },
    },
  });
  if (!transcript || transcript.status !== TranscriptStatus.COMPLETED) {
    return { outcome: "skipped", reason: "transcript_not_ready" };
  }

  const mappingReady = isSpeakerMappingReadyForAnalysis(transcript);
  if (!mappingReady) {
    return { outcome: "skipped", reason: "speaker_mapping_not_ready" };
  }

  const readiness = getEnhancementReadinessForAnalysisFromMetadata({
    processingMetadata: transcript.processingMetadata,
    enhancementEnabled: isYandexTranscriptEnhancementEnabled(),
    enhancementAutoRun: isTranscriptEnhancementAutoRunEnabled(),
  });
  if (!readiness.canRequestAnalysis) {
    return {
      outcome: "skipped",
      reason: "enhancement_not_ready_for_analysis",
      readiness,
    };
  }

  const request = await requestAnalysis({
    sessionId: params.sessionId,
    triggerSource: params.triggerSource,
    runInBackground: true,
    forceRerun: false,
  });
  return { outcome: "started", request };
}
