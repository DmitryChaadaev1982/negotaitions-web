export type ProcessingMetadata = Record<string, unknown>;

export function asProcessingMetadata(value: unknown): ProcessingMetadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as ProcessingMetadata) }
    : {};
}

/**
 * Shallow-merge a processingMetadata patch onto the latest snapshot.
 * Unknown/historical top-level keys are preserved unless the patch
 * explicitly replaces that key. Nested namespace objects in the patch
 * replace only that namespace; callers must merge inside a namespace
 * before patching when they need to keep sibling fields there.
 */
export function mergeProcessingMetadata(
  current: unknown,
  patch: ProcessingMetadata,
): ProcessingMetadata {
  return {
    ...asProcessingMetadata(current),
    ...patch,
  };
}

export function getTranscriptEnhancementNamespace(
  processingMetadata: unknown,
): ProcessingMetadata {
  return asProcessingMetadata(
    asProcessingMetadata(processingMetadata).transcriptEnhancement,
  );
}

export function isTranscriptEnhancementRunning(
  processingMetadata: unknown,
): boolean {
  const status = getTranscriptEnhancementNamespace(processingMetadata).status;
  return status === "RUNNING" || status === "IN_PROGRESS" || status === "QUEUED";
}

export const ENHANCEMENT_RUNNING_MATERIAL_LOCK_MESSAGE =
  "Transcript material cannot be changed while enhancement is running.";

export const ENHANCEMENT_RUNNING_AI_LOCK_MESSAGE =
  "AI analysis cannot start while transcript enhancement is running.";
