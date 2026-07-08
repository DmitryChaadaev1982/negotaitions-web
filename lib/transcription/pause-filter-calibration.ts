import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  classifySegmentAgainstPauseIntervals,
  type PauseOverlapClassification,
} from "@/lib/transcription/pause-interval-filter";
import type { NormalizedSegment } from "@/lib/transcription/speaker-labels";

export type PauseOffsetInterval = {
  startSeconds: number;
  endSeconds: number;
};

export type PauseAbsoluteInterval = {
  startedAt: string;
  endedAt: string | null;
};

export type CalibrationSegment = NormalizedSegment & {
  mappedParticipantId?: string | null;
};

export type SegmentProductionDecision = {
  classification: PauseOverlapClassification;
  shouldDrop: boolean;
  overlapDurationSeconds: number;
  overlapRatio: number;
  matchedIntervals: number;
};

export type RawCalibrationSegment = {
  orderIndex: number;
  speakerLabel: string | null;
  displaySpeakerLabel: string | null;
  rawSpeakerLabel: string | null;
  mappedParticipantId: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  durationSeconds: number | null;
  text: string;
  productionDecision: SegmentProductionDecision;
};

export type RawCalibrationInputArtifact = {
  schemaVersion: "1";
  generatedAt: string;
  warnings: string[];
  sessionId: string;
  recordingId: string;
  transcriptId: string;
  recording: {
    startedAt: string | null;
    endedAt: string | null;
    durationSeconds: number | null;
  };
  transcriptBeforeFiltering: {
    text: string | null;
    diarizedText: string | null;
  };
  provider: {
    normalizedSegments: NormalizedSegment[];
  };
  mappedSegmentsBeforeFiltering: RawCalibrationSegment[];
  pauseIntervals: {
    absolute: PauseAbsoluteInterval[];
    offsets: PauseOffsetInterval[];
  };
  markers: {
    active: string[];
    paused: string[];
  };
};

export type RuleFamily =
  | "any_overlap_drop"
  | "ratio_only"
  | "absolute_overlap_only"
  | "midpoint_inside_pause"
  | "padded_midpoint_inside_pause"
  | "midpoint_or_ratio"
  | "midpoint_or_absolute"
  | "hybrid_centerline";

export type PauseFilterCandidate = {
  family: RuleFamily;
  boundaryToleranceSeconds: number;
  midpointPaddingSeconds: number;
  dropOverlapRatio: number;
  significantPauseOverlapSeconds: number;
};

export type SegmentClassificationRow = {
  candidateId: string;
  segmentOrderIndex: number;
  startSeconds: number | null;
  endSeconds: number | null;
  text: string;
  shouldDrop: boolean;
  reasons: string[];
  overlapDurationSeconds: number;
  overlapRatio: number;
  midpointSeconds: number | null;
};

export type CandidateDiagnostics = {
  rawSegmentCount: number;
  keptSegmentCount: number;
  droppedSegmentCount: number;
  pauseIntervalCount: number;
  keptPausedOverlapSecondsTotal: number;
  droppedPausedOverlapSecondsTotal: number;
  maxKeptPauseOverlapSeconds: number;
  maxDroppedPauseOverlapSeconds: number;
  midpointDropCount: number;
  ratioDropCount: number;
  absoluteDropCount: number;
  jitterKeptCount: number;
};

export type CandidateMarkerStats = {
  activeMarkersTotal: number;
  activeMarkersPresent: number;
  activeMarkersMissing: number;
  pausedMarkersTotal: number;
  pausedMarkersPresent: number;
  pausedMarkersAbsent: number;
};

export type CandidateEvaluation = {
  candidateId: string;
  candidate: PauseFilterCandidate;
  diagnostics: CandidateDiagnostics;
  markerStats: CandidateMarkerStats;
  reconstructedText: string;
  score: number;
  penalties: string[];
};

