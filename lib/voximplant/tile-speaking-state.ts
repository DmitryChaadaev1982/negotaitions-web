import {
  canRenderSpeakingHighlight,
  type ParticipantConnectionStatus,
  type ParticipantMediaStatus,
} from "@/lib/voximplant/participant-presence-media-model";

/**
 * Visual state of a room tile border.
 *
 * Precedence is fixed and identical for every role:
 *   1. disconnected/stale;
 *   2. muted;
 *   3. active speaking;
 *   4. connected/default.
 */
export type TileBorderState = "disconnected" | "muted" | "speaking" | "connected";

export type TileSpeakingStateInput = {
  connectionStatus: ParticipantConnectionStatus;
  micStatus: ParticipantMediaStatus;
  audioTrackPresent: boolean;
  isSpeaking: boolean;
  /** True when the tile belongs to a superseded local connection. */
  staleConnection?: boolean;
  connectionGeneration?: string | number | null;
  speakingGeneration?: string | number | null;
};

/**
 * Whether a tile may render the active-speaker highlight.
 *
 * Applies to Participant A, Participant B, Facilitator, and Observer alike, in
 * the stage slots and in the observer rail, in every negotiation phase.
 */
export function resolveTileSpeakingHighlight(input: TileSpeakingStateInput): boolean {
  return canRenderSpeakingHighlight({
    connected: input.connectionStatus === "connected",
    stale: input.staleConnection === true,
    microphoneEnabled: input.micStatus === "on",
    audioTrackPresent: input.audioTrackPresent,
    isSpeaking: input.isSpeaking,
    connectionGeneration: input.connectionGeneration ?? null,
    speakingGeneration: input.speakingGeneration,
  });
}

export function resolveTileBorderState(input: {
  connectionStatus: ParticipantConnectionStatus;
  micStatus: ParticipantMediaStatus;
  isSpeaking: boolean;
}): TileBorderState {
  if (input.connectionStatus !== "connected") return "disconnected";
  if (input.micStatus === "off") return "muted";
  if (input.micStatus === "on" && input.isSpeaking) return "speaking";
  if (input.micStatus === "on") return "connected";
  return "disconnected";
}
