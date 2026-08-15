export type LobbyDeviceWarningKey =
  | "cameraBusyOrUnavailable"
  | "microphoneUnavailable";

type MediaTrackLike = {
  readyState?: string;
};

type MediaStreamLike = {
  getAudioTracks?: () => MediaTrackLike[];
  getVideoTracks?: () => MediaTrackLike[];
};

/**
 * A device counts as present while it still has a non-ended track.
 * Disabled/muted tracks stay `live` and are not connection errors.
 */
export function hasLiveMediaTrack(
  stream: MediaStreamLike | null | undefined,
  kind: "audio" | "video",
): boolean {
  if (!stream) return false;
  const tracks =
    kind === "audio" ? (stream.getAudioTracks?.() ?? []) : (stream.getVideoTracks?.() ?? []);
  return tracks.some((track) => track.readyState !== "ended");
}

/**
 * Reconcile the Event-lobby device warning from actual local media streams.
 * A stale recoverable StreamManager error must not persist once both
 * microphone and camera tracks exist. One healthy device does not hide a
 * real failure of the other.
 */
export function reconcileLobbyDeviceWarning(input: {
  hasMicrophoneStream: boolean;
  hasCameraStream: boolean;
}): LobbyDeviceWarningKey | null {
  if (input.hasMicrophoneStream && input.hasCameraStream) {
    return null;
  }
  if (!input.hasMicrophoneStream && input.hasCameraStream) {
    return "microphoneUnavailable";
  }
  return "cameraBusyOrUnavailable";
}
