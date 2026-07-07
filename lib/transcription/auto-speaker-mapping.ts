import { prisma } from "@/lib/prisma";
import {
  VOXIMPLANT_MIC_ACTIVITY_SOURCE,
  VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
} from "@/lib/telemetry/audio-activity-sources";
import {
  TELEMETRY_MIN_INTERVAL_MS,
  TELEMETRY_NORMALIZE_MERGE_GAP_MS,
  TELEMETRY_CALIBRATION,
} from "@/lib/telemetry/speaking-activity-config";
import {
  selectOneToOneMappingFromScoreMatrix,
  type SpeakerScoreMatrix,
} from "@/lib/transcription/auto-speaker-mapping-core";
import { computeGlobalAssignmentMargin } from "@/lib/transcription/auto-trigger-mapping-core";
import { evaluateTelemetryQuality, type TelemetryQuality } from "@/lib/transcription/mapping-safety";
import {
  selectTelemetrySourceForSpeakerMapping,
  sourceBlockingWarnings,
  type SpeakerMappingTelemetrySource,
  type TelemetrySourceCandidate,
} from "@/lib/transcription/speaker-mapping-telemetry-source-selection";
import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

export type TelemetryParticipantHealth = {
  participantId: string;
  rows: number;
  totalDurationMs: number;
  firstActivityOffsetSeconds: number | null;
  lastActivityOffsetSeconds: number | null;
  recordingCoverageRatio: number;
  hasDirectOffsets: boolean;
  usedDerivedOffsets: boolean;
  avgIntervalMs: number | null;
  medianIntervalMs: number | null;
  shortIntervalCount: number;
};

export type TelemetryHealthReport = {
  participants: Record<string, TelemetryParticipantHealth>;
  warnings: string[];
};