export type CalibrationRunResult = {
  generatedAt: string;
  inputWarnings: string[];
  markersInRawText: {
    activeMarkersDetected: string[];
    pausedMarkersDetected: string[];
  };
  inconclusive: boolean;
  reason: string | null;
  recommendedRule: {
    candidateId: string;
    family: RuleFamily;
    boundaryToleranceSeconds: number;
    midpointPaddingSeconds: number;
    dropOverlapRatio: number;
    significantPauseOverlapSeconds: number;
    score: number;
    confidence: "high" | "medium" | "low";
  } | null;
  candidates: CandidateEvaluation[];
  classifications: SegmentClassificationRow[];
};

const GRID_BOUNDARY_TOLERANCE_SECONDS = [0.15, 0.25, 0.35, 0.5];
const GRID_MIDPOINT_PADDING_SECONDS = [0, 0.25, 0.5, 0.75, 1.0];
const GRID_DROP_OVERLAP_RATIO = [0.5, 0.6, 0.7, 0.75, 0.85];
const GRID_SIGNIFICANT_PAUSE_OVERLAP_SECONDS = [1.0, 1.25, 1.5, 2.0, 2.5, 3.0];
const RULE_FAMILIES: RuleFamily[] = [
  "any_overlap_drop",
  "ratio_only",
  "absolute_overlap_only",
  "midpoint_inside_pause",
  "padded_midpoint_inside_pause",
  "midpoint_or_ratio",
  "midpoint_or_absolute",
  "hybrid_centerline",
];

const RULE_SIMPLICITY_RANK: Record<RuleFamily, number> = {
  any_overlap_drop: 1,
  ratio_only: 1,
  absolute_overlap_only: 1,
  midpoint_inside_pause: 1,
  padded_midpoint_inside_pause: 2,
  midpoint_or_ratio: 2,
  midpoint_or_absolute: 2,
  hybrid_centerline: 3,
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function parseCalibrationMarkerList(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  return uniqueNonEmpty(raw.split("|"));
}

function mergeIntervals(intervals: PauseOffsetInterval[]): PauseOffsetInterval[] {
  if (intervals.length <= 1) {
    return [...intervals];
  }
  const sorted = [...intervals].sort(
    (a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds,
  );
  const merged: PauseOffsetInterval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.startSeconds > previous.endSeconds) {
      merged.push({ ...interval });
      continue;
    }
    previous.endSeconds = Math.max(previous.endSeconds, interval.endSeconds);
  }
  return merged;
}

function overlapWithPauseIntervals(
  segment: { startSeconds: number; endSeconds: number },
  pauseIntervals: PauseOffsetInterval[],
) {
  let overlapDurationSeconds = 0;
  for (const interval of pauseIntervals) {
    const start = Math.max(segment.startSeconds, interval.startSeconds);
    const end = Math.min(segment.endSeconds, interval.endSeconds);
    if (end > start) {
      overlapDurationSeconds += end - start;
    }
  }
  return overlapDurationSeconds;
}

