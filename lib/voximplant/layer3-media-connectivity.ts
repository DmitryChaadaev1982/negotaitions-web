/**
 * Session-room Layer-3 Vox/media connectivity.
 *
 * Layer 1 (logical presence / SessionRoomConnection heartbeat) and Layer 2
 * (session/roomLifecycle) are independent. Layer-3 degradation must not write
 * Leave, expire the lease, or change roomLifecycle.
 *
 * Installed SDK @voximplant/websdk 5.1.0: ConnectionOptions.autoReconnect
 * defaults to true, so ClientState.RECONNECTING / ConferenceState.RECONNECTING
 * are owned by the SDK. The app must not connect/join/hangup/disconnect then.
 */

export const VOX_SDK_RECONNECTING = "RECONNECTING";
export const VOX_SDK_CLIENT_CONNECTED = "CONNECTED";
export const VOX_SDK_CLIENT_LOGGED_IN = "LOGGED_IN";
export const VOX_SDK_CONFERENCE_CONNECTED = "CONNECTED";
export const VOX_SDK_CONFERENCE_FAILED = "FAILED";
export const VOX_SDK_CONFERENCE_DISCONNECTED = "DISCONNECTED";
export const VOX_CONFERENCE_CONNECTION_LOST = "CONNECTION_LOST";
export const VOX_CONFERENCE_LOCAL_ENDED = "LOCAL_ENDED";
export const VOX_CONFERENCE_REMOTE_ENDED = "REMOTE_ENDED";

export type Layer3ConnectivityStatus =
  | "connected"
  | "reconnecting"
  | "degraded"
  | "recovering"
  | "failed";

export type Layer3BannerKind = "reconnecting" | "degraded" | "failed" | null;

export type Layer3ConnectivityState = {
  status: Layer3ConnectivityStatus;
  sdkClientState: string | null;
  sdkConferenceState: string | null;
  reason: string | null;
  /** True after the first successful room entry until unmount/leave/stale. */
  hasEnteredRoom: boolean;
  keepShellMounted: boolean;
  keepHeartbeatActive: boolean;
};

export type Layer3408Action = "observe_sdk" | "keep" | "resync" | "terminal_recover";

export type Layer3ProviderMutation = {
  connect: boolean;
  join: boolean;
  hangup: boolean;
  disconnect: boolean;
};

export function isSdkReconnecting(
  clientState?: string | null,
  conferenceState?: string | null,
): boolean {
  return (
    clientState === VOX_SDK_RECONNECTING ||
    conferenceState === VOX_SDK_RECONNECTING
  );
}

export function isSdkReconnectSettled(
  clientState?: string | null,
  conferenceState?: string | null,
): boolean {
  if (isSdkReconnecting(clientState, conferenceState)) return false;
  const clientOk =
    clientState == null ||
    clientState === VOX_SDK_CLIENT_CONNECTED ||
    clientState === VOX_SDK_CLIENT_LOGGED_IN;
  const conferenceOk =
    conferenceState == null ||
    conferenceState === VOX_SDK_CONFERENCE_CONNECTED ||
    conferenceState === "CREATED" ||
    conferenceState === "CONNECTING";
  return clientOk && conferenceOk;
}

export function isTerminalConferenceState(state?: string | null): boolean {
  return (
    state === VOX_SDK_CONFERENCE_FAILED ||
    state === VOX_SDK_CONFERENCE_DISCONNECTED
  );
}

export function normalizeConferenceDisconnectReason(
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return reason.trim().toUpperCase();
}

export function isConnectionLostDisconnectReason(
  reason: string | null | undefined,
): boolean {
  const normalized = normalizeConferenceDisconnectReason(reason);
  return normalized === VOX_CONFERENCE_CONNECTION_LOST;
}

export function isLocalEndedDisconnectReason(
  reason: string | null | undefined,
): boolean {
  return normalizeConferenceDisconnectReason(reason) === VOX_CONFERENCE_LOCAL_ENDED;
}

export function isRemoteEndedDisconnectReason(
  reason: string | null | undefined,
): boolean {
  return normalizeConferenceDisconnectReason(reason) === VOX_CONFERENCE_REMOTE_ENDED;
}

