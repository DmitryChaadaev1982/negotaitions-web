import { prisma } from "@/lib/prisma";
import {
  TELEMETRY_MIN_INTERVAL_MS,
  TELEMETRY_NORMALIZE_MERGE_GAP_MS,
  TELEMETRY_CALIBRATION,
} from "@/lib/telemetry/speaking-activity-config";
import { evaluateTelemetryQuality, type TelemetryQuality } from "@/lib/transcription/mapping-safety";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

export type SpeakerParticipantScore = {
  overlapMs: number;
  speakerDurationMs: number;
  coverage: number;
};

export type SpeakerScoreMatrix = Record<
  string,
  Record<string, SpeakerParticipantScore>
>;

export type AutoMappingSuggestion = {
  strategy: "diarization_segment_overlap";
  available: boolean;
  unavailableReason: string | null;
  scoreMatrix: SpeakerScoreMatrix;
  selectedMapping: SpeakerMapping;
  selectedMargins: Record<string, number | null>;
  rejectedCandidateMapping: SpeakerMapping;
  mapping: SpeakerMapping;
  confidence: Record<string, number>;
  telemetryQuality: TelemetryQuality;
};

type TranscriptWithSegments = {
  id: string;
  segments: Array<{
    speakerLabel: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
  }>;
};

type NumericInterval = { start: number; end: number };

type OneToOneSelection = {
  mapping: SpeakerMapping;
  confidence: Record<string, number>;
  margins: Record<string, number | null>;
};

export function selectOneToOneMappingFromScoreMatrix(
  speakerLabels: string[],
  participantIds: string[],
  scoreMatrix: SpeakerScoreMatrix,
): OneToOneSelection {
  if (speakerLabels.length === 0 || participantIds.length === 0) {
    return { mapping: {}, confidence: {}, margins: {} };
  }

  let bestScore = -1;
  let bestAssignment: Record<string, string> = {};

  const recurse = (
    index: number,
    usedParticipants: Set<string>,
    currentAssignment: Record<string, string>,
    currentScore: number,
  ) => {
    if (index >= speakerLabels.length) {
      if (currentScore > bestScore) {
        bestScore = currentScore;
        bestAssignment = { ...currentAssignment };
      }
      return;
    }

    const speakerLabel = speakerLabels[index]!;
    for (const participantId of participantIds) {
      if (usedParticipants.has(participantId)) continue;
      const score = scoreMatrix[speakerLabel]?.[participantId]?.coverage ?? 0;
      currentAssignment[speakerLabel] = participantId;
      usedParticipants.add(participantId);
      recurse(index + 1, usedParticipants, currentAssignment, currentScore + score);
      usedParticipants.delete(participantId);
      delete currentAssignment[speakerLabel];
    }
  };

  recurse(0, new Set<string>(), {}, 0);

  const mapping: SpeakerMapping = {};
  const confidence: Record<string, number> = {};
  const margins: Record<string, number | null> = {};

  for (const speakerLabel of speakerLabels) {
    const selectedParticipantId = bestAssignment[speakerLabel];
    if (!selectedParticipantId) {
      mapping[speakerLabel] = null;
      confidence[speakerLabel] = 0;
      margins[speakerLabel] = null;
      continue;
    }

    mapping[speakerLabel] = selectedParticipantId;
    const selectedCoverage =
      scoreMatrix[speakerLabel]?.[selectedParticipantId]?.coverage ?? 0;
    if (selectedCoverage <= 0) {
      mapping[speakerLabel] = null;
      confidence[speakerLabel] = 0;
      margins[speakerLabel] = null;
      continue;
    }
    confidence[speakerLabel] = Math.round(selectedCoverage * 100) / 100;

    const runnerUpCoverage = participantIds
      .filter((participantId) => participantId !== selectedParticipantId)
      .map((participantId) => scoreMatrix[speakerLabel]?.[participantId]?.coverage ?? 0)
      .sort((a, b) => b - a)[0];
    margins[speakerLabel] =
      runnerUpCoverage == null
        ? null
        : Math.round((selectedCoverage - runnerUpCoverage) * 100) / 100;
  }

  return { mapping, confidence, margins };
}

