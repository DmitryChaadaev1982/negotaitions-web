export type ParticipantConnectionStatus = "connected" | "disconnected" | "unknown";
export type ParticipantMediaStatus = "on" | "off" | "unknown";

export type ParticipantPresenceMediaModel = {
  displayName: string;
  displayRole: string | null;
  connectionStatus: ParticipantConnectionStatus;
  micStatus: ParticipantMediaStatus;
  cameraStatus: ParticipantMediaStatus;
  shouldRenderActiveTile: boolean;
};

type NormalizeParticipantPresenceMediaInput = {
  displayName: string;
  displayRole?: string | null;
  connectedSignal: boolean;
  allowConnectedWithoutMediaTile?: boolean;
  lastSeenAt?: string | null;
  videoStream?: MediaStream | null;
  audioStream?: MediaStream | null;
  micSignal?: ParticipantMediaStatus;
  cameraSignal?: ParticipantMediaStatus;
};

const RECENT_PRESENCE_WINDOW_MS = 30_000;

function isRecentPresence(lastSeenAt: string | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= RECENT_PRESENCE_WINDOW_MS;
}

function inferTrackStatus(
  stream: MediaStream | null | undefined,
  kind: "audio" | "video",
): ParticipantMediaStatus {
  if (!stream) return "unknown";
  const tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
  if (tracks.length === 0) return "unknown";
  return tracks.some((track) => track.enabled) ? "on" : "off";
}

export function normalizeParticipantPresenceMedia(
  input: NormalizeParticipantPresenceMediaInput,
): ParticipantPresenceMediaModel {
  const inferredMicStatus = input.micSignal ?? inferTrackStatus(input.audioStream ?? null, "audio");
  const inferredCameraStatus =
    input.cameraSignal ?? inferTrackStatus(input.videoStream ?? null, "video");

  const connectionStatus: ParticipantConnectionStatus = input.connectedSignal
    ? "connected"
    : isRecentPresence(input.lastSeenAt)
      ? "disconnected"
      : "unknown";

  const micStatus: ParticipantMediaStatus =
    connectionStatus === "connected"
      ? inferredMicStatus === "unknown"
        ? "off"
        : inferredMicStatus
      : "unknown";
  const cameraStatus: ParticipantMediaStatus =
    connectionStatus === "connected"
      ? inferredCameraStatus === "unknown"
        ? "off"
        : inferredCameraStatus
      : "unknown";

  const hasMediaSignal = micStatus !== "unknown" || cameraStatus !== "unknown";

  return {
    displayName: input.displayName,
    displayRole: input.displayRole ?? null,
    connectionStatus,
    micStatus,
    cameraStatus,
    shouldRenderActiveTile:
      connectionStatus === "connected" &&
      (input.allowConnectedWithoutMediaTile === true || hasMediaSignal),
  };
}
