import type { ActiveTimelineInterval } from "@/lib/transcription/active-audio-timeline";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function getPauseProcessingModeFromMetadata(
  metadata: unknown,
): "source_audio_cut" | "transcript_interval_filter" {
  const root = asObject(metadata);
  const pauseProcessing = asObject(root?.pauseProcessing);
  const mode = pauseProcessing?.mode;
  return mode === "source_audio_cut"
    ? "source_audio_cut"
    : "transcript_interval_filter";
}

export function getActiveTimelineFromMetadata(
  metadata: unknown,
): ActiveTimelineInterval[] | null {
  const root = asObject(metadata);
  const pauseProcessing = asObject(root?.pauseProcessing);
  const timelineValue = pauseProcessing?.activeTimelineMap;
  const timelineObject = asObject(timelineValue);
  const maybeIntervals = Array.isArray(timelineObject?.activeIntervals)
    ? timelineObject.activeIntervals
    : Array.isArray(timelineValue)
      ? timelineValue
      : null;
  if (!maybeIntervals) {
    return null;
  }
  const intervals: ActiveTimelineInterval[] = [];
  for (const interval of maybeIntervals) {
    const item = asObject(interval);
    if (!item) continue;
    const parsed: ActiveTimelineInterval = {
      partIndex:
        typeof item.partIndex === "number" && Number.isFinite(item.partIndex)
          ? item.partIndex
          : intervals.length,
      realStartMs:
        typeof item.realStartMs === "number" && Number.isFinite(item.realStartMs)
          ? item.realStartMs
          : -1,
      realEndMs:
        typeof item.realEndMs === "number" && Number.isFinite(item.realEndMs)
          ? item.realEndMs
          : -1,
      activeStartMs:
        typeof item.activeStartMs === "number" && Number.isFinite(item.activeStartMs)
          ? item.activeStartMs
          : -1,
      activeEndMs:
        typeof item.activeEndMs === "number" && Number.isFinite(item.activeEndMs)
          ? item.activeEndMs
          : -1,
      durationMs:
        typeof item.durationMs === "number" && Number.isFinite(item.durationMs)
          ? item.durationMs
          : -1,
    };
    if (
      parsed.realEndMs <= parsed.realStartMs ||
      parsed.activeEndMs <= parsed.activeStartMs ||
      parsed.durationMs <= 0
    ) {
      continue;
    }
    intervals.push(parsed);
  }
  return intervals.length > 0 ? intervals : null;
}
