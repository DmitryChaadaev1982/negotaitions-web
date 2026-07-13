export type TranscriptTimingSegment = {
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
};

export type ResolvedTurnSpeaker = {
  speakerName: string;
  rawSpeakerLabel: string | null;
  mappingApplied: boolean;
  speakerKey: string;
};

export type GroupedTranscriptTurn = ResolvedTurnSpeaker & {
  text: string;
  startSeconds: number | null;
  endSeconds: number | null;
};

const DEFAULT_TIME_FALLBACK = "00:00:00";

function isFiniteNonNegativeNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function formatTranscriptTimestampUi(
  value: number | null | undefined,
  fallback = DEFAULT_TIME_FALLBACK,
): string {
  if (!isFiniteNonNegativeNumber(value)) {
    return fallback;
  }

  const totalTenths = Math.round(value * 10);
  const totalWholeSeconds = Math.floor(totalTenths / 10);
  const tenth = totalTenths % 10;

  if (totalWholeSeconds < 3600) {
    const minutes = Math.floor(totalWholeSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (totalWholeSeconds % 60).toString().padStart(2, "0");
    return `${minutes}:${seconds}.${tenth}`;
  }

  const hours = Math.floor(totalWholeSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalWholeSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalWholeSeconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${seconds}.${tenth}`;
}

export function formatTranscriptTimeRangeUi(
  startSeconds: number | null,
  endSeconds: number | null,
  fallback = DEFAULT_TIME_FALLBACK,
): string {
  const hasStart = isFiniteNonNegativeNumber(startSeconds);
  const hasEnd = isFiniteNonNegativeNumber(endSeconds);

  if (!hasStart && !hasEnd) {
    return fallback;
  }

  if (hasStart && hasEnd) {
    return `${formatTranscriptTimestampUi(startSeconds)}-${formatTranscriptTimestampUi(endSeconds)}`;
  }

  return formatTranscriptTimestampUi(hasStart ? startSeconds : endSeconds);
}

export function formatTranscriptDurationUi(params: {
  startSeconds: number | null;
  endSeconds: number | null;
  unitLabel: string;
}): string | null {
  const { startSeconds, endSeconds, unitLabel } = params;
  if (!isFiniteNonNegativeNumber(startSeconds) || !isFiniteNonNegativeNumber(endSeconds)) {
    return null;
  }
  if (endSeconds < startSeconds) {
    return null;
  }

  const durationTenths = Math.round((endSeconds - startSeconds) * 10);
  return `${(durationTenths / 10).toFixed(1)} ${unitLabel}`;
}

export function formatTranscriptTimeRangeWithDurationUi(params: {
  startSeconds: number | null;
  endSeconds: number | null;
  durationUnitLabel: string;
  fallback?: string;
}): string {
  const timeRange = formatTranscriptTimeRangeUi(
    params.startSeconds,
    params.endSeconds,
    params.fallback,
  );
  const duration = formatTranscriptDurationUi({
    startSeconds: params.startSeconds,
    endSeconds: params.endSeconds,
    unitLabel: params.durationUnitLabel,
  });

  return duration ? `${timeRange} · ${duration}` : timeRange;
}

export function groupSegmentsIntoTurns<TSegment extends TranscriptTimingSegment>(
  segments: TSegment[],
  resolveSpeaker: (segment: TSegment) => ResolvedTurnSpeaker,
): GroupedTranscriptTurn[] {
  const turns: GroupedTranscriptTurn[] = [];

  for (const segment of segments) {
    const resolvedSpeaker = resolveSpeaker(segment);
    const lastTurn = turns.at(-1);

    if (lastTurn && lastTurn.speakerKey === resolvedSpeaker.speakerKey) {
      lastTurn.text = `${lastTurn.text} ${segment.text}`.trim();
      if (lastTurn.startSeconds == null && segment.startSeconds != null) {
        lastTurn.startSeconds = segment.startSeconds;
      }
      if (segment.endSeconds != null) {
        lastTurn.endSeconds = segment.endSeconds;
      }
      continue;
    }

    turns.push({
      ...resolvedSpeaker,
      text: segment.text,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    });
  }

  return turns;
}
