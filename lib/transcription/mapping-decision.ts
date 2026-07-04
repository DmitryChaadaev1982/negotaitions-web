export type AutoMappingDecision = {
  shouldApply: boolean;
  reason: string;
};

export function decideAutoMappingApplication(params: {
  allSpeakersCovered: boolean;
  highConfidence: boolean;
  weakMargin: boolean;
  mappingSafetySafe: boolean;
  mappingSafetyReason: string | null | undefined;
  telemetryWarnings: string[];
}): AutoMappingDecision {
  const telemetryBlocksAutoApply = params.telemetryWarnings.some((warning) =>
    [
      "missing_participant_coverage",
      "participant_low_activity",
      "telemetry_imbalanced",
      "alignment_unreliable",
    ].includes(warning),
  );

  const shouldApply =
    params.allSpeakersCovered &&
    params.highConfidence &&
    !params.weakMargin &&
    params.mappingSafetySafe &&
    !telemetryBlocksAutoApply;

  const reason = !params.allSpeakersCovered
    ? "partial_mapping_review_required"
    : !params.mappingSafetySafe
      ? params.mappingSafetyReason ?? "safety_review_required"
      : telemetryBlocksAutoApply
        ? "telemetry_quality_review_required"
        : params.weakMargin
          ? "low_margin_review_required"
          : !params.highConfidence
            ? "low_confidence_review_required"
            : "high_confidence_prefilled";

  return { shouldApply, reason };
}
