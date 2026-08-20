import { resolveMappingFailure } from "@/lib/transcription/mapping-failure-reasons";

export function resolvePrimaryMappingReasonI18nKey(params: {
  speakerMappingStatus: string | null | undefined;
  mappingFailureI18nKey: string | null | undefined;
  mappingFailureCompactI18nKey: string | null | undefined;
  mappingSuggestionDiagnostics: Record<string, unknown> | null | undefined;
}): string | null {
  if (
    typeof params.mappingFailureI18nKey === "string" &&
    params.mappingFailureI18nKey.trim().length > 0
  ) {
    return params.mappingFailureI18nKey;
  }

  const fromDiagnostics = resolveMappingFailure({
    speakerMappingStatus: params.speakerMappingStatus,
    processingMetadata: {
      mappingSuggestion: params.mappingSuggestionDiagnostics ?? null,
    },
  }).mappingFailureI18nKey;

  if (fromDiagnostics) {
    return fromDiagnostics;
  }

  if (
    typeof params.mappingFailureCompactI18nKey === "string" &&
    params.mappingFailureCompactI18nKey.trim().length > 0
  ) {
    return params.mappingFailureCompactI18nKey;
  }

  return null;
}

export function resolveSpeakerMappingStatusDescriptionKey(params: {
  speakerMappingStatus: string | null | undefined;
  hasSuggestedMapping: boolean;
}): string | null {
  if (params.speakerMappingStatus === "REQUIRED" || params.speakerMappingStatus === "NEEDS_REVIEW") {
    return params.hasSuggestedMapping
      ? "recording.mappingStatusDescription.reviewWithSuggestion"
      : "recording.mappingStatusDescription.reviewWithoutSuggestion";
  }

  if (params.speakerMappingStatus === "PARTIALLY_MAPPED") {
    return "recording.mappingStatusDescription.partiallyMapped";
  }

  if (params.speakerMappingStatus === "AUTO_SUGGESTED") {
    return "recording.mappingStatusDescription.appliedNeedsConfirmation";
  }

  return null;
}
