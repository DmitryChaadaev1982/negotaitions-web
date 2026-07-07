import fs from "node:fs/promises";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";
import {
  REQUIRED_SOURCE_SCENARIOS,
  evaluateRemoteSourceRecommendation,
  evaluateTargetRuntimeTelemetrySelection,
} from "./session-speaker-mapping-forensics-source-utils.mjs";

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
const DECISION_BLOCKING_WARNINGS = new Set([
  "missing_participant_coverage",
  "participant_low_activity",
  "telemetry_imbalanced",
  "alignment_unreliable",
  "no_activity_for_participant",
  "low_activity_for_participant",
  "row_imbalance",
  "duration_imbalance",
]);
const VOXIMPLANT_MIC_ACTIVITY_SOURCE = "VOXIMPLANT_MIC_ACTIVITY";
const VOX_REMOTE_STREAM_ACTIVITY_SOURCE = "VOX_REMOTE_STREAM_ACTIVITY";

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toMs(seconds) {
  return Math.round(seconds * 1000);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function overlapMs(aStartMs, aEndMs, bStartMs, bEndMs) {
  const start = Math.max(aStartMs, bStartMs);
  const end = Math.min(aEndMs, bEndMs);
  return Math.max(0, end - start);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function buildOrderNormalizedTranscriptWindows(segments) {
  const sorted = [...segments].sort((a, b) => a.orderIndex - b.orderIndex);
  const result = [];
  let previousScoringEndMs = Number.NEGATIVE_INFINITY;
  for (const segment of sorted) {
    const scoringStartMs = Math.max(segment.startMs, previousScoringEndMs);
    const scoringEndMs = Math.max(segment.endMs, scoringStartMs);
    previousScoringEndMs = scoringEndMs;
    const durationMs = Math.max(0, scoringEndMs - scoringStartMs);
    const reasons = [];
    if (scoringStartMs > segment.startMs) reasons.push("shifted_for_order_overlap");
    if (scoringEndMs === scoringStartMs && segment.endMs <= scoringStartMs) {
      reasons.push("zero_duration_clamped");
    }
    if (durationMs > 0 && durationMs <= 250) reasons.push("short_adjusted_window");
    result.push({
      orderIndex: segment.orderIndex,
      speakerLabel: segment.speakerLabel,
      originalStartMs: segment.startMs,
      originalEndMs: segment.endMs,
      scoringStartMs,
      scoringEndMs,
      durationMs,
      adjustmentReason: reasons.length ? reasons.join("|") : "none",
      text: segment.text,
    });
  }
  return result;
}

function detectProviderWindowPathology(segments) {
  const sorted = [...segments].sort((a, b) => a.orderIndex - b.orderIndex);
  const normalized = buildOrderNormalizedTranscriptWindows(sorted);
  const reasons = new Set();
  const conflictingSegments = new Set();
  let crossSpeakerOverlapMs = 0;
  const totalDurationMs = sorted.reduce(
    (sum, seg) => sum + Math.max(0, seg.endMs - seg.startMs),
    0,
  );

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const other = sorted[j];
      if (current.speakerLabel === other.speakerLabel) continue;
      const overlap = overlapMs(
        current.startMs,
        current.endMs,
        other.startMs,
        other.endMs,
      );
      if (overlap <= 0) continue;
      crossSpeakerOverlapMs += overlap;
      conflictingSegments.add(current.orderIndex);
      conflictingSegments.add(other.orderIndex);
      reasons.add("provider_segments_overlap");
    }
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const prevNormalized = normalized[i - 1];
    if (current.startMs < prevNormalized.scoringEndMs - 1000) {
      conflictingSegments.add(current.orderIndex);
      conflictingSegments.add(prevNormalized.orderIndex);
      reasons.add("order_time_conflict");
    }
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const durationMs = Math.max(0, current.endMs - current.startMs);
    if (durationMs < 15000) continue;
    let crossTurnOverlaps = 0;
    for (let j = 0; j < sorted.length; j += 1) {
      if (i === j) continue;
      const other = sorted[j];
      if (other.speakerLabel === current.speakerLabel) continue;
      if (
        overlapMs(current.startMs, current.endMs, other.startMs, other.endMs) > 0
      ) {
        crossTurnOverlaps += 1;
      }
    }
    if (crossTurnOverlaps >= 2) {
      reasons.add("long_segment_crosses_turn_boundary");
      conflictingSegments.add(current.orderIndex);
    }
  }

  const overlapRatio =
    totalDurationMs > 0 ? round(crossSpeakerOverlapMs / totalDurationMs, 3) : 0;
  if (overlapRatio >= 0.2) reasons.add("provider_segments_overlap");

  return {
    hasPathologicalOverlap: reasons.size > 0,
    overlapRatio,
    conflictingSegments: [...conflictingSegments].sort((a, b) => a - b),
    reasons: [...reasons],
  };
}

function parseArgs(argv) {
  if (argv.length < 3) {
    throw new Error(
      "Usage: node scripts/debug/session-speaker-mapping-forensics.mjs <SESSION_ID> [--env-file .env] [--out .debug/session-forensics/<SESSION_ID>]",
    );
  }
  const sessionId = argv[2];
  let envFile = null;
  let outDir = null;

  for (let i = 3; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file") {
      envFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out") {
      outDir = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!sessionId) {
    throw new Error("SESSION_ID is required");
  }
  if (!outDir) {
    outDir = path.join(".debug", "session-forensics", sessionId);
  }
  return { sessionId, envFile, outDir };
}

