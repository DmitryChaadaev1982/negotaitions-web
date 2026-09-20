/**
 * Session-room Layer-3 LOCAL Vox transport / Conference connectivity.
 *
 * Layer 1 (logical presence / SessionRoomConnection heartbeat) and Layer 2
 * (session/roomLifecycle) are independent. Layer-3 client-wide state is only
 * this browser's local Client/Conference connectivity and recovery. Remote
 * participant presence and remote media receive state must not drive it.
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
 * Disconnected is a terminal membership candidate when the local Conference
 * ended: CONNECTION_LOST, or REMOTE_ENDED
 * (`ConferenceEvent.Disconnected` + `ConferenceDisconnectReason.RemoteEnded`).
 * LOCAL_ENDED remains an explicit local hangup and must not auto-recover.
 * Ordinary remote EndpointRemoved / Stream Ended are different events.
 * SDK RECONNECTING defers *execution* of recovery; it must not drop the incident.
 */
export function isTerminalConferenceIncident(input: {
  kind: "failed" | "disconnected";
  disconnectReason?: string | null;
}): boolean {
  if (input.kind === "failed") return true;
  if (isLocalEndedDisconnectReason(input.disconnectReason)) return false;
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
 * After a real RECONNECTING → settled edge, local signaling is healthy again.
 * Remote stream pause / ended / receive-state must not keep Layer 3 degraded.
 * A healthy single-user room is a valid connected state.
 */
export function layer3AfterSdkReconnectSettled(
  current: Layer3ConnectivityState,
): Layer3ConnectivityState {
  return {
    ...current,
    status: "connected",
    reason: null,
    keepShellMounted: current.hasEnteredRoom,
    keepHeartbeatActive: current.hasEnteredRoom,
  };
}

/**
 * Local-only helper. Remote StartReceiving / RemoteMediaAdded must not call
 * this to "heal" Layer 3. Local SDK reconnect settle uses
 * {@link layer3AfterSdkReconnectSettled}.
 */
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

/**
 * Local transport / provider degradation only (for example 408 resync).
 * Remote StopReceiving, remote stream ended, and peer media pause must not
 * call this.
 */
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
 * Layer-3 chrome from LOCAL connectivity only. Remote media usability must
 * not change a reconnecting status into "degraded". Tiny signaling blips
 * still do not flash from this helper; {@link sessionRoomProviderBannerKind}
 * owns the compact overlay.
 */
export function layer3BannerKind(input: {
  status: Layer3ConnectivityStatus;
  mediaUsable?: boolean;
}): Layer3BannerKind {
  void input.mediaUsable;
  if (input.status === "failed") return "failed";
  if (input.status === "recovering") return "reconnecting";
  if (input.status === "degraded") return "degraded";
  return null;
}

export type SessionTransportRecoveryUiStatus = "stable" | "recovering" | "lost";

/**
 * Authoritative session-room reconnect chrome. Layer-3 `connected` wins over a
 * stale gateway-quiet `lost`/`recovering` verdict. SDK reconnecting still shows
 * a compact overlay even when some live tracks remain.
 */
export function sessionRoomProviderBannerKind(input: {
  layer3Status: Layer3ConnectivityStatus;
  layer3Banner: Layer3BannerKind;
  transportRecoveryStatus: SessionTransportRecoveryUiStatus;
}): Layer3BannerKind {
  if (input.layer3Status === "connected") return null;
  if (input.layer3Banner) return input.layer3Banner;
  if (input.layer3Status === "reconnecting" || input.layer3Status === "recovering") {
    return "reconnecting";
  }
  if (input.transportRecoveryStatus === "lost") return "failed";
  if (input.transportRecoveryStatus === "recovering") return "reconnecting";
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
  T extends {
    id: string;
    stream?: unknown;
    audioStream?: unknown;
    streamLive?: boolean;
    audioLive?: boolean;
    videoStreamId?: string | null;
    videoReceiving?: boolean;
  },
>(remote: T, kind: "video" | "audio" | "both"): T {
  if (kind === "audio") {
    return { ...remote, audioStream: null, audioLive: false };
  }
  if (kind === "video") {
    return {
      ...remote,
      stream: null,
      streamLive: false,
      videoStreamId: null,
      videoReceiving: false,
    };
  }
  return {
    ...remote,
    stream: null,
    audioStream: null,
    streamLive: false,
    audioLive: false,
    videoStreamId: null,
    videoReceiving: false,
  };
}
