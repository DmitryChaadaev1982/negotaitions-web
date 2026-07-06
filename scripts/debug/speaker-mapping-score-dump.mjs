import { config as loadEnv } from "dotenv";
import pg from "pg";

const { Client } = pg;

const TELEMETRY_MIN_INTERVAL_MS = 300;
const TELEMETRY_NORMALIZE_MERGE_GAP_MS = 1200;
const AUTO_MAPPING_HIGH_CONFIDENCE = 0.6;
const AUTO_MAPPING_MIN_MARGIN = 0.12;
const AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD = 0.2;
const AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE = 0.12;
const GLOBAL_OVERRIDE_BLOCKING_WARNINGS = new Set([
  "missing_participant_coverage",
  "participant_low_activity",
  "telemetry_imbalanced",
  "alignment_unreliable",
  "no_activity_for_participant",
  "low_activity_for_participant",
  "row_imbalance",
  "duration_imbalance",
]);

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function overlapSeconds(a, b) {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? end - start : 0;
}

function hasOverlapWithAny(interval, others) {
  return others.some((other) => overlapSeconds(interval, other) > 0);
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function evaluateTelemetryQuality(params) {
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
    hasDerivedOffsets = false,
    outsideRecordingWindowRows = 0,
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
  const imbalanceByDuration = totalDurationMs > 0 ? maxDurationMs / totalDurationMs : null;
  const alignmentMode = hasOffsets
    ? "offsets"
    : hasAbsoluteTimestamps
      ? "absolute_time_to_recording_start"
      : "none";

  const warnings = [];
  if (participantCount >= 2 && participantCoverage < participantCount) {
    warnings.push("missing_participant_coverage");
    warnings.push("no_activity_for_participant");
  }
  if (participantCount >= 2 && rowCounts.some((rows) => rows < 2)) {
    warnings.push("participant_low_activity");
    warnings.push("low_activity_for_participant");
  }
  const rowImbalanced =
    participantCount >= 2 && totalRows > 0 && (imbalanceByRows ?? 0) >= 0.85 && minRows <= 2;
  const durationImbalanced =
    participantCount >= 2 &&
    totalDurationMs > 0 &&
    (imbalanceByDuration ?? 0) >= 0.85 &&
    minDurationMs <= 2000;
  if (rowImbalanced) {
    warnings.push("row_imbalance_high");
    warnings.push("row_imbalance");
  }
  if (durationImbalanced) {
    warnings.push("duration_imbalance_high");
    warnings.push("duration_imbalance");
  }
  if (participantCount >= 2 && rowImbalanced && durationImbalanced) {
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
    warnings.push("missing_offsets");
  }
  if (hasDerivedOffsets) {
    warnings.push("derived_offsets");
  }
  if (!hasOffsets && !hasAbsoluteTimestamps) {
    warnings.push("alignment_unreliable");
    warnings.push("missing_offsets");
  }
  if (outsideRecordingWindowRows > 0) {
    warnings.push("activity_outside_recording_window");
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
    hasDerivedOffsets,
    alignmentMode,
    activeParticipantsDuringRecording: participantCoverage,
    outsideRecordingWindowRows,
    warnings,
  };
}

function evaluateMappingSafety({ mapping, rawSpeakerLabels, participantIds, mode }) {
  const mappedParticipantIds = rawSpeakerLabels
    .map((label) => mapping[label])
    .filter((value) => Boolean(value));
  const byParticipant = new Map();
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

function decideAutoMappingApplication(params) {
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

function enumerateAssignments(speakerLabels, participantIds, scoreMatrix) {
  const all = [];
  const recurse = (index, usedParticipants, currentAssignment, currentScore) => {
    if (index >= speakerLabels.length) {
      all.push({
        assignment: { ...currentAssignment },
        totalScore: round(currentScore, 3),
      });
      return;
    }
    const speakerLabel = speakerLabels[index];
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
  recurse(0, new Set(), {}, 0);
  all.sort((a, b) => b.totalScore - a.totalScore);
  return all;
}

function shouldAllowGlobalMarginOverride(params) {
  if (!params.weakMargin) return false;
  if (params.speakerLabelCount !== 2) return false;
  if (params.participantCandidateCount !== 2) return false;
  if (!params.allSpeakersCovered) return false;
  if (!params.mappingSafetySafe) return false;
  if (
    params.globalAssignmentMargin == null ||
    params.globalAssignmentMargin < AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD
  ) {
    return false;
  }
  const hasLowCoverage = Object.values(params.selectedCoverageBySpeaker).some(
    (coverage) =>
      coverage == null ||
      coverage < AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
  );
  if (hasLowCoverage) return false;
  if (params.telemetryQuality.participantCoverage < 2) return false;
  if (params.telemetryQuality.activeParticipantsDuringRecording < 2) return false;
  if (params.telemetryQuality.shortIntervalCount > 0) return false;
  const blockedByWarning = params.telemetryQuality.warnings.some((warning) =>
    GLOBAL_OVERRIDE_BLOCKING_WARNINGS.has(warning),
  );
  if (blockedByWarning) return false;
  return true;
}

function selectOneToOneMappingFromScoreMatrix(speakerLabels, participantIds, scoreMatrix) {
  if (speakerLabels.length === 0 || participantIds.length === 0) {
    return { mapping: {}, confidence: {}, margins: {}, rankedAssignments: [] };
  }

  let bestScore = -1;
  let bestAssignment = {};
  const rankedAssignments = enumerateAssignments(speakerLabels, participantIds, scoreMatrix);
  if (rankedAssignments.length > 0) {
    bestScore = rankedAssignments[0].totalScore;
    bestAssignment = rankedAssignments[0].assignment;
  }

  const mapping = {};
  const confidence = {};
  const margins = {};

  for (const speakerLabel of speakerLabels) {
    const selectedParticipantId = bestAssignment[speakerLabel];
    if (!selectedParticipantId) {
      mapping[speakerLabel] = null;
      confidence[speakerLabel] = 0;
      margins[speakerLabel] = null;
      continue;
    }
    mapping[speakerLabel] = selectedParticipantId;
    const selectedCoverage = scoreMatrix[speakerLabel]?.[selectedParticipantId]?.coverage ?? 0;
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
      runnerUpCoverage == null ? null : Math.round((selectedCoverage - runnerUpCoverage) * 100) / 100;
  }

  return {
    mapping,
    confidence,
    margins,
    bestScore,
    rankedAssignments,
  };
}

async function main() {
  loadEnv({ path: ".env", override: true });
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing in .env");
  }

  const sessionId = process.argv[2];
  if (!sessionId) {
    throw new Error("Usage: node scripts/debug/speaker-mapping-score-dump.mjs <sessionId>");
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const participantsRes = await client.query(
      `select
        sp.id,
        sp."displayName" as name,
        null::text as role,
        sp.type,
        sp."sessionRoleId",
        sr.name as session_role_name,
        sp."joinedAt",
        null::timestamptz as "leftAt",
        sp."createdAt"
      from "SessionParticipant" sp
      left join "SessionRole" sr on sr.id = sp."sessionRoleId"
      where sp."sessionId" = $1
      order by sp."createdAt"`,
      [sessionId],
    );
    const participants = participantsRes.rows;

    const recordingsRes = await client.query(
      `select id, status, "startedAt", "endedAt", "createdAt", "updatedAt"
      from "Recording"
      where "sessionId" = $1
      order by "createdAt" desc`,
      [sessionId],
    );
    const recordings = recordingsRes.rows;
    const recording = recordings[0] ?? null;

    const transcriptsRes = await client.query(
      `select id, status, null::text as "processingStage", "speakerMappingStatus", "diarizationStatus",
          "createdAt", "updatedAt", "processingMetadata"
      from "Transcript"
      where "sessionId" = $1
      order by "createdAt" desc`,
      [sessionId],
    );
    const transcripts = transcriptsRes.rows;
    const latestTranscript = transcripts[0] ?? null;
    if (!latestTranscript) {
      throw new Error(`No transcript found for session ${sessionId}`);
    }

    const segmentsRes = await client.query(
      `select
        "speakerLabel",
        "startSeconds",
        "endSeconds",
        greatest(
          0,
          round(
            cast((coalesce("endSeconds", 0) - coalesce("startSeconds", 0)) * 1000 as numeric),
            0
          )
        ) as duration_ms,
        text
      from "TranscriptSegment"
      where "transcriptId" = $1
      order by "startSeconds", "endSeconds"`,
      [latestTranscript.id],
    );
    const segmentsRaw = segmentsRes.rows;

    const segmentsBySpeakerRes = await client.query(
      `select
        "speakerLabel",
        count(*) as segments,
        min(round(cast(coalesce("startSeconds", 0) * 1000 as numeric), 0)) as first_start_ms,
        max(round(cast(coalesce("endSeconds", 0) * 1000 as numeric), 0)) as last_end_ms,
        sum(
          greatest(
            0,
            round(
              cast((coalesce("endSeconds", 0) - coalesce("startSeconds", 0)) * 1000 as numeric),
              0
            )
          )
        ) as total_segment_ms
      from "TranscriptSegment"
      where "transcriptId" = $1
      group by "speakerLabel"
      order by "speakerLabel"`,
      [latestTranscript.id],
    );
    const segmentsBySpeaker = segmentsBySpeakerRes.rows;

    const activityRes = await client.query(
      `select
        "sessionParticipantId",
        "startedAt",
        "endedAt",
        "startedOffsetSeconds",
        "endedOffsetSeconds",
        confidence,
        greatest(0, extract(epoch from (coalesce("endedAt", "startedAt") - "startedAt")) * 1000) as duration_ms,
        "createdAt"
      from "SessionParticipantAudioActivity"
      where "sessionId" = $1
      order by "startedAt", "createdAt"`,
      [sessionId],
    );
    const audioRaw = activityRes.rows;

    const audioGroupedRes = await client.query(
      `select
        "sessionParticipantId",
        count(*) as rows,
        count(*) filter (
          where "startedOffsetSeconds" is not null and "endedOffsetSeconds" is not null
        ) as rows_with_offsets,
        count(*) filter (
          where "startedOffsetSeconds" is null or "endedOffsetSeconds" is null
        ) as rows_without_offsets,
        min("startedOffsetSeconds") as first_start_offset,
        max("endedOffsetSeconds") as last_end_offset,
        sum(greatest(0, extract(epoch from (coalesce("endedAt", "startedAt") - "startedAt")) * 1000)) as total_activity_ms,
        avg(greatest(0, extract(epoch from (coalesce("endedAt", "startedAt") - "startedAt")) * 1000)) as avg_activity_ms
      from "SessionParticipantAudioActivity"
      where "sessionId" = $1
      group by "sessionParticipantId"
      order by total_activity_ms desc`,
      [sessionId],
    );
    const audioGrouped = audioGroupedRes.rows;

    const participantById = new Map(participants.map((p) => [p.id, p]));
    const candidateParticipants = participants.filter((participant) => participant.type !== "OBSERVER");
    const negotiationParticipantPool = candidateParticipants.filter(
      (participant) => participant.type === "PARTICIPANT",
    );
    const participantPool =
      negotiationParticipantPool.length > 0 ? negotiationParticipantPool : candidateParticipants;
    const participantPoolIds = new Set(participantPool.map((participant) => participant.id));
    const participantCandidateReasons = participants.map((participant) => {
      if (participant.type === "OBSERVER") {
        return { participantId: participant.id, included: false, reason: "excluded_observer_type" };
      }
      if (negotiationParticipantPool.length > 0 && participant.type !== "PARTICIPANT") {
        return {
          participantId: participant.id,
          included: false,
          reason: "excluded_non_participant_when_participant_pool_available",
        };
      }
      return { participantId: participant.id, included: true, reason: "included_candidate_pool" };
    });

    const recordingStartMs = recording?.startedAt ? new Date(recording.startedAt).getTime() : null;
    const recordingEndMs = recording?.endedAt ? new Date(recording.endedAt).getTime() : null;
    let hasOffsets = false;
    let derivedOffsetCount = 0;
    let outsideRecordingWindowRows = 0;

    const activityByParticipant = new Map();
    for (const activity of audioRaw) {
      let start = activity.startedOffsetSeconds;
      let end = activity.endedOffsetSeconds;
      let rowUsedDerivedOffset = false;
      if (activity.startedOffsetSeconds != null || activity.endedOffsetSeconds != null) {
        hasOffsets = true;
      }

      if (start == null && recordingStartMs != null) {
        start = (new Date(activity.startedAt).getTime() - recordingStartMs) / 1000;
        derivedOffsetCount += 1;
        rowUsedDerivedOffset = true;
      }
      if (end == null && recordingStartMs != null && activity.endedAt != null) {
        end = (new Date(activity.endedAt).getTime() - recordingStartMs) / 1000;
        derivedOffsetCount += 1;
        rowUsedDerivedOffset = true;
      }

      if (start == null) continue;
      const safeEnd = end ?? start + 1;
      const clampedStartAtMs = new Date(activity.startedAt).getTime();
      const clampedEndAtMs =
        activity.endedAt != null ? new Date(activity.endedAt).getTime() : clampedStartAtMs + 1000;
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
                  recordingEndMs == null ? Number.POSITIVE_INFINITY : (recordingEndMs - recordingStartMs) / 1000,
                ),
              ),
        level: typeof activity.confidence === "number" ? activity.confidence : null,
        hasDirectOffsets: activity.startedOffsetSeconds != null || activity.endedOffsetSeconds != null,
        usedDerivedOffset: rowUsedDerivedOffset,
      });
      activityByParticipant.set(activity.sessionParticipantId, existing);
    }

    const segmentsWithTimestamps = segmentsRaw.filter(
      (s) => s.speakerLabel && s.startSeconds != null && s.endSeconds != null,
    );
    const diarizedIntervals = segmentsWithTimestamps.map((segment) => ({
      start: segment.startSeconds,
      end: segment.endSeconds,
    }));

    const normalizedByParticipant = new Map();
    const rowsByParticipant = {};
    const durationByParticipantMs = {};
    const avgIntervalMs = {};
    const medianIntervalMs = {};
    let shortIntervalCount = 0;
    let mergedIntervalCount = 0;

    for (const participant of participantPool) {
      const rawIntervals = activityByParticipant.get(participant.id) ?? [];
      rowsByParticipant[participant.id] = rawIntervals.length;

      const filteredRaw = rawIntervals.filter((interval) => interval.end > interval.start).sort((a, b) => a.start - b.start);
      const keptIntervals = [];
      for (const interval of filteredRaw) {
        const durationMs = (interval.end - interval.start) * 1000;
        const overlapsDiarized = hasOverlapWithAny(interval, diarizedIntervals);
        if (durationMs < TELEMETRY_MIN_INTERVAL_MS && !overlapsDiarized) {
          shortIntervalCount += 1;
          continue;
        }
        keptIntervals.push({ start: interval.start, end: interval.end });
      }

      const merged = [];
      for (const interval of keptIntervals) {
        const prev = merged[merged.length - 1];
        if (prev && interval.start - prev.end <= TELEMETRY_NORMALIZE_MERGE_GAP_MS / 1000) {
          prev.end = Math.max(prev.end, interval.end);
          mergedIntervalCount += 1;
        } else {
          merged.push({ ...interval });
        }
      }

      normalizedByParticipant.set(participant.id, merged);
      const durationsMs = merged.map((interval) => Math.max(0, Math.round((interval.end - interval.start) * 1000)));
      durationByParticipantMs[participant.id] = durationsMs.reduce((sum, durationMs) => sum + durationMs, 0);
      avgIntervalMs[participant.id] =
        durationsMs.length > 0
          ? Math.round(durationsMs.reduce((sum, durationMs) => sum + durationMs, 0) / durationsMs.length)
          : null;
      const medianValue = median(durationsMs);
      medianIntervalMs[participant.id] = medianValue == null ? null : Math.round(medianValue);
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

    const speakerLabels = [...new Set(segmentsWithTimestamps.map((s) => s.speakerLabel).filter(Boolean))];
    const labelOrder = [...new Set(segmentsRaw.map((s) => s.speakerLabel).filter(Boolean))];
    const scoreMatrix = {};
    const scoreDetails = {};
    const rejectedCandidateMapping = {};

    for (const speakerLabel of speakerLabels) {
      const speakerSegments = segmentsWithTimestamps.filter((s) => s.speakerLabel === speakerLabel);
      const totalSpeakerDuration = speakerSegments.reduce(
        (sum, s) => sum + ((s.endSeconds ?? 0) - (s.startSeconds ?? 0)),
        0,
      );
      if (totalSpeakerDuration === 0) continue;
      let bestParticipantId = null;
      let bestOverlap = 0;
      scoreMatrix[speakerLabel] = {};
      scoreDetails[speakerLabel] = {};

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
          coverage: round(coverage, 3),
        };

        const participantDurationMs = durationByParticipantMs[participantId] ?? 0;
        const participantCoverage = participantDurationMs > 0 ? (overlap * 1000) / participantDurationMs : 0;
        scoreDetails[speakerLabel][participantId] = {
          overlapMs: Math.round(overlap * 1000),
          nonOverlapMs: Math.max(0, Math.round(totalSpeakerDuration * 1000) - Math.round(overlap * 1000)),
          segmentCoverage: round(coverage, 3),
          participantCoverage: round(participantCoverage, 3),
          durationScore: round(coverage, 3),
          finalScore: round(coverage, 3),
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

    const suggestedLabels = Object.keys(selection.mapping).filter((label) => selection.mapping[label]);
    const confidences = suggestedLabels
      .map((label) => selection.confidence[label])
      .filter((value) => typeof value === "number");
    const minConfidence = confidences.length > 0 ? Math.min(...confidences) : null;
    const allSpeakersCovered =
      labelOrder.length > 0 && labelOrder.every((label) => Boolean(selection.mapping[label]));
    const weakMargin = Object.values(selection.margins).some(
      (margin) => margin != null && margin < AUTO_MAPPING_MIN_MARGIN,
    );
    const highConfidence = minConfidence !== null && minConfidence >= AUTO_MAPPING_HIGH_CONFIDENCE;
    const selectedCoverageBySpeaker = Object.fromEntries(
      labelOrder.map((label) => [
        label,
        typeof selection.confidence[label] === "number"
          ? selection.confidence[label]
          : null,
      ]),
    );

    const mappingSafety = evaluateMappingSafety({
      mapping: Object.fromEntries(labelOrder.map((label) => [label, selection.mapping[label] ?? null])),
      rawSpeakerLabels: labelOrder,
      participantIds: participantPool.map((participant) => participant.id),
      mode: "unknown",
    });

    const assignments = selection.rankedAssignments;
    const bestAssignment = assignments[0] ?? null;
    const secondBestAssignment = assignments[1] ?? null;
    const globalMargin =
      bestAssignment && secondBestAssignment
        ? round(bestAssignment.totalScore - secondBestAssignment.totalScore, 3)
        : null;
    const weakMarginOverriddenByGlobalEvidence = shouldAllowGlobalMarginOverride({
      weakMargin,
      speakerLabelCount: labelOrder.length,
      participantCandidateCount: participantPool.length,
      allSpeakersCovered,
      mappingSafetySafe: mappingSafety.safe,
      globalAssignmentMargin: globalMargin,
      selectedCoverageBySpeaker,
      telemetryQuality,
    });
    const effectiveHighConfidence =
      highConfidence || weakMarginOverriddenByGlobalEvidence;
    const effectiveWeakMargin = weakMargin && !weakMarginOverriddenByGlobalEvidence;

    const decision = decideAutoMappingApplication({
      allSpeakersCovered,
      highConfidence: effectiveHighConfidence,
      weakMargin: effectiveWeakMargin,
      mappingSafetySafe: mappingSafety.safe,
      mappingSafetyReason: mappingSafety.reason,
      rawSpeakerCount: labelOrder.length,
      expectedParticipantCount: participantPool.length,
      activeParticipantsDuringRecording: telemetryQuality.activeParticipantsDuringRecording,
      hasOffsets: telemetryQuality.hasOffsets,
      hasDerivedOffsets: telemetryQuality.hasDerivedOffsets,
      telemetryWarnings: telemetryQuality.warnings,
    });

    const processingMetadata = latestTranscript.processingMetadata ?? {};
    const existingSuggestion = processingMetadata?.mappingSuggestion ?? null;

    const output = {
      note: "Scoring logic mirrored from lib/transcription/auto-speaker-mapping.ts and auto-trigger decision gates. Existing scorer cannot be imported from node .mjs without TS loader.",
      sessionId,
      latestTranscriptId: latestTranscript.id,
      participants,
      recordings,
      transcripts: transcripts.map((t) => ({
        id: t.id,
        status: t.status,
        processingStage: t.processingStage,
        speakerMappingStatus: t.speakerMappingStatus,
        diarizationStatus: t.diarizationStatus,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      segmentsBySpeaker,
      segmentsRaw,
      audioGrouped,
      audioRaw,
      speakerLabels,
      participantCandidates: participantCandidateReasons,
      scoreMatrix,
      scoreDetails,
      globalAssignmentCandidates: assignments.slice(0, 10),
      assignment1: assignments[0] ?? null,
      assignment2: assignments[1] ?? null,
      bestAssignment,
      secondBestAssignment,
      globalMargin,
      requiredMarginThreshold: AUTO_MAPPING_MIN_MARGIN,
      globalMarginOverrideThreshold: AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD,
      minSelectedCoverageForOverride:
        AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
      selectedMapping: selection.mapping,
      selectedMargins: selection.margins,
      selectedCoverageBySpeaker,
      weakMarginDetected: weakMargin,
      weakMarginOverriddenByGlobalEvidence,
      effectiveWeakMargin,
      confidence: selection.confidence,
      minConfidence,
      requiredConfidenceThreshold: AUTO_MAPPING_HIGH_CONFIDENCE,
      effectiveHighConfidence,
      telemetryQuality,
      mappingSafety,
      decision,
      reasonForLowMarginReviewRequired:
        decision.reason === "low_margin_review_required"
          ? {
              weakMargin,
              selectedMargins: selection.margins,
              minMarginThreshold: AUTO_MAPPING_MIN_MARGIN,
            }
          : null,
      existingTranscriptMappingSuggestionReason:
        existingSuggestion && typeof existingSuggestion.reason === "string"
          ? existingSuggestion.reason
          : null,
      existingTranscriptMappingSuggestion: existingSuggestion,
    };

    console.log(JSON.stringify(output, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[speaker-mapping-score-dump] failed:", error.message);
  process.exit(1);
});
