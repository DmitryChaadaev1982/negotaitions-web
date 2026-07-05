import type { RoomAuthToken } from "@/lib/room-auth";
import { roomAuthBody } from "@/lib/room-auth";
import {
  VOX_END_DEBOUNCE_MS,
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
  localAudioStreamPresent: boolean;
  sessionParticipantIdPresent: boolean;
  participantIdentity: string | null;
  recordingActiveClientSide: boolean | null;
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
