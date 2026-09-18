import {
  isEnhancementStatusRunning,
  isTranscriptEnhancementTerminal,
} from "@/lib/post-processing/projection";
import { projectTranscriptEnhancementStatus } from "@/lib/services/transcript-enhancement-job";
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

/**
 * Canonical materials/status enhancement vocabulary.
 * Persisted run status uses RUNNING; UI/API running is IN_PROGRESS.
 */
export function resolveTranscriptEnhancementStatus(
  processingMetadata: unknown,
): TranscriptEnhancementUiStatus {
  return projectTranscriptEnhancementStatus(processingMetadata).uiStatus;
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
