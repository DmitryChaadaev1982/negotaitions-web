import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

export type MappingConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

type MappingDiagnostics = {
  reason?: unknown;
  candidateMapping?: unknown;
  selectedMapping?: unknown;
  candidateConfidence?: unknown;
  confidence?: unknown;
  minConfidence?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeMapping(value: unknown): SpeakerMapping {
  const mappingObject = asRecord(value);
  const normalized: SpeakerMapping = {};

  for (const [speakerLabel, participantId] of Object.entries(mappingObject)) {
    normalized[speakerLabel] =
      typeof participantId === "string" && participantId.trim().length > 0
        ? participantId
        : null;
  }

  return normalized;
}

function normalizeConfidenceMap(value: unknown): Record<string, number> {
  const map = asRecord(value);
  const normalized: Record<string, number> = {};

  for (const [speakerLabel, confidence] of Object.entries(map)) {
    if (typeof confidence === "number" && Number.isFinite(confidence)) {
      normalized[speakerLabel] = confidence;
    }
  }

  return normalized;
}

export function resolveMappingConfidenceLevel(
  confidence: number | null | undefined,
): MappingConfidenceLevel | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return null;
  }
  if (confidence >= 0.85) {
    return "HIGH";
  }
  if (confidence >= 0.65) {
    return "MEDIUM";
  }
  return "LOW";
}

export function resolveAssistedMappingSuggestion(payload: {
  mappingSuggestionDiagnostics: unknown;
}) {
  const diagnostics = asRecord(payload.mappingSuggestionDiagnostics) as MappingDiagnostics;
  const suggestedMapping = normalizeMapping(
    diagnostics.candidateMapping != null
      ? diagnostics.candidateMapping
      : diagnostics.selectedMapping,
  );
  const confidenceMap = normalizeConfidenceMap(
    diagnostics.candidateConfidence != null
      ? diagnostics.candidateConfidence
      : diagnostics.confidence,
  );
  const globalConfidenceValue =
    typeof diagnostics.minConfidence === "number" &&
    Number.isFinite(diagnostics.minConfidence)
      ? diagnostics.minConfidence
      : null;

  const perSpeakerLevels = Object.entries(confidenceMap).reduce<
    Record<string, MappingConfidenceLevel>
  >((acc, [speakerLabel, confidence]) => {
    const level = resolveMappingConfidenceLevel(confidence);
    if (level) {
      acc[speakerLabel] = level;
    }
    return acc;
  }, {});

  return {
    reason:
      typeof diagnostics.reason === "string" && diagnostics.reason.trim().length > 0
        ? diagnostics.reason
        : null,
    suggestedMapping,
    hasAnySuggestion:
      Object.values(suggestedMapping).some((participantId) => Boolean(participantId)),
    hasFullSuggestionForSpeakers(speakerLabels: string[]) {
      if (speakerLabels.length === 0) {
        return false;
      }
      return speakerLabels.every((speakerLabel) => Boolean(suggestedMapping[speakerLabel]));
    },
    perSpeakerConfidence: perSpeakerLevels,
    globalConfidenceLevel: resolveMappingConfidenceLevel(globalConfidenceValue),
  };
}

export function resolveSpeakerReviewMode(params: {
  speakerMappingStatus: string | null | undefined;
  speakersCount: number;
  isEditable: boolean;
  manualSpeakerModeEnabled: boolean;
  transcriptSource: "MANUAL" | "GENERATED" | null | undefined;
  mappingReviewSkipped: boolean;
}): "REVIEW_CARD" | "AUTO_APPLIED_NOTE" | "NONE" {
  if (params.speakerMappingStatus === "AUTO_SUGGESTED") {
    return "AUTO_APPLIED_NOTE";
  }

  const needsReview =
    params.speakerMappingStatus === "REQUIRED" ||
    params.speakerMappingStatus === "NEEDS_REVIEW";

  if (
    needsReview &&
    params.speakersCount > 0 &&
    params.isEditable &&
    !params.manualSpeakerModeEnabled &&
    params.transcriptSource !== "MANUAL" &&
    !params.mappingReviewSkipped
  ) {
    return "REVIEW_CARD";
  }

  return "NONE";
}

