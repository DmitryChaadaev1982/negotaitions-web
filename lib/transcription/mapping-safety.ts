import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

export type MappingMode = "multi_device" | "single_device" | "unknown";

export type MappingSafetyResult = {
  safe: boolean;
  reason?: string;
  rawSpeakerCount: number;
  participantCount: number;
  distinctMappedParticipantCount: number;
  duplicateParticipantIds: string[];
  mode: MappingMode;
};

export type TelemetryQuality = {
  participantCoverage: number;
  participantCount: number;
  rowsByParticipant: Record<string, number>;
  durationByParticipantMs: Record<string, number>;
  avgIntervalMs: Record<string, number | null>;
  medianIntervalMs: Record<string, number | null>;
  shortIntervalCount: number;
  mergedIntervalCount: number;
  totalRows: number;
  imbalanceByRows: number | null;
  imbalanceByDuration: number | null;
  hasOffsets: boolean;
  alignmentMode: "offsets" | "absolute_time_to_recording_start" | "none";
  warnings: string[];
};

export function evaluateMappingSafety(params: {
  mapping: SpeakerMapping;
  rawSpeakerLabels: string[];
  participantIds: string[];
  mode: MappingMode;
}): MappingSafetyResult {
  const { mapping, rawSpeakerLabels, participantIds, mode } = params;
  const mappedParticipantIds = rawSpeakerLabels
    .map((label) => mapping[label])
    .filter((value): value is string => Boolean(value));
  const byParticipant = new Map<string, number>();
  for (const participantId of mappedParticipantIds) {
    byParticipant.set(participantId, (byParticipant.get(participantId) ?? 0) + 1);
  }
  const duplicateParticipantIds = [...byParticipant.entries()]
    .filter(([, count]) => count > 1)
    .map(([participantId]) => participantId);

  const rawSpeakerCount = rawSpeakerLabels.length;
  const participantCount = participantIds.length;
  const distinctMappedParticipantCount = new Set(mappedParticipantIds).size;
  const manyToOneInMultiParticipantSession =
    rawSpeakerCount >= 2 &&
    participantCount >= 2 &&
    distinctMappedParticipantCount < rawSpeakerCount;

  // Conservative by default: many-to-one auto mapping is unsafe even in single-device
  // mode unless explicitly confirmed by a human.
  if (manyToOneInMultiParticipantSession) {
    return {
      safe: false,
      reason:
        mode === "single_device"
          ? "many_to_one_requires_manual_review_single_device"
          : "many_to_one_mapping_in_multi_participant_session",
      rawSpeakerCount,
      participantCount,
      distinctMappedParticipantCount,
      duplicateParticipantIds,
      mode,
    };
  }

  return {
    safe: true,
    rawSpeakerCount,
    participantCount,
    distinctMappedParticipantCount,
    duplicateParticipantIds,
    mode,
  };
}

export function evaluateTelemetryQuality(params: {
  rowsByParticipant: Record<string, number>;
  durationByParticipantMs: Record<string, number>;
  avgIntervalMs: Record<string, number | null>;
  medianIntervalMs: Record<string, number | null>;
  shortIntervalCount: number;
  mergedIntervalCount: number;
  participantCount: number;
  hasOffsets: boolean;
  hasAbsoluteTimestamps: boolean;
}): TelemetryQuality {
  const {
    rowsByParticipant,
    durationByParticipantMs,
    avgIntervalMs,
    medianIntervalMs,
    shortIntervalCount,
    mergedIntervalCount,
    participantCount,
    hasOffsets,
    hasAbsoluteTimestamps,
  } = params;
  const rowCounts = Object.values(rowsByParticipant);
  const totalRows = rowCounts.reduce((sum, rows) => sum + rows, 0);
  const participantCoverage = rowCounts.filter((rows) => rows > 0).length;
  const maxRows = rowCounts.length > 0 ? Math.max(...rowCounts) : 0;
  const minRows = rowCounts.length > 0 ? Math.min(...rowCounts) : 0;
  const totalDurationMs = Object.values(durationByParticipantMs).reduce(
    (sum, durationMs) => sum + durationMs,
    0,
  );
  const maxDurationMs = Math.max(0, ...Object.values(durationByParticipantMs));
  const minDurationMs = Object.values(durationByParticipantMs).length
    ? Math.min(...Object.values(durationByParticipantMs))
    : 0;
  const imbalanceByRows = totalRows > 0 ? maxRows / totalRows : null;
  const imbalanceByDuration =
    totalDurationMs > 0 ? maxDurationMs / totalDurationMs : null;
  const alignmentMode = hasOffsets
    ? "offsets"
    : hasAbsoluteTimestamps
      ? "absolute_time_to_recording_start"
      : "none";

  const warnings: string[] = [];
  if (participantCount >= 2 && participantCoverage < participantCount) {
    warnings.push("missing_participant_coverage");
  }
  if (participantCount >= 2 && rowCounts.some((rows) => rows < 2)) {
    warnings.push("participant_low_activity");
  }
  const rowImbalanced =
    participantCount >= 2 &&
    totalRows > 0 &&
    (imbalanceByRows ?? 0) >= 0.85 &&
    minRows <= 2;
  const durationImbalanced =
    participantCount >= 2 &&
    totalDurationMs > 0 &&
    (imbalanceByDuration ?? 0) >= 0.85 &&
    minDurationMs <= 2000;
  if (rowImbalanced) {
    warnings.push("row_imbalance_high");
  }
  if (durationImbalanced) {
    warnings.push("duration_imbalance_high");
  }
  if (
    participantCount >= 2 &&
    rowImbalanced &&
    durationImbalanced
  ) {
    warnings.push("telemetry_imbalanced");
  }
  if (shortIntervalCount > 0) {
    warnings.push("short_intervals_present");
  }
  if (mergedIntervalCount > 0) {
    warnings.push("intervals_merged");
  }
  if (!hasOffsets && hasAbsoluteTimestamps) {
    warnings.push("offsets_missing_fallback_absolute_time");
  }
  if (!hasOffsets && !hasAbsoluteTimestamps) {
    warnings.push("alignment_unreliable");
  }

  return {
    participantCoverage,
    participantCount,
    rowsByParticipant,
    durationByParticipantMs,
    avgIntervalMs,
    medianIntervalMs,
    shortIntervalCount,
    mergedIntervalCount,
    totalRows,
    imbalanceByRows,
    imbalanceByDuration,
    hasOffsets,
    alignmentMode,
    warnings,
  };
}

export function detectMappingMode(
  processingMetadata: Record<string, unknown> | null | undefined,
): MappingMode {
  if (!processingMetadata) return "unknown";

  const candidates = [
    processingMetadata.captureMode,
    processingMetadata.deviceMode,
    processingMetadata.microphoneMode,
    processingMetadata.inputMode,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  if (candidates.some((value) => value.includes("single"))) {
    return "single_device";
  }
  if (candidates.some((value) => value.includes("multi"))) {
    return "multi_device";
  }
  return "unknown";
}
