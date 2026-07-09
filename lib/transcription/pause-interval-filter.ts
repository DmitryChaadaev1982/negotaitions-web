type PauseInterval = {
  startedAt: Date;
  endedAt: Date | null;
};

type OffsetInterval = {
  startSeconds: number;
  endSeconds: number;
};

type TimedSegment = {
  startSeconds: number | null;
  endSeconds: number | null;
};

export type PauseOverlapClassification =
  | "no_overlap"
  | "fully_inside_pause"
  | "overlap_dominantly_paused"
  | "significant_pause_overlap"
  | "boundary_overlap_mostly_unpaused"
  | "invalid_segment_timestamps";

export type PauseOverlapDecision = {
  classification: PauseOverlapClassification;
  shouldDrop: boolean;
  segmentDurationSeconds: number;
  overlapDurationSeconds: number;
  overlapRatio: number;
  matchedIntervals: number;
};

export type PauseFilteringOptions = {
  /**
   * @deprecated Use dropOverlapRatio.
   */
  dominantOverlapRatioThreshold?: number;
  dropOverlapRatio?: number;
  boundaryToleranceSeconds?: number;
  significantPauseOverlapSeconds?: number;
};

export type PauseFilteringDiagnostics = {
  totalPausedIntervals: number;
  filteredSegmentCount: number;
  fullyPausedDroppedCount: number;
  boundaryOverlapKeptCount: number;
  boundaryOverlapDroppedCount: number;
  significantOverlapDroppedCount: number;
  maxKeptPauseOverlapSeconds: number;
  maxDroppedPauseOverlapSeconds: number;
};

/**
 * Legacy/deprecated fallback pause filtering implementation.
 * Production default pause handling should use source_audio_cut mode instead.
 */
const DEFAULT_DOMINANT_OVERLAP_RATIO_THRESHOLD = 0.6;
const DEFAULT_BOUNDARY_TOLERANCE_SECONDS = 0.35;
const DEFAULT_SIGNIFICANT_PAUSE_OVERLAP_SECONDS = 1.25;

function mergeOffsetIntervals(intervals: OffsetInterval[]): OffsetInterval[] {
  if (intervals.length <= 1) {
    return intervals;
  }
  const sorted = [...intervals].sort(
    (a, b) => a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds,
  );
  const merged: OffsetInterval[] = [];
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

function resolvePauseFilteringOptions(
  options?: PauseFilteringOptions,
): Required<PauseFilteringOptions> {
  const dropOverlapRatio =
    options?.dropOverlapRatio ??
    options?.dominantOverlapRatioThreshold ??
    DEFAULT_DOMINANT_OVERLAP_RATIO_THRESHOLD;
  return {
    dominantOverlapRatioThreshold: dropOverlapRatio,
    dropOverlapRatio,
    boundaryToleranceSeconds:
      options?.boundaryToleranceSeconds ?? DEFAULT_BOUNDARY_TOLERANCE_SECONDS,
    significantPauseOverlapSeconds:
      options?.significantPauseOverlapSeconds ??
      DEFAULT_SIGNIFICANT_PAUSE_OVERLAP_SECONDS,
  };
}

function overlapWithInterval(segment: {
  startSeconds: number;
  endSeconds: number;
}, interval: OffsetInterval): number {
  const overlapStart = Math.max(segment.startSeconds, interval.startSeconds);
  const overlapEnd = Math.min(segment.endSeconds, interval.endSeconds);
  return overlapEnd > overlapStart ? overlapEnd - overlapStart : 0;
}

export function buildPauseOffsetIntervals(params: {
  recordingStartedAt: Date | null | undefined;
  recordingEndedAt: Date | null | undefined;
  pauseIntervals: PauseInterval[];
}): OffsetInterval[] {
  const { recordingStartedAt, recordingEndedAt, pauseIntervals } = params;
  if (!recordingStartedAt || pauseIntervals.length === 0) {
    return [];
  }

  const recordingStartMs = recordingStartedAt.getTime();
  const recordingEndMs =
    recordingEndedAt && recordingEndedAt.getTime() > recordingStartMs
      ? recordingEndedAt.getTime()
      : Number.POSITIVE_INFINITY;

  return pauseIntervals
    .map((interval) => {
      const startMs = Math.max(interval.startedAt.getTime(), recordingStartMs);
      const endMs = Math.min(
        interval.endedAt?.getTime() ?? recordingEndMs,
        recordingEndMs,
      );
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
      }
      return {
        startSeconds: Math.max(0, (startMs - recordingStartMs) / 1000),
        endSeconds: Math.max(0, (endMs - recordingStartMs) / 1000),
      };
    })
    .filter((interval): interval is OffsetInterval => Boolean(interval));
}