export type AutoMappingSuggestion = {
  strategy: "diarization_segment_overlap";
  available: boolean;
  unavailableReason: string | null;
  selectedTelemetrySource: SpeakerMappingTelemetrySource;
  fallbackReason: string | null;
  sourceDecisionSummary: string;
  targetRuntimeDecision: "remote_selected" | "local_fallback_selected" | "manual_review";
  scoreMatrix: SpeakerScoreMatrix;
  scoreMatrixBySource: Record<string, SpeakerScoreMatrix>;
  sourceWarningsBySource: Record<string, string[]>;
  sourceReasonBySource: Record<string, string | null>;
  remoteStreamTelemetryAvailable: boolean;
  localMicTelemetryAvailable: boolean;
  remoteRejectedReason: string | null;
  selectedMapping: SpeakerMapping;
  selectedMargins: Record<string, number | null>;
  rejectedCandidateMapping: SpeakerMapping;
  mapping: SpeakerMapping;
  confidence: Record<string, number>;
  telemetryQuality: TelemetryQuality;
  telemetryHealth: TelemetryHealthReport;
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

function buildUnavailableSuggestion(params: {
  reason: string;
  telemetryQuality: TelemetryQuality;
  telemetryHealth: TelemetryHealthReport;
  scoreMatrixBySource?: Record<string, SpeakerScoreMatrix>;
  sourceWarningsBySource?: Record<string, string[]>;
  sourceReasonBySource?: Record<string, string | null>;
  remoteStreamTelemetryAvailable?: boolean;
  localMicTelemetryAvailable?: boolean;
  remoteRejectedReason?: string | null;
  selectedTelemetrySource?: SpeakerMappingTelemetrySource;
  fallbackReason?: string | null;
  sourceDecisionSummary?: string;
  targetRuntimeDecision?: "remote_selected" | "local_fallback_selected" | "manual_review";
}): AutoMappingSuggestion {
  return {
    strategy: "diarization_segment_overlap",
    available: false,
    unavailableReason: params.reason,
    selectedTelemetrySource: params.selectedTelemetrySource ?? "NONE",
    fallbackReason: params.fallbackReason ?? null,
    sourceDecisionSummary:
      params.sourceDecisionSummary ?? "No reliable telemetry source available.",
    targetRuntimeDecision: params.targetRuntimeDecision ?? "manual_review",
    scoreMatrix: {},
    scoreMatrixBySource: params.scoreMatrixBySource ?? {},
    sourceWarningsBySource: params.sourceWarningsBySource ?? {},
    sourceReasonBySource: params.sourceReasonBySource ?? {},
    remoteStreamTelemetryAvailable: params.remoteStreamTelemetryAvailable ?? false,
    localMicTelemetryAvailable: params.localMicTelemetryAvailable ?? false,
    remoteRejectedReason: params.remoteRejectedReason ?? null,
    selectedMapping: {},
    selectedMargins: {},
    rejectedCandidateMapping: {},
    mapping: {},
    confidence: {},
    telemetryQuality: params.telemetryQuality,
    telemetryHealth: params.telemetryHealth,
  };
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
    hasDerivedOffsets: false,
    alignmentMode: "none",
    activeParticipantsDuringRecording: 0,
    outsideRecordingWindowRows: 0,
    warnings: [],
  };
  const emptyTelemetryHealth: TelemetryHealthReport = {
    participants: {},
    warnings: [],
  };

  // Check if timestamps are available in segments
  const segmentsWithTimestamps = transcript.segments.filter(
    (s) => s.speakerLabel && s.startSeconds != null && s.endSeconds != null,
  );

  if (segmentsWithTimestamps.length === 0) {
    return buildUnavailableSuggestion({
      reason: "no_timestamps",
      telemetryQuality: emptyTelemetryQuality,
      telemetryHealth: emptyTelemetryHealth,
      sourceDecisionSummary: "Transcript has no diarized timestamps.",
    });
  }

  const preferRemoteStreamTelemetry =
    process.env.SPEAKER_MAPPING_PREFER_REMOTE_STREAM_TELEMETRY !== "false";

  const allActivities = await prisma.sessionParticipantAudioActivity.findMany({
    where: { sessionId },
    orderBy: { startedAt: "asc" },
  });
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
    select: { startedAt: true, endedAt: true, status: true },
  });
  const recordingStartMs = recording?.startedAt?.getTime() ?? null;
  const recordingEndMs = recording?.endedAt?.getTime() ?? null;
  const speakerLabels = [
    ...new Set(
      segmentsWithTimestamps
        .map((s) => s.speakerLabel)
        .filter((l): l is string => Boolean(l)),
    ),
  ];
  const diarizedIntervals = segmentsWithTimestamps.map((segment) => ({
    start: segment.startSeconds ?? 0,
    end: segment.endSeconds ?? 0,
  }));

  const evaluateSource = (
    activities: typeof allActivities,
    source: Exclude<SpeakerMappingTelemetrySource, "NONE">,
  ): {
    suggestion: AutoMappingSuggestion;
    candidate: TelemetrySourceCandidate;
  } => {
    const eligibleActivities = activities.filter((activity) =>
      participantPoolIds.has(activity.sessionParticipantId),
    );
    if (activities.length === 0) {
      const suggestion = buildUnavailableSuggestion({
        reason: "no_audio_activity",
        telemetryQuality: emptyTelemetryQuality,
        telemetryHealth: emptyTelemetryHealth,
        selectedTelemetrySource: source,
        sourceDecisionSummary: "No activity rows for telemetry source.",
      });
      return {
        suggestion,
        candidate: {
          source,
          available: false,
          reason: "no_audio_activity",
          mapping: {},
          selectedCoverageBySpeaker: {},
          selectedMargins: {},
          globalAssignmentMargin: null,
          blockingWarnings: [],
          hasBlockingWarnings: false,
        },
      };
    }
    if (eligibleActivities.length === 0) {
      const suggestion = buildUnavailableSuggestion({
        reason: "no_participant_activity_for_source",
        telemetryQuality: emptyTelemetryQuality,
        telemetryHealth: emptyTelemetryHealth,
        selectedTelemetrySource: source,
        sourceDecisionSummary:
          "Source rows exist only for non-participant roles and were excluded.",
      });
      return {
        suggestion,
        candidate: {
          source,
          available: false,
          reason: "no_participant_activity_for_source",
          mapping: {},
          selectedCoverageBySpeaker: {},
          selectedMargins: {},
          globalAssignmentMargin: null,
          blockingWarnings: [],
          hasBlockingWarnings: false,
        },
      };
    }

    let hasOffsets = false;
    let derivedOffsetCount = 0;
    let outsideRecordingWindowRows = 0;
    const activityByParticipant = new Map<
      string,
      Array<{
        start: number;
        end: number;
        level: number | null;
        hasDirectOffsets: boolean;
        usedDerivedOffset: boolean;
      }>
    >();

    for (const activity of eligibleActivities) {
      let start = activity.startedOffsetSeconds;
      let end = activity.endedOffsetSeconds;
      let rowUsedDerivedOffset = false;
      if (
        activity.startedOffsetSeconds != null ||
        activity.endedOffsetSeconds != null
      ) {
        hasOffsets = true;
      }
      if (start == null && recordingStartMs != null) {
        start = (activity.startedAt.getTime() - recordingStartMs) / 1000;
        derivedOffsetCount += 1;
        rowUsedDerivedOffset = true;
      }
      if (end == null && recordingStartMs != null && activity.endedAt != null) {
        end = (activity.endedAt.getTime() - recordingStartMs) / 1000;
        derivedOffsetCount += 1;
        rowUsedDerivedOffset = true;
      }
      if (start == null) continue;
      const safeEnd = end ?? start + 1;
      const clampedStartAtMs = activity.startedAt.getTime();
      const clampedEndAtMs = activity.endedAt?.getTime() ?? clampedStartAtMs + 1000;
      if (
        recordingStartMs != null &&
        (clampedEndAtMs <= recordingStartMs ||
          (recordingEndMs != null && clampedStartAtMs >= recordingEndMs))
      ) {
        outsideRecordingWindowRows += 1;
        continue;
      }
      const existing = activityByParticipant.get(activity.sessionParticipantId) ?? [];
      existing.push({
        start:
          recordingStartMs == null
            ? start
            : Math.max(0, Math.max(start, (clampedStartAtMs - recordingStartMs) / 1000)),
        end:
          recordingStartMs == null
            ? safeEnd
            : Math.max(
                0,
                Math.min(
                  safeEnd,
                  recordingEndMs == null
                    ? Number.POSITIVE_INFINITY
                    : (recordingEndMs - recordingStartMs) / 1000,
                ),
              ),
        level: typeof activity.confidence === "number" ? activity.confidence : null,
        hasDirectOffsets:
          activity.startedOffsetSeconds != null || activity.endedOffsetSeconds != null,
        usedDerivedOffset: rowUsedDerivedOffset,
      });
      activityByParticipant.set(activity.sessionParticipantId, existing);
    }

    if (activityByParticipant.size === 0) {
      const telemetryQuality = evaluateTelemetryQuality({
        rowsByParticipant: {},
        durationByParticipantMs: {},
        avgIntervalMs: {},
        medianIntervalMs: {},
        shortIntervalCount: 0,
        mergedIntervalCount: 0,
        participantCount: participantPool.length,
        hasOffsets,
        hasAbsoluteTimestamps: recordingStartMs != null,
        hasDerivedOffsets: derivedOffsetCount > 0,
        outsideRecordingWindowRows,
      });
      const suggestion = buildUnavailableSuggestion({
        reason: "no_audio_activity_with_offsets",
        telemetryQuality,
        telemetryHealth: emptyTelemetryHealth,
        selectedTelemetrySource: source,
        sourceDecisionSummary: "Audio rows existed but no usable offsets were derived.",
      });
      return {
        suggestion,
        candidate: {
          source,
          available: false,
          reason: "no_audio_activity_with_offsets",
          mapping: {},
          selectedCoverageBySpeaker: {},
          selectedMargins: {},
          globalAssignmentMargin: null,
          blockingWarnings: sourceBlockingWarnings(telemetryQuality.warnings),
          hasBlockingWarnings: sourceBlockingWarnings(telemetryQuality.warnings).length > 0,
        },
      };
    }

    const normalizedByParticipant = new Map<string, Array<{ start: number; end: number }>>();
    const telemetryParticipants: Record<string, TelemetryParticipantHealth> = {};
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
      let shortCountForParticipant = 0;
      for (const interval of filteredRaw) {
        const durationMs = (interval.end - interval.start) * 1000;
        const overlapsDiarized = hasOverlapWithAny(interval, diarizedIntervals);
        if (durationMs < TELEMETRY_MIN_INTERVAL_MS && !overlapsDiarized) {
          shortIntervalCount += 1;
          shortCountForParticipant += 1;
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
      const recordingDurationSeconds =
        recordingStartMs != null
          ? Math.max(0, ((recordingEndMs ?? recordingStartMs) - recordingStartMs) / 1000)
          : null;
      const firstActivityOffsetSeconds = merged.length > 0 ? merged[0]!.start : null;
      const lastActivityOffsetSeconds =
        merged.length > 0 ? merged[merged.length - 1]!.end : null;
      telemetryParticipants[participant.id] = {
        participantId: participant.id,
        rows: rawIntervals.length,
        totalDurationMs: durationByParticipantMs[participant.id] ?? 0,
        firstActivityOffsetSeconds,
        lastActivityOffsetSeconds,
        recordingCoverageRatio:
          recordingDurationSeconds && recordingDurationSeconds > 0
            ? Math.min(
                1,
                Math.round(
                  (((durationByParticipantMs[participant.id] ?? 0) /
                    1000 /
                    recordingDurationSeconds) *
                    1000),
                ) / 1000,
              )
            : 0,
        hasDirectOffsets: rawIntervals.some((interval) => interval.hasDirectOffsets),
        usedDerivedOffsets: rawIntervals.some((interval) => interval.usedDerivedOffset),
        avgIntervalMs: avgIntervalMs[participant.id] ?? null,
        medianIntervalMs: medianIntervalMs[participant.id] ?? null,
        shortIntervalCount: shortCountForParticipant,
      };
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
        `[telemetry-quality] session=${sessionId} source=${source} participant=${participant.id} rawIntervals=${rawIntervals.length} normalizedIntervals=${merged.length} totalDurationMs=${durationByParticipantMs[participant.id]} minLevel=${minLevel ?? "n/a"} maxLevel=${maxLevel ?? "n/a"} avgLevel=${avgLevel ?? "n/a"} thresholds=${JSON.stringify(
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
      hasDerivedOffsets: derivedOffsetCount > 0,
      outsideRecordingWindowRows,
    });
    const telemetryHealth: TelemetryHealthReport = {
      participants: telemetryParticipants,
      warnings: [...telemetryQuality.warnings],
    };

    const scoreMatrix: SpeakerScoreMatrix = {};
    const rejectedCandidateMapping: SpeakerMapping = {};
    for (const speakerLabel of speakerLabels) {
      const speakerSegments = segmentsWithTimestamps.filter(
        (s) => s.speakerLabel === speakerLabel,
      );
      const totalSpeakerDuration = speakerSegments.reduce(
        (sum, s) => sum + ((s.endSeconds ?? 0) - (s.startSeconds ?? 0)),
        0,
      );
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
            if (overlapEnd > overlapStart) overlap += overlapEnd - overlapStart;
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
    const selectedCoverageBySpeaker = speakerLabels.reduce<Record<string, number | null>>(
      (acc, label) => {
        const value = selection.confidence[label];
        acc[label] = typeof value === "number" ? value : null;
        return acc;
      },
      {},
    );
    const globalAssignment = computeGlobalAssignmentMargin({
      speakerLabels,
      participantIds: participantPool.map((participant) => participant.id),
      scoreMatrix,
    });
    const singleSpeakerIgnoredWarnings = new Set([
      "missing_participant_coverage",
      "no_activity_for_participant",
      "participant_low_activity",
      "low_activity_for_participant",
      "row_imbalance",
      "duration_imbalance",
      "telemetry_imbalanced",
    ]);
    const blockingWarnings = sourceBlockingWarnings(telemetryQuality.warnings).filter(
      (warning) =>
        speakerLabels.length > 1 || !singleSpeakerIgnoredWarnings.has(warning),
    );
    const mapped = speakerLabels
      .map((label) => selection.mapping[label])
      .filter((value): value is string => Boolean(value));
    const allCovered =
      speakerLabels.length > 0 && speakerLabels.every((label) => Boolean(selection.mapping[label]));
    const uniqueCount = new Set(mapped).size;
    const oneToOneSafe = speakerLabels.length <= 1 || uniqueCount === mapped.length;
    const positiveMargins = speakerLabels.every(
      (label) => (selection.margins[label] ?? 0) > 0,
    );
    const coverageStrong = speakerLabels.every(
      (label) => (selection.confidence[label] ?? 0) >= 0.12,
    );
    const usable = allCovered && oneToOneSafe && positiveMargins && coverageStrong;
    const candidateReason = !allCovered
      ? "incomplete_mapping"
      : !oneToOneSafe
        ? "many_to_one_mapping"
        : !coverageStrong
          ? "low_selected_coverage"
          : !positiveMargins
            ? "ambiguous_margin"
            : blockingWarnings.length > 0
              ? blockingWarnings[0] ?? "telemetry_quality_review_required"
              : null;

    const suggestion: AutoMappingSuggestion = {
      strategy: "diarization_segment_overlap",
      available: true,
      unavailableReason: null,
      selectedTelemetrySource: source,
      fallbackReason: null,
      sourceDecisionSummary: "Source evaluated.",
      targetRuntimeDecision: "manual_review",
      scoreMatrix,
      scoreMatrixBySource: {},
      sourceWarningsBySource: {},
      sourceReasonBySource: {},
      remoteStreamTelemetryAvailable: false,
      localMicTelemetryAvailable: false,
      remoteRejectedReason: null,
      selectedMapping: selection.mapping,
      selectedMargins: selection.margins,
      rejectedCandidateMapping,
      mapping: selection.mapping,
      confidence: selection.confidence,
      telemetryQuality,
      telemetryHealth,
    };
    return {
      suggestion,
      candidate: {
        source,
        available: usable && blockingWarnings.length === 0,
        reason: candidateReason,
        mapping: selection.mapping,
        selectedCoverageBySpeaker,
        selectedMargins: selection.margins,
        globalAssignmentMargin: globalAssignment.margin,
        blockingWarnings,
        hasBlockingWarnings: blockingWarnings.length > 0,
      },
    };
  };

  const remoteActivities = allActivities.filter(
    (activity) => activity.source === VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
  );
  const localActivities = allActivities.filter(
    (activity) => activity.source === VOXIMPLANT_MIC_ACTIVITY_SOURCE,
  );
  const remote = evaluateSource(remoteActivities, VOX_REMOTE_STREAM_ACTIVITY_SOURCE);
  const local = evaluateSource(localActivities, VOXIMPLANT_MIC_ACTIVITY_SOURCE);

  const sourceSelection = selectTelemetrySourceForSpeakerMapping({
    speakerLabels,
    preferRemoteStreamTelemetry,
    remote: remote.candidate,
    local: local.candidate,
  });

  const scoreMatrixBySource = {
    [VOX_REMOTE_STREAM_ACTIVITY_SOURCE]: remote.suggestion.scoreMatrix,
    [VOXIMPLANT_MIC_ACTIVITY_SOURCE]: local.suggestion.scoreMatrix,
  };
  const sourceWarningsBySource = {
    [VOX_REMOTE_STREAM_ACTIVITY_SOURCE]: remote.suggestion.telemetryQuality.warnings,
    [VOXIMPLANT_MIC_ACTIVITY_SOURCE]: local.suggestion.telemetryQuality.warnings,
  };
  const sourceReasonBySource = {
    [VOX_REMOTE_STREAM_ACTIVITY_SOURCE]: remote.candidate.reason,
    [VOXIMPLANT_MIC_ACTIVITY_SOURCE]: local.candidate.reason,
  };
  const remoteStreamTelemetryAvailable = remoteActivities.length > 0;
  const localMicTelemetryAvailable = localActivities.length > 0;

  if (sourceSelection.selectedTelemetrySource === "NONE") {
    return buildUnavailableSuggestion({
      reason: sourceSelection.fallbackReason ?? "no_reliable_telemetry_source",
      telemetryQuality: remote.suggestion.telemetryQuality,
      telemetryHealth: remote.suggestion.telemetryHealth,
      scoreMatrixBySource,
      sourceWarningsBySource,
      sourceReasonBySource,
      remoteStreamTelemetryAvailable,
      localMicTelemetryAvailable,
      remoteRejectedReason: remote.candidate.reason,
      selectedTelemetrySource: "NONE",
      fallbackReason: sourceSelection.fallbackReason,
      sourceDecisionSummary: sourceSelection.sourceDecisionSummary,
      targetRuntimeDecision: sourceSelection.targetRuntimeDecision,
    });
  }

  const selected =
    sourceSelection.selectedTelemetrySource === VOX_REMOTE_STREAM_ACTIVITY_SOURCE
      ? remote.suggestion
      : local.suggestion;

  return {
    ...selected,
    selectedTelemetrySource: sourceSelection.selectedTelemetrySource,
    fallbackReason: sourceSelection.fallbackReason,
    sourceDecisionSummary: sourceSelection.sourceDecisionSummary,
    targetRuntimeDecision: sourceSelection.targetRuntimeDecision,
    scoreMatrixBySource,
    sourceWarningsBySource,
    sourceReasonBySource,
    remoteStreamTelemetryAvailable,
    localMicTelemetryAvailable,
    remoteRejectedReason:
      sourceSelection.selectedTelemetrySource === VOX_REMOTE_STREAM_ACTIVITY_SOURCE
        ? null
        : remote.candidate.reason,
  };
}