function overlapSeconds(a: NumericInterval, b: NumericInterval): number {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? end - start : 0;
}

function hasOverlapWithAny(
  interval: NumericInterval,
  others: NumericInterval[],
): boolean {
  return others.some((other) => overlapSeconds(interval, other) > 0);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/**
 * Attempt to suggest speaker mapping using SessionParticipantAudioActivity
 * overlap with transcript segment timestamps.
 *
 * If no audio activity data exists, returns available=false with an explanation.
 * Never silently applies mapping — facilitator must confirm.
 */
export async function suggestSpeakerMapping(
  sessionId: string,
  transcript: TranscriptWithSegments,
): Promise<AutoMappingSuggestion> {
  const emptyTelemetryQuality: TelemetryQuality = {
    participantCoverage: 0,
    participantCount: 0,
    rowsByParticipant: {},
    durationByParticipantMs: {},
    avgIntervalMs: {},
    medianIntervalMs: {},
    shortIntervalCount: 0,
    mergedIntervalCount: 0,
    totalRows: 0,
    imbalanceByRows: null,
    imbalanceByDuration: null,
    hasOffsets: false,
    alignmentMode: "none",
    warnings: [],
  };

  // Check if timestamps are available in segments
  const segmentsWithTimestamps = transcript.segments.filter(
    (s) => s.speakerLabel && s.startSeconds != null && s.endSeconds != null,
  );

  if (segmentsWithTimestamps.length === 0) {
    return {
      strategy: "diarization_segment_overlap",
      available: false,
      unavailableReason: "no_timestamps",
      scoreMatrix: {},
      selectedMapping: {},
      selectedMargins: {},
      rejectedCandidateMapping: {},
      mapping: {},
      confidence: {},
      telemetryQuality: emptyTelemetryQuality,
    };
  }

  // Load audio activity for this session
  const activities = await prisma.sessionParticipantAudioActivity.findMany({
    where: { sessionId },
    orderBy: { startedAt: "asc" },
  });

  if (activities.length === 0) {
    return {
      strategy: "diarization_segment_overlap",
      available: false,
      unavailableReason: "no_audio_activity",
      scoreMatrix: {},
      selectedMapping: {},
      selectedMargins: {},
      rejectedCandidateMapping: {},
      mapping: {},
      confidence: {},
      telemetryQuality: emptyTelemetryQuality,
    };
  }

  // Load participants to map activity to displayNames
  const participants = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    select: { id: true, displayName: true, type: true },
  });

  const participantById = new Map(participants.map((p) => [p.id, p]));
  const candidateParticipants = participants.filter((participant) => participant.type !== "OBSERVER");
  const negotiationParticipantPool =
    candidateParticipants.filter((participant) => participant.type === "PARTICIPANT");
  const participantPool =
    negotiationParticipantPool.length > 0 ? negotiationParticipantPool : candidateParticipants;
  const participantPoolIds = new Set(participantPool.map((participant) => participant.id));

  // Load recording start time so we can compute offsets for activities
  // that were stored with absolute timestamps only (no startedOffsetSeconds)
  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: { startedAt: true },
  });
  const recordingStartMs = recording?.startedAt?.getTime() ?? null;
  let hasOffsets = false;

  // Group raw activity intervals by participant
  const activityByParticipant = new Map<
    string,
    Array<{ start: number; end: number; level: number | null }>
  >();

  for (const activity of activities) {
    let start = activity.startedOffsetSeconds;
    let end = activity.endedOffsetSeconds;
    if (activity.startedOffsetSeconds != null || activity.endedOffsetSeconds != null) {
      hasOffsets = true;
    }

    // Fall back to computing offsets from recording start using absolute timestamps
    if (start == null && recordingStartMs != null) {
      start = (activity.startedAt.getTime() - recordingStartMs) / 1000;
    }
    if (end == null && recordingStartMs != null && activity.endedAt != null) {
      end = (activity.endedAt.getTime() - recordingStartMs) / 1000;
    }

    if (start == null) continue;
    const safeEnd = end ?? start + 1;

    const existing = activityByParticipant.get(activity.sessionParticipantId) ?? [];
    existing.push({
      start,
      end: safeEnd,
      level: typeof activity.confidence === "number" ? activity.confidence : null,
    });
    activityByParticipant.set(activity.sessionParticipantId, existing);
  }

  if (activityByParticipant.size === 0) {
    return {
      strategy: "diarization_segment_overlap",
      available: false,
      unavailableReason: "no_audio_activity_with_offsets",
      scoreMatrix: {},
      selectedMapping: {},
      selectedMargins: {},
      rejectedCandidateMapping: {},
      mapping: {},
      confidence: {},
      telemetryQuality: evaluateTelemetryQuality({
        rowsByParticipant: {},
        durationByParticipantMs: {},
        avgIntervalMs: {},
        medianIntervalMs: {},
        shortIntervalCount: 0,
        mergedIntervalCount: 0,
        participantCount: participantPool.length,
        hasOffsets,
        hasAbsoluteTimestamps: recordingStartMs != null,
      }),
    };
  }

  const diarizedIntervals = segmentsWithTimestamps.map((segment) => ({
    start: segment.startSeconds ?? 0,
    end: segment.endSeconds ?? 0,
  }));

  const normalizedByParticipant = new Map<string, Array<{ start: number; end: number }>>();

  const rowsByParticipant: Record<string, number> = {};
  const durationByParticipantMs: Record<string, number> = {};
  const avgIntervalMs: Record<string, number | null> = {};
  const medianIntervalMs: Record<string, number | null> = {};
  let shortIntervalCount = 0;
  let mergedIntervalCount = 0;
  for (const participant of participantPool) {
    const rawIntervals = activityByParticipant.get(participant.id) ?? [];
    rowsByParticipant[participant.id] = rawIntervals.length;

    const filteredRaw = rawIntervals
      .filter((interval) => interval.end > interval.start)
      .sort((a, b) => a.start - b.start);

    const keptIntervals: Array<{ start: number; end: number }> = [];
    for (const interval of filteredRaw) {
      const durationMs = (interval.end - interval.start) * 1000;
      const overlapsDiarized = hasOverlapWithAny(interval, diarizedIntervals);
      if (durationMs < TELEMETRY_MIN_INTERVAL_MS && !overlapsDiarized) {
        shortIntervalCount += 1;
        continue;
      }
      keptIntervals.push({ start: interval.start, end: interval.end });
    }

    const merged: Array<{ start: number; end: number }> = [];
    for (const interval of keptIntervals) {
      const prev = merged.at(-1);
      if (
        prev &&
        interval.start - prev.end <= TELEMETRY_NORMALIZE_MERGE_GAP_MS / 1000
      ) {
        prev.end = Math.max(prev.end, interval.end);
        mergedIntervalCount += 1;
      } else {
        merged.push({ ...interval });
      }
    }

    normalizedByParticipant.set(participant.id, merged);

    const durationsMs = merged.map((interval) =>
      Math.max(0, Math.round((interval.end - interval.start) * 1000)),
    );
    durationByParticipantMs[participant.id] = durationsMs.reduce(
      (sum, durationMs) => sum + durationMs,
      0,
    );
    avgIntervalMs[participant.id] =
      durationsMs.length > 0
        ? Math.round(
            durationsMs.reduce((sum, durationMs) => sum + durationMs, 0) /
              durationsMs.length,
          )
        : null;
    const medianValue = median(durationsMs);
    medianIntervalMs[participant.id] =
      medianValue == null ? null : Math.round(medianValue);

    const levelValues = filteredRaw
      .map((interval) => interval.level)
      .filter((value): value is number => typeof value === "number");
    const avgLevel =
      levelValues.length > 0
        ? Math.round(
            (levelValues.reduce((sum, value) => sum + value, 0) / levelValues.length) * 10,
          ) / 10
        : null;
    const minLevel = levelValues.length > 0 ? Math.min(...levelValues) : null;
    const maxLevel = levelValues.length > 0 ? Math.max(...levelValues) : null;
    console.info(
      `[telemetry-quality] session=${sessionId} participant=${participant.id} rawIntervals=${rawIntervals.length} normalizedIntervals=${merged.length} totalDurationMs=${durationByParticipantMs[participant.id]} minLevel=${minLevel ?? "n/a"} maxLevel=${maxLevel ?? "n/a"} avgLevel=${avgLevel ?? "n/a"} thresholds=${JSON.stringify(
        TELEMETRY_CALIBRATION,
      )}`,
    );
  }

  const telemetryQuality = evaluateTelemetryQuality({
    rowsByParticipant,
    durationByParticipantMs,
    avgIntervalMs,
    medianIntervalMs,
    shortIntervalCount,
    mergedIntervalCount,
    participantCount: participantPool.length,
    hasOffsets,
    hasAbsoluteTimestamps: recordingStartMs != null,
  });

  // Get unique speaker labels from transcript
  const speakerLabels = [
    ...new Set(
      segmentsWithTimestamps
        .map((s) => s.speakerLabel)
        .filter((l): l is string => Boolean(l)),
    ),
  ];

  // For each speaker label, compute overlap with each participant's activity
  const scoreMatrix: SpeakerScoreMatrix = {};
  const rejectedCandidateMapping: SpeakerMapping = {};

  for (const speakerLabel of speakerLabels) {
    const speakerSegments = segmentsWithTimestamps.filter(
      (s) => s.speakerLabel === speakerLabel,
    );

    const totalSpeakerDuration = speakerSegments.reduce((sum, s) => {
      return sum + ((s.endSeconds ?? 0) - (s.startSeconds ?? 0));
    }, 0);

    if (totalSpeakerDuration === 0) continue;

    let bestParticipantId: string | null = null;
    let bestOverlap = 0;
    scoreMatrix[speakerLabel] = {};

    for (const [participantId] of activityByParticipant) {
      if (!participantPoolIds.has(participantId)) continue;
      let overlap = 0;

      for (const segment of speakerSegments) {
        const segStart = segment.startSeconds ?? 0;
        const segEnd = segment.endSeconds ?? 0;

        const normalizedIntervals = normalizedByParticipant.get(participantId) ?? [];
        for (const interval of normalizedIntervals) {
          const overlapStart = Math.max(segStart, interval.start);
          const overlapEnd = Math.min(segEnd, interval.end);
          if (overlapEnd > overlapStart) {
            overlap += overlapEnd - overlapStart;
          }
        }
      }

      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestParticipantId = participantId;
      }

      const coverage = totalSpeakerDuration > 0 ? overlap / totalSpeakerDuration : 0;
      scoreMatrix[speakerLabel][participantId] = {
        overlapMs: Math.round(overlap * 1000),
        speakerDurationMs: Math.round(totalSpeakerDuration * 1000),
        coverage: Math.round(coverage * 1000) / 1000,
      };
    }

    if (bestParticipantId && participantById.has(bestParticipantId)) {
      rejectedCandidateMapping[speakerLabel] = bestParticipantId;
    }
  }

  const selection = selectOneToOneMappingFromScoreMatrix(
    speakerLabels,
    participantPool.map((participant) => participant.id),
    scoreMatrix,
  );

  return {
    strategy: "diarization_segment_overlap",
    available: true,
    unavailableReason: null,
    scoreMatrix,
    selectedMapping: selection.mapping,
    selectedMargins: selection.margins,
    rejectedCandidateMapping,
    mapping: selection.mapping,
    confidence: selection.confidence,
    telemetryQuality,
  };
}