export function classifySegmentAgainstPauseIntervals(
  segment: TimedSegment,
  pauseIntervals: OffsetInterval[],
  options?: PauseFilteringOptions,
): PauseOverlapDecision {
  const resolvedOptions = resolvePauseFilteringOptions(options);
  if (
    segment.startSeconds == null ||
    segment.endSeconds == null ||
    !Number.isFinite(segment.startSeconds) ||
    !Number.isFinite(segment.endSeconds) ||
    segment.endSeconds <= segment.startSeconds
  ) {
    return {
      classification: "invalid_segment_timestamps",
      shouldDrop: false,
      segmentDurationSeconds: 0,
      overlapDurationSeconds: 0,
      overlapRatio: 0,
      matchedIntervals: 0,
    };
  }
  const normalizedPauseIntervals = mergeOffsetIntervals(pauseIntervals);
  if (normalizedPauseIntervals.length === 0) {
    return {
      classification: "no_overlap",
      shouldDrop: false,
      segmentDurationSeconds: segment.endSeconds - segment.startSeconds,
      overlapDurationSeconds: 0,
      overlapRatio: 0,
      matchedIntervals: 0,
    };
  }

  const normalizedSegment = {
    startSeconds: segment.startSeconds,
    endSeconds: segment.endSeconds,
  };
  const segmentDurationSeconds =
    normalizedSegment.endSeconds - normalizedSegment.startSeconds;

  let overlapDurationSeconds = 0;
  let matchedIntervals = 0;
  let fullyInsidePause = false;

  for (const interval of normalizedPauseIntervals) {
    if (
      normalizedSegment.startSeconds >= interval.startSeconds &&
      normalizedSegment.endSeconds <= interval.endSeconds
    ) {
      fullyInsidePause = true;
      matchedIntervals += 1;
      overlapDurationSeconds = segmentDurationSeconds;
      break;
    }
    const overlap = overlapWithInterval(normalizedSegment, interval);
    if (overlap > 0) {
      overlapDurationSeconds += overlap;
      matchedIntervals += 1;
    }
  }

  if (overlapDurationSeconds <= 0) {
    return {
      classification: "no_overlap",
      shouldDrop: false,
      segmentDurationSeconds,
      overlapDurationSeconds: 0,
      overlapRatio: 0,
      matchedIntervals: 0,
    };
  }

  if (fullyInsidePause) {
    return {
      classification: "fully_inside_pause",
      shouldDrop: true,
      segmentDurationSeconds,
      overlapDurationSeconds,
      overlapRatio: 1,
      matchedIntervals,
    };
  }

  const overlapRatio =
    segmentDurationSeconds > 0 ? overlapDurationSeconds / segmentDurationSeconds : 0;
  if (overlapDurationSeconds <= resolvedOptions.boundaryToleranceSeconds) {
    return {
      classification: "boundary_overlap_mostly_unpaused",
      shouldDrop: false,
      segmentDurationSeconds,
      overlapDurationSeconds,
      overlapRatio,
      matchedIntervals,
    };
  }

  if (overlapRatio >= resolvedOptions.dropOverlapRatio) {
    return {
      classification: "overlap_dominantly_paused",
      shouldDrop: true,
      segmentDurationSeconds,
      overlapDurationSeconds,
      overlapRatio,
      matchedIntervals,
    };
  }

  return {
    classification:
      overlapDurationSeconds >= resolvedOptions.significantPauseOverlapSeconds
        ? "significant_pause_overlap"
        : "boundary_overlap_mostly_unpaused",
    shouldDrop:
      overlapDurationSeconds >= resolvedOptions.significantPauseOverlapSeconds,
    segmentDurationSeconds,
    overlapDurationSeconds,
    overlapRatio,
    matchedIntervals,
  };
}

export function filterSegmentsByPauseIntervals<T>(
  segments: T[],
  pauseIntervals: OffsetInterval[],
  getTiming: (segment: T) => TimedSegment,
  options?: PauseFilteringOptions,
): {
  keptSegments: T[];
  droppedSegments: T[];
  diagnostics: PauseFilteringDiagnostics;
} {
  const keptSegments: T[] = [];
  const droppedSegments: T[] = [];
  let fullyPausedDroppedCount = 0;
  let boundaryOverlapKeptCount = 0;
  let boundaryOverlapDroppedCount = 0;
  let significantOverlapDroppedCount = 0;
  let maxKeptPauseOverlapSeconds = 0;
  let maxDroppedPauseOverlapSeconds = 0;

  for (const segment of segments) {
    const decision = classifySegmentAgainstPauseIntervals(
      getTiming(segment),
      pauseIntervals,
      options,
    );
    if (decision.shouldDrop) {
      droppedSegments.push(segment);
      maxDroppedPauseOverlapSeconds = Math.max(
        maxDroppedPauseOverlapSeconds,
        decision.overlapDurationSeconds,
      );
      if (decision.classification === "fully_inside_pause") {
        fullyPausedDroppedCount += 1;
      } else if (
        decision.classification === "overlap_dominantly_paused" ||
        decision.classification === "significant_pause_overlap"
      ) {
        boundaryOverlapDroppedCount += 1;
        if (decision.classification === "significant_pause_overlap") {
          significantOverlapDroppedCount += 1;
        }
      }
      continue;
    }

    keptSegments.push(segment);
    maxKeptPauseOverlapSeconds = Math.max(
      maxKeptPauseOverlapSeconds,
      decision.overlapDurationSeconds,
    );
    if (decision.classification === "boundary_overlap_mostly_unpaused") {
      boundaryOverlapKeptCount += 1;
    }
  }

  return {
    keptSegments,
    droppedSegments,
    diagnostics: {
      totalPausedIntervals: pauseIntervals.length,
      filteredSegmentCount: droppedSegments.length,
      fullyPausedDroppedCount,
      boundaryOverlapKeptCount,
      boundaryOverlapDroppedCount,
      significantOverlapDroppedCount,
      maxKeptPauseOverlapSeconds,
      maxDroppedPauseOverlapSeconds,
    },
  };
}

export function segmentOverlapsPausedInterval(
  segment: TimedSegment,
  pauseIntervals: OffsetInterval[],
) {
  return classifySegmentAgainstPauseIntervals(segment, pauseIntervals).shouldDrop;
}

