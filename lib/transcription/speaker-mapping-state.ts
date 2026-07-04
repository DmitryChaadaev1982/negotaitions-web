import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

type MappingSuggestion = {
  candidateMapping?: unknown;
  selectedMapping?: unknown;
  rejectedBySafety?: unknown;
  safety?: unknown;
  mappingSafety?: unknown;
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

function hasMappingKeys(mapping: SpeakerMapping): boolean {
  return Object.keys(mapping).length > 0;
}

function isSuggestionSafeForDisplay(suggestion: MappingSuggestion): boolean {
  if (suggestion.rejectedBySafety === true) {
    return false;
  }

  const safety = asRecord(suggestion.safety);
  if (safety.safeToApply === false) {
    return false;
  }

  const mappingSafety = asRecord(suggestion.mappingSafety);
  if (mappingSafety.safe === false) {
    return false;
  }

  return true;
}

/**
 * UI source precedence:
 * 1) Persisted transcript.speakerMapping (manual/confirmed source of truth)
 * 2) Safe auto suggestion when status allows it
 * 3) Empty mapping
 */
export function resolveSpeakerMappingForUi(params: {
  speakerMapping: unknown;
  speakerMappingStatus: string | null | undefined;
  processingMetadata: unknown;
}): SpeakerMapping {
  const persistedMapping = normalizeMapping(params.speakerMapping);
  if (hasMappingKeys(persistedMapping)) {
    return persistedMapping;
  }

  if (params.speakerMappingStatus !== "AUTO_SUGGESTED") {
    return {};
  }

  const metadata = asRecord(params.processingMetadata);
  const suggestion = asRecord(metadata.mappingSuggestion) as MappingSuggestion;
  if (!isSuggestionSafeForDisplay(suggestion)) {
    return {};
  }

  const candidate =
    suggestion.candidateMapping != null
      ? normalizeMapping(suggestion.candidateMapping)
      : normalizeMapping(suggestion.selectedMapping);

  return hasMappingKeys(candidate) ? candidate : {};
}

export function deriveSpeakerMappingStatus(params: {
  hasSpeakerDiarization: boolean;
  speakerLabels: string[];
  mapping: SpeakerMapping;
  confirm: boolean;
  previousStatus: string | null | undefined;
}): {
  status: string;
  allMapped: boolean;
  canConfirm: boolean;
} {
  if (!params.hasSpeakerDiarization || params.speakerLabels.length === 0) {
    return { status: "NOT_REQUIRED", allMapped: true, canConfirm: true };
  }

  const assignedCount = params.speakerLabels.filter((label) =>
    Boolean(params.mapping[label]),
  ).length;
  const allMapped = assignedCount === params.speakerLabels.length;
  const hasAnyMapped = assignedCount > 0;

  if (params.confirm) {
    if (!allMapped) {
      return {
        status:
          params.previousStatus === "NEEDS_REVIEW"
            ? "NEEDS_REVIEW"
            : hasAnyMapped
              ? "PARTIALLY_MAPPED"
              : "REQUIRED",
        allMapped: false,
        canConfirm: false,
      };
    }

    return { status: "CONFIRMED", allMapped: true, canConfirm: true };
  }

  if (allMapped) {
    return { status: "AUTO_SUGGESTED", allMapped: true, canConfirm: true };
  }

  if (hasAnyMapped) {
    return {
      status: params.previousStatus === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "PARTIALLY_MAPPED",
      allMapped: false,
      canConfirm: false,
    };
  }

  return {
    status: params.previousStatus === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "REQUIRED",
    allMapped: false,
    canConfirm: false,
  };
}
