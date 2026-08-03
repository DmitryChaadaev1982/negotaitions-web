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

export type ParticipantReconnectMediaState = {
  userId: string | null;
  role: string;
  connectionGeneration: string | number | null;
  providerEndpointId: string | null;
  streamId: string | null;
  audioTrackPresent: boolean;
  microphoneEnabled: boolean | null;
  cameraEnabled: boolean | null;
  isSpeaking: boolean;
  lastMediaUpdateAt: string | null;
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

export function canShowSpeakingHighlight(input: {
  connectionStatus: ParticipantConnectionStatus;
  micStatus: ParticipantMediaStatus;
  isSpeaking: boolean;
}): boolean {
  return (
    input.connectionStatus === "connected" &&
    input.micStatus === "on" &&
    input.isSpeaking
  );
}

export type SpeakingHighlightInput = {
  connected: boolean;
  stale: boolean;
  microphoneEnabled: boolean;
  audioTrackPresent: boolean;
  isSpeaking: boolean;
  /** Generation of the connection currently rendered by the tile. */
  connectionGeneration?: string | number | null;
  /** Generation the speaking signal was produced under. */
  speakingGeneration?: string | number | null;
};

/**
 * Single speaking-highlight rule shared by every rendered room user
 * (Participant A, Participant B, Facilitator, Observer; local and remote).
 *
 * The rule is deliberately role-agnostic and phase-agnostic: it depends only on
 * the current connection having a present, enabled audio track that the audio
 * analyser reports as speaking. Negotiation phase and control policy decide
 * whether a microphone is *allowed*, never whether real speech is *visualized*.
 *
 * Tile precedence is preserved by the caller: disconnected/stale and muted are
 * resolved before speaking, and speaking is resolved before connected/default.
 */
export function canRenderSpeakingHighlight(input: SpeakingHighlightInput): boolean {
  if (!input.connected) return false;
  if (input.stale) return false;
  if (!input.microphoneEnabled) return false;
  if (!input.audioTrackPresent) return false;
  if (!input.isSpeaking) return false;
  const connectionGeneration = input.connectionGeneration ?? null;
  const speakingGeneration =
    input.speakingGeneration === undefined ? connectionGeneration : input.speakingGeneration;
  return connectionGeneration === speakingGeneration;
}

export function buildParticipantReconnectMediaState(input: {
  userId?: string | null;
  role: string;
  connectionGeneration?: string | number | null;
  providerEndpointId?: string | null;
  streamId?: string | null;
  audioStream?: MediaStream | null;
  microphoneEnabled?: boolean | null;
  cameraEnabled?: boolean | null;
  isSpeaking?: boolean;
  lastMediaUpdateAt?: string | null;
}): ParticipantReconnectMediaState {
  const audioTracks = input.audioStream?.getAudioTracks() ?? [];
  const audioTrackPresent = audioTracks.length > 0;
  const trackEnabled = audioTracks.some((track) => track.enabled);
  const microphoneEnabled =
    input.microphoneEnabled === undefined
      ? audioTrackPresent
        ? trackEnabled
        : null
      : input.microphoneEnabled;
  return {
    userId: input.userId ?? null,
    role: input.role,
    connectionGeneration: input.connectionGeneration ?? null,
    providerEndpointId: input.providerEndpointId ?? null,
    streamId: input.streamId ?? null,
    audioTrackPresent,
    microphoneEnabled,
    cameraEnabled: input.cameraEnabled ?? null,
    isSpeaking: microphoneEnabled === true ? input.isSpeaking === true : false,
    lastMediaUpdateAt: input.lastMediaUpdateAt ?? null,
  };
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
      ? inferredMicStatus
      : "unknown";
  const cameraStatus: ParticipantMediaStatus =
    connectionStatus === "connected"
      ? inferredCameraStatus
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
