export type TranscriptScoringSegment = {
  orderIndex: number;
  speakerLabel: string;
  startMs: number;
  endMs: number;
  text?: string | null;
};

export type TranscriptScoringWindow = {
  orderIndex: number;
  speakerLabel: string;
  originalStartMs: number;
  originalEndMs: number;
  scoringStartMs: number;
  scoringEndMs: number;
  durationMs: number;
  adjustmentReason: string;
};

const SHORT_ADJUSTED_WINDOW_MS = 250;

export function buildOrderNormalizedTranscriptWindows(
  input: TranscriptScoringSegment[],
): TranscriptScoringWindow[] {
  const sorted = [...input].sort((a, b) => a.orderIndex - b.orderIndex);
  const result: TranscriptScoringWindow[] = [];
  let previousScoringEndMs = Number.NEGATIVE_INFINITY;

  for (const segment of sorted) {
    const originalStartMs = Math.max(0, Math.round(segment.startMs));
    const originalEndMs = Math.max(0, Math.round(segment.endMs));
    const scoringStartMs = Math.max(originalStartMs, previousScoringEndMs);
    const scoringEndMs = Math.max(originalEndMs, scoringStartMs);
    const durationMs = Math.max(0, scoringEndMs - scoringStartMs);
    previousScoringEndMs = scoringEndMs;

    const reasons: string[] = [];
    if (scoringStartMs > originalStartMs) reasons.push("shifted_for_order_overlap");
    if (scoringEndMs === scoringStartMs && originalEndMs <= scoringStartMs) {
      reasons.push("zero_duration_clamped");
    }
    if (durationMs > 0 && durationMs <= SHORT_ADJUSTED_WINDOW_MS) {
      reasons.push("short_adjusted_window");
    }

    result.push({
      orderIndex: segment.orderIndex,
      speakerLabel: segment.speakerLabel,
      originalStartMs,
      originalEndMs,
      scoringStartMs,
      scoringEndMs,
      durationMs,
      adjustmentReason: reasons.length > 0 ? reasons.join("|") : "none",
    });
  }

  return result;
}
