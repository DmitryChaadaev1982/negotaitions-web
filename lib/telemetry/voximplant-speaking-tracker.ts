import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody } from "@/lib/room-auth";
import {
  VOX_END_DEBOUNCE_MS,
  VOX_MIN_INTERVAL_MS,
  VOX_SPEAKING_OFF_LEVEL,
  VOX_SPEAKING_ON_LEVEL,
} from "@/lib/telemetry/speaking-activity-config";

export type TrackerBlockReason =
  | "disabled"
  | "local-stream-missing"
  | "participant-id-missing"
  | null;

export type TrackerDebugState = {
  mounted: boolean;
  enabled?: boolean;
  localAudioStreamPresent: boolean;
  sessionParticipantIdPresent: boolean;
  sessionParticipantId?: string | null;
  participantIdentity: string | null;
  micLevel?: number | null;
  muted?: boolean;
  speaking?: boolean;
  intervalOpen?: boolean;
  recordingActiveClientSide: boolean | null;
  postCount?: number;
  lastPostStatus?: number | null;
  lastPostResponse?: string | null;
  lastOpenReason?: string | null;
  lastCloseReason?: string | null;
  openSince?: string | null;
  skippedShortIntervalCount?: number;
  pendingSilenceClose?: boolean;
  lastIntervalStartedAt: string | null;
  lastIntervalEndedAt: string | null;
  lastPostAttemptAt: string | null;
  lastPostResult: "idle" | "success" | "failed";
  lastError: string | null;
  blockReason: TrackerBlockReason;
};

export type BuildSpeakingIntervalPayloadInput = {
  sessionParticipantId: string;
  participantIdentity?: string | null;
  startedAt: Date;
  endedAt: Date;
  recordingActiveClientSide: boolean;
  audioProcessingEnabled?: boolean;
};

export type LifecycleCloseReason =
  | "silence_debounce"
  | "muted"
  | "block_transition"
  | "unmount";

export type LifecycleTick = {
  atMs: number;
  micLevel: number;
  muted?: boolean;
  blocked?: boolean;
  rerender?: boolean;
  unmount?: boolean;
};

export type SimulatedLifecycleInterval = {
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  closeReason: LifecycleCloseReason;
};

export function simulateSpeakingIntervalLifecycle(
  ticks: LifecycleTick[],
  options?: {
    onLevel?: number;
    offLevel?: number;
    debounceMs?: number;
    minIntervalMs?: number;
  },
): {
  intervals: SimulatedLifecycleInterval[];
  skippedShortIntervalCount: number;
} {
  const onLevel = options?.onLevel ?? VOX_SPEAKING_ON_LEVEL;
  const offLevel = options?.offLevel ?? VOX_SPEAKING_OFF_LEVEL;
  const debounceMs = options?.debounceMs ?? VOX_END_DEBOUNCE_MS;
  const minIntervalMs = options?.minIntervalMs ?? VOX_MIN_INTERVAL_MS;
  const sorted = [...ticks].sort((a, b) => a.atMs - b.atMs);
  const intervals: SimulatedLifecycleInterval[] = [];
  let skippedShortIntervalCount = 0;
  let intervalStartedAtMs: number | null = null;
  let pendingCloseAtMs: number | null = null;
  let pendingCloseReason: LifecycleCloseReason = "silence_debounce";

  const closeInterval = (endedAtMs: number, closeReason: LifecycleCloseReason) => {
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

    const effectiveLevel = tick.muted ? 0 : tick.micLevel;
    if (effectiveLevel > onLevel) {
      pendingCloseAtMs = null;
      if (intervalStartedAtMs == null) {
        intervalStartedAtMs = tick.atMs;
      }
      continue;
    }

    const belowOff = effectiveLevel < offLevel;
    if (!belowOff || intervalStartedAtMs == null) {
      continue;
    }

    if (pendingCloseAtMs == null) {
      pendingCloseAtMs = tick.atMs + debounceMs;
      pendingCloseReason = tick.muted ? "muted" : "silence_debounce";
    }
    if (tick.atMs >= pendingCloseAtMs) {
      closeInterval(pendingCloseAtMs, pendingCloseReason);
    }
  }

  return { intervals, skippedShortIntervalCount };
}

export function getTrackerBlockReason(input: {
  enabled: boolean;
  localAudioStreamPresent: boolean;
  sessionParticipantId?: string | null;
}): TrackerBlockReason {
  if (!input.enabled) return "disabled";
  if (!input.localAudioStreamPresent) return "local-stream-missing";
  if (!input.sessionParticipantId) return "participant-id-missing";
  return null;
}

export function buildSpeakingIntervalPayload(input: BuildSpeakingIntervalPayloadInput) {
  return {
    event: "speaking_interval" as const,
    sessionParticipantId: input.sessionParticipantId,
    participantIdentity: input.participantIdentity ?? undefined,
    source: "VOXIMPLANT_MIC_ACTIVITY" as const,
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    telemetryCalibration: {
      speakingOnLevel: VOX_SPEAKING_ON_LEVEL,
      speakingOffLevel: VOX_SPEAKING_OFF_LEVEL,
      endDebounceMs: VOX_END_DEBOUNCE_MS,
      minIntervalMs: VOX_MIN_INTERVAL_MS,
      recordingActiveClientSide: input.recordingActiveClientSide,
      audioProcessingEnabled: input.audioProcessingEnabled ?? null,
    },
  };
}

export async function postSpeakingInterval(input: {
  fetchImpl: typeof fetch;
  sessionId: string;
  roomAuth: RoomAuthToken;
  connectionId?: string;
  payload: ReturnType<typeof buildSpeakingIntervalPayload>;
}): Promise<{ ok: boolean; status: number }> {
  const response = await input.fetchImpl(`/api/sessions/${input.sessionId}/audio-activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    credentials: "same-origin",
    body: JSON.stringify({
      ...roomAuthBody(input.roomAuth, { connectionId: input.connectionId }),
      ...input.payload,
    }),
  });

  return {
    ok: response.ok,
    status: response.status,
  };
}
