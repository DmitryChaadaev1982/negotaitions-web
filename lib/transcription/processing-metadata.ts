export type ProcessingMetadata = Record<string, unknown>;

export const PROCESSING_METADATA_ENHANCEMENT_NAMESPACE = "transcriptEnhancement" as const;
export const PROCESSING_METADATA_ENHANCEMENT_PUBLICATION_NAMESPACE =
  "transcriptEnhancementPublication" as const;
export const PROCESSING_METADATA_MAPPING_NAMESPACE = "mappingSuggestion" as const;
export const PROCESSING_METADATA_TRANSCRIPTION_CLAIM_NAMESPACE =
  "transcriptionClaim" as const;

export type ProcessingMetadataOwnedNamespace =
  | typeof PROCESSING_METADATA_ENHANCEMENT_NAMESPACE
  | typeof PROCESSING_METADATA_ENHANCEMENT_PUBLICATION_NAMESPACE
  | typeof PROCESSING_METADATA_MAPPING_NAMESPACE
  | typeof PROCESSING_METADATA_TRANSCRIPTION_CLAIM_NAMESPACE;

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
 *
 * Ownership:
 * - `transcriptEnhancement` — latest D1 enhancement attempt only
 * - `transcriptEnhancementPublication` — successful atomic publication,
 *   generation fence, and approved manual lexical invalidation only
 * - `mappingSuggestion` — mapping suggestion / auto-trigger mapping only
 * - `transcriptionClaim` — transcription admission only
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

/**
 * Replace one owned namespace while preserving every sibling key, including
 * unknown historical diagnostics. Callers must not pass a whole stale
 * `processingMetadata` snapshot as `patch`.
 */
export function patchProcessingMetadataNamespace(
  current: unknown,
  namespace: ProcessingMetadataOwnedNamespace,
  value: unknown,
): ProcessingMetadata {
  return mergeProcessingMetadata(current, { [namespace]: value });
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
  const ns = getTranscriptEnhancementNamespace(processingMetadata);
  const status = ns.status;
  const executionStatus = ns.executionStatus;
  return (
    status === "RUNNING" ||
    status === "IN_PROGRESS" ||
    status === "QUEUED" ||
    executionStatus === "RUNNING" ||
    executionStatus === "QUEUED"
  );
}

export const ENHANCEMENT_RUNNING_MATERIAL_LOCK_MESSAGE =
  "Transcript lexical text cannot be changed while enhancement is still eligible to publish.";

export const ENHANCEMENT_RUNNING_AI_LOCK_MESSAGE =
  "AI analysis cannot start while transcript enhancement is still eligible to publish.";