/**
 * Membership-terminal classification is independent of SDK RECONNECTING.
 * Failed is always terminal for that Conference object. Unexpected
 * Disconnected (including CONNECTION_LOST) is a terminal membership event.
 * LOCAL_ENDED / REMOTE_ENDED are not application terminal-recovery triggers.
 * SDK RECONNECTING defers *execution* of recovery; it must not drop the incident.
 */
export function isTerminalConferenceIncident(input: {
  kind: "failed" | "disconnected";
  disconnectReason?: string | null;
}): boolean {
  if (input.kind === "failed") return true;
  if (isLocalEndedDisconnectReason(input.disconnectReason)) return false;
  if (isRemoteEndedDisconnectReason(input.disconnectReason)) return false;
  return true;
}

/** Recovery join/hangup/connect/disconnect waits until SDK leaves RECONNECTING. */
export function shouldDeferTerminalRecovery(sdkReconnecting: boolean): boolean {
  return sdkReconnecting;
}

export type SdkReconnectTransition = {
  reconnecting: boolean;
  episodeStarted: boolean;
  episodeSettled: boolean;
};

/**
 * Edge-triggered SDK reconnect observation. Ordinary CREATED / CONNECTING /
 * CONNECTED / LOGGED_IN callbacks are not a reconnect episode unless they
 * follow RECONNECTING.
 */
export function observeSdkReconnectTransition(input: {
  wasReconnecting: boolean;
  clientState?: string | null;
  conferenceState?: string | null;
}): SdkReconnectTransition {
  const reconnecting = isSdkReconnecting(input.clientState, input.conferenceState);
  return {
    reconnecting,
    episodeStarted: reconnecting && !input.wasReconnecting,
    episodeSettled: !reconnecting && input.wasReconnecting,
  };
}

const REMOTE_MEDIA_LIVENESS_DEGRADATION_REASONS = new Set([
  "stream_ended",
  "native_track_ended",
  "stop_receiving_automatic",
]);

/** Empty remote roster is not media degradation. Only explicit liveness reasons are. */
export function hasRemoteMediaLivenessDegradation(
  state: Pick<Layer3ConnectivityState, "status" | "reason">,
): boolean {
  if (!state.reason) return false;
  return REMOTE_MEDIA_LIVENESS_DEGRADATION_REASONS.has(state.reason);
}

export function appMustNotMutateProvider(input: {
  sdkReconnecting: boolean;
  stale: boolean;
  explicitLeave: boolean;
}): boolean {
  return input.sdkReconnecting || input.stale || input.explicitLeave;
}

export function permittedProviderMutations(input: {
  sdkReconnecting: boolean;
  stale: boolean;
  explicitLeave: boolean;
}): Layer3ProviderMutation {
  if (appMustNotMutateProvider(input)) {
    return { connect: false, join: false, hangup: false, disconnect: false };
  }
  return { connect: true, join: true, hangup: true, disconnect: true };
}

export function decide408Action(input: {
  sdkReconnecting: boolean;
  mediaUsable: boolean;
  conferenceTerminal: boolean;
}): Layer3408Action {
  if (input.conferenceTerminal) return "terminal_recover";
  if (input.sdkReconnecting) return "observe_sdk";
  if (input.mediaUsable) return "keep";
  return "resync";
}

export function fenceGeneration(currentGeneration: number): {
  fencedGeneration: number;
  nextGeneration: number;
} {
  return {
    fencedGeneration: currentGeneration,
    nextGeneration: currentGeneration + 1,
  };
}

export function createLayer3State(
  partial?: Partial<Layer3ConnectivityState>,
): Layer3ConnectivityState {
  const status = partial?.status ?? "connected";
  const hasEnteredRoom = partial?.hasEnteredRoom ?? false;
  return {
    status,
    sdkClientState: partial?.sdkClientState ?? null,
    sdkConferenceState: partial?.sdkConferenceState ?? null,
    reason: partial?.reason ?? null,
    hasEnteredRoom,
    keepShellMounted: partial?.keepShellMounted ?? hasEnteredRoom,
    keepHeartbeatActive: partial?.keepHeartbeatActive ?? hasEnteredRoom,
  };
}

export function layer3AfterSdkReconnecting(
  current: Layer3ConnectivityState,
): Layer3ConnectivityState {
  return {
    ...current,
    status: "reconnecting",
    keepShellMounted: current.hasEnteredRoom,
    keepHeartbeatActive: current.hasEnteredRoom,
  };
}

