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

export function segmentOverlapsPausedInterval(
  segment: TimedSegment,
  pauseIntervals: OffsetInterval[],
) {
  if (
    segment.startSeconds == null ||
    segment.endSeconds == null ||
    segment.endSeconds <= segment.startSeconds ||
    pauseIntervals.length === 0
  ) {
    return false;
  }
  return pauseIntervals.some((interval) => {
    const overlapStart = Math.max(segment.startSeconds as number, interval.startSeconds);
    const overlapEnd = Math.min(segment.endSeconds as number, interval.endSeconds);
    return overlapEnd > overlapStart;
  });
}

