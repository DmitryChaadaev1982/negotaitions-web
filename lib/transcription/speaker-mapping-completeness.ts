export type SpeakerMappingCompletenessParticipant = {
  id: string;
  type: string;
};

export type SpeakerMappingCompletenessSegment = {
  text?: string | null;
  speakerLabel?: string | null;
  mappedParticipantId?: string | null;
};

export type SpeakerMappingCompletenessInput = {
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string | null;
  segments: SpeakerMappingCompletenessSegment[];
  participants: SpeakerMappingCompletenessParticipant[];
};

export type SpeakerMappingCompletenessReason =
  | "NOT_REQUIRED"
  | "REVIEW_REQUIRED"
  | "COMPLETE"
  | "INCOMPLETE_UNMAPPED"
  | "INCOMPLETE_MISSING_LABEL"
  | "INCOMPLETE_INVALID_PARTICIPANT"
  | "INCOMPLETE_INELIGIBLE_PARTICIPANT";

export type SpeakerMappingCompleteness = {
  structurallyComplete: boolean;
  readyForAnalysis: boolean;
  reviewRequired: boolean;
  reason: SpeakerMappingCompletenessReason;
};

function isEligibleNegotiationSpeaker(type: string): boolean {
  return type === "PARTICIPANT";
}

/**
 * Canonical speaker-mapping structural completeness.
 * Do not substitute mappingSuggestion.isApplied, cluster JSON, a client draft,
 * or the AUTO_SUGGESTED string alone.
 */
export function evaluateSpeakerMappingStructuralCompleteness(
  input: SpeakerMappingCompletenessInput,
): SpeakerMappingCompleteness {
  const status = input.speakerMappingStatus;
  if (status === "REQUIRED" || status === "NEEDS_REVIEW") {
    return {
      structurallyComplete: false,
      readyForAnalysis: false,
      reviewRequired: true,
      reason: "REVIEW_REQUIRED",
    };
  }

  if (!input.hasSpeakerDiarization || status === "NOT_REQUIRED") {
    return {
      structurallyComplete: true,
      readyForAnalysis: true,
      reviewRequired: false,
      reason: "NOT_REQUIRED",
    };
  }

  const spokenSegments = input.segments.filter((segment) => Boolean(segment.text?.trim()));
  if (spokenSegments.length === 0) {
    return {
      structurallyComplete: true,
      readyForAnalysis: true,
      reviewRequired: false,
      reason: "COMPLETE",
    };
  }

  const participantsById = new Map(
    input.participants.map((participant) => [participant.id, participant]),
  );

  for (const segment of spokenSegments) {
    if (!segment.speakerLabel?.trim()) {
      return {
        structurallyComplete: false,
        readyForAnalysis: false,
        reviewRequired: false,
        reason: "INCOMPLETE_MISSING_LABEL",
      };
    }

    const mappedParticipantId = segment.mappedParticipantId?.trim() ?? "";
    if (!mappedParticipantId) {
      return {
        structurallyComplete: false,
        readyForAnalysis: false,
        reviewRequired: false,
        reason: "INCOMPLETE_UNMAPPED",
      };
    }

    const participant = participantsById.get(mappedParticipantId);
    if (!participant) {
      return {
        structurallyComplete: false,
        readyForAnalysis: false,
        reviewRequired: false,
        reason: "INCOMPLETE_INVALID_PARTICIPANT",
      };
    }

    if (!isEligibleNegotiationSpeaker(participant.type)) {
      return {
        structurallyComplete: false,
        readyForAnalysis: false,
        reviewRequired: false,
        reason: "INCOMPLETE_INELIGIBLE_PARTICIPANT",
      };
    }
  }

  return {
    structurallyComplete: true,
    readyForAnalysis: true,
    reviewRequired: false,
    reason: "COMPLETE",
  };
}
