import {
  VOX_END_DEBOUNCE_MS,
  VOX_MIN_INTERVAL_MS,
} from "@/lib/telemetry/speaking-activity-config";

export type RemoteTrackerBlockReason =
  | "disabled"
  | "facilitator-required"
  | null;

export type RemoteLifecycleCloseReason =
  | "silence_debounce"
  | "block_transition"
  | "unmount";

export type RemoteLifecycleTick = {
  atMs: number;
  speaking: boolean;
  blocked?: boolean;
  unmount?: boolean;
};

export type SimulatedRemoteLifecycleInterval = {
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  closeReason: RemoteLifecycleCloseReason;
};

export function getRemoteTrackerBlockReason(input: {
  enabled: boolean;
  canReportRemoteTelemetry: boolean;
}): RemoteTrackerBlockReason {
  if (!input.enabled) return "disabled";
  if (!input.canReportRemoteTelemetry) return "facilitator-required";
  return null;
}

export function isRemoteStreamTelemetryEnabled(
  envValue: string | undefined,
): boolean {
  return envValue !== "false";
}

export function simulateRemoteSpeakingIntervalLifecycle(
  ticks: RemoteLifecycleTick[],
  options?: {
    debounceMs?: number;
    minIntervalMs?: number;
  },
): {
  intervals: SimulatedRemoteLifecycleInterval[];
  skippedShortIntervalCount: number;
} {
  const debounceMs = options?.debounceMs ?? VOX_END_DEBOUNCE_MS;
  const minIntervalMs = options?.minIntervalMs ?? VOX_MIN_INTERVAL_MS;
  const sorted = [...ticks].sort((a, b) => a.atMs - b.atMs);
  const intervals: SimulatedRemoteLifecycleInterval[] = [];
  let skippedShortIntervalCount = 0;
  let intervalStartedAtMs: number | null = null;
  let pendingCloseAtMs: number | null = null;

  const closeInterval = (endedAtMs: number, closeReason: RemoteLifecycleCloseReason) => {
    if (intervalStartedAtMs == null) return;
    const durationMs = endedAtMs - intervalStartedAtMs;
    if (durationMs >= minIntervalMs) {
      intervals.push({
        startedAtMs: intervalStartedAtMs,
        endedAtMs,
        durationMs,
        closeReason,
      });
    } else {
      skippedShortIntervalCount += 1;
    }
    intervalStartedAtMs = null;
    pendingCloseAtMs = null;
  };

  for (const tick of sorted) {
    if (tick.unmount) {
      closeInterval(tick.atMs, "unmount");
      continue;
    }
    if (tick.blocked) {
      closeInterval(tick.atMs, "block_transition");
      continue;
    }
    if (tick.speaking) {
      pendingCloseAtMs = null;
      if (intervalStartedAtMs == null) {
        intervalStartedAtMs = tick.atMs;
      }
      continue;
    }
    if (intervalStartedAtMs == null) {
      continue;
    }
    if (pendingCloseAtMs == null) {
      pendingCloseAtMs = tick.atMs + debounceMs;
    }
    if (tick.atMs >= pendingCloseAtMs) {
      closeInterval(pendingCloseAtMs, "silence_debounce");
    }
  }

  return { intervals, skippedShortIntervalCount };
}
