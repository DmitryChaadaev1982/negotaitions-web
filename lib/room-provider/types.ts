/**
 * Provider-agnostic room adapter types for Stage 5.3.
 *
 * The shared room shell interacts with video providers ONLY through these
 * types. All provider-specific SDK imports and logic live behind adapters.
 *
 * Provider adapters MUST NOT own:
 *   - role authorization
 *   - private briefing visibility
 *   - facilitator permissions
 *   - session status rules
 *   - role reassignment permissions
 *   - Yandex transcript/debrief availability
 *   - AI analysis visibility rules
 *
 * Provider adapter MUST own:
 *   - connect/disconnect
 *   - media publish/unpublish
 *   - mute/unmute
 *   - camera enable/disable
 *   - device acquisition
 *   - identity/token/key bootstrap
 *   - participant presence/speaking event mapping
 *   - recording transport specifics
 */

export type VideoProviderKind = "livekit" | "voximplant";

/** Mapping from Voximplant RecordingStatus to the shared model. */
export type ProviderRecordingStatus =
  | "not_recording"
  | "starting"
  | "recording"
  | "stopping"
  | "stopped"
  | "failed"
  | "unknown";

export type RemoteParticipantState = {
  /** Provider-specific endpoint/participant ID. */
  id: string;
  /** Display name resolved at transport level (may differ from DB-resolved name). */
  displayName: string;
  /** Live video MediaStream, or null when camera is off or participant has no video. */
  stream: MediaStream | null;
};

/**
 * Shared recording state type used by both providers and the recording-control
 * route response. Matches the DB Recording row shape exposed to the room.
 */
export type RoomRecordingState = {
  status: string;
  errorMessage: string | null;
} | null;

/**
 * Minimal provider adapter interface.
 *
 * LiveKit implementation: fulfilled by LiveKit room context (injected via slot props).
 * Voximplant implementation: fulfilled by `useVoximplantRoom`.
 */
export type RoomProviderAdapter = {
  /** Which provider backs this adapter. */
  readonly provider: VideoProviderKind;

  /** Whether the provider is currently connected to the media room. */
  readonly isConnected: boolean;

  /** Whether local microphone is muted. */
  readonly isMicMuted: boolean;

  /** Whether local camera is streaming. */
  readonly isCameraOn: boolean;

  /** Non-fatal device acquisition warnings (e.g. camera busy, mic unavailable). */
  readonly mediaWarnings: string[];

  /** Local participant video MediaStream (null when camera is off). */
  readonly localStream: MediaStream | null;

  /** Remote participants currently in the media room. */
  readonly remoteParticipants: RemoteParticipantState[];

  /** Toggle local microphone on/off. */
  readonly toggleMic: () => void;

  /** Toggle local camera on/off. */
  readonly toggleCamera: () => void;

  /** Disconnect from the provider and release all resources. */
  readonly disconnect: () => Promise<void>;

  /**
   * Provider-side recording status, if the provider tracks its own recording.
   * LiveKit: not directly tracked here (the DB recording row is authoritative).
   * Voximplant: reflects the scenario's recording state when available.
   */
  readonly providerRecordingStatus?: ProviderRecordingStatus;

  // ── Extended diagnostics (Voximplant-specific, optional) ─────────────────

  /** Voximplant mic capture lifecycle status. */
  readonly micCaptureStatus?: string;
  /** Live microphone level 0–100 for display (Voximplant). */
  readonly micLevel?: number;
  /** Whether remote audio playback is blocked by autoplay policy (Voximplant). */
  readonly remotePlaybackBlocked?: boolean;
  /** Unlock remote audio playback after user gesture (Voximplant). */
  readonly unlockAudioPlayback?: () => void;
};

/**
 * Session close state subset used by the shared room shell.
 * Matches what the control-state API endpoint returns.
 */
export type ShellSessionCloseState = {
  isClosed: boolean;
  closeMessageKey:
    | "events.sessionClosedByEvent"
    | "events.sessionClosedBeforeNegotiation"
    | "join.sessionFinishedMessage"
    | null;
  closedBeforeNegotiation: boolean;
};