function isMidpointInsidePause(
  midpointSeconds: number,
  pauseIntervals: PauseOffsetInterval[],
  paddingSeconds: number,
): boolean {
  for (const interval of pauseIntervals) {
    const start = interval.startSeconds - paddingSeconds;
    const end = interval.endSeconds + paddingSeconds;
    if (midpointSeconds >= start && midpointSeconds <= end) {
      return true;
    }
  }
  return false;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function candidateToId(candidate: PauseFilterCandidate): string {
  return [
    candidate.family,
    `bt=${formatNumber(candidate.boundaryToleranceSeconds)}`,
    `mp=${formatNumber(candidate.midpointPaddingSeconds)}`,
    `rr=${formatNumber(candidate.dropOverlapRatio)}`,
    `abs=${formatNumber(candidate.significantPauseOverlapSeconds)}`,
  ].join("|");
}

export function resolveCalibrationSessionDir(
  baseDir: string,
  sessionId: string,
): string {
  return path.join(baseDir, sessionId);
}

function segmentDurationSeconds(segment: {
  startSeconds: number | null;
  endSeconds: number | null;
}): number | null {
  if (
    segment.startSeconds == null ||
    segment.endSeconds == null ||
    !Number.isFinite(segment.startSeconds) ||
    !Number.isFinite(segment.endSeconds) ||
    segment.endSeconds <= segment.startSeconds
  ) {
    return null;
  }
  return segment.endSeconds - segment.startSeconds;
}

export function buildRawCalibrationInputArtifact(params: {
  sessionId: string;
  recordingId: string;
  transcriptId: string;
  recordingStartedAt: Date | null;
  recordingEndedAt: Date | null;
  recordingDurationSeconds: number | null;
  transcriptTextBeforeFiltering: string | null;
  diarizedTextBeforeFiltering: string | null;
  providerNormalizedSegments: NormalizedSegment[];
  mappedSegmentsBeforeFiltering: CalibrationSegment[];
  pauseIntervalsAbsolute: Array<{ startedAt: Date; endedAt: Date | null }>;
  pauseIntervalsOffsets: PauseOffsetInterval[];
  activeMarkers: string[];
  pausedMarkers: string[];
}): RawCalibrationInputArtifact {
  const warnings: string[] = [];
  if (params.mappedSegmentsBeforeFiltering.length === 0) {
    warnings.push(
      "No mapped segments were available before pause filtering; calibration signal may be inconclusive.",
    );
  }

  const mappedSegmentsBeforeFiltering: RawCalibrationSegment[] =
    params.mappedSegmentsBeforeFiltering.map((segment) => {
      const productionDecision = classifySegmentAgainstPauseIntervals(
        {
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
        },
        params.pauseIntervalsOffsets,
      );
      return {
        orderIndex: segment.orderIndex,
        speakerLabel: segment.speakerLabel,
        displaySpeakerLabel: segment.displaySpeakerLabel,
        rawSpeakerLabel: segment.rawSpeakerLabel ?? null,
        mappedParticipantId: segment.mappedParticipantId ?? null,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        durationSeconds: segmentDurationSeconds(segment),
        text: segment.text,
        productionDecision: {
          classification: productionDecision.classification,
          shouldDrop: productionDecision.shouldDrop,
          overlapDurationSeconds: productionDecision.overlapDurationSeconds,
          overlapRatio: productionDecision.overlapRatio,
          matchedIntervals: productionDecision.matchedIntervals,
        },
      };
    });

  return {
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    warnings,
    sessionId: params.sessionId,
    recordingId: params.recordingId,
    transcriptId: params.transcriptId,
    recording: {
      startedAt: params.recordingStartedAt?.toISOString() ?? null,
      endedAt: params.recordingEndedAt?.toISOString() ?? null,
      durationSeconds: params.recordingDurationSeconds,
    },
    transcriptBeforeFiltering: {
      text: params.transcriptTextBeforeFiltering,
      diarizedText: params.diarizedTextBeforeFiltering,
    },
    provider: {
      normalizedSegments: params.providerNormalizedSegments,
    },
    mappedSegmentsBeforeFiltering,
    pauseIntervals: {
      absolute: params.pauseIntervalsAbsolute.map((interval) => ({
        startedAt: interval.startedAt.toISOString(),
        endedAt: interval.endedAt?.toISOString() ?? null,
      })),
      offsets: params.pauseIntervalsOffsets,
    },
    markers: {
      active: params.activeMarkers,
      paused: params.pausedMarkers,
    },
  };
}

export async function writeRawCalibrationInputArtifact(params: {
  calibrationDir: string;
  sessionId: string;
  artifact: RawCalibrationInputArtifact;
}): Promise<string> {
  const sessionDir = resolveCalibrationSessionDir(
    params.calibrationDir,
    params.sessionId,
  );
  const outputPath = path.join(sessionDir, "raw-calibration-input.json");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(outputPath, JSON.stringify(params.artifact, null, 2), "utf8");
  return outputPath;
}

function buildCandidateGrid(): PauseFilterCandidate[] {
  const candidates: PauseFilterCandidate[] = [];
  for (const family of RULE_FAMILIES) {
    for (const boundaryToleranceSeconds of GRID_BOUNDARY_TOLERANCE_SECONDS) {
      for (const midpointPaddingSeconds of GRID_MIDPOINT_PADDING_SECONDS) {
        for (const dropOverlapRatio of GRID_DROP_OVERLAP_RATIO) {
          for (const significantPauseOverlapSeconds of GRID_SIGNIFICANT_PAUSE_OVERLAP_SECONDS) {
            candidates.push({
              family,
              boundaryToleranceSeconds,
              midpointPaddingSeconds,
              dropOverlapRatio,
              significantPauseOverlapSeconds,
            });
          }
        }
      }
    }
  }
  return candidates;
}

function evaluateCandidateAgainstSegment(
  candidate: PauseFilterCandidate,
  segment: RawCalibrationSegment,
  pauseIntervals: PauseOffsetInterval[],
): {
  shouldDrop: boolean;
  reasons: string[];
  overlapDurationSeconds: number;
  overlapRatio: number;
  midpointSeconds: number | null;
} {
  if (
    segment.startSeconds == null ||
    segment.endSeconds == null ||
    !Number.isFinite(segment.startSeconds) ||
    !Number.isFinite(segment.endSeconds) ||
    segment.endSeconds <= segment.startSeconds
  ) {
    return {
      shouldDrop: false,
      reasons: ["invalid_timing"],
      overlapDurationSeconds: 0,
      overlapRatio: 0,
      midpointSeconds: null,
    };
  }

  const duration = segment.endSeconds - segment.startSeconds;
  const overlapDurationSeconds = overlapWithPauseIntervals(
    { startSeconds: segment.startSeconds, endSeconds: segment.endSeconds },
    pauseIntervals,
  );
  const overlapRatio = duration > 0 ? overlapDurationSeconds / duration : 0;
  const midpointSeconds = segment.startSeconds + duration / 2;
  const midpointInside = isMidpointInsidePause(
    midpointSeconds,
    pauseIntervals,
    candidate.family === "midpoint_inside_pause"
      ? 0
      : candidate.midpointPaddingSeconds,
  );

  const reasons: string[] = [];
  if (midpointInside) {
    reasons.push("midpoint");
  }
  if (overlapRatio >= candidate.dropOverlapRatio && overlapDurationSeconds > 0) {
    reasons.push("ratio");
  }
  if (overlapDurationSeconds >= candidate.significantPauseOverlapSeconds) {
    reasons.push("absolute");
  }
  if (
    overlapDurationSeconds > 0 &&
    overlapDurationSeconds <= candidate.boundaryToleranceSeconds
  ) {
    reasons.push("jitter_boundary");
  }

  let shouldDrop = false;
  switch (candidate.family) {
    case "any_overlap_drop":
      shouldDrop = overlapDurationSeconds > 0;
      break;
    case "ratio_only":
      shouldDrop = reasons.includes("ratio");
      break;
    case "absolute_overlap_only":
      shouldDrop = reasons.includes("absolute");
      break;
    case "midpoint_inside_pause":
      shouldDrop = midpointInside;
      break;
    case "padded_midpoint_inside_pause":
      shouldDrop = midpointInside;
      break;
    case "midpoint_or_ratio":
      shouldDrop = midpointInside || reasons.includes("ratio");
      break;
    case "midpoint_or_absolute":
      shouldDrop = midpointInside || reasons.includes("absolute");
      break;
    case "hybrid_centerline":
      shouldDrop =
        reasons.includes("ratio") ||
        reasons.includes("absolute") ||
        (midpointInside &&
          overlapDurationSeconds >
            Math.max(candidate.boundaryToleranceSeconds, 0.05));
      break;
  }

  return {
    shouldDrop,
    reasons,
    overlapDurationSeconds,
    overlapRatio,
    midpointSeconds,
  };
}

function markerPresent(text: string, marker: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedMarker = normalizeText(marker);
  if (!normalizedMarker) {
    return false;
  }
  return normalizedText.includes(normalizedMarker);
}

function computeMarkerStats(
  reconstructedText: string,
  activeMarkers: string[],
  pausedMarkers: string[],
): CandidateMarkerStats {
  const activeMarkersPresent = activeMarkers.filter((marker) =>
    markerPresent(reconstructedText, marker),
  ).length;
  const pausedMarkersPresent = pausedMarkers.filter((marker) =>
    markerPresent(reconstructedText, marker),
  ).length;
  return {
    activeMarkersTotal: activeMarkers.length,
    activeMarkersPresent,
    activeMarkersMissing: activeMarkers.length - activeMarkersPresent,
    pausedMarkersTotal: pausedMarkers.length,
    pausedMarkersPresent,
    pausedMarkersAbsent: pausedMarkers.length - pausedMarkersPresent,
  };
}

function scoreCandidate(params: {
  markerStats: CandidateMarkerStats;
  diagnostics: CandidateDiagnostics;
  rawSegmentCount: number;
}): { score: number; penalties: string[] } {
  const { markerStats, diagnostics, rawSegmentCount } = params;
  let score = 0;
  const penalties: string[] = [];

  score += markerStats.activeMarkersPresent * 40;
  score -= markerStats.activeMarkersMissing * 140;
  score += markerStats.pausedMarkersAbsent * 35;
  score -= markerStats.pausedMarkersPresent * 160;

  const droppedRatio = rawSegmentCount > 0 ? diagnostics.droppedSegmentCount / rawSegmentCount : 0;
  if (droppedRatio > 0.8) {
    const penalty = Math.round((droppedRatio - 0.8) * 200);
    score -= penalty;
    penalties.push(`excessive_drop_ratio:${penalty}`);
  }

  const pausedOverlapPenalty = Math.round(
    diagnostics.keptPausedOverlapSecondsTotal * 6 +
      diagnostics.maxKeptPauseOverlapSeconds * 10,
  );
  if (pausedOverlapPenalty > 0) {
    score -= pausedOverlapPenalty;
    penalties.push(`kept_paused_overlap:${pausedOverlapPenalty}`);
  }

  if (diagnostics.jitterKeptCount === 0 && diagnostics.keptPausedOverlapSecondsTotal > 0) {
    score -= 8;
    penalties.push("no_jitter_tolerance");
  }

  return { score, penalties };
}

export function runPauseFilterCalibration(params: {
  input: RawCalibrationInputArtifact;
  activeMarkers?: string[];
  pausedMarkers?: string[];
}): CalibrationRunResult {
  const generatedAt = new Date().toISOString();
  const inputWarnings = [...params.input.warnings];
  const mergedPauseIntervals = mergeIntervals(params.input.pauseIntervals.offsets);
  const activeMarkers = uniqueNonEmpty(params.activeMarkers ?? params.input.markers.active);
  const pausedMarkers = uniqueNonEmpty(params.pausedMarkers ?? params.input.markers.paused);
  const rawText = params.input.mappedSegmentsBeforeFiltering
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join(" ");

  const activeMarkersDetected = activeMarkers.filter((marker) =>
    markerPresent(rawText, marker),
  );
  const pausedMarkersDetected = pausedMarkers.filter((marker) =>
    markerPresent(rawText, marker),
  );

  const noMarkerSignal =
    activeMarkersDetected.length === 0 && pausedMarkersDetected.length === 0;
  if (noMarkerSignal) {
    inputWarnings.push(
      "None of the provided markers were detected in raw pre-filter text; recommendations are inconclusive.",
    );
  }

  const candidates = buildCandidateGrid();
  const evaluations: CandidateEvaluation[] = [];
  const classifications: SegmentClassificationRow[] = [];

  for (const candidate of candidates) {
    const candidateId = candidateToId(candidate);
    const kept: RawCalibrationSegment[] = [];
    let keptPausedOverlapSecondsTotal = 0;
    let droppedPausedOverlapSecondsTotal = 0;
    let maxKeptPauseOverlapSeconds = 0;
    let maxDroppedPauseOverlapSeconds = 0;
    let midpointDropCount = 0;
    let ratioDropCount = 0;
    let absoluteDropCount = 0;
    let jitterKeptCount = 0;
    let droppedSegmentCount = 0;

    for (const segment of params.input.mappedSegmentsBeforeFiltering) {
      const evalResult = evaluateCandidateAgainstSegment(
        candidate,
        segment,
        mergedPauseIntervals,
      );
      const segmentRow: SegmentClassificationRow = {
        candidateId,
        segmentOrderIndex: segment.orderIndex,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
        shouldDrop: evalResult.shouldDrop,
        reasons: evalResult.reasons,
        overlapDurationSeconds: evalResult.overlapDurationSeconds,
        overlapRatio: evalResult.overlapRatio,
        midpointSeconds: evalResult.midpointSeconds,
      };
      classifications.push(segmentRow);

      if (evalResult.shouldDrop) {
        droppedSegmentCount += 1;
        droppedPausedOverlapSecondsTotal += evalResult.overlapDurationSeconds;
        maxDroppedPauseOverlapSeconds = Math.max(
          maxDroppedPauseOverlapSeconds,
          evalResult.overlapDurationSeconds,
        );
        if (evalResult.reasons.includes("midpoint")) {
          midpointDropCount += 1;
        }
        if (evalResult.reasons.includes("ratio")) {
          ratioDropCount += 1;
        }
        if (evalResult.reasons.includes("absolute")) {
          absoluteDropCount += 1;
        }
      } else {
        kept.push(segment);
        keptPausedOverlapSecondsTotal += evalResult.overlapDurationSeconds;
        maxKeptPauseOverlapSeconds = Math.max(
          maxKeptPauseOverlapSeconds,
          evalResult.overlapDurationSeconds,
        );
        if (evalResult.reasons.includes("jitter_boundary")) {
          jitterKeptCount += 1;
        }
      }
    }

    const reconstructedText = kept
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ");
    const diagnostics: CandidateDiagnostics = {
      rawSegmentCount: params.input.mappedSegmentsBeforeFiltering.length,
      keptSegmentCount: kept.length,
      droppedSegmentCount,
      pauseIntervalCount: mergedPauseIntervals.length,
      keptPausedOverlapSecondsTotal,
      droppedPausedOverlapSecondsTotal,
      maxKeptPauseOverlapSeconds,
      maxDroppedPauseOverlapSeconds,
      midpointDropCount,
      ratioDropCount,
      absoluteDropCount,
      jitterKeptCount,
    };
    const markerStats = computeMarkerStats(
      reconstructedText,
      activeMarkers,
      pausedMarkers,
    );
    const { score, penalties } = scoreCandidate({
      markerStats,
      diagnostics,
      rawSegmentCount: params.input.mappedSegmentsBeforeFiltering.length,
    });
    evaluations.push({
      candidateId,
      candidate,
      diagnostics,
      markerStats,
      reconstructedText,
      score,
      penalties,
    });
  }

  evaluations.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const simplicityDiff =
      RULE_SIMPLICITY_RANK[a.candidate.family] -
      RULE_SIMPLICITY_RANK[b.candidate.family];
    if (simplicityDiff !== 0) {
      return simplicityDiff;
    }
    return (
      a.diagnostics.droppedSegmentCount - b.diagnostics.droppedSegmentCount ||
      a.candidateId.localeCompare(b.candidateId)
    );
  });

  const top = evaluations[0] ?? null;
  const second = evaluations[1] ?? null;
  let recommendedRule: CalibrationRunResult["recommendedRule"] = null;
  if (top && !noMarkerSignal) {
    const scoreGap = second ? top.score - second.score : top.score;
    const confidence: "high" | "medium" | "low" =
      scoreGap >= 60 ? "high" : scoreGap >= 20 ? "medium" : "low";
    recommendedRule = {
      candidateId: top.candidateId,
      family: top.candidate.family,
      boundaryToleranceSeconds: top.candidate.boundaryToleranceSeconds,
      midpointPaddingSeconds: top.candidate.midpointPaddingSeconds,
      dropOverlapRatio: top.candidate.dropOverlapRatio,
      significantPauseOverlapSeconds:
        top.candidate.significantPauseOverlapSeconds,
      score: top.score,
      confidence,
    };
  }

  return {
    generatedAt,
    inputWarnings,
    markersInRawText: {
      activeMarkersDetected,
      pausedMarkersDetected,
    },
    inconclusive: noMarkerSignal,
    reason: noMarkerSignal
      ? "No active or paused markers were found in raw text."
      : null,
    recommendedRule,
    candidates: evaluations,
    classifications,
  };
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toScoreboardCsv(result: CalibrationRunResult): string {
  const header = [
    "candidateId",
    "family",
    "score",
    "activePresent",
    "activeMissing",
    "pausedPresent",
    "pausedAbsent",
    "kept",
    "dropped",
    "keptPausedOverlapSecondsTotal",
    "maxKeptPauseOverlapSeconds",
  ].join(",");
  const rows = result.candidates.map((entry) =>
    [
      entry.candidateId,
      entry.candidate.family,
      String(entry.score),
      String(entry.markerStats.activeMarkersPresent),
      String(entry.markerStats.activeMarkersMissing),
      String(entry.markerStats.pausedMarkersPresent),
      String(entry.markerStats.pausedMarkersAbsent),
      String(entry.diagnostics.keptSegmentCount),
      String(entry.diagnostics.droppedSegmentCount),
      entry.diagnostics.keptPausedOverlapSecondsTotal.toFixed(3),
      entry.diagnostics.maxKeptPauseOverlapSeconds.toFixed(3),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

function toSegmentClassificationCsv(result: CalibrationRunResult): string {
  const header = [
    "candidateId",
    "segmentOrderIndex",
    "startSeconds",
    "endSeconds",
    "shouldDrop",
    "reasons",
    "overlapDurationSeconds",
    "overlapRatio",
    "midpointSeconds",
    "text",
  ].join(",");
  const rows = result.classifications.map((row) =>
    [
      row.candidateId,
      String(row.segmentOrderIndex),
      row.startSeconds == null ? "" : row.startSeconds.toFixed(3),
      row.endSeconds == null ? "" : row.endSeconds.toFixed(3),
      row.shouldDrop ? "1" : "0",
      row.reasons.join("+"),
      row.overlapDurationSeconds.toFixed(3),
      row.overlapRatio.toFixed(4),
      row.midpointSeconds == null ? "" : row.midpointSeconds.toFixed(3),
      row.text,
    ]
      .map((value) => csvEscape(value))
      .join(","),
  );
  return [header, ...rows].join("\n");
}

function toReportMarkdown(
  input: RawCalibrationInputArtifact,
  result: CalibrationRunResult,
): string {
  const top = result.candidates[0] ?? null;
  const lines: string[] = [];
  lines.push("# Pause Filter Calibration Report");
  lines.push("");
  lines.push(`- Generated: ${result.generatedAt}`);
  lines.push(`- Session: ${input.sessionId}`);
  lines.push(`- Recording: ${input.recordingId}`);
  lines.push(`- Transcript: ${input.transcriptId}`);
  lines.push(`- Inconclusive: ${result.inconclusive ? "yes" : "no"}`);
  if (result.reason) {
    lines.push(`- Reason: ${result.reason}`);
  }
  if (result.recommendedRule) {
    lines.push(`- Recommended candidate: ${result.recommendedRule.candidateId}`);
    lines.push(`- Confidence: ${result.recommendedRule.confidence}`);
  } else {
    lines.push("- Recommended candidate: none");
  }
  lines.push("");
  lines.push("## Marker signal");
  lines.push("");
  lines.push(
    `- Active markers detected in raw text: ${result.markersInRawText.activeMarkersDetected.length}/${input.markers.active.length}`,
  );
  lines.push(
    `- Paused markers detected in raw text: ${result.markersInRawText.pausedMarkersDetected.length}/${input.markers.paused.length}`,
  );
  lines.push("");
  lines.push("## Top candidate");
  lines.push("");
  if (top) {
    lines.push(`- Candidate: ${top.candidateId}`);
    lines.push(`- Score: ${top.score}`);
    lines.push(
      `- Kept segments: ${top.diagnostics.keptSegmentCount}, dropped segments: ${top.diagnostics.droppedSegmentCount}`,
    );
    lines.push(
      `- Kept paused overlap seconds total: ${top.diagnostics.keptPausedOverlapSecondsTotal.toFixed(3)}`,
    );
  } else {
    lines.push("- No candidates evaluated.");
  }
  lines.push("");
  lines.push("## Warnings");
  lines.push("");
  if (result.inputWarnings.length === 0) {
    lines.push("- none");
  } else {
    for (const warning of result.inputWarnings) {
      lines.push(`- ${warning}`);
    }
  }
  lines.push("");
  lines.push(
    "> Warning: calibration artifacts can contain test speech text and should stay local.",
  );
  lines.push(
    "> Production pause-filter defaults are not changed by this tooling.",
  );
  return lines.join("\n");
}

export async function writeCalibrationRunArtifacts(params: {
  calibrationDir: string;
  sessionId: string;
  input: RawCalibrationInputArtifact;
  runResult: CalibrationRunResult;
}): Promise<{
  sessionDir: string;
  candidateScoreboardCsv: string;
  candidateScoreboardJson: string;
  segmentClassificationTableCsv: string;
  reconstructedTextByCandidateJson: string;
  recommendedRuleJson: string;
  calibrationReportMd: string;
}> {
  const sessionDir = resolveCalibrationSessionDir(
    params.calibrationDir,
    params.sessionId,
  );
  await mkdir(sessionDir, { recursive: true });

  const candidateScoreboardCsv = path.join(sessionDir, "candidate-scoreboard.csv");
  const candidateScoreboardJson = path.join(
    sessionDir,
    "candidate-scoreboard.json",
  );
  const segmentClassificationTableCsv = path.join(
    sessionDir,
    "segment-classification-table.csv",
  );
  const reconstructedTextByCandidateJson = path.join(
    sessionDir,
    "reconstructed-text-by-candidate.json",
  );
  const recommendedRuleJson = path.join(sessionDir, "recommended-rule.json");
  const calibrationReportMd = path.join(sessionDir, "calibration-report.md");

  const reconstructedText = Object.fromEntries(
    params.runResult.candidates.map((candidate) => [
      candidate.candidateId,
      candidate.reconstructedText,
    ]),
  );

  await writeFile(candidateScoreboardCsv, toScoreboardCsv(params.runResult), "utf8");
  await writeFile(
    candidateScoreboardJson,
    JSON.stringify(params.runResult.candidates, null, 2),
    "utf8",
  );
  await writeFile(
    segmentClassificationTableCsv,
    toSegmentClassificationCsv(params.runResult),
    "utf8",
  );
  await writeFile(
    reconstructedTextByCandidateJson,
    JSON.stringify(reconstructedText, null, 2),
    "utf8",
  );
  await writeFile(
    recommendedRuleJson,
    JSON.stringify(
      {
        generatedAt: params.runResult.generatedAt,
        inconclusive: params.runResult.inconclusive,
        reason: params.runResult.reason,
        recommendedRule: params.runResult.recommendedRule,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    calibrationReportMd,
    toReportMarkdown(params.input, params.runResult),
    "utf8",
  );

  return {
    sessionDir,
    candidateScoreboardCsv,
    candidateScoreboardJson,
    segmentClassificationTableCsv,
    reconstructedTextByCandidateJson,
    recommendedRuleJson,
    calibrationReportMd,
  };
}

export async function readRawCalibrationInput(
  inputPath: string,
): Promise<RawCalibrationInputArtifact> {
  const payload = await readFile(inputPath, "utf8");
  return JSON.parse(payload) as RawCalibrationInputArtifact;
}
