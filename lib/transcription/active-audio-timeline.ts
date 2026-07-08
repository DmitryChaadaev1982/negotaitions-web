export type TimelineOffsetIntervalMs = {
  startMs: number;
  endMs: number | null;
};

export type ActiveTimelineInterval = {
  partIndex: number;
  realStartMs: number;
  realEndMs: number;
  activeStartMs: number;
  activeEndMs: number;
  durationMs: number;
};

export type ActiveAudioTimelineDiagnostics = {
  inputPauseCount: number;
  normalizedPauseCount: number;
  droppedInvalidPauseCount: number;
  mergedPauseCount: number;
  droppedActiveIntervalCount: number;
  removedPauseDurationMs: number;
  activeDurationMs: number;
};

export type ActiveAudioTimelineResult = {
  activeIntervals: ActiveTimelineInterval[];
  normalizedPauseIntervals: Array<{ startMs: number; endMs: number }>;
  diagnostics: ActiveAudioTimelineDiagnostics;
};

export class ActiveAudioTimelineError extends Error {
  readonly diagnostics: ActiveAudioTimelineDiagnostics;

  constructor(message: string, diagnostics: ActiveAudioTimelineDiagnostics) {
    super(message);
    this.name = "ActiveAudioTimelineError";
    this.diagnostics = diagnostics;
  }
}

function clampMs(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= max) return max;
  return value;
}

function normalizePauseIntervals(params: {
  recordingDurationMs: number;
  pauseIntervals: TimelineOffsetIntervalMs[];
}): {
  normalizedPauseIntervals: Array<{ startMs: number; endMs: number }>;
  droppedInvalidPauseCount: number;
  mergedPauseCount: number;
} {
  const { recordingDurationMs, pauseIntervals } = params;
  let droppedInvalidPauseCount = 0;
  const clamped = pauseIntervals
    .map((interval) => {
      const startMs = clampMs(interval.startMs, recordingDurationMs);
      const endRaw = interval.endMs ?? recordingDurationMs;
      const endMs = clampMs(endRaw, recordingDurationMs);
      if (endMs <= startMs) {
        droppedInvalidPauseCount += 1;
        return null;
      }
      return { startMs, endMs };
    })
    .filter((interval): interval is { startMs: number; endMs: number } =>
      Boolean(interval),
    )
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: Array<{ startMs: number; endMs: number }> = [];
  let mergedPauseCount = 0;
  for (const interval of clamped) {
    const previous = merged.at(-1);
    if (!previous || interval.startMs > previous.endMs) {
      merged.push({ ...interval });
      continue;
    }
    previous.endMs = Math.max(previous.endMs, interval.endMs);
    mergedPauseCount += 1;
  }

  return {
    normalizedPauseIntervals: merged,
    droppedInvalidPauseCount,
    mergedPauseCount,
  };
}

export function buildActiveAudioTimeline(params: {
  recordingDurationMs: number;
  pauseIntervals: TimelineOffsetIntervalMs[];
}): ActiveAudioTimelineResult {
  const recordingDurationMs = Math.max(0, Math.round(params.recordingDurationMs));
  const { normalizedPauseIntervals, droppedInvalidPauseCount, mergedPauseCount } =
    normalizePauseIntervals({
      recordingDurationMs,
      pauseIntervals: params.pauseIntervals,
    });

  const activeIntervals: ActiveTimelineInterval[] = [];
  let cursorMs = 0;
  let activeCursorMs = 0;
  let droppedActiveIntervalCount = 0;

  const addActiveInterval = (realStartMs: number, realEndMs: number) => {
    const durationMs = realEndMs - realStartMs;
    if (durationMs <= 0) {
      droppedActiveIntervalCount += 1;
      return;
    }
    const activeStartMs = activeCursorMs;
    const activeEndMs = activeStartMs + durationMs;
    activeIntervals.push({
      partIndex: activeIntervals.length,
      realStartMs,
      realEndMs,
      activeStartMs,
      activeEndMs,
      durationMs,
    });
    activeCursorMs = activeEndMs;
  };

  for (const paused of normalizedPauseIntervals) {
    addActiveInterval(cursorMs, paused.startMs);
    cursorMs = paused.endMs;
  }
  addActiveInterval(cursorMs, recordingDurationMs);

  const removedPauseDurationMs = Math.max(0, recordingDurationMs - activeCursorMs);
  const diagnostics: ActiveAudioTimelineDiagnostics = {
    inputPauseCount: params.pauseIntervals.length,
    normalizedPauseCount: normalizedPauseIntervals.length,
    droppedInvalidPauseCount,
    mergedPauseCount,
    droppedActiveIntervalCount,
    removedPauseDurationMs,
    activeDurationMs: activeCursorMs,
  };

  if (activeIntervals.length === 0) {
    throw new ActiveAudioTimelineError(
      "No active audio remains after pause exclusion.",
      diagnostics,
    );
  }

  return {
    activeIntervals,
    normalizedPauseIntervals,
    diagnostics,
  };
}