/**
 * After a real RECONNECTING → settled edge, signaling is healthy again.
 * Do not infer DEGRADED from an empty remote roster. Preserve degraded only
 * when a prior media-liveness reason is still attached.
 */
export function layer3AfterSdkReconnectSettled(
  current: Layer3ConnectivityState,
): Layer3ConnectivityState {
  const preserveDegraded = hasRemoteMediaLivenessDegradation(current);
  return {
    ...current,
    status: preserveDegraded ? "degraded" : "connected",
    reason: preserveDegraded ? current.reason : null,
    keepShellMounted: current.hasEnteredRoom,
    keepHeartbeatActive: current.hasEnteredRoom,
  };
}

/** Usable live remote media clears liveness degradation immediately. */
export function layer3AfterUsableRemoteMedia(
  current: Layer3ConnectivityState,
  sdkReconnecting: boolean,
): Layer3ConnectivityState {
  return {
    ...current,
    status: sdkReconnecting ? "reconnecting" : "connected",
    reason: null,
  };
}

export function layer3DuringTerminalRecovery(
  current: Layer3ConnectivityState,
  reason: string | null,
): Layer3ConnectivityState {
  return {
    ...current,
    status: "recovering",
    reason,
    keepShellMounted: true,
    keepHeartbeatActive: true,
    hasEnteredRoom: true,
  };
}

export function layer3AfterTerminalRecoveryFailed(
  current: Layer3ConnectivityState,
  reason: string | null,
): Layer3ConnectivityState {
  return {
    ...current,
    status: "failed",
    reason,
    keepShellMounted: current.hasEnteredRoom,
    keepHeartbeatActive: current.hasEnteredRoom,
  };
}

export function layer3AfterMediaDegraded(
  current: Layer3ConnectivityState,
  reason: string | null,
): Layer3ConnectivityState {
  if (current.status === "recovering" || current.status === "failed") {
    return current;
  }
  return {
    ...current,
    status: current.status === "reconnecting" ? "reconnecting" : "degraded",
    reason,
    keepShellMounted: current.hasEnteredRoom,
    keepHeartbeatActive: current.hasEnteredRoom,
  };
}

/**
 * Tiny signaling blips with still-usable media must not flash a banner.
 * No timer is applied on the media-render path; this is UI projection only.
 */
export function layer3BannerKind(input: {
  status: Layer3ConnectivityStatus;
  mediaUsable: boolean;
}): Layer3BannerKind {
  if (input.status === "failed") return "failed";
  if (input.status === "recovering") return "reconnecting";
  if (input.status === "degraded") return "degraded";
  if (input.status === "reconnecting" && !input.mediaUsable) return "degraded";
  return null;
}

export function shouldKeepSharedRoomShell(input: {
  hasEnteredRoom: boolean;
  stale: boolean;
  explicitLeave: boolean;
}): boolean {
  if (input.stale || input.explicitLeave) return false;
  return input.hasEnteredRoom;
}

/** Recording START/STOP must not be dispatched because Layer-3 recovered. */
export const LAYER3_RECOVERY_RECORDING_CONTROL = {
  start: false,
  stop: false,
} as const;

export type LiveRemoteMediaUpsert<T extends { id: string }> = {
  current: readonly T[];
  next: T;
};

/**
 * Synchronous live-media upsert. Callers must not await recovery, poll, or
 * fetch before invoking this.
 */
export function upsertLiveRemoteMedia<T extends { id: string }>(
  input: LiveRemoteMediaUpsert<T>,
): T[] {
  const index = input.current.findIndex((item) => item.id === input.next.id);
  if (index === -1) return [...input.current, input.next];
  const copy = [...input.current];
  copy[index] = input.next;
  return copy;
}

export function hideRemoteMediaFields<
  T extends { id: string; stream?: unknown; audioStream?: unknown; streamLive?: boolean; audioLive?: boolean },
>(remote: T, kind: "video" | "audio" | "both"): T {
  if (kind === "audio") {
    return { ...remote, audioStream: null, audioLive: false };
  }
  if (kind === "video") {
    return { ...remote, stream: null, streamLive: false };
  }
  return {
    ...remote,
    stream: null,
    audioStream: null,
    streamLive: false,
    audioLive: false,
  };
}
