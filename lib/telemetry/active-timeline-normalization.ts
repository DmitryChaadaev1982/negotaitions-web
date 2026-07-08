import type { ActiveTimelineInterval } from "@/lib/transcription/active-audio-timeline";

export type AudioActivityTimelineRow = {
  sessionParticipantId: string;
  source: string;
  startSeconds: number;
  endSeconds: number;
  confidence: number | null;
};

export type NormalizedAudioActivityTimelineRow = AudioActivityTimelineRow & {
  sourceRowIndex: number;
  splitPartIndex: number;
  realStartSeconds: number;
  realEndSeconds: number;
};

export type AudioActivityExclusion = {
  sourceRowIndex: number;
  reason: "invalid_interval" | "inside_pause_gap" | "outside_active_timeline";
};

export type NormalizeAudioActivityResult = {
  normalizedRows: NormalizedAudioActivityTimelineRow[];
  excludedRows: AudioActivityExclusion[];
};

function overlapMs(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
}

export function normalizeAudioActivityToActiveTimeline(
  activityRows: AudioActivityTimelineRow[],
  activeTimeline: ActiveTimelineInterval[] | null | undefined,
): NormalizeAudioActivityResult {
  if (!activeTimeline || activeTimeline.length === 0) {
    return {
      normalizedRows: activityRows.map((row, index) => ({
        ...row,
        sourceRowIndex: index,
        splitPartIndex: 0,
        realStartSeconds: row.startSeconds,
        realEndSeconds: row.endSeconds,
      })),
      excludedRows: [],
    };
  }

  const normalizedRows: NormalizedAudioActivityTimelineRow[] = [];
  const excludedRows: AudioActivityExclusion[] = [];

  for (const [rowIndex, row] of activityRows.entries()) {
    if (
      !Number.isFinite(row.startSeconds) ||
      !Number.isFinite(row.endSeconds) ||
      row.endSeconds <= row.startSeconds
    ) {
      excludedRows.push({ sourceRowIndex: rowIndex, reason: "invalid_interval" });
      continue;
    }

    const rowStartMs = Math.round(row.startSeconds * 1000);
    const rowEndMs = Math.round(row.endSeconds * 1000);
    let splitPartIndex = 0;
    let overlapFound = false;

    for (const interval of activeTimeline) {
      const overlapDurationMs = overlapMs(
        rowStartMs,
        rowEndMs,
        interval.realStartMs,
        interval.realEndMs,
      );
      if (overlapDurationMs <= 0) {
        continue;
      }

      overlapFound = true;
      const overlapStartMs = Math.max(rowStartMs, interval.realStartMs);
      const overlapEndMs = Math.min(rowEndMs, interval.realEndMs);
      const shiftedStartMs =
        interval.activeStartMs + (overlapStartMs - interval.realStartMs);
      const shiftedEndMs = interval.activeStartMs + (overlapEndMs - interval.realStartMs);
      if (shiftedEndMs <= shiftedStartMs) {
        continue;
      }

      normalizedRows.push({
        ...row,
        startSeconds: shiftedStartMs / 1000,
        endSeconds: shiftedEndMs / 1000,
        sourceRowIndex: rowIndex,
        splitPartIndex,
        realStartSeconds: overlapStartMs / 1000,
        realEndSeconds: overlapEndMs / 1000,
      });
      splitPartIndex += 1;
    }

    if (!overlapFound) {
      const timelineStartMs = activeTimeline[0]?.realStartMs ?? 0;
      const timelineEndMs = activeTimeline.at(-1)?.realEndMs ?? 0;
      excludedRows.push({
        sourceRowIndex: rowIndex,
        reason:
          rowEndMs <= timelineStartMs || rowStartMs >= timelineEndMs
            ? "outside_active_timeline"
            : "inside_pause_gap",
      });
    }
  }

  return {
    normalizedRows,
    excludedRows,
  };
}