function ensureDatabaseUrl(envFile) {
  if (!process.env.DATABASE_URL && envFile) {
    loadEnv({ path: envFile, override: false });
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Provide it in environment or pass --env-file <path>.",
    );
  }
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function csvEscape(value) {
  if (value == null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
}

function toCsv(rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function truncateText(text, maxChars = 120) {
  if (!text) return "";
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
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
    DECISION_BLOCKING_WARNINGS.has(warning),
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

function selectOneToOneMappingFromScoreMatrix(speakerLabels, participantIds, scoreMatrix) {
  if (speakerLabels.length === 0 || participantIds.length === 0) {
    return { mapping: {}, confidence: {}, margins: {}, rankedAssignments: [] };
  }

  const rankedAssignments = enumerateAssignments(speakerLabels, participantIds, scoreMatrix);
  const bestAssignment = rankedAssignments[0]?.assignment ?? {};
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
    rankedAssignments,
  };
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

function detectMappingMode(processingMetadata) {
  if (!processingMetadata || typeof processingMetadata !== "object") return "unknown";
  const candidates = [
    processingMetadata.captureMode,
    processingMetadata.deviceMode,
    processingMetadata.microphoneMode,
    processingMetadata.inputMode,
  ]
    .filter((value) => typeof value === "string")
    .map((value) => value.toLowerCase());
  if (candidates.some((value) => value.includes("single"))) return "single_device";
  if (candidates.some((value) => value.includes("multi"))) return "multi_device";
  return "unknown";
}

function normalizeTelemetryRows({
  activities,
  recordingStartMs,
  recordingEndMs,
  participantIds,
  diarizedIntervals,
  includeDerived = true,
  includeOutsideWindow = false,
  mergeGapMs = TELEMETRY_NORMALIZE_MERGE_GAP_MS,
  shiftMs = 0,
}) {
  const rowsByParticipant = {};
  const rowsWithOffsetsByParticipant = {};
  const rowsDerivedByParticipant = {};
  const rawIntervalRowsByParticipant = {};
  const normalizedByParticipant = new Map();
  const rowsBySource = {};
  const rowsByParticipantBySource = {};
  const durationByParticipantBySource = {};
  const normalizedTotalsByParticipant = {};
  const avgIntervalMs = {};
  const medianIntervalMs = {};
  const mergedCountByParticipant = {};
  const shortCountByParticipant = {};
  const outsideCountByParticipant = {};
  const excludedRowsByReason = {};
  let hasOffsets = false;
  let hasDerivedOffsets = false;
  let outsideRecordingWindowRows = 0;
  let shortIntervalCount = 0;
  let mergedIntervalCount = 0;

  const markExcluded = (reason) => {
    excludedRowsByReason[reason] = (excludedRowsByReason[reason] ?? 0) + 1;
  };

  for (const participantId of participantIds) {
    rowsByParticipant[participantId] = 0;
    rowsWithOffsetsByParticipant[participantId] = 0;
    rowsDerivedByParticipant[participantId] = 0;
    rawIntervalRowsByParticipant[participantId] = [];
    normalizedByParticipant.set(participantId, []);
    rowsByParticipantBySource[participantId] = {};
    durationByParticipantBySource[participantId] = {};
    normalizedTotalsByParticipant[participantId] = 0;
    avgIntervalMs[participantId] = null;
    medianIntervalMs[participantId] = null;
    mergedCountByParticipant[participantId] = 0;
    shortCountByParticipant[participantId] = 0;
    outsideCountByParticipant[participantId] = 0;
  }

  for (const activity of activities) {
    const participantId = activity.sessionParticipantId;
    const source = activity.source ?? "unknown";
    rowsBySource[source] = (rowsBySource[source] ?? 0) + 1;
    rowsByParticipantBySource[participantId] ??= {};
    durationByParticipantBySource[participantId] ??= {};
    rowsByParticipantBySource[participantId][source] =
      (rowsByParticipantBySource[participantId][source] ?? 0) + 1;
    if (!rowsByParticipant[participantId] && rowsByParticipant[participantId] !== 0) {
      markExcluded("excluded_non_participant_role");
      continue;
    }
    rowsByParticipant[participantId] += 1;

    const hadDirectOffsets =
      activity.startedOffsetSeconds != null || activity.endedOffsetSeconds != null;
    if (hadDirectOffsets) {
      hasOffsets = true;
      rowsWithOffsetsByParticipant[participantId] += 1;
    }

    let startSec = activity.startedOffsetSeconds;
    let endSec = activity.endedOffsetSeconds;
    let usedDerivedOffset = false;

    if ((startSec == null || endSec == null) && recordingStartMs != null) {
      if (startSec == null) {
        startSec = (activity.startedAtMs - recordingStartMs) / 1000;
      }
      if (endSec == null) {
        const fallbackEndAt = activity.endedAtMs ?? activity.startedAtMs + 1000;
        endSec = (fallbackEndAt - recordingStartMs) / 1000;
      }
      usedDerivedOffset = true;
    }

    if (usedDerivedOffset) {
      hasDerivedOffsets = true;
      rowsDerivedByParticipant[participantId] += 1;
    }
    if (usedDerivedOffset && !includeDerived) {
      markExcluded("excluded_derived_offsets");
      rawIntervalRowsByParticipant[participantId].push({
        ...activity,
        source,
        startMs: null,
        endMs: null,
        usedDerivedOffset,
        hasDirectOffsets: hadDirectOffsets,
        excludedReason: "excluded_derived_offsets",
      });
      continue;
    }
    if (startSec == null) {
      markExcluded("missing_start_offset");
      rawIntervalRowsByParticipant[participantId].push({
        ...activity,
        source,
        startMs: null,
        endMs: null,
        usedDerivedOffset,
        hasDirectOffsets: hadDirectOffsets,
        excludedReason: "missing_start_offset",
      });
      continue;
    }

    const safeEndSec = endSec ?? startSec + 1;
    let startMs = toMs(startSec) + shiftMs;
    let endMs = toMs(safeEndSec) + shiftMs;
    if (endMs < startMs) {
      [startMs, endMs] = [endMs, startMs];
    }
    if (endMs === startMs) {
      endMs = startMs + 1;
    }

    let outsideWindow = false;
    if (recordingStartMs != null) {
      const recordingDurationMs =
        recordingEndMs != null ? Math.max(0, recordingEndMs - recordingStartMs) : null;
      if (recordingDurationMs != null) {
        if (endMs <= 0 || startMs >= recordingDurationMs) {
          outsideWindow = true;
        }
        if (!includeOutsideWindow) {
          startMs = clamp(startMs, 0, recordingDurationMs);
          endMs = clamp(endMs, 0, recordingDurationMs);
        }
      } else if (!includeOutsideWindow) {
        startMs = Math.max(0, startMs);
        endMs = Math.max(startMs + 1, endMs);
      }
    }

    if (outsideWindow) {
      outsideRecordingWindowRows += 1;
      outsideCountByParticipant[participantId] += 1;
      if (!includeOutsideWindow) {
        markExcluded("outside_recording_window");
        rawIntervalRowsByParticipant[participantId].push({
          ...activity,
          source,
          startMs,
          endMs,
          usedDerivedOffset,
          hasDirectOffsets: hadDirectOffsets,
          outsideWindow: true,
          excludedReason: "outside_recording_window",
        });
        continue;
      }
    }

    const rawRow = {
      ...activity,
      source,
      startMs,
      endMs,
      usedDerivedOffset,
      hasDirectOffsets: hadDirectOffsets,
      outsideWindow,
      excludedReason: null,
    };
    rawIntervalRowsByParticipant[participantId].push(rawRow);
    const current = normalizedByParticipant.get(participantId);
    current.push({
      startMs,
      endMs,
      usedDerivedOffset,
      hadOutsideWindow: outsideWindow,
      sourceCount: 1,
      sources: [source],
    });
    const durationMs = Math.max(0, endMs - startMs);
    durationByParticipantBySource[participantId][source] =
      (durationByParticipantBySource[participantId][source] ?? 0) + durationMs;
  }

  for (const participantId of participantIds) {
    const intervals = normalizedByParticipant
      .get(participantId)
      .filter((interval) => interval.endMs > interval.startMs)
      .sort((a, b) => a.startMs - b.startMs);

    const kept = [];
    for (const interval of intervals) {
      const durationMs = interval.endMs - interval.startMs;
      const overlapsDiarized = diarizedIntervals.some(
        (seg) => overlapMs(interval.startMs, interval.endMs, seg.startMs, seg.endMs) > 0,
      );
      if (durationMs < TELEMETRY_MIN_INTERVAL_MS && !overlapsDiarized) {
        markExcluded("short_interval_no_diarized_overlap");
        shortIntervalCount += 1;
        shortCountByParticipant[participantId] += 1;
        continue;
      }
      kept.push(interval);
    }

    const merged = [];
    for (const interval of kept) {
      const prev = merged.at(-1);
      if (prev && interval.startMs - prev.endMs <= mergeGapMs) {
        prev.endMs = Math.max(prev.endMs, interval.endMs);
        prev.usedDerivedOffset = prev.usedDerivedOffset || interval.usedDerivedOffset;
        prev.hadOutsideWindow = prev.hadOutsideWindow || interval.hadOutsideWindow;
        prev.sourceCount += interval.sourceCount;
        prev.sources = [...new Set([...prev.sources, ...interval.sources])];
        mergedIntervalCount += 1;
        mergedCountByParticipant[participantId] += 1;
      } else {
        merged.push({
          ...interval,
          sources: [...new Set(interval.sources)],
        });
      }
    }
    normalizedByParticipant.set(participantId, merged);
    const durations = merged.map((interval) => Math.max(0, interval.endMs - interval.startMs));
    normalizedTotalsByParticipant[participantId] = durations.reduce((acc, item) => acc + item, 0);
    avgIntervalMs[participantId] =
      durations.length > 0 ? Math.round(durations.reduce((acc, item) => acc + item, 0) / durations.length) : null;
    const med = median(durations);
    medianIntervalMs[participantId] = med == null ? null : Math.round(med);
  }

  return {
    rowsByParticipant,
    rowsBySource,
    rowsByParticipantBySource,
    durationByParticipantBySource,
    rowsWithOffsetsByParticipant,
    rowsDerivedByParticipant,
    rawIntervalRowsByParticipant,
    normalizedByParticipant,
    normalizedTotalsByParticipant,
    avgIntervalMs,
    medianIntervalMs,
    mergedCountByParticipant,
    shortCountByParticipant,
    outsideCountByParticipant,
    shortIntervalCount,
    mergedIntervalCount,
    hasOffsets,
    hasDerivedOffsets,
    outsideRecordingWindowRows,
    excludedRowsByReason,
  };
}

function computeScoreMatrix({ speakerLabels, participantIds, segmentsBySpeaker, normalizedByParticipant }) {
  const scoreMatrix = {};
  const scoreDetail = {};
  for (const speakerLabel of speakerLabels) {
    const segments = segmentsBySpeaker.get(speakerLabel) ?? [];
    const speakerDurationMs = segments.reduce((acc, seg) => acc + Math.max(0, seg.endMs - seg.startMs), 0);
    scoreMatrix[speakerLabel] = {};
    scoreDetail[speakerLabel] = {};
    for (const participantId of participantIds) {
      const intervals = normalizedByParticipant.get(participantId) ?? [];
      let overlapTotalMs = 0;
      for (const segment of segments) {
        for (const interval of intervals) {
          overlapTotalMs += overlapMs(segment.startMs, segment.endMs, interval.startMs, interval.endMs);
        }
      }
      const coverage = speakerDurationMs > 0 ? overlapTotalMs / speakerDurationMs : 0;
      scoreMatrix[speakerLabel][participantId] = {
        overlapMs: overlapTotalMs,
        speakerDurationMs,
        coverage: round(coverage, 3),
      };
      scoreDetail[speakerLabel][participantId] = {
        overlapMs: overlapTotalMs,
        coverage: round(coverage, 3),
      };
    }
  }
  return { scoreMatrix, scoreDetail };
}

function buildCurrentDecision({
  labelOrder,
  participantPool,
  scoreMatrix,
  telemetryQuality,
  processingMetadata,
}) {
  const selection = selectOneToOneMappingFromScoreMatrix(
    labelOrder,
    participantPool.map((p) => p.id),
    scoreMatrix,
  );
  const mapping = Object.fromEntries(labelOrder.map((label) => [label, selection.mapping[label] ?? null]));
  const allSpeakersCovered = labelOrder.length > 0 && labelOrder.every((label) => Boolean(mapping[label]));
  const weakMargin = Object.values(selection.margins).some(
    (margin) => margin != null && margin < AUTO_MAPPING_MIN_MARGIN,
  );
  const minConfidenceValues = labelOrder
    .map((label) => selection.confidence[label])
    .filter((value) => typeof value === "number");
  const minConfidence = minConfidenceValues.length ? Math.min(...minConfidenceValues) : null;
  const highConfidence = minConfidence != null && minConfidence >= AUTO_MAPPING_HIGH_CONFIDENCE;
  const selectedCoverageBySpeaker = Object.fromEntries(
    labelOrder.map((label) => [
      label,
      typeof selection.confidence[label] === "number" ? selection.confidence[label] : null,
    ]),
  );
  const mappingSafety = evaluateMappingSafety({
    mapping,
    rawSpeakerLabels: labelOrder,
    participantIds: participantPool.map((p) => p.id),
    mode: detectMappingMode(processingMetadata),
  });
  const globalCandidates = enumerateAssignments(
    labelOrder,
    participantPool.map((p) => p.id),
    scoreMatrix,
  );
  const best = globalCandidates[0] ?? null;
  const secondBest = globalCandidates[1] ?? null;
  const globalMargin =
    best && secondBest ? round(best.totalScore - secondBest.totalScore, 3) : null;
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
  const effectiveWeakMargin = weakMargin && !weakMarginOverriddenByGlobalEvidence;
  const effectiveHighConfidence = highConfidence || weakMarginOverriddenByGlobalEvidence;
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
  const blockingWarnings = telemetryQuality.warnings.filter((warning) =>
    DECISION_BLOCKING_WARNINGS.has(warning),
  );
  const nonBlockingWarnings = telemetryQuality.warnings.filter(
    (warning) => !DECISION_BLOCKING_WARNINGS.has(warning),
  );
  return {
    selection,
    mapping,
    minConfidence,
    highConfidence,
    weakMargin,
    weakMarginOverriddenByGlobalEvidence,
    effectiveWeakMargin,
    effectiveHighConfidence,
    selectedCoverageBySpeaker,
    mappingSafety,
    globalCandidates,
    best,
    secondBest,
    globalMargin,
    decision,
    blockingWarnings,
    nonBlockingWarnings,
    thresholds: {
      AUTO_MAPPING_MIN_MARGIN,
      AUTO_MAPPING_GLOBAL_MARGIN_OVERRIDE_THRESHOLD,
      AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
      AUTO_MAPPING_HIGH_CONFIDENCE,
    },
  };
}

function buildTranscriptStats(segments) {
  const bySpeaker = new Map();
  const ordered = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  for (const seg of ordered) {
    if (!seg.speakerLabel) continue;
    if (!bySpeaker.has(seg.speakerLabel)) {
      bySpeaker.set(seg.speakerLabel, {
        speakerLabel: seg.speakerLabel,
        segmentCount: 0,
        totalDurationMs: 0,
        firstStartMs: null,
        lastEndMs: null,
        averageSegmentDurationMs: null,
        longSegmentsCount: 0,
        overlapOrAdjacencyIssues: 0,
        rawSegments: [],
      });
    }
    const item = bySpeaker.get(seg.speakerLabel);
    item.segmentCount += 1;
    item.totalDurationMs += seg.durationMs;
    item.firstStartMs = item.firstStartMs == null ? seg.startMs : Math.min(item.firstStartMs, seg.startMs);
    item.lastEndMs = item.lastEndMs == null ? seg.endMs : Math.max(item.lastEndMs, seg.endMs);
    if (seg.durationMs >= 10000) item.longSegmentsCount += 1;
    item.rawSegments.push({
      orderIndex: seg.orderIndex,
      startMs: seg.startMs,
      endMs: seg.endMs,
      durationMs: seg.durationMs,
      text: seg.text,
    });
  }
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    if (!prev.speakerLabel || !curr.speakerLabel) continue;
    if (prev.speakerLabel !== curr.speakerLabel && curr.startMs - prev.endMs <= 200) {
      if (bySpeaker.has(prev.speakerLabel)) bySpeaker.get(prev.speakerLabel).overlapOrAdjacencyIssues += 1;
      if (bySpeaker.has(curr.speakerLabel)) bySpeaker.get(curr.speakerLabel).overlapOrAdjacencyIssues += 1;
    }
  }
  const rows = [...bySpeaker.values()].map((item) => ({
    ...item,
    averageSegmentDurationMs:
      item.segmentCount > 0 ? Math.round(item.totalDurationMs / item.segmentCount) : null,
  }));
  rows.sort((a, b) => a.speakerLabel.localeCompare(b.speakerLabel));
  return rows;
}

function buildSegmentOverlapDetail({
  segments,
  participantPool,
  normalizedByParticipant,
  recordingDurationMs,
}) {
  const detailRows = [];
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    const participantOverlaps = {};
    let best = { participantId: null, ratio: 0, overlapMs: 0 };
    let second = { participantId: null, ratio: 0, overlapMs: 0 };
    for (const participant of participantPool) {
      const intervals = normalizedByParticipant.get(participant.id) ?? [];
      let overlapTotalMs = 0;
      for (const interval of intervals) {
        overlapTotalMs += overlapMs(seg.startMs, seg.endMs, interval.startMs, interval.endMs);
      }
      participantOverlaps[participant.id] = overlapTotalMs;
      const ratio = seg.durationMs > 0 ? overlapTotalMs / seg.durationMs : 0;
      if (ratio > best.ratio) {
        second = { ...best };
        best = { participantId: participant.id, ratio, overlapMs: overlapTotalMs };
      } else if (ratio > second.ratio) {
        second = { participantId: participant.id, ratio, overlapMs: overlapTotalMs };
      }
    }
    const prev = i > 0 ? segments[i - 1] : null;
    const next = i + 1 < segments.length ? segments[i + 1] : null;
    const boundarySuspicious =
      (prev &&
        prev.speakerLabel !== seg.speakerLabel &&
        Math.abs(seg.startMs - prev.endMs) <= 250) ||
      (next &&
        next.speakerLabel !== seg.speakerLabel &&
        Math.abs(next.startMs - seg.endMs) <= 250);
    const overlapRatios = Object.values(participantOverlaps)
      .map((value) => (seg.durationMs > 0 ? value / seg.durationMs : 0))
      .sort((a, b) => b - a);
    const multiOverlapCount = overlapRatios.filter((ratio) => ratio >= 0.2).length;
    const outsideWindow =
      recordingDurationMs != null && (seg.endMs <= 0 || seg.startMs >= recordingDurationMs);
    detailRows.push({
      segmentId: seg.id,
      orderIndex: seg.orderIndex,
      speakerLabel: seg.speakerLabel,
      startMs: seg.startMs,
      endMs: seg.endMs,
      durationMs: seg.durationMs,
      textPreview: truncateText(seg.text, 120),
      overlapByParticipantMs: participantOverlaps,
      bestParticipantId: best.participantId,
      bestOverlapRatio: round(best.ratio, 3),
      secondOverlapRatio: round(second.ratio, 3),
      segmentMargin: round(best.ratio - second.ratio, 3),
      flags: {
        no_telemetry_overlap: best.overlapMs <= 0,
        ambiguous_segment: best.ratio > 0 && best.ratio - second.ratio < 0.1,
        cross_talk_possible: multiOverlapCount >= 2,
        segment_too_long: seg.durationMs >= 15000,
        speaker_turn_boundary_suspicious: Boolean(boundarySuspicious),
        outside_recording_window: Boolean(outsideWindow),
      },
    });
  }
  return detailRows;
}

function buildParticipantOverlapDetail({
  participantPool,
  normalizedByParticipant,
  segmentsBySpeaker,
  recordingDurationMs,
}) {
  const rows = [];
  for (const participant of participantPool) {
    const intervals = normalizedByParticipant.get(participant.id) ?? [];
    for (const interval of intervals) {
      const overlapBySpeakerMs = {};
      let bestLabel = null;
      let bestMs = 0;
      let labelsWithOverlap = 0;
      for (const [speakerLabel, segments] of segmentsBySpeaker.entries()) {
        let overlapTotal = 0;
        for (const seg of segments) {
          overlapTotal += overlapMs(seg.startMs, seg.endMs, interval.startMs, interval.endMs);
        }
        overlapBySpeakerMs[speakerLabel] = overlapTotal;
        if (overlapTotal > 0) labelsWithOverlap += 1;
        if (overlapTotal > bestMs) {
          bestMs = overlapTotal;
          bestLabel = speakerLabel;
        }
      }
      rows.push({
        participantId: participant.id,
        participantName: participant.name,
        startMs: interval.startMs,
        endMs: interval.endMs,
        durationMs: interval.endMs - interval.startMs,
        overlapBySpeakerMs,
        bestSpeakerLabel: bestLabel,
        flags: {
          no_transcript_overlap: bestMs === 0,
          overlaps_multiple_speakers: labelsWithOverlap >= 2,
          outside_recording_window:
            recordingDurationMs != null &&
            (interval.endMs <= 0 || interval.startMs >= recordingDurationMs),
          derived_offset: Boolean(interval.usedDerivedOffset),
        },
      });
    }
  }
  return rows.sort((a, b) => a.startMs - b.startMs);
}

function summarizeScenarioDelta(current, other) {
  const changes = [];
  if (current.decision.shouldApply !== other.decision.shouldApply) {
    changes.push(`shouldApply ${current.decision.shouldApply} -> ${other.decision.shouldApply}`);
  }
  if (current.decision.reason !== other.decision.reason) {
    changes.push(`reason ${current.decision.reason} -> ${other.decision.reason}`);
  }
  if (current.globalMargin !== other.globalMargin) {
    changes.push(`globalMargin ${current.globalMargin} -> ${other.globalMargin}`);
  }
  const labels = new Set([
    ...Object.keys(current.selectedCoverageBySpeaker),
    ...Object.keys(other.selectedCoverageBySpeaker),
  ]);
  for (const label of labels) {
    const before = current.selectedCoverageBySpeaker[label];
    const after = other.selectedCoverageBySpeaker[label];
    if (before !== after) {
      changes.push(`coverage[${label}] ${before} -> ${after}`);
    }
  }
  return changes;
}

function intervalOverlapRatio(a, b) {
  const overlap = overlapMs(a.startMs, a.endMs, b.startMs, b.endMs);
  const aDur = Math.max(1, a.endMs - a.startMs);
  const bDur = Math.max(1, b.endMs - b.startMs);
  return overlap / Math.min(aDur, bDur);
}

function deduplicateCombinedActivities(activities) {
  const sorted = [...activities].sort(
    (a, b) => a.startedAtMs - b.startedAtMs || (a.endedAtMs ?? 0) - (b.endedAtMs ?? 0),
  );
  const groupedByParticipant = new Map();
  for (const row of sorted) {
    const list = groupedByParticipant.get(row.sessionParticipantId) ?? [];
    const startMs = row.startedAtMs;
    const endMs = row.endedAtMs ?? row.startedAtMs + 1000;
    let merged = false;
    for (const existing of list) {
      if (existing.source === row.source) continue;
      const ratio = intervalOverlapRatio(
        { startMs: existing.startedAtMs, endMs: existing.endedAtMs ?? existing.startedAtMs + 1000 },
        { startMs, endMs },
      );
      if (ratio < 0.7) continue;
      existing.startedAtMs = Math.min(existing.startedAtMs, startMs);
      existing.endedAtMs = Math.max(existing.endedAtMs ?? existing.startedAtMs + 1000, endMs);
      existing.startedAt = new Date(existing.startedAtMs);
      existing.endedAt = new Date(existing.endedAtMs);
      existing.startedOffsetSeconds = Math.min(
        existing.startedOffsetSeconds ?? Number.POSITIVE_INFINITY,
        row.startedOffsetSeconds ?? Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(existing.startedOffsetSeconds)) existing.startedOffsetSeconds = null;
      existing.endedOffsetSeconds = Math.max(
        existing.endedOffsetSeconds ?? Number.NEGATIVE_INFINITY,
        row.endedOffsetSeconds ?? Number.NEGATIVE_INFINITY,
      );
      if (!Number.isFinite(existing.endedOffsetSeconds)) existing.endedOffsetSeconds = null;
      existing.source = "COMBINED_DEDUPED";
      merged = true;
      break;
    }
    if (!merged) {
      list.push({ ...row });
      groupedByParticipant.set(row.sessionParticipantId, list);
    }
  }
  return [...groupedByParticipant.values()].flat();
}

function classifyRootCauses({
  currentRuntime,
  segmentOverlapDetail,
  participantOverlapDetail,
  telemetryShiftSweepBest,
  longSegmentScenarios,
  candidateParticipants,
  speakerLabels,
}) {
  const results = [];
  const add = (classification, evidence, nextAction) => {
    results.push({ classification, evidence, nextAction });
  };

  const lowCoverage = Object.values(currentRuntime.selectedCoverageBySpeaker).some(
    (value) => value == null || value < AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE,
  );
  const noOverlapSegments = segmentOverlapDetail.filter((row) => row.flags.no_telemetry_overlap).length;
  const ambiguousSegments = segmentOverlapDetail.filter((row) => row.flags.ambiguous_segment).length;
  const crossTalkSegments = segmentOverlapDetail.filter((row) => row.flags.cross_talk_possible).length;
  const telemetryGaps = participantOverlapDetail.filter((row) => row.flags.no_transcript_overlap).length;
  const excludedCandidates = candidateParticipants.filter((item) => !item.included).length;

  if (currentRuntime.decision.shouldApply) {
    add(
      "GOOD_ENOUGH_AUTO_APPLY",
      [
        `Decision is shouldApply=true (${currentRuntime.decision.reason})`,
        `Global margin=${currentRuntime.globalMargin ?? "n/a"}, min confidence=${currentRuntime.minConfidence ?? "n/a"}`,
      ],
      "Allow runtime auto-apply flow and verify UI refresh/state transitions.",
    );
  }
  if (
    currentRuntime.globalMargin != null &&
    currentRuntime.globalMargin < AUTO_MAPPING_MIN_MARGIN
  ) {
    add(
      "LOW_GLOBAL_MARGIN",
      [`Global margin ${currentRuntime.globalMargin ?? "n/a"} is below stable-separation range.`],
      "Keep manual review default; compare telemetry shift and long-segment scenarios before tuning thresholds.",
    );
  }
  if (lowCoverage) {
    add(
      "LOW_SELECTED_COVERAGE",
      [
        `Selected coverage below ${AUTO_MAPPING_MIN_SELECTED_COVERAGE_FOR_OVERRIDE} for at least one speaker.`,
        JSON.stringify(currentRuntime.selectedCoverageBySpeaker),
      ],
      "Investigate activity gaps and segment boundaries; consider confidence from long-turn-only subsets.",
    );
  }
  if (telemetryShiftSweepBest && telemetryShiftSweepBest.improvement >= 0.12) {
    add(
      "TIMING_SHIFT_SUSPECTED",
      [
        `Best telemetry shift ${telemetryShiftSweepBest.shiftMs}ms improved global margin by ${round(
          telemetryShiftSweepBest.improvement,
          3,
        )}.`,
      ],
      "Investigate consistent recording/offset clock alignment and recording start anchoring.",
    );
  }
  if (currentRuntime.telemetryQuality.warnings.includes("derived_offsets")) {
    add(
      "DERIVED_OFFSETS_DISTORTION",
      ["Telemetry contains derived offsets fallback rows."],
      "Compare current_runtime vs exclude_derived_offsets and prioritize direct offset capture for future sessions.",
    );
  }
  if (currentRuntime.telemetryQuality.warnings.includes("activity_outside_recording_window")) {
    add(
      "OUTSIDE_WINDOW_DISTORTION",
      ["Audio activity rows outside recording window were detected."],
      "Ensure out-of-window data is excluded from scoring and validate capture boundaries.",
    );
  }
  if (ambiguousSegments > 0 || longSegmentScenarios.some((item) => item.improved)) {
    add(
      "TRANSCRIPT_SEGMENTS_TOO_LONG_OR_BAD_BOUNDARIES",
      [
        `Ambiguous segments=${ambiguousSegments}`,
        `Long-segment-only scenarios improved=${longSegmentScenarios.filter((i) => i.improved).length > 0}`,
      ],
      "Use segment-boundary-aware scoring variants (center-point or trimmed windows) as diagnostic aids.",
    );
  }
  if (crossTalkSegments > 0) {
    add(
      "CROSSTALK_OR_OPEN_MIC_LEAKAGE",
      [`Cross-talk-possible segments detected: ${crossTalkSegments}`],
      "Investigate open mic overlap behavior and suppress overlap-heavy windows in confidence decisions.",
    );
  }
  if (telemetryGaps > 0 || noOverlapSegments > 0) {
    add(
      "TELEMETRY_GAPS",
      [
        `Participant intervals without transcript overlap=${telemetryGaps}`,
        `Transcript segments without telemetry overlap=${noOverlapSegments}`,
      ],
      "Treat auto mapping as low confidence; prioritize manual review for this session.",
    );
  }
  if (speakerLabels.length !== currentRuntime.participantPoolCount) {
    add(
      "SPEAKER_COUNT_MISMATCH",
      [`Speakers=${speakerLabels.length}, participant candidates=${currentRuntime.participantPoolCount}`],
      "Prevent auto-apply and keep facilitator confirmation required.",
    );
  }
  if (excludedCandidates > 0) {
    add(
      "PARTICIPANT_CANDIDATE_PROBLEM",
      [`Excluded candidates: ${excludedCandidates}`],
      "Review participant pool inclusion rules for this session (observer/participant typing).",
    );
  }
  if (currentRuntime.decision.shouldApply && currentRuntime.reasonFromTranscriptStatusMismatch) {
    add(
      "UI_STALE_OR_STATUS_NOT_REFRESHED",
      ["Diagnostics indicate auto-apply should pass but transcript status suggests unresolved state."],
      "Refresh materials status polling and inspect stale processingMetadata/state transitions.",
    );
  }
  if (results.length === 0) {
    add(
      "INCONCLUSIVE",
      ["No strong single-signal root cause identified from stored telemetry/transcript overlap alone."],
      "Use manual reviewer workflow and collect richer telemetry snapshots in future sessions.",
    );
  }
  return results;
}

function buildTimelineRows({ segments, participantPool, normalizedByParticipant }) {
  const events = [];
  for (const seg of segments) {
    events.push({
      type: "transcript_segment",
      actor: seg.speakerLabel ?? "unknown",
      startMs: seg.startMs,
      endMs: seg.endMs,
      durationMs: seg.durationMs,
      text: truncateText(seg.text, 120),
    });
  }
  for (const participant of participantPool) {
    const intervals = normalizedByParticipant.get(participant.id) ?? [];
    for (const interval of intervals) {
      events.push({
        type: "participant_activity",
        actor: `${participant.name} (${participant.id})`,
        startMs: interval.startMs,
        endMs: interval.endMs,
        durationMs: interval.endMs - interval.startMs,
        text: interval.usedDerivedOffset ? "derived_offset=true" : "",
      });
    }
  }
  events.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return events;
}

function timelineMarkdown(rows) {
  const lines = ["# Timeline", "", "Events are replayed from stored DB rows only.", ""];
  for (const row of rows) {
    lines.push(
      `- [${row.type}] ${row.actor} | ${row.startMs}ms -> ${row.endMs}ms (${row.durationMs}ms)${
        row.text ? ` | ${row.text}` : ""
      }`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function timelineHtml(rows) {
  const bodyRows = rows
    .map(
      (row) => `
      <tr>
        <td>${row.type}</td>
        <td>${row.actor}</td>
        <td>${row.startMs}</td>
        <td>${row.endMs}</td>
        <td>${row.durationMs}</td>
        <td>${row.text ? row.text.replace(/</g, "&lt;").replace(/>/g, "&gt;") : ""}</td>
      </tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Session Speaker Mapping Forensics Timeline</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #ddd; padding: 6px; vertical-align: top; }
    th { background: #f5f5f5; text-align: left; }
    tr:nth-child(even) { background: #fafafa; }
  </style>
</head>
<body>
  <h1>Session Speaker Mapping Forensics Timeline</h1>
  <p>Generated from stored <code>TranscriptSegment</code> and <code>SessionParticipantAudioActivity</code> rows.</p>
  <table>
    <thead>
      <tr>
        <th>Type</th><th>Actor</th><th>Start (ms)</th><th>End (ms)</th><th>Duration (ms)</th><th>Details</th>
      </tr>
    </thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
</body>
</html>
`;
}

async function run() {
  const args = parseArgs(process.argv);
  ensureDatabaseUrl(args.envFile);
  const outDir = path.resolve(args.outDir);
  await fs.mkdir(outDir, { recursive: true });

  console.log("NO_DB_MUTATION=true");
  console.log("[forensics] read-only replay mode. This tool cannot recreate browser mic telemetry if raw mic snapshots were not stored.");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const sessionRes = await client.query(
      `select id, title, status, "startedAt", "endedAt", "createdAt", "updatedAt"
       from "Session"
       where id = $1`,
      [args.sessionId],
    );
    const session = sessionRes.rows[0] ?? null;

    const participantsRes = await client.query(
      `select
        sp.id,
        sp."displayName" as name,
        sp.type as role,
        sr.name as "sessionRole",
        sp."joinedAt",
        null::timestamptz as "leftAt",
        sp."createdAt"
      from "SessionParticipant" sp
      left join "SessionRole" sr on sr.id = sp."sessionRoleId"
      where sp."sessionId" = $1
      order by sp."createdAt" asc`,
      [args.sessionId],
    );
    const participants = participantsRes.rows;

    const recordingRes = await client.query(
      `select id, status, "startedAt", "endedAt", "createdAt", "updatedAt"
       from "Recording"
       where "sessionId" = $1
       order by ("status" = 'COMPLETED') desc, "createdAt" desc
       limit 1`,
      [args.sessionId],
    );
    const recording = recordingRes.rows[0] ?? null;
    const recordingDurationMs =
      recording?.startedAt && recording?.endedAt
        ? new Date(recording.endedAt).getTime() - new Date(recording.startedAt).getTime()
        : null;

    const transcriptRes = await client.query(
      `select id, status, "diarizationStatus", "speakerMappingStatus", "processingMetadata", "createdAt", "updatedAt"
       from "Transcript"
       where "sessionId" = $1
       order by ("status" = 'COMPLETED') desc, "createdAt" desc
       limit 1`,
      [args.sessionId],
    );
    const transcript = transcriptRes.rows[0] ?? null;

    const transcriptSegmentsRes = transcript
      ? await client.query(
          `select
            id,
            "orderIndex",
            "speakerLabel",
            "startSeconds",
            "endSeconds",
            text
          from "TranscriptSegment"
          where "transcriptId" = $1
          order by "orderIndex" asc`,
          [transcript.id],
        )
      : { rows: [] };

    const audioRes = await client.query(
      `select
        id,
        "sessionParticipantId",
        "startedAt",
        "endedAt",
        "startedOffsetSeconds",
        "endedOffsetSeconds",
        confidence,
        source,
        "createdAt"
      from "SessionParticipantAudioActivity"
      where "sessionId" = $1
      order by "startedAt" asc, "createdAt" asc`,
      [args.sessionId],
    );

    const missing = [];
    if (!session) missing.push("Session");
    if (!participants.length) missing.push("SessionParticipant");
    if (!recording) missing.push("Recording(latest/completed)");
    if (!transcript) missing.push("Transcript(latest/completed)");
    if (transcript && transcriptSegmentsRes.rows.length === 0) missing.push("TranscriptSegment(latest transcript)");
    if (audioRes.rows.length === 0) missing.push("SessionParticipantAudioActivity");

    const participantById = new Map(participants.map((p) => [p.id, p]));
    const candidateParticipants = (() => {
      const nonObservers = participants.filter((p) => p.role !== "OBSERVER");
      const participantOnly = nonObservers.filter((p) => p.role === "PARTICIPANT");
      const pool = participantOnly.length > 0 ? participantOnly : nonObservers;
      const poolIds = new Set(pool.map((p) => p.id));
      return participants.map((p) => {
        if (p.role === "OBSERVER") {
          return { participantId: p.id, included: false, reason: "excluded_observer_type" };
        }
        if (!poolIds.has(p.id)) {
          return {
            participantId: p.id,
            included: false,
            reason: "excluded_non_participant_when_participant_pool_available",
          };
        }
        return { participantId: p.id, included: true, reason: "included_candidate_pool" };
      });
    })();
    const participantPool = participants.filter((p) =>
      candidateParticipants.some((c) => c.participantId === p.id && c.included),
    );

    const segments = transcriptSegmentsRes.rows
      .filter((row) => row.speakerLabel != null && row.startSeconds != null && row.endSeconds != null)
      .map((row) => {
        const startMs = Math.round(Number(row.startSeconds) * 1000);
        const endMs = Math.round(Number(row.endSeconds) * 1000);
        return {
          id: row.id,
          orderIndex: row.orderIndex,
          speakerLabel: row.speakerLabel,
          startMs,
          endMs,
          durationMs: Math.max(0, endMs - startMs),
          text: row.text ?? "",
        };
      })
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const speakerLabels = [...new Set(segments.map((s) => s.speakerLabel).filter(Boolean))];
    const segmentsBySpeaker = new Map();
    for (const label of speakerLabels) {
      segmentsBySpeaker.set(
        label,
        segments.filter((segment) => segment.speakerLabel === label),
      );
    }
    const orderNormalizedWindows = buildOrderNormalizedTranscriptWindows(segments);
    const providerWindowPathology = detectProviderWindowPathology(segments);
    const orderNormalizedSegmentsBySpeaker = new Map();
    for (const label of speakerLabels) {
      orderNormalizedSegmentsBySpeaker.set(
        label,
        orderNormalizedWindows
          .filter((segment) => segment.speakerLabel === label)
          .map((segment) => ({
            id: `order-normalized-${segment.orderIndex}`,
            orderIndex: segment.orderIndex,
            speakerLabel: segment.speakerLabel,
            startMs: segment.scoringStartMs,
            endMs: segment.scoringEndMs,
            durationMs: segment.durationMs,
            text: segment.text ?? "",
            adjustmentReason: segment.adjustmentReason,
          })),
      );
    }

    const recordingStartMs = recording?.startedAt ? new Date(recording.startedAt).getTime() : null;
    const recordingEndMs = recording?.endedAt ? new Date(recording.endedAt).getTime() : null;
    const activities = audioRes.rows.map((row) => ({
      ...row,
      startedAtMs: new Date(row.startedAt).getTime(),
      endedAtMs: row.endedAt ? new Date(row.endedAt).getTime() : null,
    }));

    const diarizedIntervals = segments.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
    }));

    const normalizedCurrent = normalizeTelemetryRows({
      activities,
      recordingStartMs,
      recordingEndMs,
      participantIds: participantPool.map((p) => p.id),
      diarizedIntervals,
      includeDerived: true,
      includeOutsideWindow: false,
      mergeGapMs: TELEMETRY_NORMALIZE_MERGE_GAP_MS,
      shiftMs: 0,
    });

    const telemetryQualityCurrent = evaluateTelemetryQuality({
      rowsByParticipant: normalizedCurrent.rowsByParticipant,
      durationByParticipantMs: normalizedCurrent.normalizedTotalsByParticipant,
      avgIntervalMs: normalizedCurrent.avgIntervalMs,
      medianIntervalMs: normalizedCurrent.medianIntervalMs,
      shortIntervalCount: normalizedCurrent.shortIntervalCount,
      mergedIntervalCount: normalizedCurrent.mergedIntervalCount,
      participantCount: participantPool.length,
      hasOffsets: normalizedCurrent.hasOffsets,
      hasAbsoluteTimestamps: recordingStartMs != null,
      hasDerivedOffsets: normalizedCurrent.hasDerivedOffsets,
      outsideRecordingWindowRows: normalizedCurrent.outsideRecordingWindowRows,
    });

    const scoreCurrent = computeScoreMatrix({
      speakerLabels,
      participantIds: participantPool.map((p) => p.id),
      segmentsBySpeaker,
      normalizedByParticipant: normalizedCurrent.normalizedByParticipant,
    });

    const currentRuntime = buildCurrentDecision({
      labelOrder: speakerLabels,
      participantPool,
      scoreMatrix: scoreCurrent.scoreMatrix,
      telemetryQuality: telemetryQualityCurrent,
      processingMetadata: transcript?.processingMetadata ?? null,
    });
    currentRuntime.telemetryQuality = telemetryQualityCurrent;
    currentRuntime.participantPoolCount = participantPool.length;
    currentRuntime.reasonFromTranscriptStatusMismatch =
      currentRuntime.decision.shouldApply &&
      transcript?.speakerMappingStatus &&
      !["AUTO_SUGGESTED", "CONFIRMED"].includes(transcript.speakerMappingStatus);

    const transcriptStats = buildTranscriptStats(segments);
    const segmentOverlapDetail = buildSegmentOverlapDetail({
      segments,
      participantPool,
      normalizedByParticipant: normalizedCurrent.normalizedByParticipant,
      recordingDurationMs,
    });
    const participantOverlapDetail = buildParticipantOverlapDetail({
      participantPool,
      normalizedByParticipant: normalizedCurrent.normalizedByParticipant,
      segmentsBySpeaker,
      recordingDurationMs,
    });

    const runScenario = (name, options) => {
      const scenarioActivities = options.activitiesOverride
        ? options.activitiesOverride
        : options.activityFilter
          ? activities.filter(options.activityFilter)
          : activities;
      const normalized = normalizeTelemetryRows({
        activities: scenarioActivities,
        recordingStartMs,
        recordingEndMs,
        participantIds: participantPool.map((p) => p.id),
        diarizedIntervals: options.diarizedIntervalsOverride ?? diarizedIntervals,
        includeDerived: options.includeDerived ?? true,
        includeOutsideWindow: options.includeOutsideWindow ?? false,
        mergeGapMs: options.mergeGapMs ?? TELEMETRY_NORMALIZE_MERGE_GAP_MS,
        shiftMs: options.shiftMs ?? 0,
      });
      const score = computeScoreMatrix({
        speakerLabels,
        participantIds: participantPool.map((p) => p.id),
        segmentsBySpeaker: options.segmentsBySpeakerOverride ?? segmentsBySpeaker,
        normalizedByParticipant: normalized.normalizedByParticipant,
      });
      const telemetryQuality = evaluateTelemetryQuality({
        rowsByParticipant: normalized.rowsByParticipant,
        durationByParticipantMs: normalized.normalizedTotalsByParticipant,
        avgIntervalMs: normalized.avgIntervalMs,
        medianIntervalMs: normalized.medianIntervalMs,
        shortIntervalCount: normalized.shortIntervalCount,
        mergedIntervalCount: normalized.mergedIntervalCount,
        participantCount: participantPool.length,
        hasOffsets: normalized.hasOffsets,
        hasAbsoluteTimestamps: recordingStartMs != null,
        hasDerivedOffsets: normalized.hasDerivedOffsets,
        outsideRecordingWindowRows: normalized.outsideRecordingWindowRows,
      });
      const replay = buildCurrentDecision({
        labelOrder: speakerLabels,
        participantPool,
        scoreMatrix: score.scoreMatrix,
        telemetryQuality,
        processingMetadata: transcript?.processingMetadata ?? null,
      });
      return {
        name,
        options,
        activityRows: scenarioActivities.length,
        scoreMatrix: score.scoreMatrix,
        selectedMapping: replay.mapping,
        globalMargin: replay.globalMargin,
        selectedCoverageBySpeaker: replay.selectedCoverageBySpeaker,
        perSpeakerMargins: replay.selection.margins,
        shouldApplyLike: replay.decision.shouldApply,
        reason: replay.decision.reason,
        telemetryQuality,
        excludedRowsByReason: normalized.excludedRowsByReason,
        deltaVsCurrent: summarizeScenarioDelta(currentRuntime, replay),
        replay,
      };
    };

    const scoringScenarios = {};
    scoringScenarios.current_runtime = {
      scoreMatrix: scoreCurrent.scoreMatrix,
      selectedMapping: currentRuntime.mapping,
      globalMargin: currentRuntime.globalMargin,
      selectedCoverageBySpeaker: currentRuntime.selectedCoverageBySpeaker,
      perSpeakerMargins: currentRuntime.selection.margins,
      shouldApplyLike: currentRuntime.decision.shouldApply,
      reason: currentRuntime.decision.reason,
      telemetryQuality: telemetryQualityCurrent,
      excludedRowsByReason: normalizedCurrent.excludedRowsByReason,
      deltaVsCurrent: [],
    };
    scoringScenarios.local_mic_only = runScenario("local_mic_only", {
      activityFilter: (row) => row.source === VOXIMPLANT_MIC_ACTIVITY_SOURCE,
    });
    scoringScenarios.remote_stream_only = runScenario("remote_stream_only", {
      activityFilter: (row) => row.source === VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    });
    scoringScenarios.local_mic_order_normalized_windows = runScenario(
      "local_mic_order_normalized_windows",
      {
        activityFilter: (row) => row.source === VOXIMPLANT_MIC_ACTIVITY_SOURCE,
        segmentsBySpeakerOverride: orderNormalizedSegmentsBySpeaker,
        diarizedIntervalsOverride: orderNormalizedWindows.map((segment) => ({
          startMs: segment.scoringStartMs,
          endMs: segment.scoringEndMs,
        })),
      },
    );
    scoringScenarios.remote_stream_order_normalized_windows = runScenario(
      "remote_stream_order_normalized_windows",
      {
        activityFilter: (row) => row.source === VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
        segmentsBySpeakerOverride: orderNormalizedSegmentsBySpeaker,
        diarizedIntervalsOverride: orderNormalizedWindows.map((segment) => ({
          startMs: segment.scoringStartMs,
          endMs: segment.scoringEndMs,
        })),
      },
    );
    const combinedSources = new Set([
      VOXIMPLANT_MIC_ACTIVITY_SOURCE,
      VOX_REMOTE_STREAM_ACTIVITY_SOURCE,
    ]);
    scoringScenarios.combined_naive = runScenario("combined_naive", {
      activityFilter: (row) => combinedSources.has(row.source),
    });
    scoringScenarios.combined_deduplicated = runScenario("combined_deduplicated", {
      activitiesOverride: deduplicateCombinedActivities(
        activities.filter((row) => combinedSources.has(row.source)),
      ),
    });

    scoringScenarios.exclude_derived_offsets = runScenario("exclude_derived_offsets", {
      includeDerived: false,
    });
    scoringScenarios.exclude_outside_window = runScenario("exclude_outside_window", {
      includeOutsideWindow: false,
    });

    const turnMajority = (() => {
      const minOverlapRatio = 0.2;
      const votesBySpeaker = {};
      const mapping = {};
      for (const label of speakerLabels) {
        const segs = segmentsBySpeaker.get(label) ?? [];
        const votes = {};
        for (const participant of participantPool) votes[participant.id] = 0;
        for (const seg of segs) {
          let bestParticipant = null;
          let bestRatio = 0;
          for (const participant of participantPool) {
            const intervals = normalizedCurrent.normalizedByParticipant.get(participant.id) ?? [];
            let overlapTotal = 0;
            for (const interval of intervals) {
              overlapTotal += overlapMs(seg.startMs, seg.endMs, interval.startMs, interval.endMs);
            }
            const ratio = seg.durationMs > 0 ? overlapTotal / seg.durationMs : 0;
            if (ratio > bestRatio) {
              bestRatio = ratio;
              bestParticipant = participant.id;
            }
          }
          if (bestParticipant && bestRatio >= minOverlapRatio) {
            votes[bestParticipant] += 1;
          }
        }
        votesBySpeaker[label] = votes;
        const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
        mapping[label] = winner && winner[1] > 0 ? winner[0] : null;
      }
      return {
        name: "turn_majority_voting",
        minOverlapRatio,
        votesBySpeaker,
        selectedMapping: mapping,
        confidenceBySpeaker: Object.fromEntries(
          Object.entries(votesBySpeaker).map(([label, votes]) => {
            const entries = Object.values(votes);
            const totalVotes = entries.reduce((acc, item) => acc + item, 0);
            const top = entries.length ? Math.max(...entries) : 0;
            return [label, totalVotes > 0 ? round(top / totalVotes, 3) : 0];
          }),
        ),
      };
    })();
    scoringScenarios.turn_majority_voting = turnMajority;

    const centerPoint = (() => {
      const votesBySpeaker = {};
      const mapping = {};
      for (const label of speakerLabels) {
        const votes = {};
        for (const participant of participantPool) votes[participant.id] = 0;
        const segs = segmentsBySpeaker.get(label) ?? [];
        for (const seg of segs) {
          const mid = seg.startMs + Math.floor(seg.durationMs / 2);
          for (const participant of participantPool) {
            const intervals = normalizedCurrent.normalizedByParticipant.get(participant.id) ?? [];
            if (intervals.some((interval) => mid >= interval.startMs && mid <= interval.endMs)) {
              votes[participant.id] += 1;
            }
          }
        }
        votesBySpeaker[label] = votes;
        const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
        mapping[label] = winner && winner[1] > 0 ? winner[0] : null;
      }
      return { name: "center_point_voting", votesBySpeaker, selectedMapping: mapping };
    })();
    scoringScenarios.center_point_voting = centerPoint;

    const trimmedSegments = (() => {
      const trims = [250, 500, 1000];
      const results = [];
      for (const trimMs of trims) {
        const trimmed = segments
          .map((seg) => {
            const start = seg.startMs + trimMs;
            const end = seg.endMs - trimMs;
            if (end <= start) return null;
            return { ...seg, startMs: start, endMs: end, durationMs: end - start };
          })
          .filter(Boolean);
        const bySpeaker = new Map();
        for (const label of speakerLabels) {
          bySpeaker.set(
            label,
            trimmed.filter((seg) => seg.speakerLabel === label),
          );
        }
        const replay = runScenario(`trimmed_segments_${trimMs}ms`, {
          segmentsBySpeakerOverride: bySpeaker,
          diarizedIntervalsOverride: trimmed.map((seg) => ({ startMs: seg.startMs, endMs: seg.endMs })),
        });
        results.push({
          trimMs,
          ...replay,
        });
      }
      return results;
    })();
    scoringScenarios.trimmed_segments = trimmedSegments;

    const telemetryShiftSweep = (() => {
      const results = [];
      for (let shiftMs = -5000; shiftMs <= 5000; shiftMs += 500) {
        const scenario = runScenario(`telemetry_shift_${shiftMs}`, { shiftMs });
        results.push({
          shiftMs,
          globalMargin: scenario.globalMargin,
          shouldApplyLike: scenario.shouldApplyLike,
          reason: scenario.reason,
          selectedCoverageBySpeaker: scenario.selectedCoverageBySpeaker,
        });
      }
      const withMargins = results.filter((row) => row.globalMargin != null);
      const sorted = [...withMargins].sort((a, b) => b.globalMargin - a.globalMargin);
      const best = sorted[0] ?? null;
      return {
        sweep: results,
        bestShift: best,
        improvement:
          best && currentRuntime.globalMargin != null && best.globalMargin != null
            ? round(best.globalMargin - currentRuntime.globalMargin, 3)
            : null,
      };
    })();
    scoringScenarios.telemetry_shift_sweep = telemetryShiftSweep;

    const mergeGapSweep = (() => {
      const mergeGaps = [250, 500, 1000, 1500, 2000];
      return mergeGaps.map((mergeGapMs) =>
        runScenario(`merge_gap_${mergeGapMs}`, {
          mergeGapMs,
        }),
      );
    })();
    scoringScenarios.merge_gap_sweep = mergeGapSweep;

    const firstLongTurnCalibration = (() => {
      const byLabel = {};
      for (const label of speakerLabels) {
        byLabel[label] = segments
          .filter((seg) => seg.speakerLabel === label && seg.durationMs >= 8000)
          .slice(0, 1);
      }
      const windows = Object.values(byLabel)
        .flat()
        .map((seg) => ({ speakerLabel: seg.speakerLabel, startMs: seg.startMs, endMs: seg.endMs, durationMs: seg.durationMs }));
      const overlapByWindow = windows.map((window) => {
        const overlap = {};
        for (const participant of participantPool) {
          const intervals = normalizedCurrent.normalizedByParticipant.get(participant.id) ?? [];
          overlap[participant.id] = intervals.reduce(
            (acc, interval) => acc + overlapMs(window.startMs, window.endMs, interval.startMs, interval.endMs),
            0,
          );
        }
        return { ...window, overlapByParticipantMs: overlap };
      });
      return {
        windows,
        overlapByWindow,
        interpretation:
          windows.length >= 2
            ? "calibration_windows_present"
            : "insufficient_long_turns_for_calibration",
      };
    })();
    scoringScenarios.first_long_turn_calibration = firstLongTurnCalibration;

    const longSegmentsOnly = (() => {
      const thresholds = [5000, 8000, 10000];
      return thresholds.map((thresholdMs) => {
        const filteredSegments = segments.filter((seg) => seg.durationMs >= thresholdMs);
        const bySpeaker = new Map();
        for (const label of speakerLabels) {
          bySpeaker.set(
            label,
            filteredSegments.filter((seg) => seg.speakerLabel === label),
          );
        }
        const replay = runScenario(`long_segments_only_${thresholdMs}ms`, {
          segmentsBySpeakerOverride: bySpeaker,
          diarizedIntervalsOverride: filteredSegments.map((seg) => ({
            startMs: seg.startMs,
            endMs: seg.endMs,
          })),
        });
        return {
          thresholdMs,
          segmentCount: filteredSegments.length,
          ...replay,
        };
      });
    })();
    scoringScenarios.long_segments_only = longSegmentsOnly;

    const overlapMatrixCsvRows = [];
    for (const speakerLabel of speakerLabels) {
      for (const participant of participantPool) {
        const score = scoreCurrent.scoreMatrix[speakerLabel]?.[participant.id] ?? {
          overlapMs: 0,
          speakerDurationMs: 0,
          coverage: 0,
        };
        overlapMatrixCsvRows.push({
          speakerLabel,
          participantId: participant.id,
          participantName: participant.name,
          overlapMs: score.overlapMs,
          speakerDurationMs: score.speakerDurationMs,
          coverage: score.coverage,
        });
      }
    }

    const rawAudioCsvRows = activities.map((row) => ({
      id: row.id,
      sessionParticipantId: row.sessionParticipantId,
      participantName: participantById.get(row.sessionParticipantId)?.name ?? "",
      startedAt: toIsoOrNull(row.startedAt),
      endedAt: toIsoOrNull(row.endedAt),
      startedOffsetSeconds: row.startedOffsetSeconds,
      endedOffsetSeconds: row.endedOffsetSeconds,
      confidence: row.confidence,
      source: row.source,
      createdAt: toIsoOrNull(row.createdAt),
    }));

    const normalizedAudioCsvRows = participantPool.flatMap((participant) => {
      const intervals = normalizedCurrent.normalizedByParticipant.get(participant.id) ?? [];
      return intervals.map((interval, idx) => ({
        participantId: participant.id,
        participantName: participant.name,
        intervalIndex: idx,
        startMs: interval.startMs,
        endMs: interval.endMs,
        durationMs: interval.endMs - interval.startMs,
        usedDerivedOffset: interval.usedDerivedOffset,
        hadOutsideWindow: interval.hadOutsideWindow,
        sourceCount: interval.sourceCount,
        source: interval.sources.join("|"),
      }));
    });

    const transcriptSegmentsCsvRows = segments.map((segment) => ({
      segmentId: segment.id,
      orderIndex: segment.orderIndex,
      speakerLabel: segment.speakerLabel,
      startMs: segment.startMs,
      endMs: segment.endMs,
      durationMs: segment.durationMs,
      text: segment.text,
    }));

    const segmentOverlapCsvRows = segmentOverlapDetail.map((row) => ({
      segmentId: row.segmentId,
      orderIndex: row.orderIndex,
      speakerLabel: row.speakerLabel,
      startMs: row.startMs,
      endMs: row.endMs,
      durationMs: row.durationMs,
      textPreview: row.textPreview,
      bestParticipantId: row.bestParticipantId,
      bestOverlapRatio: row.bestOverlapRatio,
      secondOverlapRatio: row.secondOverlapRatio,
      segmentMargin: row.segmentMargin,
      noTelemetryOverlap: row.flags.no_telemetry_overlap,
      ambiguousSegment: row.flags.ambiguous_segment,
      crossTalkPossible: row.flags.cross_talk_possible,
      segmentTooLong: row.flags.segment_too_long,
      turnBoundarySuspicious: row.flags.speaker_turn_boundary_suspicious,
      outsideRecordingWindow: row.flags.outside_recording_window,
      overlapByParticipantMs: JSON.stringify(row.overlapByParticipantMs),
    }));

    const participantOverlapCsvRows = participantOverlapDetail.map((row) => ({
      participantId: row.participantId,
      participantName: row.participantName,
      startMs: row.startMs,
      endMs: row.endMs,
      durationMs: row.durationMs,
      bestSpeakerLabel: row.bestSpeakerLabel,
      noTranscriptOverlap: row.flags.no_transcript_overlap,
      overlapsMultipleSpeakers: row.flags.overlaps_multiple_speakers,
      outsideRecordingWindow: row.flags.outside_recording_window,
      derivedOffset: row.flags.derived_offset,
      overlapBySpeakerMs: JSON.stringify(row.overlapBySpeakerMs),
    }));

    const audioParticipantStats = participantPool.map((participant) => {
      const rawRows = normalizedCurrent.rawIntervalRowsByParticipant[participant.id] ?? [];
      const normalizedIntervals = normalizedCurrent.normalizedByParticipant.get(participant.id) ?? [];
      const offsetRows = rawRows.filter((row) => row.hasDirectOffsets).length;
      const derivedRows = rawRows.filter((row) => row.usedDerivedOffset).length;
      const outsideRows = rawRows.filter((row) => row.outsideWindow).length;
      const rawDurations = rawRows
        .filter((row) => row.startMs != null && row.endMs != null && !row.excludedReason)
        .map((row) => row.endMs - row.startMs);
      const normalizedDurations = normalizedIntervals.map((row) => row.endMs - row.startMs);
      const firstOffset = rawRows
        .filter((row) => row.startMs != null)
        .map((row) => row.startMs)
        .sort((a, b) => a - b)[0];
      const lastOffset = rawRows
        .filter((row) => row.endMs != null)
        .map((row) => row.endMs)
        .sort((a, b) => b - a)[0];
      return {
        participantId: participant.id,
        participantName: participant.name,
        rawRowCount: rawRows.length,
        rowsWithOffsets: offsetRows,
        rowsWithDerivedOffsets: derivedRows,
        rowsOutsideRecordingWindow: outsideRows,
        totalRawDurationMs: rawDurations.reduce((acc, item) => acc + item, 0),
        normalizedScoringDurationMs: normalizedDurations.reduce((acc, item) => acc + item, 0),
        firstOffsetMs: firstOffset ?? null,
        lastOffsetMs: lastOffset ?? null,
        avgIntervalMs:
          normalizedDurations.length > 0
            ? Math.round(normalizedDurations.reduce((acc, item) => acc + item, 0) / normalizedDurations.length)
            : null,
        medianIntervalMs: median(normalizedDurations),
        mergedIntervalCount: normalizedCurrent.mergedCountByParticipant[participant.id] ?? 0,
        rawIntervals: rawRows.map((row) => ({
          startMs: row.startMs,
          endMs: row.endMs,
          excludedReason: row.excludedReason,
          usedDerivedOffset: row.usedDerivedOffset,
          outsideWindow: row.outsideWindow ?? false,
        })),
        normalizedIntervals: normalizedIntervals.map((row) => ({
          startMs: row.startMs,
          endMs: row.endMs,
          usedDerivedOffset: row.usedDerivedOffset,
          hadOutsideWindow: row.hadOutsideWindow,
          sourceCount: row.sourceCount,
        })),
      };
    });

    const transcriptSpeakerDiagnostics = transcriptStats.map((item) => ({
      speakerLabel: item.speakerLabel,
      segmentCount: item.segmentCount,
      totalDurationMs: item.totalDurationMs,
      firstStartMs: item.firstStartMs,
      lastEndMs: item.lastEndMs,
      averageSegmentDurationMs: item.averageSegmentDurationMs,
      longSegmentsCount: item.longSegmentsCount,
      possibleOverlapOrAdjacencyIssues: item.overlapOrAdjacencyIssues,
      rawSegmentList: item.rawSegments,
    }));

    const telemetryShiftBest = scoringScenarios.telemetry_shift_sweep.bestShift
      ? {
          shiftMs: scoringScenarios.telemetry_shift_sweep.bestShift.shiftMs,
          improvement: scoringScenarios.telemetry_shift_sweep.improvement ?? 0,
        }
      : null;

    const longScenarioSignals = scoringScenarios.long_segments_only.map((scenario) => ({
      thresholdMs: scenario.thresholdMs,
      improved: (scenario.globalMargin ?? Number.NEGATIVE_INFINITY) > (currentRuntime.globalMargin ?? Number.NEGATIVE_INFINITY),
      globalMargin: scenario.globalMargin,
    }));

    const rootCauseClassification = classifyRootCauses({
      currentRuntime,
      segmentOverlapDetail,
      participantOverlapDetail,
      telemetryShiftSweepBest: telemetryShiftBest,
      longSegmentScenarios: longScenarioSignals,
      candidateParticipants,
      speakerLabels,
    });

    const timelineRows = buildTimelineRows({
      segments,
      participantPool,
      normalizedByParticipant: normalizedCurrent.normalizedByParticipant,
    });

    const localMicScenario = scoringScenarios.local_mic_only;
    const remoteStreamScenario = scoringScenarios.remote_stream_only;
    const localMicOrderNormalizedScenario =
      scoringScenarios.local_mic_order_normalized_windows;
    const remoteOrderNormalizedScenario =
      scoringScenarios.remote_stream_order_normalized_windows;
    const sourceRecommendations = evaluateRemoteSourceRecommendation({
      currentRuntime: {
        shouldApply: currentRuntime.decision.shouldApply,
      },
      localMicOnly: {
        shouldApply: localMicScenario.shouldApplyLike,
        globalMargin: localMicScenario.globalMargin,
        selectedCoverageBySpeaker: localMicScenario.selectedCoverageBySpeaker,
      },
      remoteStreamOnly: {
        mapping: remoteStreamScenario.selectedMapping,
        activityRows: remoteStreamScenario.activityRows ?? 0,
        globalMargin: remoteStreamScenario.globalMargin,
        selectedCoverageBySpeaker: remoteStreamScenario.selectedCoverageBySpeaker,
      },
      speakerLabels,
    });
    const targetRuntimeSourceSelection = evaluateTargetRuntimeTelemetrySelection({
      localMicOnly: {
        selectedMapping: localMicScenario.selectedMapping,
        selectedCoverageBySpeaker: localMicScenario.selectedCoverageBySpeaker,
        globalMargin: localMicScenario.globalMargin,
        shouldApplyLike: localMicScenario.shouldApplyLike,
        reason: localMicScenario.reason,
      },
      remoteStreamOnly: {
        selectedMapping: remoteStreamScenario.selectedMapping,
        selectedCoverageBySpeaker: remoteStreamScenario.selectedCoverageBySpeaker,
        globalMargin: remoteStreamScenario.globalMargin,
        shouldApplyLike: remoteStreamScenario.shouldApplyLike,
        reason: remoteStreamScenario.reason,
      },
      speakerLabels,
    });
    const targetOrderNormalizedRuntime = evaluateTargetRuntimeTelemetrySelection({
      localMicOnly: {
        selectedMapping: localMicOrderNormalizedScenario.selectedMapping,
        selectedCoverageBySpeaker:
          localMicOrderNormalizedScenario.selectedCoverageBySpeaker,
        globalMargin: localMicOrderNormalizedScenario.globalMargin,
        shouldApplyLike: localMicOrderNormalizedScenario.shouldApplyLike,
        reason: localMicOrderNormalizedScenario.reason,
      },
      remoteStreamOnly: {
        selectedMapping: remoteOrderNormalizedScenario.selectedMapping,
        selectedCoverageBySpeaker:
          remoteOrderNormalizedScenario.selectedCoverageBySpeaker,
        globalMargin: remoteOrderNormalizedScenario.globalMargin,
        shouldApplyLike: remoteOrderNormalizedScenario.shouldApplyLike,
        reason: remoteOrderNormalizedScenario.reason,
      },
      speakerLabels,
    });
    scoringScenarios.target_order_normalized_runtime = {
      ...targetOrderNormalizedRuntime,
      providerWindowPathology,
      selectedWindowStrategy:
        targetOrderNormalizedRuntime.selectedTelemetrySource ===
        VOX_REMOTE_STREAM_ACTIVITY_SOURCE
          ? "order_normalized_windows"
          : "provider_raw_windows",
      orderedWindowScoreMatrix:
        scoringScenarios.remote_stream_order_normalized_windows.scoreMatrix ?? {},
      orderedWindowSelectedMapping:
        scoringScenarios.remote_stream_order_normalized_windows.selectedMapping ??
        {},
      orderedWindowGlobalMargin:
        scoringScenarios.remote_stream_order_normalized_windows.globalMargin ?? null,
      orderedWindowPerSpeakerMargins:
        scoringScenarios.remote_stream_order_normalized_windows.perSpeakerMargins ??
        {},
      orderedWindowSelectedCoverageBySpeaker:
        scoringScenarios.remote_stream_order_normalized_windows
          .selectedCoverageBySpeaker ?? {},
    };

    const recommendations = [
      `Current runtime auto-apply decision: ${currentRuntime.decision.shouldApply} (${currentRuntime.decision.reason})`,
      currentRuntime.decision.shouldApply
        ? "Current runtime mapping failure appears unjustified by scorer replay; inspect state/UI freshness."
        : "Current runtime mapping failure appears justified by stored telemetry/transcript evidence.",
      scoringScenarios.turn_majority_voting
        ? `Turn-majority mapping candidate: ${JSON.stringify(scoringScenarios.turn_majority_voting.selectedMapping)}`
        : "Turn-majority mapping unavailable.",
      scoringScenarios.center_point_voting
        ? `Center-point mapping candidate: ${JSON.stringify(scoringScenarios.center_point_voting.selectedMapping)}`
        : "Center-point mapping unavailable.",
      scoringScenarios.telemetry_shift_sweep.bestShift
        ? `Best telemetry shift: ${scoringScenarios.telemetry_shift_sweep.bestShift.shiftMs}ms (margin ${scoringScenarios.telemetry_shift_sweep.bestShift.globalMargin})`
        : "No telemetry shift conclusion (insufficient overlap data).",
      `Source recommendation: ${sourceRecommendations.join(", ") || "none"}`,
      "Calibration block heuristic may help only if first long turns produce clear disjoint overlap windows.",
      "This tool replays stored SessionParticipantAudioActivity and TranscriptSegment only; it cannot reconstruct missing browser mic snapshots.",
    ];

    const summaryJson = {
      tool: "session-speaker-mapping-forensics",
      generatedAt: new Date().toISOString(),
      NO_DB_MUTATION: true,
      limitation:
        "Cannot recreate browser microphone telemetry if raw mic samples/debug snapshots were not stored. Replays stored SessionParticipantAudioActivity and TranscriptSegment only.",
      params: {
        sessionId: args.sessionId,
        envFile: args.envFile ?? null,
        outDir,
      },
      missingData: missing,
      basicFacts: {
        session: session
          ? {
              id: session.id,
              title: session.title,
              status: session.status,
              startedAt: toIsoOrNull(session.startedAt),
              endedAt: toIsoOrNull(session.endedAt),
            }
          : null,
        recording: recording
          ? {
              id: recording.id,
              status: recording.status,
              startedAt: toIsoOrNull(recording.startedAt),
              endedAt: toIsoOrNull(recording.endedAt),
              durationMs: recordingDurationMs,
            }
          : null,
        transcript: transcript
          ? {
              id: transcript.id,
              status: transcript.status,
              diarizationStatus: transcript.diarizationStatus,
              speakerMappingStatus: transcript.speakerMappingStatus,
            }
          : null,
        participants: participants.map((participant) => {
          const candidate = candidateParticipants.find((item) => item.participantId === participant.id);
          return {
            id: participant.id,
            name: participant.name,
            role: participant.role,
            sessionRole: participant.sessionRole,
            joinedAt: toIsoOrNull(participant.joinedAt),
            leftAt: toIsoOrNull(participant.leftAt),
            candidateIncluded: candidate?.included ?? false,
            candidateReason: candidate?.reason ?? "unknown",
          };
        }),
      },
      transcriptAnalysis: transcriptSpeakerDiagnostics,
      audioActivityAnalysis: audioParticipantStats,
      audioActivityBySource: {
        rowsBySource: normalizedCurrent.rowsBySource,
        rowsByParticipantBySource: normalizedCurrent.rowsByParticipantBySource,
        durationByParticipantBySource: normalizedCurrent.durationByParticipantBySource,
        excludedRowsByReason: normalizedCurrent.excludedRowsByReason,
      },
      currentScorerReplay: {
        providerWindowPathology,
        selectedWindowStrategy: "provider_raw_windows",
        scoreMatrix: scoreCurrent.scoreMatrix,
        selectedMapping: currentRuntime.mapping,
        selectedMargins: currentRuntime.selection.margins,
        selectedCoverageBySpeaker: currentRuntime.selectedCoverageBySpeaker,
        globalAssignmentCandidates: currentRuntime.globalCandidates,
        globalMargin: currentRuntime.globalMargin,
        thresholds: currentRuntime.thresholds,
        decision: {
          shouldApply: currentRuntime.decision.shouldApply,
          reason: currentRuntime.decision.reason,
          weakMarginDetected: currentRuntime.weakMargin,
          weakMarginOverriddenByGlobalEvidence:
            currentRuntime.weakMarginOverriddenByGlobalEvidence,
          blockingWarnings: currentRuntime.blockingWarnings,
          nonBlockingWarnings: currentRuntime.nonBlockingWarnings,
        },
      },
      orderNormalizedReplay: {
        selectedWindowStrategy: "order_normalized_windows",
        providerWindowPathology,
        orderedWindowScoreMatrix:
          scoringScenarios.remote_stream_order_normalized_windows.scoreMatrix ?? {},
        orderedWindowSelectedMapping:
          scoringScenarios.remote_stream_order_normalized_windows.selectedMapping ??
          {},
        orderedWindowGlobalMargin:
          scoringScenarios.remote_stream_order_normalized_windows.globalMargin ??
          null,
        orderedWindowPerSpeakerMargins:
          scoringScenarios.remote_stream_order_normalized_windows
            .perSpeakerMargins ?? {},
        orderedWindowSelectedCoverageBySpeaker:
          scoringScenarios.remote_stream_order_normalized_windows
            .selectedCoverageBySpeaker ?? {},
      },
      segmentLevelOverlapDetail: segmentOverlapDetail,
      participantLevelReverseOverlap: participantOverlapDetail,
      scoringScenarios,
      requiredSourceScenarios: REQUIRED_SOURCE_SCENARIOS,
      sourceRecommendations,
      targetRuntimeSourceSelection,
      rootCauseClassification,
      recommendations,
      dataReads: [
        "Session",
        "SessionParticipant (+SessionRole)",
        "Recording (latest/completed)",
        "Transcript (latest/completed)",
        "TranscriptSegment (for selected transcript)",
        "SessionParticipantAudioActivity",
      ],
    };

    const summaryMdLines = [
      "# Session Speaker Mapping Forensics",
      "",
      "NO_DB_MUTATION=true",
      "",
      `Session: ${args.sessionId}`,
      "",
      "## Limitation",
      "- Cannot recreate browser microphone telemetry if raw mic samples/debug snapshots were not stored.",
      "- Replays/analyzes stored `SessionParticipantAudioActivity` + `TranscriptSegment` only.",
      "",
      "## Basic Facts",
      `- Session: ${session ? `${session.id} | ${session.title} | ${session.status}` : "missing"}`,
      `- Recording: ${recording ? `${recording.id} | ${recording.status} | durationMs=${recordingDurationMs ?? "n/a"}` : "missing"}`,
      `- Transcript: ${
        transcript
          ? `${transcript.id} | status=${transcript.status} | diarizationStatus=${transcript.diarizationStatus ?? "n/a"} | speakerMappingStatus=${transcript.speakerMappingStatus ?? "n/a"}`
          : "missing"
      }`,
      `- Missing entities: ${missing.length ? missing.join(", ") : "none"}`,
      "",
      "### Participants",
      ...participants.map((participant) => {
        const c = candidateParticipants.find((item) => item.participantId === participant.id);
        return `- ${participant.id} | ${participant.name} | role=${participant.role} | sessionRole=${participant.sessionRole ?? "n/a"} | included=${c?.included ?? false} (${c?.reason ?? "unknown"})`;
      }),
      "",
      "## Current Runtime Replay",
      `- shouldApply: ${currentRuntime.decision.shouldApply}`,
      `- reason: ${currentRuntime.decision.reason}`,
      `- selectedWindowStrategy: provider_raw_windows`,
      `- providerWindowPathology: ${JSON.stringify(providerWindowPathology)}`,
      `- globalMargin: ${currentRuntime.globalMargin ?? "n/a"}`,
      `- selectedCoverageBySpeaker: ${JSON.stringify(currentRuntime.selectedCoverageBySpeaker)}`,
      `- selectedMapping: ${JSON.stringify(currentRuntime.mapping)}`,
      `- weakMarginDetected: ${currentRuntime.weakMargin}`,
      `- weakMarginOverriddenByGlobalEvidence: ${currentRuntime.weakMarginOverriddenByGlobalEvidence}`,
      `- blockingWarnings: ${
        currentRuntime.blockingWarnings.length ? currentRuntime.blockingWarnings.join(", ") : "none"
      }`,
      `- rowsBySource: ${JSON.stringify(normalizedCurrent.rowsBySource)}`,
      `- excludedRowsByReason: ${JSON.stringify(normalizedCurrent.excludedRowsByReason)}`,
      "",
      "## Scenario Highlights",
      `- local_mic_only: ${scoringScenarios.local_mic_only.reason}, shouldApplyLike=${scoringScenarios.local_mic_only.shouldApplyLike}, margin=${scoringScenarios.local_mic_only.globalMargin ?? "n/a"}`,
      `- remote_stream_only: ${scoringScenarios.remote_stream_only.reason}, shouldApplyLike=${scoringScenarios.remote_stream_only.shouldApplyLike}, margin=${scoringScenarios.remote_stream_only.globalMargin ?? "n/a"}`,
      `- local_mic_order_normalized_windows: ${scoringScenarios.local_mic_order_normalized_windows.reason}, shouldApplyLike=${scoringScenarios.local_mic_order_normalized_windows.shouldApplyLike}, margin=${scoringScenarios.local_mic_order_normalized_windows.globalMargin ?? "n/a"}`,
      `- remote_stream_order_normalized_windows: ${scoringScenarios.remote_stream_order_normalized_windows.reason}, shouldApplyLike=${scoringScenarios.remote_stream_order_normalized_windows.shouldApplyLike}, margin=${scoringScenarios.remote_stream_order_normalized_windows.globalMargin ?? "n/a"}`,
      `- target_order_normalized_runtime: selectedTelemetrySource=${scoringScenarios.target_order_normalized_runtime.selectedTelemetrySource}, targetRuntimeDecision=${scoringScenarios.target_order_normalized_runtime.targetRuntimeDecision}, wouldAutoApplyWithTargetLogic=${scoringScenarios.target_order_normalized_runtime.wouldAutoApplyWithTargetLogic}`,
      `- combined_naive: ${scoringScenarios.combined_naive.reason}, shouldApplyLike=${scoringScenarios.combined_naive.shouldApplyLike}, margin=${scoringScenarios.combined_naive.globalMargin ?? "n/a"}`,
      `- combined_deduplicated: ${scoringScenarios.combined_deduplicated.reason}, shouldApplyLike=${scoringScenarios.combined_deduplicated.shouldApplyLike}, margin=${scoringScenarios.combined_deduplicated.globalMargin ?? "n/a"}`,
      `- exclude_derived_offsets: ${scoringScenarios.exclude_derived_offsets.reason}, shouldApplyLike=${scoringScenarios.exclude_derived_offsets.shouldApplyLike}`,
      `- exclude_outside_window: ${scoringScenarios.exclude_outside_window.reason}, shouldApplyLike=${scoringScenarios.exclude_outside_window.shouldApplyLike}`,
      `- telemetry_shift_sweep best: shiftMs=${
        scoringScenarios.telemetry_shift_sweep.bestShift?.shiftMs ?? "n/a"
      }, margin=${scoringScenarios.telemetry_shift_sweep.bestShift?.globalMargin ?? "n/a"}, improvement=${scoringScenarios.telemetry_shift_sweep.improvement ?? "n/a"}`,
      `- turn_majority_voting: ${JSON.stringify(scoringScenarios.turn_majority_voting.selectedMapping)}`,
      `- center_point_voting: ${JSON.stringify(scoringScenarios.center_point_voting.selectedMapping)}`,
      "",
      "## Root Cause Classification",
      ...rootCauseClassification.map(
        (item) =>
          `- ${item.classification}: ${item.evidence.join(" | ")} -> next: ${item.nextAction}`,
      ),
      "",
      "## Recommendations",
      `- raw-window result: mapping=${JSON.stringify(scoringScenarios.remote_stream_only.selectedMapping)}, margin=${scoringScenarios.remote_stream_only.globalMargin ?? "n/a"}, shouldApplyLike=${scoringScenarios.remote_stream_only.shouldApplyLike}`,
      `- ordered-window result: mapping=${JSON.stringify(scoringScenarios.remote_stream_order_normalized_windows.selectedMapping)}, margin=${scoringScenarios.remote_stream_order_normalized_windows.globalMargin ?? "n/a"}, shouldApplyLike=${scoringScenarios.remote_stream_order_normalized_windows.shouldApplyLike}`,
      `- ordered windows would auto-apply: ${scoringScenarios.target_order_normalized_runtime.wouldAutoApplyWithTargetLogic}`,
      `- Source recommendations: ${sourceRecommendations.join(", ") || "none"}`,
      `- targetRuntimeDecision: ${targetRuntimeSourceSelection.targetRuntimeDecision}`,
      `- selectedTelemetrySource: ${targetRuntimeSourceSelection.selectedTelemetrySource}`,
      `- fallbackReason: ${targetRuntimeSourceSelection.fallbackReason ?? "none"}`,
      `- wouldAutoApplyWithTargetLogic: ${targetRuntimeSourceSelection.wouldAutoApplyWithTargetLogic}`,
      ...recommendations.map((line) => `- ${line}`),
      "",
    ];

    await fs.writeFile(path.join(outDir, "summary.json"), JSON.stringify(summaryJson, null, 2));
    await fs.writeFile(path.join(outDir, "summary.md"), summaryMdLines.join("\n"));
    await fs.writeFile(
      path.join(outDir, "transcript-segments.csv"),
      toCsv(transcriptSegmentsCsvRows, [
        "segmentId",
        "orderIndex",
        "speakerLabel",
        "startMs",
        "endMs",
        "durationMs",
        "text",
      ]),
    );
    await fs.writeFile(
      path.join(outDir, "audio-activity-raw.csv"),
      toCsv(rawAudioCsvRows, [
        "id",
        "sessionParticipantId",
        "participantName",
        "startedAt",
        "endedAt",
        "startedOffsetSeconds",
        "endedOffsetSeconds",
        "confidence",
        "source",
        "createdAt",
      ]),
    );
    await fs.writeFile(
      path.join(outDir, "audio-activity-normalized.csv"),
      toCsv(normalizedAudioCsvRows, [
        "participantId",
        "participantName",
        "intervalIndex",
        "startMs",
        "endMs",
        "durationMs",
        "usedDerivedOffset",
        "hadOutsideWindow",
        "sourceCount",
        "source",
      ]),
    );
    await fs.writeFile(
      path.join(outDir, "overlap-matrix.csv"),
      toCsv(overlapMatrixCsvRows, [
        "speakerLabel",
        "participantId",
        "participantName",
        "overlapMs",
        "speakerDurationMs",
        "coverage",
      ]),
    );
    await fs.writeFile(
      path.join(outDir, "segment-overlap-detail.csv"),
      toCsv(segmentOverlapCsvRows, [
        "segmentId",
        "orderIndex",
        "speakerLabel",
        "startMs",
        "endMs",
        "durationMs",
        "textPreview",
        "bestParticipantId",
        "bestOverlapRatio",
        "secondOverlapRatio",
        "segmentMargin",
        "noTelemetryOverlap",
        "ambiguousSegment",
        "crossTalkPossible",
        "segmentTooLong",
        "turnBoundarySuspicious",
        "outsideRecordingWindow",
        "overlapByParticipantMs",
      ]),
    );
    await fs.writeFile(
      path.join(outDir, "participant-overlap-detail.csv"),
      toCsv(participantOverlapCsvRows, [
        "participantId",
        "participantName",
        "startMs",
        "endMs",
        "durationMs",
        "bestSpeakerLabel",
        "noTranscriptOverlap",
        "overlapsMultipleSpeakers",
        "outsideRecordingWindow",
        "derivedOffset",
        "overlapBySpeakerMs",
      ]),
    );
    await fs.writeFile(
      path.join(outDir, "scoring-scenarios.json"),
      JSON.stringify(scoringScenarios, null, 2),
    );
    await fs.writeFile(path.join(outDir, "timeline.md"), timelineMarkdown(timelineRows));
    await fs.writeFile(path.join(outDir, "timeline.html"), timelineHtml(timelineRows));

    console.log(`[forensics] done session=${args.sessionId}`);
    console.log(`[forensics] output=${outDir}`);
    console.log(`[forensics] current_runtime shouldApply=${currentRuntime.decision.shouldApply} reason=${currentRuntime.decision.reason} globalMargin=${currentRuntime.globalMargin}`);
    console.log(`[forensics] score_matrix=${JSON.stringify(scoreCurrent.scoreMatrix)}`);
    console.log(`[forensics] selected_coverage=${JSON.stringify(currentRuntime.selectedCoverageBySpeaker)}`);
    console.log(`[forensics] root_causes=${rootCauseClassification.map((item) => item.classification).join(",")}`);
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error("[session-speaker-mapping-forensics] failed:", error.message);
  process.exit(1);
});
