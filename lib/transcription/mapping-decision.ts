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
  rawSpeakerCount: number;
  expectedParticipantCount: number;
  activeParticipantsDuringRecording: number;
  hasOffsets: boolean;
  hasDerivedOffsets: boolean;
  telemetryWarnings: string[];
}): AutoMappingDecision {
  const telemetryBlocksAutoApply = params.telemetryWarnings.some((warning) =>
    [
      "missing_participant_coverage",
      "participant_low_activity",
      "telemetry_imbalanced",
      "alignment_unreliable",
      "no_activity_for_participant",
      "low_activity_for_participant",
      "row_imbalance",
      "duration_imbalance",
    ].includes(warning),
  );
  const speakerCountCompatible =
    params.rawSpeakerCount > 0 &&
    params.expectedParticipantCount > 0 &&
    params.rawSpeakerCount <= params.expectedParticipantCount;
  const enoughActiveParticipants = params.activeParticipantsDuringRecording >= 2;
  const offsetsUsable = params.hasOffsets || params.hasDerivedOffsets;

  const shouldApply =
    speakerCountCompatible &&
    params.allSpeakersCovered &&
    params.highConfidence &&
    !params.weakMargin &&
    params.mappingSafetySafe &&
    !telemetryBlocksAutoApply &&
    enoughActiveParticipants &&
    offsetsUsable;

  const reason = !speakerCountCompatible
    ? "speaker_count_mismatch_review_required"
    : !params.allSpeakersCovered
    ? "partial_mapping_review_required"
    : !params.mappingSafetySafe
      ? params.mappingSafetyReason ?? "safety_review_required"
      : !enoughActiveParticipants
        ? "telemetry_coverage_review_required"
        : !offsetsUsable
          ? "telemetry_offsets_review_required"
      : telemetryBlocksAutoApply
        ? "telemetry_quality_review_required"
        : params.weakMargin
          ? "low_margin_review_required"
          : !params.highConfidence
            ? "low_confidence_review_required"
            : "high_confidence_prefilled";

  return { shouldApply, reason };
}
