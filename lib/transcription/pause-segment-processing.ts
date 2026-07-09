import type { PauseProcessingMode } from "@/lib/env";
import {
  filterSegmentsByPauseIntervals,
  type PauseFilteringDiagnostics,
} from "@/lib/transcription/pause-interval-filter";

export function buildNoopPauseFilteringDiagnostics(
  totalPausedIntervals: number,
): PauseFilteringDiagnostics {
  return {
    totalPausedIntervals,
    filteredSegmentCount: 0,
    fullyPausedDroppedCount: 0,
    boundaryOverlapKeptCount: 0,
    boundaryOverlapDroppedCount: 0,
    significantOverlapDroppedCount: 0,
    maxKeptPauseOverlapSeconds: 0,
    maxDroppedPauseOverlapSeconds: 0,
  };
}

export function applyPauseSegmentProcessingMode<
  T extends { startSeconds: number | null; endSeconds: number | null },
>(
  mode: PauseProcessingMode,
  segments: T[],
  pauseOffsetIntervals: Array<{ startSeconds: number; endSeconds: number }>,
): {
  keptSegments: T[];
  droppedSegments: T[];
  diagnostics: PauseFilteringDiagnostics;
} {
  if (mode === "source_audio_cut") {
    return {
      // In source_audio_cut mode, paused source audio is already removed before ASR.
      // Additional transcript-level filtering would be double-processing.
      keptSegments: segments,
      droppedSegments: [],
      diagnostics: buildNoopPauseFilteringDiagnostics(pauseOffsetIntervals.length),
    };
  }

  // Legacy fallback path. Kept for explicit PAUSE_PROCESSING_MODE override only.
  return filterSegmentsByPauseIntervals(
    segments,
    pauseOffsetIntervals,
    (segment) => ({
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    }),
  );
}
