type MappingFailureReason =
  | "unavailable:no_audio_activity"
  | "many_to_one"
  | "low_coverage"
  | "low_margin"
  | "missing_offsets"
  | "telemetry_imbalanced"
  | "no_safe_one_to_one"
  | "manual_review_required"
  | "unknown_mapping_failure";

const REASON_TO_I18N_KEY: Record<MappingFailureReason, string> = {
  "unavailable:no_audio_activity": "recording.mappingFailureReason.unavailableNoAudioActivity",
  many_to_one: "recording.mappingFailureReason.manyToOne",
  low_coverage: "recording.mappingFailureReason.lowCoverage",
  low_margin: "recording.mappingFailureReason.lowMargin",
  missing_offsets: "recording.mappingFailureReason.missingOffsets",
  telemetry_imbalanced: "recording.mappingFailureReason.telemetryImbalanced",
  no_safe_one_to_one: "recording.mappingFailureReason.noSafeOneToOne",
  manual_review_required: "recording.mappingFailureReason.manualReviewRequired",
  unknown_mapping_failure: "recording.mappingFailureReason.unknownMappingFailure",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function mapFromWarnings(warnings: string[]): MappingFailureReason | null {
  if (warnings.includes("no_activity_for_participant")) {
    return "unavailable:no_audio_activity";
  }
  if (warnings.includes("missing_offsets")) {
    return "missing_offsets";
  }
  if (
    warnings.includes("telemetry_imbalanced") ||
    warnings.includes("row_imbalance") ||
    warnings.includes("duration_imbalance")
  ) {
    return "telemetry_imbalanced";
  }
  if (warnings.includes("low_activity_for_participant")) {
    return "low_coverage";
  }
  return null;
}

export function resolveMappingFailure(payload: {
  speakerMappingStatus: string | null | undefined;
  processingMetadata: unknown;
}) {
  const metadata = asRecord(payload.processingMetadata);
  const suggestion = asRecord(metadata.mappingSuggestion);
  const rawReason =
    typeof suggestion.reason === "string" && suggestion.reason.trim().length > 0
      ? suggestion.reason.trim()
      : null;
  const unavailableReason =
    typeof suggestion.unavailableReason === "string" &&
    suggestion.unavailableReason.trim().length > 0
      ? suggestion.unavailableReason.trim()
      : null;
  const telemetryQuality = asRecord(suggestion.telemetryQuality);
  const warnings = Array.isArray(telemetryQuality.warnings)
    ? telemetryQuality.warnings.filter((value): value is string => typeof value === "string")
    : [];

  let normalized: MappingFailureReason | null = null;
  if (rawReason === "unavailable:no_audio_activity" || unavailableReason === "no_audio_activity") {
    normalized = "unavailable:no_audio_activity";
  } else if (
    rawReason === "many_to_one_mapping_in_multi_participant_session" ||
    rawReason === "many_to_one_requires_manual_review_single_device" ||
    rawReason === "many_to_one"
  ) {
    normalized = "many_to_one";
  } else if (rawReason === "telemetry_coverage_review_required" || rawReason === "low_coverage") {
    normalized = "low_coverage";
  } else if (rawReason === "low_margin" || rawReason === "weak_margin_requires_review") {
    normalized = "low_margin";
  } else if (rawReason === "telemetry_offsets_review_required" || rawReason === "missing_offsets") {
    normalized = "missing_offsets";
  } else if (
    rawReason === "telemetry_quality_review_required" ||
    rawReason === "telemetry_imbalanced"
  ) {
    normalized = "telemetry_imbalanced";
  } else if (rawReason === "no_safe_one_to_one") {
    normalized = "no_safe_one_to_one";
  } else if (
    rawReason === "manual_review_required" ||
    rawReason === "required_manual_confirmation"
  ) {
    normalized = "manual_review_required";
  } else {
    normalized = mapFromWarnings(warnings);
  }

  const requiresManual =
    payload.speakerMappingStatus === "REQUIRED" || payload.speakerMappingStatus === "NEEDS_REVIEW";
  const effectiveReason = normalized ?? (requiresManual ? "unknown_mapping_failure" : null);
  const i18nKey = effectiveReason ? REASON_TO_I18N_KEY[effectiveReason] : null;
  const compactI18nKey = effectiveReason
    ? effectiveReason === "unavailable:no_audio_activity"
      ? "recording.mappingFailureCompact.noAudioActivity"
      : "recording.mappingFailureCompact.generic"
    : null;

  return {
    mappingFailureReason: effectiveReason,
    mappingFailureI18nKey: i18nKey,
    mappingFailureCompactI18nKey: compactI18nKey,
    mappingFailureDetails: {
      rawReason,
      unavailableReason,
      warnings,
      telemetryQuality,
    },
    mappingSuggestionDiagnostics: suggestion,
  };
}
