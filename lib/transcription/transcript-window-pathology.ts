import {
  buildOrderNormalizedTranscriptWindows,
  type TranscriptScoringSegment,
} from "@/lib/transcription/order-normalized-transcript-windows";

export type ProviderWindowPathologyReason =
  | "provider_segments_overlap"
  | "order_time_conflict"
  | "long_segment_crosses_turn_boundary";

export type ProviderWindowPathology = {
  hasPathologicalOverlap: boolean;
  overlapRatio: number;
  conflictingSegments: number[];
  reasons: ProviderWindowPathologyReason[];
};

function overlapMs(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): number {
  const start = Math.max(aStartMs, bStartMs);
  const end = Math.min(aEndMs, bEndMs);
  return Math.max(0, end - start);
}

export function detectTranscriptWindowPathology(
  input: TranscriptScoringSegment[],
): ProviderWindowPathology {
  const sorted = [...input].sort((a, b) => a.orderIndex - b.orderIndex);
  if (sorted.length <= 1) {
    return {
      hasPathologicalOverlap: false,
      overlapRatio: 0,
      conflictingSegments: [],
      reasons: [],
    };
  }

  const normalized = buildOrderNormalizedTranscriptWindows(sorted);
  const reasons = new Set<ProviderWindowPathologyReason>();
  const conflictingSegments = new Set<number>();
  let crossSpeakerOverlapMs = 0;
  let totalDurationMs = 0;

  for (const segment of sorted) {
    totalDurationMs += Math.max(0, segment.endMs - segment.startMs);
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const other = sorted[j]!;
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
    const current = sorted[i]!;
    const prevNormalized = normalized[i - 1]!;
    if (current.startMs < prevNormalized.scoringEndMs - 1000) {
      conflictingSegments.add(current.orderIndex);
      conflictingSegments.add(prevNormalized.orderIndex);
      reasons.add("order_time_conflict");
    }
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]!;
    const durationMs = Math.max(0, current.endMs - current.startMs);
    if (durationMs < 15000) continue;

    let overlapTurns = 0;
    for (let j = 0; j < sorted.length; j += 1) {
      if (i === j) continue;
      const other = sorted[j]!;
      if (other.speakerLabel === current.speakerLabel) continue;
      if (
        overlapMs(current.startMs, current.endMs, other.startMs, other.endMs) > 0
      ) {
        overlapTurns += 1;
      }
    }
    if (overlapTurns >= 2) {
      reasons.add("long_segment_crosses_turn_boundary");
      conflictingSegments.add(current.orderIndex);
    }
  }

  const overlapRatio =
    totalDurationMs > 0 ? crossSpeakerOverlapMs / totalDurationMs : 0;
  if (overlapRatio >= 0.2) {
    reasons.add("provider_segments_overlap");
  }

  return {
    hasPathologicalOverlap: reasons.size > 0,
    overlapRatio: Math.round(overlapRatio * 1000) / 1000,
    conflictingSegments: [...conflictingSegments].sort((a, b) => a - b),
    reasons: [...reasons],
  };
}
