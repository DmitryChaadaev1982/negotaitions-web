import {
  isEnhancementStatusRunning,
  isTranscriptEnhancementTerminal,
} from "@/lib/post-processing/projection";
import {
  getTranscriptEnhancementNamespace,
  isTranscriptEnhancementRunning,
} from "@/lib/transcription/processing-metadata";

export type TranscriptEnhancementUiStatus =
  | "NOT_AVAILABLE"
  | "IDLE"
  | "SUGGESTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED";

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Canonical materials/status enhancement vocabulary.
 * Persisted run status uses RUNNING; UI/API running is IN_PROGRESS.
 */
export function resolveTranscriptEnhancementStatus(
  processingMetadata: unknown,
): TranscriptEnhancementUiStatus {
  const metadata = asMetadata(processingMetadata);
  const enhancement = asMetadata(metadata.transcriptEnhancement);
  const recommendation = asMetadata(metadata.transcriptEnhancementRecommendation);
  const status = typeof enhancement.status === "string" ? enhancement.status : null;
  if (isEnhancementStatusRunning(status)) return "IN_PROGRESS";
  if (status === "FAILED") return "FAILED";
  if (status === "PARTIAL") return "PARTIAL";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "SKIPPED") return "SKIPPED";
  if (recommendation.suggested === true) return "SUGGESTED";
  if (metadata.transcriptionProvider === "yandex_speechkit") return "IDLE";
  return "NOT_AVAILABLE";
}

export function isEffectiveTranscriptEnhancementRunning(
  processingMetadata: unknown,
): boolean {
  return isEnhancementStatusRunning(
    resolveTranscriptEnhancementStatus(processingMetadata),
  );
}

/**
 * Effective RUNNING lock for the Recording & Transcription section.
 * Polled materials/status canonical status wins over a stale /recording snapshot.
 */
export function resolveTranscriptSectionEnhancementRunning(input: {
  canonicalEnhancementRunning?: boolean;
  canonicalEnhancementStatus?: string | null;
  localEnhancementStatus?: string | null;
  processingMetadata?: unknown;
}): boolean {
  if (typeof input.canonicalEnhancementRunning === "boolean") {
    return input.canonicalEnhancementRunning;
  }
  if (input.canonicalEnhancementStatus !== undefined) {
    return isEnhancementStatusRunning(input.canonicalEnhancementStatus);
  }
  return (
    isEnhancementStatusRunning(input.localEnhancementStatus) ||
    isTranscriptEnhancementRunning(input.processingMetadata)
  );
}

export function resolveTranscriptSectionEnhancementPresentation(input: {
  canonicalEnhancementRunning?: boolean;
  canonicalEnhancementStatus?: string | null;
  localEnhancementStatus?: string | null;
  processingMetadata?: unknown;
}): {
  running: boolean;
  terminal: boolean;
  status: string | null;
} {
  const namespace = getTranscriptEnhancementNamespace(input.processingMetadata);
  const status =
    input.canonicalEnhancementStatus !== undefined
      ? input.canonicalEnhancementStatus
      : input.localEnhancementStatus ??
        (typeof namespace.status === "string" ? namespace.status : null);
  const running = resolveTranscriptSectionEnhancementRunning(input);
  return {
    running,
    terminal: !running && isTranscriptEnhancementTerminal(status),
    status,
  };
}
