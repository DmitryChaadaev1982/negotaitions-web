"use client";

/**
 * Architecture: docs/architecture/05-voximplant-integration.md
 */

import type { ParticipantType } from "@/app/generated/prisma/enums";
import {
  buildCameraEnablePlan,
  isDuplicateVideoStreamError,
} from "@/lib/voximplant/camera-toggle-logic";
import {
  acquireVoxClientOwnership,
  isIntentionalProviderHandoffActive,
  registerVoxClientDisconnect,
  waitForVoxClientIdle,
  type VoxClientOwnership,
} from "@/lib/voximplant/browser-client-lifecycle";
import { AUDIO_LEVEL_RMS_TO_PERCENT_MULTIPLIER } from "@/lib/telemetry/speaking-activity-config";
import { clearRemoteAudioElements, stopVoxLikeStreamTracks } from "@/lib/voximplant/media-cleanup";
import {
  installVoxCameraErrorSuppressor,
  isAlreadyExistsStreamError,
  isRecoverableVoxMediaError,
  toVoxErrorMessage,
} from "@/lib/voximplant/media-error-utils";
import {
  dispatchVoxSdkLog,
  initVoxCore,
  registerVoxSdkLogSink,
  resetVoxSdkLogDedupe,
} from "@/lib/voximplant/websdk-core";
import type {
  VoxClassification,
  VoxLifecyclePhase,
} from "@/lib/voximplant/provider-error-classification";
import {
  createLayer3State,
  decide408Action,
  fenceGeneration,
  isLocalEndedDisconnectReason,
  isTerminalConferenceIncident,
  isTerminalConferenceState,
  layer3AfterMediaDegraded,
  layer3AfterSdkReconnectSettled,
  layer3AfterSdkReconnecting,
  layer3AfterTerminalRecoveryFailed,
  layer3AfterUsableRemoteMedia,
  layer3BannerKind,
  layer3DuringTerminalRecovery,
  observeSdkReconnectTransition,
  shouldDeferTerminalRecovery,
  type Layer3ConnectivityState,
} from "@/lib/voximplant/layer3-media-connectivity";
import {
  shouldApplyConferenceCallback,
  isAuthoritativeConferenceStateWatcher,
} from "@/lib/voximplant/conference-callback-ownership";
import {
  bindEndpointStreamLiveness,
  createEndpointStreamLivenessRegistry,
  disposeAllEndpointStreamLiveness,
  disposeEndpointStreamLiveness,
  disposeEndpointStreamLivenessBinding,
  isAutomaticStopReceivingReason,
  mediaStreamFromLiveVoxStream,
  pruneMissingEndpointStreamLiveness,
  selectLiveVoxStream,
  VOX_STREAM_EVENT_ENDED,
  type EndpointStreamLivenessRegistry,
} from "@/lib/voximplant/media-liveness";
import {
  classifyProviderDisconnect,
  createBoundedProviderRejoin,
  isLocalMediaDeviceClassification,
  isMediaRecoveryClassification,
  isSessionOperableForProviderRejoin,
  retainPendingTerminalIncident,
  shouldCancelPendingTerminalIncident,
  takePendingTerminalIncident,
  type PendingTerminalRecoveryIncident,
  type ProviderDisconnectIntent,
  type ProviderRecoveryStatus,
} from "@/lib/voximplant/provider-disconnect-recovery";
import {
  reconcileRemoteParticipantsFromSnapshot,
  remotesAfterProviderDisconnect,
} from "@/lib/voximplant/endpoint-reconciliation";
import { logProviderRecovery } from "@/lib/voximplant/provider-recovery-log";
import {
  GATEWAY_WEBSOCKET_CLOSE_SDK_LOG,
  type VoxProviderFaultMode,
} from "@/lib/voximplant/provider-fault-simulation";
import { DEFAULT_PROVIDER_CONNECT_RETRY_POLICY } from "@/lib/voximplant/provider-connect-retry";
import {
  createSessionTransportRecovery,
  type SessionTransportRecovery,
  type SessionTransportRecoveryState,
} from "@/lib/voximplant/session-transport-recovery";
import {
  createDroppedCauseReporter,
  installVoxReInviteSchemeSanitizer,
  type VoxConnectionSeam,
} from "@/lib/voximplant/reinvite-scheme-sanitizer";
import { isStaleConnectionResponse } from "@/lib/client/stale-connection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Public types ────────────────────────────────────────────────────────────

export type MicCaptureStatus =
  | "not_requested"
  | "requesting"
  | "active"
  | "muted"
  | "unavailable"
  | "error";

// ─── Internal SDK type shims ─────────────────────────────────────────────────

type VoxWatchable<T> = {
  value: T;
  watch: (listener: (nextValue: T) => void) => () => void;
};

type VoxStream = {
  id: string;
  type: string;
  track?: MediaStreamTrack;
  sourceStream?: MediaStream;
  close?: () => void;
  addEventListener?: (
    eventName: "ENDED",
    listener: (event: { payload?: { streamId?: string } }) => void,
  ) => void;
  removeEventListener?: (
    eventName: "ENDED",
    listener: (event: { payload?: { streamId?: string } }) => void,
  ) => void;
};

type VoxEndpointMediaEvent = {
  payload?: {
    stream?: VoxStream;
    streamId?: string;
    reason?: string;
  };
};

type VoxEndpoint = {
  id: string;
  userName: string;
  displayName: string;
  addEventListener: (
    eventName:
      | "RemoteMediaAdded"
      | "RemoteMediaRemoved"
      | "StartReceivingVideoStream"
      | "StopReceivingVideoStream"
      | "StartReceivingAudioStream"
      | "StopReceivingAudioStream",
    listener: (event: VoxEndpointMediaEvent) => void,
  ) => void;
  removeEventListener: (
    eventName:
      | "RemoteMediaAdded"
      | "RemoteMediaRemoved"
      | "StartReceivingVideoStream"
      | "StopReceivingVideoStream"
      | "StartReceivingAudioStream"
      | "StopReceivingAudioStream",
    listener: (event: VoxEndpointMediaEvent) => void,
  ) => void;
  getAnyAudioStreams: () => VoxStream[];
  getAnyVideoStreams: () => VoxStream[];
};

type VoxConferenceEvent = {
  payload?: {
    reason?: string;
    newEndpointId?: string;
    removedEndpointId?: string;
  };
};

type VoxConference = {
  addEventListener: (
    eventName:
      | "Connected"
      | "Failed"
      | "Disconnected"
      | "EndpointAdded"
      | "EndpointRemoved",
    listener: (event: VoxConferenceEvent) => void,
  ) => void;
  removeEventListener: (
    eventName:
      | "Connected"
      | "Failed"
      | "Disconnected"
      | "EndpointAdded"
      | "EndpointRemoved",
    listener: (event: VoxConferenceEvent) => void,
  ) => void;
  join: () => Promise<void>;
  hangup: () => void;
  addStream: (stream: VoxStream) => Promise<void>;
  muteMicrophone: () => void;
  unmuteMicrophone: () => void;
  endpoints: VoxWatchable<Map<string, VoxEndpoint>>;
  state?: VoxWatchable<string>;
  /**
   * Sends a text message to the VoxEngine scenario via the Voximplant SDK
   * messaging channel. Used to relay recording_control messages.
   * Optional: only present on SDK versions that support conference messaging.
   */
  sendMessage?: (text: string) => void;
};

type VoxStreamModule = {
  streamManager: {
    createAudioStream: (config: { audioProcessing: boolean }) => Promise<VoxStream>;
    createVideoStream: (config: unknown) => Promise<VoxStream>;
  };
};

type VoxConferenceManager = {
  createConference: (options: {
    conferenceName: string;
    muteAudio?: boolean;
    reportStats?: boolean;
  }) => VoxConference;
};

type VoxCore = {
  registerModules: (modules: unknown[]) => void;
  getModule: (token: unknown) => unknown;
  client: {
    connect: (options?: { node?: string }) => Promise<unknown>;
    disconnect: () => Promise<unknown>;
    requestOneTimeKey: (options: { username: string }) => Promise<string>;
    loginOneTimeKey: (options: { username: string; hash: string }) => Promise<unknown>;
    state?: VoxWatchable<string>;
  };
};

type VoxRoomRole =
  | "participant_a"
  | "participant_b"
  | "facilitator"
  | "observer"
  | "unknown";

type AccessReadyPayload = {
  provider: "voximplant";
  roomNameOrConferenceName: string;
  user: {
    providerUsername: string;
    sdkUsername: string;
    displayName: string;
    role: VoxRoomRole;
  };
  connection: {
    accountName: string;
    applicationName: string;
    userDomain: string;
  };
  audioProcessingProfile?: "speech" | "raw_diagnostic";
  credentials:
    | {
        status: "one_time_key_required";
      }
    | {
        status: "ready";
        method: "one_time_key";
        oneTimeKeyHash: string;
      };
  error?: string;
  details?: string;
  code?: string;
};

type VoxRoomParticipant = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
  stream: MediaStream | null;
  audioStream?: MediaStream | null;
};

type VoxTabTakeoverMessage = {
  type: "lease_takeover_claimed";
  sessionId: string;
  connectionId: string;
  sdkUsername: string;
};

const VOX_TAKEOVER_CHANNEL = "vox-room-lifecycle";

function isVoxTabTakeoverMessage(value: unknown): value is VoxTabTakeoverMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.type === "lease_takeover_claimed" &&
    typeof record.sessionId === "string" &&
    typeof record.connectionId === "string" &&
    typeof record.sdkUsername === "string"
  );
}

export function shouldApplyVoxTakeoverMessage(input: {
  message: VoxTabTakeoverMessage;
  sessionId: string;
  connectionId?: string;
  sdkUsername: string;
}) {
  return (
    input.message.sessionId === input.sessionId &&
    input.message.sdkUsername === input.sdkUsername &&
    input.message.connectionId !== input.connectionId
  );
}

type UpsertRemoteParticipantInput = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
  stream?: MediaStream | null;
  audioStream?: MediaStream | null;
};

// ─── Hook options & result ────────────────────────────────────────────────────

type UseVoximplantRoomOptions = {
  sessionId: string;
  connectionId?: string;
  onStaleConnection?: () => void;
  /**
   * Server-gated provider fault script. Only ever anything but `"off"` when the
   * server runs with `EXTERNAL_SERVICES_MODE=mock`, so production cannot reach
   * a simulated transport failure.
   */
  providerFaultSimulation?: VoxProviderFaultMode;
  /**
   * Explicit URL debug override only (?camera=off or ?media=off).
   * All roles attempt camera by default when this is false/absent.
   */
  disableInitialCamera?: boolean;
  /**
   * Explicit URL debug override only (?mic=off or ?media=off).
   * All roles attempt microphone by default when this is false/absent.
   */
  disableInitialMic?: boolean;
  /**
   * Dedicated Post-processing Lab seam: skip Vox signaling. Production never
   * sets this; the room page only passes true when POST_TRANSCRIPTION_LAB=1.
   */
  skipRealtimeConnect?: boolean;
  /**
   * Latest Session close/operability projection. Evaluated at disconnect time
   * so a later FINISH/event-close cannot be missed by a stale closure.
   */
  isSessionOperable?: () => boolean;
};

type UseVoximplantRoomResult = {
  isLoading: boolean;
  isLeaving: boolean;
  joined: boolean;
  status: string;
  error: string | null;
  role: VoxRoomRole;
  localDisplayName: string;
  conferenceName: string;
  participantType: ParticipantType | null;
  localParticipant: VoxRoomParticipant | null;
  remoteParticipants: VoxRoomParticipant[];
  isMicMuted: boolean;
  isCameraOn: boolean;
  cameraUnavailable: boolean;
  /** Non-fatal Russian-language device acquisition warnings shown to the user. */
  mediaWarnings: string[];
  toggleMic: () => void;
  toggleCamera: () => void;
  leave: () => Promise<void>;
  // ── Audio diagnostics ──
  /** Lifecycle status of local microphone capture. */
  micCaptureStatus: MicCaptureStatus;
  localAudioStreamCreated: boolean;
  localAudioStreamAddedToConference: boolean;
  lastAudioError: string | null;
  /** Live local microphone level 0–100 (from AnalyserNode, ~15fps). */
  micLevel: number;
  /** Whether Vox audio processing profile is active. */
  audioProcessingEnabled: boolean;
  /** Number of remote video endpoints currently tracked. */
  remoteStreamCount: number;
  /** Number of HTMLAudioElement objects created for remote audio. */
  remoteAudioElementCount: number;
  /** True when at least one remote audio element's play() was blocked by autoplay policy. */
  remotePlaybackBlocked: boolean;
  lastRemoteAudioError: string | null;
  /** Call this after a user gesture to unblock all remote audio playback. */
  unlockAudioPlayback: () => void;
  /**
   * Send a text message to the VoxEngine scenario via conference.sendMessage().
   * Used by the Voximplant recording adapter to relay recording_control messages.
   * Returns true when the message was dispatched; false when the conference is
   * not connected or the SDK does not expose sendMessage on this version.
   */
  sendConferenceMessage: (text: string) => boolean;
  /**
   * Non-blocking gateway-transport health for an already connected room. The
   * Session shell, its state and its lifecycle are unaffected by it.
   */
  transportRecovery: SessionTransportRecoveryState;
  /** Client-only bounded provider rejoin: idle | recovering | recovered | failed. */
  providerRecovery: ProviderRecoveryStatus;
  /**
   * Authoritative Layer-3 Vox/media connectivity. Independent of logical
   * presence (heartbeat) and roomLifecycle.
   */
  layer3: Layer3ConnectivityState;
  layer3Banner: "reconnecting" | "degraded" | "failed" | null;
  /** True after first successful room entry; keeps SharedRoomShell mounted. */
  hasEnteredRoom: boolean;
  /** True when conference.sendMessage() is available on the current SDK object. */
  sendMessageAvailable: boolean;
};

// ─── Runtime mutable state (lives in a ref, never triggers renders) ───────────

type RuntimeState = {
  generation: number;
  core: VoxCore;
  /** Retained so toggles can create new streams after joining. */
  streamModule: VoxStreamModule;
  conferenceManager: VoxConferenceManager;
  conferenceName: string;
  muteAudio: boolean;
  /** VideoQuality enum value from the SDK used for new camera streams. */
  videoQuality: unknown;
  conference: VoxConference | null;
  conferenceConnected: boolean;
  localAudioStream: VoxStream | null;
  localVideoStream: VoxStream | null;
  /**
   * True when localAudioStream is a synthetic silent stream (Web Audio API, no physical mic).
   * Used to decide whether to replace the stream on unmute.
   */
  isSilentAudio: boolean;
  /** True once audio stream has been added to conference via addStream. Prevents duplicate adds. */
  audioStreamAdded: boolean;
  /** True once video stream has been added to conference via addStream. Prevents duplicate adds. */
  videoStreamAdded: boolean;
  /** Guards against concurrent audio toggle operations. */
  audioOpPending: boolean;
  /** Guards against concurrent video toggle operations. */
  videoOpPending: boolean;
  endpointSubscriptions: Map<
    string,
    {
      endpoint: VoxEndpoint;
      generation: number;
      onAdded: (event: VoxEndpointMediaEvent) => void;
      onRemoved: (event: VoxEndpointMediaEvent) => void;
      onStopVideo?: (event: VoxEndpointMediaEvent) => void;
      onStartVideo?: (event: VoxEndpointMediaEvent) => void;
    }
  >;
  streamLivenessByEndpoint: EndpointStreamLivenessRegistry;
  conferenceStateWatcherEpoch: number;
  unwatchClientState: (() => void) | null;
  unwatchConferenceState: (() => void) | null;
  conferenceListeners: {
    onConnected: (event: VoxConferenceEvent) => void;
    onFailed: (event: VoxConferenceEvent) => void;
    onDisconnected: (event: VoxConferenceEvent) => void;
    onEndpointAdded: (event: VoxConferenceEvent) => void;
    onEndpointRemoved: (event: VoxConferenceEvent) => void;
  } | null;
  // ── Mic level meter ──
  analyserNode: AnalyserNode | null;
  analyserCtx: AudioContext | null;
  animFrameId: number | null;
  /** Timestamp of last micLevel state update (throttles to ~15fps). */
  lastMicLevelTs: number;
  // ── Remote audio elements ──
  /** Keyed by `${endpointId}-${streamId}`. */
  remoteAudioElements: Map<string, HTMLAudioElement>;
  /** Poll fallback for endpoint media status sync. */
  endpointSyncIntervalId: number | null;
};

type VoxLifecycleAbortReason =
  | "stale_connection"
  | "invalidated_generation"
  | "component_unmounted";

class VoxLifecycleAbortError extends Error {
  readonly reason: VoxLifecycleAbortReason;

  constructor(reason: VoxLifecycleAbortReason) {
    super(`Vox lifecycle aborted: ${reason}`);
    this.name = "VoxLifecycleAbortError";
    this.reason = reason;
  }
}

function isVoxLifecycleAbortError(error: unknown): error is VoxLifecycleAbortError {
  return error instanceof VoxLifecycleAbortError;
}

export function createVoxGenerationTracker() {
  let currentGeneration = 0;
  let stale = false;
  let mounted = true;

  return {
    begin(): number {
      stale = false;
      currentGeneration += 1;
      return currentGeneration;
    },
    invalidate(reason: VoxLifecycleAbortReason): void {
      currentGeneration += 1;
      if (reason === "stale_connection") stale = true;
      if (reason === "component_unmounted") mounted = false;
    },
    assertCurrent(generation: number): void {
      if (!mounted) throw new VoxLifecycleAbortError("component_unmounted");
      if (stale) throw new VoxLifecycleAbortError("stale_connection");
      if (currentGeneration !== generation) {
        throw new VoxLifecycleAbortError("invalidated_generation");
      }
    },
    isCurrent(generation: number): boolean {
      return mounted && !stale && currentGeneration === generation;
    },
  };
}

export function createSingleFlightAsync<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<void>,
) {
  let inFlight: Promise<void> | null = null;
  return (...args: TArgs): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = handler(...args).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

// ─── Pure utility functions ───────────────────────────────────────────────────

function toErrorMessage(error: unknown): string {
  return toVoxErrorMessage(error);
}

/**
 * Returns true for device-access errors that should be treated as non-fatal:
 * device busy, permission denied, device not found.
 */
function isNonFatalMediaError(error: unknown): boolean {
  return isRecoverableVoxMediaError(error);
}

/**
 * Returns true for SDK "already exists" errors from addStream.
 * These indicate the conference already registered a stream of that type.
 */
function isAlreadyExistsError(error: unknown): boolean {
  return isAlreadyExistsStreamError(error);
}

/**
 * Creates a completely silent audio stream via Web Audio API.
 * Does NOT access any physical microphone. Used as a fallback to satisfy
 * the Voximplant SDK's requirement that an audio stream is added before join().
 */
function createSilentAudioStream(): VoxStream | null {
  try {
    const AudioContextCtor =
      (typeof window !== "undefined" ? window.AudioContext : undefined) ??
      (typeof window !== "undefined"
        ? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined);
    if (!AudioContextCtor) return null;

    const ctx = new AudioContextCtor();
    const destination = ctx.createMediaStreamDestination();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 0;
    osc.connect(gain);
    gain.connect(destination);
    osc.start();

    const ms = destination.stream;
    const track = ms.getAudioTracks()[0];
    if (!track) {
      try { osc.stop(); } catch { /* ignore */ }
      void ctx.close();
      return null;
    }

    return {
      id: `silent-audio-${Date.now()}`,
      type: "audio",
      track,
      sourceStream: ms,
      close: () => {
        try { osc.stop(); } catch { /* ignore */ }
        try { track.stop(); } catch { /* ignore */ }
        void ctx.close();
      },
    };
  } catch {
    return null;
  }
}

/**
 * Calls conference.addStream, treating "stream already exists" as a recoverable state
 * mismatch (e.g. caused by React StrictMode double-invoke or SDK internal state).
 * Returns true on success or benign duplicate; throws on genuine errors.
 */
async function safeAddStream(conference: VoxConference, stream: VoxStream): Promise<boolean> {
  try {
    await conference.addStream(stream);
    return true;
  } catch (e) {
    if (isAlreadyExistsError(e)) {
      // Stream slot is already occupied — treat as if we successfully added it.
      return true;
    }
    throw e;
  }
}

function streamToMediaStream(stream: VoxStream | null): MediaStream | null {
  if (!stream) return null;
  if (stream.sourceStream) return stream.sourceStream;
  if (stream.track) return new MediaStream([stream.track]);
  return null;
}

function liveRemoteMediaStream(stream: VoxStream | null): MediaStream | null {
  return mediaStreamFromLiveVoxStream(stream);
}

function getAudioTrack(stream: VoxStream | null): MediaStreamTrack | null {
  return streamToMediaStream(stream)?.getAudioTracks()[0] ?? null;
}

function mapParticipantType(role: VoxRoomRole): ParticipantType | null {
  if (role === "facilitator") return "FACILITATOR";
  if (role === "observer") return "OBSERVER";
  if (role === "participant_a" || role === "participant_b") return "PARTICIPANT";
  return null;
}

function buildAccessErrorMessage(status: number, payload: { error?: string; code?: string }) {
  if (status === 401) return "Authentication required. Please sign in and try again.";
  if (status === 403) return "Access denied for this negotiation room.";
  if (status === 501) return "Voximplant browser auth handoff is not ready in this environment.";
  if (status === 503) return "Voximplant configuration is incomplete in this environment.";
  if (payload.error) return payload.error;
  return `Unable to initialize Voximplant (${status}).`;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

/**
 * DEV ONLY: Temporarily patches console.error to suppress expected Voximplant
 * WebSDK camera-busy messages that would otherwise trigger the Next.js dev
 * overlay. Only active while camera acquisition is in progress.
 *
 * Suppresses ONLY messages matching both:
 *   "[StreamManager]" + "NotReadableError"  — SDK stream-manager device-busy log
 *   "NotReadableError: Device in use"        — exact SDK error string
 *   "Device in use" + "[StreamManager]"      — alternate phrasing
 *
 * Auth errors, conference join errors and unknown SDK errors are NOT suppressed.
 * Always call the returned restore function (in a finally block).
 */
function installCameraErrorSuppressor(): () => void {
  return installVoxCameraErrorSuppressor();
}

/** Steady state: the gateway link is up and nothing is being recovered. */
const IDLE_TRANSPORT_RECOVERY: SessionTransportRecoveryState = {
  status: "stable",
  attempt: 0,
  maxAttempts: DEFAULT_PROVIDER_CONNECT_RETRY_POLICY.maxAttempts,
  reason: null,
  canRetryManually: false,
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVoximplantRoom({
  sessionId,
  connectionId,
  onStaleConnection,
  providerFaultSimulation = "off",
  disableInitialCamera = false,
  disableInitialMic = false,
  isSessionOperable,
  skipRealtimeConnect = false,
}: UseVoximplantRoomOptions): UseVoximplantRoomResult {
  const runtimeRef = useRef<RuntimeState | null>(null);
  const mountedRef = useRef(true);
  const isJoiningRef = useRef(false);
  const generationRef = useRef(0);
  const staleLifecycleRef = useRef(false);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const staleNotifiedRef = useRef(false);
  const sdkUsernameRef = useRef<string | null>(null);
  const takeoverChannelRef = useRef<BroadcastChannel | null>(null);
  const clientOwnershipRef = useRef<VoxClientOwnership | null>(null);
  const lifecyclePhaseRef = useRef<VoxLifecyclePhase>("idle");
  const droppedCauseReporterRef = useRef(createDroppedCauseReporter());
  /** Stable ref for display name so toggle callbacks avoid stale closures. */
  const localDisplayNameRef = useRef("");
  const audioProcessingEnabledRef = useRef(true);
  const disconnectIntentRef = useRef<ProviderDisconnectIntent>("none");
  const rejoinInProgressRef = useRef(false);
  const boundedRejoinRef = useRef(createBoundedProviderRejoin());
  const isSessionOperableRef = useRef(isSessionOperable);
  useEffect(() => {
    isSessionOperableRef.current = isSessionOperable;
  }, [isSessionOperable]);
  const resyncEndpointsRef = useRef<(generation: number) => void>(() => {});
  const [providerRecovery, setProviderRecovery] =
    useState<ProviderRecoveryStatus>("idle");
  const [layer3, setLayer3] = useState<Layer3ConnectivityState>(() =>
    createLayer3State({ status: "connected", hasEnteredRoom: false }),
  );
  const [hasEnteredRoom, setHasEnteredRoom] = useState(false);
  const isUnmountingRef = useRef(false);
  const sdkClientStateRef = useRef<string | null>(null);
  const sdkConferenceStateRef = useRef<string | null>(null);
  const sdkReconnectingRef = useRef(false);
  const pendingTerminalRecoveryRef = useRef<PendingTerminalRecoveryIncident | null>(null);
  const recoverTerminalConferenceRef = useRef<
    (failedGeneration: number, reason: string) => void
  >(() => {});
  const bindConferenceRef = useRef<
    (conference: VoxConference, runtime: RuntimeState, generation: number) => void
  >(() => {});
  const layer3Ref = useRef(layer3);
  useEffect(() => {
    layer3Ref.current = layer3;
  }, [layer3]);

  const invalidateGeneration = useCallback((reason: VoxLifecycleAbortReason) => {
    generationRef.current += 1;
    lifecyclePhaseRef.current = "intentional_teardown";
    if (reason === "stale_connection") {
      staleLifecycleRef.current = true;
    }
    if (reason === "component_unmounted") {
      mountedRef.current = false;
    }
  }, []);

  const beginJoinGeneration = useCallback(() => {
    staleLifecycleRef.current = false;
    staleNotifiedRef.current = false;
    lifecyclePhaseRef.current = "connecting";
    resetVoxSdkLogDedupe();
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  const fenceCurrentGeneration = useCallback((reason: string) => {
    const current = generationRef.current;
    const { fencedGeneration, nextGeneration } = fenceGeneration(current);
    generationRef.current = nextGeneration;
    logProviderRecovery({
      surface: "session-room",
      sessionId,
      generation: fencedGeneration,
      event: "generation_fenced",
      reason,
    });
    return { fencedGeneration, nextGeneration };
  }, [sessionId]);

  const publishLayer3 = useCallback((next: Layer3ConnectivityState) => {
    layer3Ref.current = next;
    if (mountedRef.current) setLayer3(next);
  }, []);

  const [transportRecovery, setTransportRecovery] =
    useState<SessionTransportRecoveryState>(IDLE_TRANSPORT_RECOVERY);
  const transportRecoveryRef = useRef<SessionTransportRecovery | null>(null);

  /**
   * True only while this hook instance is the live owner of the room. A stale
   * tab or an unmounted generation must not keep driving recovery, and neither
   * must this room once the Event lobby has taken the shared client over.
   */
  const isTransportOwnerCurrent = useCallback(() => {
    if (!mountedRef.current || staleLifecycleRef.current) return false;
    const ownership = clientOwnershipRef.current;
    return !ownership || ownership.isCurrent();
  }, []);

  // Owns the shared SDK log callback while this room is the active surface.
  // Released on unmount, but only if the Event lobby has not already taken over.
  useEffect(() => {
    const recovery = createSessionTransportRecovery({
      isConferenceConnected: () => runtimeRef.current?.conferenceConnected === true,
      isOwnerCurrent: isTransportOwnerCurrent,
      onState: (next) => {
        if (!mountedRef.current) return;
        setTransportRecovery(next);
      },
    });
    transportRecoveryRef.current = recovery;

    const releaseSink = registerVoxSdkLogSink({
      surface: "session-room",
      getContext: () => ({
        phase: lifecyclePhaseRef.current,
        intentionalHandoff: isIntentionalProviderHandoffActive(),
      }),
      onClassified: (classification: VoxClassification) => {
        if (isLocalMediaDeviceClassification(classification.reason)) {
          return;
        }
        if (isMediaRecoveryClassification(classification.reason)) {
          const runtime = runtimeRef.current;
          if (
            lifecyclePhaseRef.current === "connected" &&
            runtime?.conferenceConnected &&
            runtime.generation === generationRef.current
          ) {
            logProviderRecovery({
              surface: "session-room",
              sessionId,
              generation: runtime.generation,
              event: "endpoint_resync",
              classification: "RECOVERABLE_TRANSIENT",
              reason: classification.reason,
            });
            resyncEndpointsRef.current(runtime.generation);
          }
          return;
        }
        if (
          classification.reason === "transport_unavailable:408" ||
          classification.reason.startsWith("transport_unavailable:408")
        ) {
          const runtime = runtimeRef.current;
          const mediaUsable = remoteParticipantsRef.current.some((remote) => {
            const video = remote.stream?.getTracks().some((track) => track.readyState !== "ended");
            const audio = remote.audioStream
              ?.getTracks()
              .some((track) => track.readyState !== "ended");
            return Boolean(video || audio);
          });
          const action = decide408Action({
            sdkReconnecting: sdkReconnectingRef.current,
            mediaUsable,
            conferenceTerminal:
              runtime?.conference == null && layer3Ref.current.status === "failed",
          });
          if (action === "observe_sdk") {
            publishLayer3(
              layer3AfterSdkReconnecting({
                ...layer3Ref.current,
                hasEnteredRoom: layer3Ref.current.hasEnteredRoom,
              }),
            );
            return;
          }
          if (action === "keep") {
            return;
          }
          if (
            action === "resync" &&
            runtime &&
            runtime.generation === generationRef.current
          ) {
            publishLayer3(
              layer3AfterMediaDegraded(layer3Ref.current, classification.reason),
            );
            resyncEndpointsRef.current(runtime.generation);
          }
          return;
        }
        // Only a gateway socket that dropped under a live connection starts a
        // transport-quiet recovery. IceRestart / ReInvite timeout must not.
        if (classification.reason !== "gateway_websocket_closed") return;
        recovery.noteTransportLoss(classification);
      },
    });

    return () => {
      recovery.cancel();
      transportRecoveryRef.current = null;
      releaseSink();
    };
  }, [isTransportOwnerCurrent, publishLayer3, sessionId]);

  /**
   * Replays the captured gateway-close log line through the real SDK log
   * pipeline once the room is up, so the classification, the console policy and
   * the recovery sequence are all exercised end to end without waiting for a
   * long-lived gateway to actually drop. Inert outside mock mode.
   *
   * It waits for the connected phase because that is the state the defect was
   * reported in, and gives up waiting after a bounded deadline so a room that
   * never reaches the gateway still produces the closure under test.
   */
  useEffect(() => {
    if (providerFaultSimulation !== "gateway-ws-close-connected") return;
    const deadline = Date.now() + 15_000;
    let timer = 0;

    const inject = () => {
      if (!mountedRef.current) return;
      if (lifecyclePhaseRef.current !== "connected" && Date.now() < deadline) {
        timer = window.setTimeout(inject, 250);
        return;
      }
      dispatchVoxSdkLog({
        fullMessage: GATEWAY_WEBSOCKET_CLOSE_SDK_LOG,
        message: [GATEWAY_WEBSOCKET_CLOSE_SDK_LOG],
        extraData: { level: "ERROR", scope: "GW Transport" },
      });
    };

    timer = window.setTimeout(inject, 1_000);
    return () => window.clearTimeout(timer);
  }, [providerFaultSimulation]);

  const assertGenerationCurrent = useCallback(
    (generation: number) => {
      if (!mountedRef.current) {
        throw new VoxLifecycleAbortError("component_unmounted");
      }
      if (staleLifecycleRef.current) {
        throw new VoxLifecycleAbortError("stale_connection");
      }
      if (generationRef.current !== generation) {
        throw new VoxLifecycleAbortError("invalidated_generation");
      }
    },
    [],
  );

  const isRuntimeActive = useCallback((runtime: RuntimeState | null, generation: number) => {
    if (!runtime) return false;
    if (staleLifecycleRef.current) return false;
    return runtime.generation === generation && generationRef.current === generation;
  }, []);

  const handleStaleConnection = useCallback(() => {
    if (staleLifecycleRef.current) return;
    disconnectIntentRef.current = "stale_connection";
    pendingTerminalRecoveryRef.current = null;
    invalidateGeneration("stale_connection");
    if (!staleNotifiedRef.current) {
      staleNotifiedRef.current = true;
      onStaleConnection?.();
    }
  }, [invalidateGeneration, onStaleConnection]);

  const broadcastTakeoverClaimed = useCallback((sdkUsername: string) => {
    if (!connectionId || typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      return;
    }
    if (!takeoverChannelRef.current) {
      takeoverChannelRef.current = new BroadcastChannel(VOX_TAKEOVER_CHANNEL);
    }
    takeoverChannelRef.current.postMessage({
      type: "lease_takeover_claimed",
      sessionId,
      connectionId,
      sdkUsername,
    } as VoxTabTakeoverMessage);
  }, [connectionId, sessionId]);

  // ── React state ──────────────────────────────────────────────────────────
  const [joinLoading, setJoinLoading] = useState(true);
  const isLoading = skipRealtimeConnect ? false : joinLoading;
  const [isLeaving, setIsLeaving] = useState(false);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState("Инициализация переговорной комнаты...");
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<VoxRoomRole>("unknown");
  const [participantType, setParticipantType] = useState<ParticipantType | null>(null);
  const [localDisplayName, setLocalDisplayName] = useState("");
  const [conferenceName, setConferenceName] = useState("");
  const [localParticipant, setLocalParticipant] = useState<VoxRoomParticipant | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<VoxRoomParticipant[]>([]);
  const remoteParticipantsRef = useRef<VoxRoomParticipant[]>([]);
  const commitRemoteParticipants = useCallback(
    (
      next:
        | VoxRoomParticipant[]
        | ((current: VoxRoomParticipant[]) => VoxRoomParticipant[]),
    ) => {
      setRemoteParticipants((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        remoteParticipantsRef.current = resolved;
        return resolved;
      });
    },
    [],
  );
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [mediaWarnings, setMediaWarnings] = useState<string[]>([]);
  // Audio diagnostics
  const [micCaptureStatus, setMicCaptureStatus] = useState<MicCaptureStatus>("not_requested");
  const [localAudioStreamCreated, setLocalAudioStreamCreated] = useState(false);
  const [localAudioStreamAddedToConference, setLocalAudioStreamAddedToConference] = useState(false);
  const [lastAudioError, setLastAudioError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [audioProcessingEnabled, setAudioProcessingEnabled] = useState(true);
  const [remoteAudioElementCount, setRemoteAudioElementCount] = useState(0);
  const [remotePlaybackBlocked, setRemotePlaybackBlocked] = useState(false);
  const [lastRemoteAudioError, setLastRemoteAudioError] = useState<string | null>(null);
  const [sendMessageAvailable, setSendMessageAvailable] = useState(false);

  // ── Warnings helpers ──────────────────────────────────────────────────────
  const addMediaWarning = useCallback((msg: string) => {
    setMediaWarnings((prev) => (prev.includes(msg) ? prev : [...prev, msg]));
  }, []);

  const removeMediaWarningsByKeyword = useCallback((keyword: string) => {
    setMediaWarnings((prev) => prev.filter((w) => !w.toLowerCase().includes(keyword)));
  }, []);

  // ── Mic level meter ───────────────────────────────────────────────────────

  /** Stop the AnalyserNode rAF loop and release its AudioContext. */
  const stopMicLevelMeter = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    if (rt.animFrameId !== null) {
      cancelAnimationFrame(rt.animFrameId);
      rt.animFrameId = null;
    }
    if (rt.analyserNode) {
      try { rt.analyserNode.disconnect(); } catch { /* ignore */ }
      rt.analyserNode = null;
    }
    if (rt.analyserCtx) {
      void rt.analyserCtx.close();
      rt.analyserCtx = null;
    }
    setMicLevel(0);
  }, []);

  /**
   * Start a Web Audio AnalyserNode on the given MediaStream.
   * Updates micLevel state at ~15fps. Non-fatal if AudioContext is unavailable.
   */
  const startMicLevelMeter = useCallback(
    (mediaStream: MediaStream) => {
      const rt = runtimeRef.current;
      if (!rt) return;

      // Tear down any existing meter first.
      stopMicLevelMeter();

      try {
        const Ctor = getAudioContextCtor();
        if (!Ctor) return;

        const ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        const source = ctx.createMediaStreamSource(mediaStream);
        source.connect(analyser);

        rt.analyserNode = analyser;
        rt.analyserCtx = ctx;
        rt.lastMicLevelTs = 0;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          const current = runtimeRef.current;
          // Stop if runtime was replaced or component unmounted.
          if (!current?.analyserNode || !mountedRef.current) return;
          current.animFrameId = requestAnimationFrame(tick);

          const now = Date.now();
          if (now - current.lastMicLevelTs < 66) return; // throttle to ~15fps
          current.lastMicLevelTs = now;

          analyser.getByteTimeDomainData(dataArray);
          let sumSq = 0;
          for (const v of dataArray) {
            const n = (v - 128) / 128;
            sumSq += n * n;
          }
          const rms = Math.sqrt(sumSq / dataArray.length);
          const level = Math.min(
            100,
            Math.round(rms * AUDIO_LEVEL_RMS_TO_PERCENT_MULTIPLIER),
          );
          setMicLevel(level);
        };

        rt.animFrameId = requestAnimationFrame(tick);

        // Resume if the context was created in suspended state (autoplay policy).
        if (ctx.state === "suspended") void ctx.resume();
      } catch {
        // AnalyserNode is optional; mic level meter failure is non-fatal.
      }
    },
    [stopMicLevelMeter],
  );

  const upsertRemote = useCallback((next: UpsertRemoteParticipantInput) => {
    commitRemoteParticipants((current) => {
      const index = current.findIndex((item) => item.id === next.id);
      if (index === -1) {
        return [
          ...current,
          {
            id: next.id,
            displayName: next.displayName,
            endpointUsername: next.endpointUsername ?? null,
            stream: next.stream ?? null,
            audioStream: next.audioStream ?? null,
          },
        ];
      }
      const copy = [...current];
      copy[index] = {
        ...copy[index],
        displayName: next.displayName,
        endpointUsername:
          next.endpointUsername === undefined
            ? copy[index].endpointUsername ?? null
            : next.endpointUsername,
        stream: next.stream === undefined ? copy[index].stream : next.stream,
        audioStream:
          next.audioStream === undefined ? copy[index].audioStream ?? null : next.audioStream,
      };
      return copy;
    });
  }, [commitRemoteParticipants]);

  // ── Remote audio attachment ───────────────────────────────────────────────

  /**
   * Create an HTMLAudioElement for a remote audio VoxStream and start playback.
   * Handles autoplay blocking by setting remotePlaybackBlocked state.
   * Safe to call multiple times for the same key (idempotent).
   */
  const attachRemoteAudioStream = useCallback(
    (endpointId: string, voxStream: VoxStream, generation: number) => {
      const rt = runtimeRef.current;
      if (!isRuntimeActive(rt, generation)) return;
      if (!rt) return;

      const ms = liveRemoteMediaStream(voxStream);
      if (!ms) return;

      const key = `${endpointId}-${voxStream.id}`;
      if (rt.remoteAudioElements.has(key)) return;

      const audio = new Audio();
      audio.srcObject = ms;
      audio.autoplay = true;
      upsertRemote({
        id: endpointId,
        displayName: endpointId,
        audioStream: ms,
      });
      rt.remoteAudioElements.set(key, audio);
      setRemoteAudioElementCount(rt.remoteAudioElements.size);

      audio.play().then(() => {
        if (mountedRef.current && generationRef.current === generation) {
          setRemotePlaybackBlocked(false);
        }
      }).catch((err: unknown) => {
        if (!mountedRef.current || generationRef.current !== generation) return;
        const msg = toErrorMessage(err);
        const isAutoplayBlock =
          (err instanceof Error && err.name === "NotAllowedError") ||
          msg.toLowerCase().includes("interact") ||
          msg.toLowerCase().includes("user gesture") ||
          msg.toLowerCase().includes("autoplay") ||
          msg.toLowerCase().includes("play()");
        if (isAutoplayBlock) {
          setRemotePlaybackBlocked(true);
        } else {
          setLastRemoteAudioError(`Воспроизведение удалённого звука: ${msg}`);
        }
      });
    },
    [isRuntimeActive, upsertRemote],
  );

  /** Pause and remove one remote audio element for a specific stream. */
  const detachRemoteAudioStream = useCallback((endpointId: string, streamId: string) => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const key = `${endpointId}-${streamId}`;
    const audio = rt.remoteAudioElements.get(key);
    if (!audio) return;
    audio.pause();
    rt.remoteAudioElements.delete(key);
    setRemoteAudioElementCount(rt.remoteAudioElements.size);
  }, []);

  /** Pause and remove all audio elements associated with an endpoint. */
  const detachRemoteAudioStreams = useCallback((endpointId: string) => {
    const rt = runtimeRef.current;
    if (!rt) return;
    const prefix = `${endpointId}-`;
    const toDelete: string[] = [];
    for (const [key, audio] of rt.remoteAudioElements) {
      if (key.startsWith(prefix)) {
        audio.pause();
        // srcObject cleared in cleanup; element is removed from map and will be GC'd.
        toDelete.push(key);
      }
    }
    for (const key of toDelete) rt.remoteAudioElements.delete(key);
    if (toDelete.length > 0) setRemoteAudioElementCount(rt.remoteAudioElements.size);
    if (toDelete.length > 0) {
      upsertRemote({
        id: endpointId,
        displayName: endpointId,
        audioStream: null,
      });
    }
  }, [upsertRemote]);

  /** Attempt to play all paused remote audio elements (call after user gesture). */
  const unlockAudioPlayback = useCallback(() => {
    const rt = runtimeRef.current;
    if (!rt) return;
    for (const audio of rt.remoteAudioElements.values()) {
      if (audio.paused) {
        audio.play().then(() => {
          if (mountedRef.current) setRemotePlaybackBlocked(false);
        }).catch(() => {
          // Still blocked — user may need to interact more explicitly.
        });
      }
    }
  }, []);

  /**
   * Send a text message to the VoxEngine scenario via conference.sendMessage().
   * Returns true on success, false when unavailable (not connected or SDK missing).
   */
  const sendConferenceMessage = useCallback((text: string): boolean => {
    const rt = runtimeRef.current;
    if (!rt?.conference || !rt.conferenceConnected || staleLifecycleRef.current) return false;
    if (generationRef.current !== rt.generation) return false;
    const conf = rt.conference as VoxConference;
    if (typeof conf.sendMessage !== "function") return false;
    try {
      conf.sendMessage(text);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Remote participants ───────────────────────────────────────────────────

  const removeRemoteById = useCallback(
    (endpointId: string) => {
      commitRemoteParticipants((current) => current.filter((item) => item.id !== endpointId));
      detachRemoteAudioStreams(endpointId);
    },
    [commitRemoteParticipants, detachRemoteAudioStreams],
  );

  const unsubscribeEndpoint = useCallback((runtime: RuntimeState, endpointId: string) => {
    disposeEndpointStreamLiveness(runtime.streamLivenessByEndpoint, endpointId);
    const subscription = runtime.endpointSubscriptions.get(endpointId);
    if (!subscription) return;
    subscription.endpoint.removeEventListener("RemoteMediaAdded", subscription.onAdded);
    subscription.endpoint.removeEventListener("RemoteMediaRemoved", subscription.onRemoved);
    if (subscription.onStopVideo) {
      subscription.endpoint.removeEventListener("StopReceivingVideoStream", subscription.onStopVideo);
    }
    if (subscription.onStartVideo) {
      subscription.endpoint.removeEventListener("StartReceivingVideoStream", subscription.onStartVideo);
    }
    runtime.endpointSubscriptions.delete(endpointId);
    detachRemoteAudioStreams(endpointId);
  }, [detachRemoteAudioStreams]);

  const clearLiveRemoteState = useCallback((generation: number) => {
    if (generationRef.current !== generation || staleLifecycleRef.current) return;
    const runtime = runtimeRef.current;
    if (runtime && runtime.generation === generation) {
      for (const endpointId of Array.from(runtime.endpointSubscriptions.keys())) {
        unsubscribeEndpoint(runtime, endpointId);
      }
      clearRemoteAudioElements(runtime.remoteAudioElements);
      runtime.remoteAudioElements.clear();
    }
    commitRemoteParticipants(remotesAfterProviderDisconnect());
    setRemoteAudioElementCount(0);
    setRemotePlaybackBlocked(false);
  }, [commitRemoteParticipants, unsubscribeEndpoint]);

  const applyRemoteVideoStream = useCallback(
    (endpoint: VoxEndpoint, generation: number) => {
      if (generationRef.current !== generation || staleLifecycleRef.current) return;
      const liveVideo = selectLiveVoxStream(endpoint.getAnyVideoStreams());
      const liveAudio = selectLiveVoxStream(endpoint.getAnyAudioStreams());
      upsertRemote({
        id: endpoint.id,
        displayName: endpoint.displayName || endpoint.userName || endpoint.id,
        endpointUsername: endpoint.userName ?? null,
        stream: liveRemoteMediaStream(liveVideo),
        audioStream: liveRemoteMediaStream(liveAudio),
      });
    },
    [upsertRemote],
  );

  // ── Cleanup ───────────────────────────────────────────────────────────────

  const clearStateAfterCleanup = useCallback(() => {
    sdkUsernameRef.current = null;
    if (!mountedRef.current) return;
    setJoined(false);
    commitRemoteParticipants([]);
    setLocalParticipant(null);
    setIsMicMuted(false);
    setIsCameraOn(false);
    setCameraUnavailable(false);
    setMicCaptureStatus("not_requested");
    setLocalAudioStreamCreated(false);
    setLocalAudioStreamAddedToConference(false);
    setMicLevel(0);
    setRemoteAudioElementCount(0);
    setRemotePlaybackBlocked(false);
    setSendMessageAvailable(false);
    setAudioProcessingEnabled(true);
  }, [commitRemoteParticipants]);

  useEffect(() => {
    return () => {
      takeoverChannelRef.current?.close();
      takeoverChannelRef.current = null;
    };
  }, []);

  const cleanup = useCallback(
    async (
      reason: VoxLifecycleAbortReason = "invalidated_generation",
      options?: {
        preserveStatus?: boolean;
        skipInvalidation?: boolean;
        expectedGeneration?: number;
      },
    ) => {
      // Allow a new lifecycle to start immediately after invalidation/teardown trigger.
      isJoiningRef.current = false;
      pendingTerminalRecoveryRef.current = null;
      boundedRejoinRef.current.cancel();
      rejoinInProgressRef.current = false;

      if (cleanupPromiseRef.current) {
        return cleanupPromiseRef.current;
      }

      if (!options?.skipInvalidation) {
        invalidateGeneration(reason);
      }

      // Detach current runtime immediately so no future operation can reuse it.
      const runtimeSnapshot = runtimeRef.current;
      const expectedGeneration = options?.expectedGeneration;
      const runtimeBelongsToExpected =
        expectedGeneration === undefined ||
        runtimeSnapshot?.generation === expectedGeneration;
      const lifecycleStillAtExpected =
        expectedGeneration !== undefined && generationRef.current === expectedGeneration;
      const shouldSkipAsStaleLifecycle =
        expectedGeneration !== undefined &&
        !runtimeBelongsToExpected &&
        !lifecycleStillAtExpected;
      if (shouldSkipAsStaleLifecycle) {
        return;
      }

      if (runtimeBelongsToExpected) {
        runtimeRef.current = null;
      }

      const promise = registerVoxClientDisconnect((async () => {
        if (!runtimeBelongsToExpected) {
          return;
        }
        if (!runtimeSnapshot) {
          clearStateAfterCleanup();
          return;
        }
        // Stop mic level meter in-place (don't use stopMicLevelMeter callback to avoid dep cycle).
        if (runtimeSnapshot.animFrameId !== null) {
          cancelAnimationFrame(runtimeSnapshot.animFrameId);
          runtimeSnapshot.animFrameId = null;
        }
        if (runtimeSnapshot.analyserNode) {
          try { runtimeSnapshot.analyserNode.disconnect(); } catch { /* ignore */ }
          runtimeSnapshot.analyserNode = null;
        }
        if (runtimeSnapshot.analyserCtx) {
          void runtimeSnapshot.analyserCtx.close();
          runtimeSnapshot.analyserCtx = null;
        }

        // Release remote audio elements.
        clearRemoteAudioElements(runtimeSnapshot.remoteAudioElements);
        if (runtimeSnapshot.endpointSyncIntervalId !== null) {
          window.clearInterval(runtimeSnapshot.endpointSyncIntervalId);
          runtimeSnapshot.endpointSyncIntervalId = null;
        }
        disposeAllEndpointStreamLiveness(runtimeSnapshot.streamLivenessByEndpoint);
        runtimeSnapshot.unwatchConferenceState?.();
        runtimeSnapshot.unwatchConferenceState = null;
        runtimeSnapshot.conferenceStateWatcherEpoch += 1;
        runtimeSnapshot.unwatchClientState?.();
        runtimeSnapshot.unwatchClientState = null;

        // Unsubscribe endpoint listeners.
        for (const { endpoint, onAdded, onRemoved } of runtimeSnapshot.endpointSubscriptions.values()) {
          endpoint.removeEventListener("RemoteMediaAdded", onAdded);
          endpoint.removeEventListener("RemoteMediaRemoved", onRemoved);
        }
        runtimeSnapshot.endpointSubscriptions.clear();

        // Unsubscribe conference listeners.
        if (runtimeSnapshot.conference && runtimeSnapshot.conferenceListeners) {
          runtimeSnapshot.conference.removeEventListener("Connected", runtimeSnapshot.conferenceListeners.onConnected);
          runtimeSnapshot.conference.removeEventListener("Failed", runtimeSnapshot.conferenceListeners.onFailed);
          runtimeSnapshot.conference.removeEventListener("Disconnected", runtimeSnapshot.conferenceListeners.onDisconnected);
          runtimeSnapshot.conference.removeEventListener("EndpointAdded", runtimeSnapshot.conferenceListeners.onEndpointAdded);
          runtimeSnapshot.conference.removeEventListener("EndpointRemoved", runtimeSnapshot.conferenceListeners.onEndpointRemoved);
          runtimeSnapshot.conferenceListeners = null;
        }

        if (runtimeSnapshot.conference) {
          runtimeSnapshot.conferenceConnected = false;
          try { runtimeSnapshot.conference.hangup(); } catch { /* ignore */ }
          runtimeSnapshot.conference = null;
        }

        // Stop browser tracks to release hardware. Silent stream close() also closes AudioContext.
        stopVoxLikeStreamTracks(runtimeSnapshot.localAudioStream);
        stopVoxLikeStreamTracks(runtimeSnapshot.localVideoStream);
        runtimeSnapshot.localAudioStream?.close?.();
        runtimeSnapshot.localVideoStream?.close?.();
        runtimeSnapshot.localAudioStream = null;
        runtimeSnapshot.localVideoStream = null;

        // Only disconnect the shared client while this surface still owns it.
        // A late Session teardown must not drop the transport the Event lobby
        // has already connected on the same singleton client.
        const ownership = clientOwnershipRef.current;
        clientOwnershipRef.current = null;
        if (!ownership || ownership.isCurrent()) {
          await runtimeSnapshot.core.client.disconnect().catch(() => undefined);
          ownership?.release();
        }
        clearStateAfterCleanup();
        if (!options?.preserveStatus && mountedRef.current) {
          setStatus("Отключено.");
        }
      })()).finally(() => {
        cleanupPromiseRef.current = null;
      });

      cleanupPromiseRef.current = promise;
      return promise;
    },
    [clearStateAfterCleanup, invalidateGeneration],
  );

  useEffect(() => {
    if (!connectionId || typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
      return;
    }
    if (!takeoverChannelRef.current) {
      takeoverChannelRef.current = new BroadcastChannel(VOX_TAKEOVER_CHANNEL);
    }

    const channel = takeoverChannelRef.current;
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isVoxTabTakeoverMessage(event.data)) return;
      const sdkUsername = sdkUsernameRef.current;
      if (!sdkUsername) return;
      if (
        shouldApplyVoxTakeoverMessage({
          message: event.data,
          sessionId,
          connectionId,
          sdkUsername,
        })
      ) {
        handleStaleConnection();
        void cleanup("stale_connection", { preserveStatus: true });
      }
    };
    channel.addEventListener("message", onMessage);
    return () => {
      channel.removeEventListener("message", onMessage);
    };
  }, [cleanup, connectionId, handleStaleConnection, sessionId]);

  // ── Leave ─────────────────────────────────────────────────────────────────

  const leave = useCallback(async () => {
    if (isLeaving) return;
    disconnectIntentRef.current = "explicit_leave";
    pendingTerminalRecoveryRef.current = null;
    boundedRejoinRef.current.cancel();
    rejoinInProgressRef.current = false;
    setIsLeaving(true);
    await cleanup("invalidated_generation");
    if (!mountedRef.current) return;
    setStatus("Отключено.");
    setIsLeaving(false);
  }, [cleanup, isLeaving]);

  // ── Endpoint subscription ─────────────────────────────────────────────────

  const subscribeEndpoint = useCallback(
    (endpoint: VoxEndpoint, generation: number) => {
      const runtime = runtimeRef.current;
      if (!isRuntimeActive(runtime, generation)) return;
      if (!runtime) return;

      const existing = runtime.endpointSubscriptions.get(endpoint.id);

      const attachStreamLiveness = (voxStream: VoxStream) => {
        const streamId = voxStream.id;
        if (!streamId) return;
        const track = voxStream.track ?? voxStream.sourceStream?.getTracks()[0];
        bindEndpointStreamLiveness({
          registry: runtime.streamLivenessByEndpoint,
          endpointId: endpoint.id,
          streamId,
          addStreamEndedListener: (handler) => {
            voxStream.addEventListener?.(VOX_STREAM_EVENT_ENDED, handler);
          },
          removeStreamEndedListener: (handler) => {
            voxStream.removeEventListener?.(VOX_STREAM_EVENT_ENDED, handler);
          },
          addTrackEndedListener: track
            ? (handler) => {
                track.addEventListener("ended", handler);
              }
            : undefined,
          removeTrackEndedListener: track
            ? (handler) => {
                track.removeEventListener("ended", handler);
              }
            : undefined,
          onEnded: () => {
            if (generationRef.current !== generation || staleLifecycleRef.current) return;
            if (!runtime.endpointSubscriptions.has(endpoint.id)) return;
            if (voxStream.type === "audio") {
              detachRemoteAudioStream(endpoint.id, streamId);
            }
            applyRemoteVideoStream(endpoint, generation);
            const stillUsable = remoteParticipantsRef.current.some((remote) => {
              const video = remote.stream?.getTracks().some((track) => track.readyState !== "ended");
              const audio = remote.audioStream
                ?.getTracks()
                .some((track) => track.readyState !== "ended");
              return Boolean(video || audio);
            });
            if (!stillUsable) {
              publishLayer3(layer3AfterMediaDegraded(layer3Ref.current, "stream_ended"));
            }
          },
        });
      };

      if (existing?.endpoint === endpoint) {
        for (const audioStream of endpoint.getAnyAudioStreams()) {
          attachStreamLiveness(audioStream);
        }
        for (const videoStream of endpoint.getAnyVideoStreams()) {
          attachStreamLiveness(videoStream);
        }
        return;
      }
      if (existing) {
        unsubscribeEndpoint(runtime, endpoint.id);
      }

      const onAdded = (event: VoxEndpointMediaEvent) => {
        if (generationRef.current !== generation || staleLifecycleRef.current) return;
        if (!event.payload?.stream) return;
        const stream = event.payload.stream;
        attachStreamLiveness(stream);
        if (stream.type === "audio") {
          attachRemoteAudioStream(endpoint.id, stream, generation);
        } else {
          applyRemoteVideoStream(endpoint, generation);
        }
        if (layer3Ref.current.status === "degraded" || layer3Ref.current.reason) {
          publishLayer3(
            layer3AfterUsableRemoteMedia(layer3Ref.current, sdkReconnectingRef.current),
          );
        }
      };
      const onRemoved = (event: VoxEndpointMediaEvent) => {
        if (generationRef.current !== generation || staleLifecycleRef.current) return;
        const removedStream = event.payload?.stream;
        const removedStreamId = removedStream?.id ?? event.payload?.streamId;
        if (removedStreamId) {
          disposeEndpointStreamLivenessBinding(
            runtime.streamLivenessByEndpoint,
            endpoint.id,
            removedStreamId,
          );
          if (removedStream?.type === "audio") {
            detachRemoteAudioStream(endpoint.id, removedStreamId);
          }
        } else {
          const present = new Set<string>();
          for (const stream of endpoint.getAnyAudioStreams()) {
            if (stream.id) present.add(stream.id);
          }
          for (const stream of endpoint.getAnyVideoStreams()) {
            if (stream.id) present.add(stream.id);
          }
          pruneMissingEndpointStreamLiveness(
            runtime.streamLivenessByEndpoint,
            endpoint.id,
            present,
          );
        }
        applyRemoteVideoStream(endpoint, generation);
      };
      const onStopVideo = (event: VoxEndpointMediaEvent) => {
        if (generationRef.current !== generation || staleLifecycleRef.current) return;
        if (!isAutomaticStopReceivingReason(event.payload?.reason)) return;
        upsertRemote({
          id: endpoint.id,
          displayName: endpoint.displayName || endpoint.userName || endpoint.id,
          stream: null,
        });
        publishLayer3(layer3AfterMediaDegraded(layer3Ref.current, "stop_receiving_automatic"));
      };
      const onStartVideo = () => {
        if (generationRef.current !== generation || staleLifecycleRef.current) return;
        applyRemoteVideoStream(endpoint, generation);
      };

      endpoint.addEventListener("RemoteMediaAdded", onAdded);
      endpoint.addEventListener("RemoteMediaRemoved", onRemoved);
      endpoint.addEventListener("StopReceivingVideoStream", onStopVideo);
      endpoint.addEventListener("StartReceivingVideoStream", onStartVideo);
      runtime.endpointSubscriptions.set(endpoint.id, {
        endpoint,
        generation,
        onAdded,
        onRemoved,
        onStopVideo,
        onStartVideo,
      });

      // Apply any streams already present on this endpoint.
      applyRemoteVideoStream(endpoint, generation);
      for (const audioStream of endpoint.getAnyAudioStreams()) {
        attachStreamLiveness(audioStream);
        attachRemoteAudioStream(endpoint.id, audioStream, generation);
      }
      for (const videoStream of endpoint.getAnyVideoStreams()) {
        attachStreamLiveness(videoStream);
      }
    },
    [
      applyRemoteVideoStream,
      attachRemoteAudioStream,
      detachRemoteAudioStream,
      isRuntimeActive,
      publishLayer3,
      unsubscribeEndpoint,
      upsertRemote,
    ],
  );

  // ── Microphone toggle ─────────────────────────────────────────────────────
  //
  // Audio acquisition is entirely independent of video:
  //   • createAudioStream is called only here and in join (never createVideoStream).
  //   • camera state/stream is never touched.

  const toggleMic = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.conference || !runtime.conferenceConnected || runtime.audioOpPending || staleLifecycleRef.current) return;
    if (generationRef.current !== runtime.generation) return;
    const operationGeneration = runtime.generation;

    runtime.audioOpPending = true;
    const nextMuted = !isMicMuted;

    void (async () => {
      try {
        if (generationRef.current !== operationGeneration || staleLifecycleRef.current) return;
        if (nextMuted) {
          // ── Mute path ──
          if (!runtime.isSilentAudio) {
            const audioTrack = getAudioTrack(runtime.localAudioStream);
            if (audioTrack) audioTrack.enabled = false;
          }
          if (runtime.conferenceConnected) {
            runtime.conference!.muteMicrophone();
          }
          if (generationRef.current !== operationGeneration || staleLifecycleRef.current) return;
          setIsMicMuted(true);
          setMicCaptureStatus("muted");
        } else {
          // ── Unmute path ──
          // If we were using a silent placeholder, release it so we can create a real stream.
          if (runtime.isSilentAudio) {
            stopVoxLikeStreamTracks(runtime.localAudioStream);
            runtime.localAudioStream?.close?.();
            runtime.localAudioStream = null;
            runtime.isSilentAudio = false;
            runtime.audioStreamAdded = false;
            setLocalAudioStreamCreated(false);
            setLocalAudioStreamAddedToConference(false);
            stopMicLevelMeter();
          }

          // Create real audio-only stream if not yet available.
          if (!runtime.localAudioStream) {
            setMicCaptureStatus("requesting");
            try {
              // Audio-only: only requests microphone, no video constraint.
              const audioStream = await runtime.streamModule.streamManager.createAudioStream(
                {
                  audioProcessing: audioProcessingEnabledRef.current,
                },
              );
              if (generationRef.current !== operationGeneration || staleLifecycleRef.current) {
                stopVoxLikeStreamTracks(audioStream);
                audioStream.close?.();
                return;
              }
              runtime.localAudioStream = audioStream;
              setLocalAudioStreamCreated(true);

              // Start mic level meter on the real microphone stream.
              const ms = streamToMediaStream(audioStream);
              if (ms) startMicLevelMeter(ms);
            } catch (e) {
              const safe = isNonFatalMediaError(e);
              setMicCaptureStatus(safe ? "unavailable" : "error");
              if (!safe) setLastAudioError(toErrorMessage(e));
              addMediaWarning(
                safe
                  ? "Микрофон занят или недоступен. Вы вошли без микрофона."
                  : `Не удалось включить микрофон: ${toErrorMessage(e)}`,
              );
              return;
            }
          }

          // Add stream to conference once — never twice.
          if (!runtime.audioStreamAdded) {
            runtime.audioStreamAdded = await safeAddStream(
              runtime.conference!,
              runtime.localAudioStream,
            );
            if (generationRef.current !== operationGeneration || staleLifecycleRef.current) return;
            setLocalAudioStreamAddedToConference(runtime.audioStreamAdded);
            removeMediaWarningsByKeyword("микрофон");
          }

          const audioTrack = getAudioTrack(runtime.localAudioStream);
          if (audioTrack) audioTrack.enabled = true;
          if (runtime.conferenceConnected) {
            runtime.conference!.unmuteMicrophone();
          }
          if (generationRef.current !== operationGeneration || staleLifecycleRef.current) return;
          setIsMicMuted(false);
          setMicCaptureStatus("active");
        }
      } catch (e) {
        setLastAudioError(toErrorMessage(e));
        addMediaWarning(`Не удалось изменить состояние микрофона: ${toErrorMessage(e)}`);
      } finally {
        if (runtimeRef.current?.generation === operationGeneration) {
          runtime.audioOpPending = false;
        }
      }
    })();
  }, [isMicMuted, addMediaWarning, removeMediaWarningsByKeyword, startMicLevelMeter, stopMicLevelMeter]);

  // ── Camera toggle ─────────────────────────────────────────────────────────
  //
  // Video acquisition is entirely independent of audio:
  //   • createVideoStream is called only here (never createAudioStream).
  //   • microphone state/stream is never touched.

  const toggleCamera = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.conference || !runtime.conferenceConnected || runtime.videoOpPending || staleLifecycleRef.current) return;
    if (generationRef.current !== runtime.generation) return;
    const conference = runtime.conference;
    const operationGeneration = runtime.generation;

    runtime.videoOpPending = true;
    const nextOn = !isCameraOn;

    void (async () => {
      try {
        if (generationRef.current !== operationGeneration || staleLifecycleRef.current) return;
        if (!nextOn) {
          // Turn camera off idempotently: keep conference stream slot and
          // disable the existing track instead of re-adding another video stream later.
          const existingMedia = streamToMediaStream(runtime.localVideoStream);
          const videoTrack = existingMedia?.getVideoTracks()?.[0] ?? null;
          if (videoTrack) {
            videoTrack.enabled = false;
          }
          setCameraUnavailable(false);
          if (runtime.localVideoStream) {
            setLocalParticipant({
              id: "local",
              displayName: localDisplayNameRef.current,
              stream: streamToMediaStream(runtime.localVideoStream),
            });
          } else {
            setLocalParticipant(null);
          }
          setIsCameraOn(false);
        } else {
          let videoStream = runtime.localVideoStream;
          const existingMedia = streamToMediaStream(videoStream);
          const existingTrack = existingMedia?.getVideoTracks()?.[0] ?? null;
          const plan = buildCameraEnablePlan({
            hasLocalVideoStream: Boolean(videoStream),
            hasReusableTrack: Boolean(existingTrack),
            videoStreamAlreadyAdded: runtime.videoStreamAdded,
          });

          if (plan.shouldReuseExistingTrack && existingTrack) {
            existingTrack.enabled = true;
          } else if (plan.shouldCreateVideoStream) {
            const restoreCameraFilter = installCameraErrorSuppressor();
            try {
              videoStream = await runtime.streamModule.streamManager.createVideoStream(
                runtime.videoQuality,
              );
              if (generationRef.current !== operationGeneration || staleLifecycleRef.current) {
                stopVoxLikeStreamTracks(videoStream);
                videoStream?.close?.();
                return;
              }
            } catch (e) {
              if (isNonFatalMediaError(e)) {
                setCameraUnavailable(true);
              }
              addMediaWarning(
                isNonFatalMediaError(e)
                  ? "Камера занята или недоступна. Вы остались в комнате без видео."
                  : `Не удалось включить камеру: ${toErrorMessage(e)}`,
              );
              return;
            } finally {
              restoreCameraFilter();
            }
            if (!videoStream) return;
            runtime.localVideoStream = videoStream;

            if (plan.shouldAddStreamToConference) {
              try {
                runtime.videoStreamAdded = await safeAddStream(conference, videoStream);
                if (generationRef.current !== operationGeneration || staleLifecycleRef.current) return;
              } catch (addErr) {
                const message = toErrorMessage(addErr);
                if (isDuplicateVideoStreamError(message)) {
                  runtime.videoStreamAdded = true;
                } else {
                  addMediaWarning(
                    `Не удалось добавить видеопоток в конференцию: ${message}`,
                  );
                  stopVoxLikeStreamTracks(videoStream);
                  runtime.localVideoStream = null;
                  return;
                }
              }
            } else if (!runtime.videoStreamAdded) {
              try {
                runtime.videoStreamAdded = await safeAddStream(conference, videoStream);
                if (generationRef.current !== operationGeneration || staleLifecycleRef.current) return;
              } catch (addErr) {
                addMediaWarning(
                  `Не удалось добавить видеопоток в конференцию: ${toErrorMessage(addErr)}`,
                );
                stopVoxLikeStreamTracks(videoStream);
                runtime.localVideoStream = null;
                return;
              }
            }
          }

          // Recover gracefully for SDK state mismatches.
          runtime.videoStreamAdded = runtime.videoStreamAdded || Boolean(runtime.localVideoStream);
          setCameraUnavailable(false);
          setLocalParticipant({
            id: "local",
            displayName: localDisplayNameRef.current,
            stream: streamToMediaStream(runtime.localVideoStream),
          });
          setIsCameraOn(true);
          removeMediaWarningsByKeyword("камера");
        }
      } catch (e) {
        addMediaWarning(`Не удалось изменить состояние камеры: ${toErrorMessage(e)}`);
      } finally {
        if (runtimeRef.current?.generation === operationGeneration) {
          runtime.videoOpPending = false;
        }
      }
    })();
  }, [isCameraOn, addMediaWarning, removeMediaWarningsByKeyword]);

  const teardownConferenceOnly = useCallback(
    (runtime: RuntimeState, options?: { hangup: boolean }) => {
      disposeAllEndpointStreamLiveness(runtime.streamLivenessByEndpoint);
      for (const endpointId of Array.from(runtime.endpointSubscriptions.keys())) {
        unsubscribeEndpoint(runtime, endpointId);
      }
      if (runtime.conference && runtime.conferenceListeners) {
        runtime.conference.removeEventListener("Connected", runtime.conferenceListeners.onConnected);
        runtime.conference.removeEventListener("Failed", runtime.conferenceListeners.onFailed);
        runtime.conference.removeEventListener("Disconnected", runtime.conferenceListeners.onDisconnected);
        runtime.conference.removeEventListener("EndpointAdded", runtime.conferenceListeners.onEndpointAdded);
        runtime.conference.removeEventListener("EndpointRemoved", runtime.conferenceListeners.onEndpointRemoved);
        runtime.conferenceListeners = null;
      }
      runtime.unwatchConferenceState?.();
      runtime.unwatchConferenceState = null;
      runtime.conferenceStateWatcherEpoch += 1;
      if (options?.hangup !== false && runtime.conference && !sdkReconnectingRef.current) {
        try { runtime.conference.hangup(); } catch { /* ignore */ }
      }
      runtime.conference = null;
      runtime.conferenceConnected = false;
      clearRemoteAudioElements(runtime.remoteAudioElements);
      runtime.remoteAudioElements.clear();
      if (mountedRef.current) {
        commitRemoteParticipants([]);
        setRemoteAudioElementCount(0);
        setSendMessageAvailable(false);
      }
    },
    [commitRemoteParticipants, unsubscribeEndpoint],
  );

  const watchSdkStates = useCallback(
    (runtime: RuntimeState, generation: number) => {
      const handleChange = () => {
        if (staleLifecycleRef.current) return;
        const currentGeneration = generationRef.current;
        if (runtimeRef.current?.generation !== currentGeneration) return;
        const observation = observeSdkReconnectTransition({
          wasReconnecting: sdkReconnectingRef.current,
          clientState: sdkClientStateRef.current,
          conferenceState: sdkConferenceStateRef.current,
        });
        sdkReconnectingRef.current = observation.reconnecting;
        if (observation.episodeStarted) {
          publishLayer3(
            layer3AfterSdkReconnecting({
              ...layer3Ref.current,
              sdkClientState: sdkClientStateRef.current,
              sdkConferenceState: sdkConferenceStateRef.current,
            }),
          );
          logProviderRecovery({
            surface: "session-room",
            sessionId,
            generation: currentGeneration,
            event: "sdk_reconnecting",
          });
          return;
        }
        if (!observation.episodeSettled) {
          return;
        }
        logProviderRecovery({
          surface: "session-room",
          sessionId,
          generation: currentGeneration,
          event: "sdk_reconnected",
        });
        if (
          shouldCancelPendingTerminalIncident({
            stale: staleLifecycleRef.current,
            mounted: mountedRef.current,
            intent: disconnectIntentRef.current,
            sessionOperable:
              isSessionOperableRef.current?.() ??
              isSessionOperableForProviderRejoin({ isClosed: false }),
          })
        ) {
          pendingTerminalRecoveryRef.current = null;
          boundedRejoinRef.current.cancel();
          rejoinInProgressRef.current = false;
          return;
        }
        const { incident, remaining } = takePendingTerminalIncident(
          pendingTerminalRecoveryRef.current,
        );
        pendingTerminalRecoveryRef.current = remaining;
        if (incident) {
          recoverTerminalConferenceRef.current(incident.generation, incident.reason);
          return;
        }
        if (isTerminalConferenceState(sdkConferenceStateRef.current)) {
          return;
        }
        publishLayer3(
          layer3AfterSdkReconnectSettled({
            ...layer3Ref.current,
            sdkClientState: sdkClientStateRef.current,
            sdkConferenceState: sdkConferenceStateRef.current,
          }),
        );
        queueMicrotask(() => {
          if (generationRef.current !== currentGeneration || staleLifecycleRef.current) return;
          resyncEndpointsRef.current(currentGeneration);
        });
      };

      if (!runtime.unwatchClientState && runtime.core.client.state?.watch) {
        runtime.unwatchClientState = runtime.core.client.state.watch((next) => {
          sdkClientStateRef.current = next;
          handleChange();
        });
        sdkClientStateRef.current = runtime.core.client.state.value ?? sdkClientStateRef.current;
      }
      runtime.unwatchConferenceState?.();
      if (runtime.conference?.state?.watch) {
        const watchedConference = runtime.conference;
        const watcherEpoch = runtime.conferenceStateWatcherEpoch + 1;
        runtime.conferenceStateWatcherEpoch = watcherEpoch;
        runtime.unwatchConferenceState = runtime.conference.state.watch((next) => {
          if (
            !isAuthoritativeConferenceStateWatcher({
              watcherConference: watchedConference,
              currentConference: runtime.conference,
              watcherEpoch,
              currentEpoch: runtime.conferenceStateWatcherEpoch,
            })
          ) {
            return;
          }
          sdkConferenceStateRef.current = next;
          handleChange();
        });
        sdkConferenceStateRef.current = runtime.conference.state.value ?? null;
      }
      void generation;
    },
    [publishLayer3, sessionId],
  );

  const pauseTerminalRecoveryAttempt = useCallback(
    (ownerGeneration: number, reason: string) => {
      if (boundedRejoinRef.current.getStatus() === "recovering") {
        boundedRejoinRef.current.pause();
        logProviderRecovery({
          surface: "session-room",
          sessionId,
          generation: ownerGeneration,
          event: "recovery_paused",
          reason,
        });
      }
      pendingTerminalRecoveryRef.current = retainPendingTerminalIncident(
        pendingTerminalRecoveryRef.current,
        { generation: ownerGeneration, reason },
      );
      publishLayer3(layer3AfterSdkReconnecting(layer3Ref.current));
    },
    [publishLayer3, sessionId],
  );

  const continueTerminalRecoveryJoin = useCallback(
    (ownerGeneration: number, reason: string) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;
      void (async () => {
        try {
          if (generationRef.current !== ownerGeneration || staleLifecycleRef.current) return;
          if (shouldDeferTerminalRecovery(sdkReconnectingRef.current)) {
            pauseTerminalRecoveryAttempt(ownerGeneration, reason);
            return;
          }
          let conference = runtime.conference;
          if (!conference) {
            if (shouldDeferTerminalRecovery(sdkReconnectingRef.current)) {
              pauseTerminalRecoveryAttempt(ownerGeneration, reason);
              return;
            }
            conference = runtime.conferenceManager.createConference({
              conferenceName: runtime.conferenceName,
              muteAudio: runtime.muteAudio,
              reportStats: false,
            });
            runtime.conference = conference;
            bindConferenceRef.current(conference, runtime, ownerGeneration);
            watchSdkStates(runtime, ownerGeneration);
          }
          if (runtime.localAudioStream && !runtime.audioStreamAdded) {
            runtime.audioStreamAdded = await safeAddStream(conference, runtime.localAudioStream);
          }
          if (generationRef.current !== ownerGeneration || staleLifecycleRef.current) return;
          if (shouldDeferTerminalRecovery(sdkReconnectingRef.current)) {
            pauseTerminalRecoveryAttempt(ownerGeneration, reason);
            return;
          }
          if (runtime.localVideoStream && !runtime.videoStreamAdded) {
            runtime.videoStreamAdded = await safeAddStream(conference, runtime.localVideoStream);
          }
          if (generationRef.current !== ownerGeneration || staleLifecycleRef.current) return;
          if (shouldDeferTerminalRecovery(sdkReconnectingRef.current)) {
            pauseTerminalRecoveryAttempt(ownerGeneration, reason);
            return;
          }
          await conference.join();
          if (generationRef.current !== ownerGeneration || staleLifecycleRef.current) return;
          if (shouldDeferTerminalRecovery(sdkReconnectingRef.current)) {
            if (!runtime.conferenceConnected) {
              pauseTerminalRecoveryAttempt(ownerGeneration, reason);
            }
            return;
          }
          runtime.conferenceConnected = true;
          if (mountedRef.current) {
            setSendMessageAvailable(typeof conference.sendMessage === "function");
          }
        } catch (joinError) {
          if (generationRef.current !== ownerGeneration) return;
          if (
            shouldDeferTerminalRecovery(sdkReconnectingRef.current) ||
            boundedRejoinRef.current.isPaused()
          ) {
            pauseTerminalRecoveryAttempt(ownerGeneration, reason);
            return;
          }
          boundedRejoinRef.current.fail();
          rejoinInProgressRef.current = false;
          setProviderRecovery("failed");
          publishLayer3(
            layer3AfterTerminalRecoveryFailed(
              layer3Ref.current,
              toErrorMessage(joinError),
            ),
          );
          logProviderRecovery({
            surface: "session-room",
            sessionId,
            generation: ownerGeneration,
            event: "recovery_failed",
            reason: toErrorMessage(joinError),
          });
        }
      })();
    },
    [pauseTerminalRecoveryAttempt, publishLayer3, sessionId, watchSdkStates],
  );

  const recoverTerminalConference = useCallback(
    (ownerGeneration: number, reason: string) => {
      const cancelAttempt = () => {
        pendingTerminalRecoveryRef.current = null;
        boundedRejoinRef.current.cancel();
        rejoinInProgressRef.current = false;
      };
      if (!mountedRef.current || staleLifecycleRef.current) {
        cancelAttempt();
        return;
      }
      if (
        disconnectIntentRef.current === "explicit_leave" ||
        disconnectIntentRef.current === "stale_connection" ||
        disconnectIntentRef.current === "unmount" ||
        disconnectIntentRef.current === "auth_denied"
      ) {
        cancelAttempt();
        return;
      }
      if (generationRef.current !== ownerGeneration) {
        return;
      }
      const sessionOperable =
        isSessionOperableRef.current?.() ??
        isSessionOperableForProviderRejoin({ isClosed: false });
      if (!sessionOperable) {
        cancelAttempt();
        return;
      }

      if (shouldDeferTerminalRecovery(sdkReconnectingRef.current)) {
        pauseTerminalRecoveryAttempt(ownerGeneration, reason);
        return;
      }

      if (boundedRejoinRef.current.resume()) {
        logProviderRecovery({
          surface: "session-room",
          sessionId,
          generation: ownerGeneration,
          event: "recovery_resumed",
          reason,
        });
        continueTerminalRecoveryJoin(ownerGeneration, reason);
        return;
      }

      if (boundedRejoinRef.current.getStatus() === "recovering") {
        return;
      }

      const kind = classifyProviderDisconnect({
        intent: disconnectIntentRef.current === "recovery_teardown" ? "none" : disconnectIntentRef.current,
        eventGeneration: ownerGeneration,
        currentGeneration: ownerGeneration,
        mounted: mountedRef.current,
        stale: staleLifecycleRef.current,
        sessionOperable,
      });
      const decision = boundedRejoinRef.current.decide(kind);
      if (!decision.shouldRejoin) {
        if (kind === "unexpected" && decision.reason !== "already_in_flight") {
          boundedRejoinRef.current.fail();
          setProviderRecovery("failed");
          publishLayer3(
            layer3AfterTerminalRecoveryFailed(layer3Ref.current, decision.reason),
          );
        }
        return;
      }

      const runtime = runtimeRef.current;
      if (!runtime) return;

      disconnectIntentRef.current = "recovery_teardown";
      boundedRejoinRef.current.begin();
      rejoinInProgressRef.current = true;
      runtime.audioStreamAdded = false;
      runtime.videoStreamAdded = false;
      setProviderRecovery("recovering");
      publishLayer3(layer3DuringTerminalRecovery(layer3Ref.current, reason));
      logProviderRecovery({
        surface: "session-room",
        sessionId,
        generation: ownerGeneration,
        event: "recovery_started",
        reason,
      });
      if (mountedRef.current) {
        setError(null);
        setJoined(false);
        setHasEnteredRoom(true);
      }

      teardownConferenceOnly(runtime, { hangup: !sdkReconnectingRef.current });
      runtime.generation = ownerGeneration;

      if (shouldDeferTerminalRecovery(sdkReconnectingRef.current)) {
        pauseTerminalRecoveryAttempt(ownerGeneration, reason);
        return;
      }

      const conference = runtime.conferenceManager.createConference({
        conferenceName: runtime.conferenceName,
        muteAudio: runtime.muteAudio,
        reportStats: false,
      });
      runtime.conference = conference;
      bindConferenceRef.current(conference, runtime, ownerGeneration);
      watchSdkStates(runtime, ownerGeneration);
      continueTerminalRecoveryJoin(ownerGeneration, reason);
    },
    [
      continueTerminalRecoveryJoin,
      pauseTerminalRecoveryAttempt,
      publishLayer3,
      sessionId,
      teardownConferenceOnly,
      watchSdkStates,
    ],
  );
  useEffect(() => {
    recoverTerminalConferenceRef.current = recoverTerminalConference;
  }, [recoverTerminalConference]);

  // ── Join effect ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!connectionId) {
      return;
    }

    if (skipRealtimeConnect) {
      mountedRef.current = true;
      return;
    }

    mountedRef.current = true;

    const join = async () => {
      isJoiningRef.current = true;
      const joinGeneration = beginJoinGeneration();
      if (mountedRef.current) {
        setJoinLoading(true);
      }
      setError(null);

      try {
        setStatus("Ожидание завершения предыдущего подключения...");
        await waitForVoxClientIdle();
        assertGenerationCurrent(joinGeneration);

        // Step 1 — fetch initial access token.
        const initialResponse = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/voximplant/access`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(connectionId ? { connectionId, claimLease: true } : {}),
            }),
          },
        );
        assertGenerationCurrent(joinGeneration);

        if (await isStaleConnectionResponse(initialResponse)) {
          handleStaleConnection();
          await cleanup("stale_connection", {
            preserveStatus: true,
            skipInvalidation: true,
            expectedGeneration: joinGeneration,
          });
          return;
        }

        const initialPayload = (await initialResponse.json().catch(() => ({}))) as AccessReadyPayload;
        assertGenerationCurrent(joinGeneration);
        if (!initialResponse.ok) {
          throw new Error(
            buildAccessErrorMessage(initialResponse.status, {
              error: initialPayload.error,
              code: initialPayload.code,
            }),
          );
        }

        if (
          initialPayload.provider !== "voximplant" ||
          initialPayload.credentials.status !== "one_time_key_required"
        ) {
          throw new Error("Unexpected access payload. Voximplant one-time-key flow is required.");
        }

        const sdkUsername = initialPayload.user.sdkUsername;
        sdkUsernameRef.current = sdkUsername;
        broadcastTakeoverClaimed(sdkUsername);
        const roomName = initialPayload.roomNameOrConferenceName;
        const displayName = initialPayload.user.displayName || "User";
        const userRole = initialPayload.user.role ?? "unknown";
        audioProcessingEnabledRef.current =
          initialPayload.audioProcessingProfile !== "raw_diagnostic";
        setAudioProcessingEnabled(audioProcessingEnabledRef.current);

        setRole(userRole);
        setParticipantType(mapParticipantType(userRole));
        setLocalDisplayName(displayName);
        localDisplayNameRef.current = displayName;
        setConferenceName(roomName);
        assertGenerationCurrent(joinGeneration);

        // Re-check global idle barrier in case a previous page teardown
        // registered its disconnect promise during access handshake.
        setStatus("Проверка завершения предыдущего подключения...");
        await waitForVoxClientIdle();
        assertGenerationCurrent(joinGeneration);

        // Step 2 — load SDK modules.
        setStatus("Инициализация Voximplant SDK...");
        const [{ Core, LogLevel, connectionToken }, conferenceModule, streamModulePackage] =
          await Promise.all([
            import("@voximplant/websdk"),
            import("@voximplant/websdk/modules/conference-manager"),
            import("@voximplant/websdk/modules/stream"),
          ]);
        assertGenerationCurrent(joinGeneration);

        const core = initVoxCore({ Core, LogLevel }) as VoxCore;

        // Must run before the conference module registers its own handleReInvite
        // subscriber, so unresolvable conf-info causes are removed from the shared
        // message before the SDK dereferences scheme.endpoints[cause.id].mids.
        installVoxReInviteSchemeSanitizer({
          connection: core.getModule(connectionToken) as VoxConnectionSeam | undefined,
          onDropped: droppedCauseReporterRef.current,
        });

        try {
          if (!core.getModule(streamModulePackage.streamToken)) {
            core.registerModules([streamModulePackage.StreamLoader()]);
          }
          if (!core.getModule(conferenceModule.conferenceToken)) {
            core.registerModules([conferenceModule.ConferenceLoader()]);
          }
        } catch {
          // Modules already registered from a previous reconnect — safe to ignore.
        }

        const conferenceManager = core.getModule(
          conferenceModule.conferenceToken,
        ) as VoxConferenceManager;
        const streamModule = core.getModule(streamModulePackage.streamToken) as VoxStreamModule;
        const videoQuality = streamModulePackage.VideoQuality.Medium;
        assertGenerationCurrent(joinGeneration);

        // Step 3 — connect and authenticate.
        setStatus("Подключение к Voximplant...");
        clientOwnershipRef.current = acquireVoxClientOwnership("session-room");
        await core.client.connect({});
        assertGenerationCurrent(joinGeneration);

        setStatus("Запрос одноразового ключа...");
        const oneTimeKey = await core.client.requestOneTimeKey({ username: sdkUsername });
        assertGenerationCurrent(joinGeneration);

        setStatus("Завершение безопасного входа...");
        const readyResponse = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/voximplant/access`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              oneTimeKey,
              ...(connectionId ? { connectionId, claimLease: true } : {}),
            }),
          },
        );
        assertGenerationCurrent(joinGeneration);
        if (await isStaleConnectionResponse(readyResponse)) {
          handleStaleConnection();
          await registerVoxClientDisconnect(core.client.disconnect());
          await cleanup("stale_connection", {
            preserveStatus: true,
            skipInvalidation: true,
            expectedGeneration: joinGeneration,
          });
          return;
        }
        const readyPayload = (await readyResponse.json().catch(() => ({}))) as AccessReadyPayload;
        assertGenerationCurrent(joinGeneration);
        if (!readyResponse.ok) {
          throw new Error(
            buildAccessErrorMessage(readyResponse.status, {
              error: readyPayload.error,
              code: readyPayload.code,
            }),
          );
        }

        if (
          readyPayload.provider !== "voximplant" ||
          readyPayload.credentials.status !== "ready" ||
          readyPayload.credentials.method !== "one_time_key"
        ) {
          throw new Error("Voximplant access handshake did not return ready credentials.");
        }
        if (readyPayload.user.sdkUsername !== sdkUsername) {
          throw new Error("Security check failed: sdkUsername mismatch during one-time-key login.");
        }

        await core.client.loginOneTimeKey({
          username: sdkUsername,
          hash: readyPayload.credentials.oneTimeKeyHash,
        });
        assertGenerationCurrent(joinGeneration);

        // Step 4 — acquire media devices (audio and video are fully independent).
        setStatus("Получение доступа к устройствам...");

        let localAudioStream: VoxStream | null = null;
        let isSilentAudio = false;
        let localVideoStream: VoxStream | null = null;
        const initialWarnings: string[] = [];

        // ── Audio acquisition (audio-only: never requests video) ──
        if (!disableInitialMic) {
          setMicCaptureStatus("requesting");
          try {
            localAudioStream = await streamModule.streamManager.createAudioStream({
              audioProcessing: audioProcessingEnabledRef.current,
            });
            assertGenerationCurrent(joinGeneration);
            setLocalAudioStreamCreated(true);
          } catch (audioError) {
            if (isNonFatalMediaError(audioError)) {
              initialWarnings.push("Микрофон занят или недоступен. Вы вошли без микрофона.");
              setMicCaptureStatus("unavailable");
            } else {
              throw audioError;
            }
          }
        }
        // Fall back to a silent synthetic stream so join() can proceed regardless.
        if (!localAudioStream) {
          const silentStream = createSilentAudioStream();
          if (silentStream) {
            localAudioStream = silentStream;
            isSilentAudio = true;
          } else {
            throw new Error("Не удалось создать аудиопоток. Попробуйте другой браузер.");
          }
        }

        // ── Video acquisition (video-only: never requests audio, never affects mic state) ──
        if (!disableInitialCamera) {
          const restoreCameraFilter = installCameraErrorSuppressor();
          try {
            localVideoStream = await streamModule.streamManager.createVideoStream(videoQuality);
            assertGenerationCurrent(joinGeneration);
          } catch (videoError) {
            if (isNonFatalMediaError(videoError)) {
              initialWarnings.push(
                "Камера занята или недоступна. Вы остались в комнате без видео.",
              );
              setCameraUnavailable(true);
            } else {
              throw videoError;
            }
          } finally {
            restoreCameraFilter();
          }
        }

        // Step 5 — create conference and register event listeners.
        const conference = conferenceManager.createConference({
          conferenceName: roomName,
          // Mute at SDK level only when using a silent placeholder to avoid transmitting silence.
          muteAudio: isSilentAudio,
          reportStats: false,
        });

        const runtimeState: RuntimeState = {
          generation: joinGeneration,
          core,
          streamModule,
          conferenceManager,
          conferenceName: roomName,
          muteAudio: isSilentAudio,
          videoQuality,
          conference,
          conferenceConnected: false,
          localAudioStream,
          localVideoStream,
          isSilentAudio,
          audioStreamAdded: false,
          videoStreamAdded: false,
          audioOpPending: false,
          videoOpPending: false,
          endpointSubscriptions: new Map(),
          streamLivenessByEndpoint: createEndpointStreamLivenessRegistry(),
          conferenceStateWatcherEpoch: 0,
          unwatchClientState: null,
          unwatchConferenceState: null,
          conferenceListeners: null,
          analyserNode: null,
          analyserCtx: null,
          animFrameId: null,
          lastMicLevelTs: 0,
          remoteAudioElements: new Map(),
          endpointSyncIntervalId: null,
        };
        runtimeRef.current = runtimeState;

        const bindConferenceSession = (
          liveConference: VoxConference,
          runtime: RuntimeState,
          generation: number,
        ) => {
          const onConnected = () => {
            if (
              !shouldApplyConferenceCallback({
                eventGeneration: generation,
                currentGeneration: generationRef.current,
                callbackConference: liveConference,
                currentConference: runtimeRef.current?.conference ?? runtime.conference,
                stale: staleLifecycleRef.current,
                mounted: mountedRef.current,
              })
            ) {
              return;
            }
            runtime.conferenceConnected = true;
            lifecyclePhaseRef.current = "connected";
            disconnectIntentRef.current = "none";
            setJoined(true);
            setHasEnteredRoom(true);
            setStatus("Подключено к переговорной комнате.");
            publishLayer3({
              ...layer3Ref.current,
              status: "connected",
              hasEnteredRoom: true,
              keepShellMounted: true,
              keepHeartbeatActive: true,
              reason: null,
            });
            if (boundedRejoinRef.current.getStatus() === "recovering") {
              boundedRejoinRef.current.succeed();
              rejoinInProgressRef.current = false;
              setProviderRecovery("recovered");
              logProviderRecovery({
                surface: "session-room",
                sessionId,
                generation,
                event: "recovery_succeeded",
              });
            }
          };
          const onFailed = (event: VoxConferenceEvent) => {
            if (
              !shouldApplyConferenceCallback({
                eventGeneration: generation,
                currentGeneration: generationRef.current,
                callbackConference: liveConference,
                currentConference: runtimeRef.current?.conference ?? runtime.conference,
                stale: staleLifecycleRef.current,
                mounted: mountedRef.current,
              })
            ) {
              return;
            }
            runtime.conferenceConnected = false;
            const reason = event.payload?.reason ?? "conference_failed";
            const sessionOperable =
              isSessionOperableRef.current?.() ??
              isSessionOperableForProviderRejoin({ isClosed: false });
            const kind = classifyProviderDisconnect({
              intent: disconnectIntentRef.current,
              eventGeneration: generation,
              currentGeneration: generationRef.current,
              mounted: mountedRef.current,
              stale: staleLifecycleRef.current,
              sessionOperable,
            });
            if (kind !== "unexpected") return;
            const { nextGeneration } = fenceCurrentGeneration(reason);
            runtime.generation = nextGeneration;
            recoverTerminalConferenceRef.current(nextGeneration, reason);
          };
          const onDisconnected = (event: VoxConferenceEvent) => {
            if (
              !shouldApplyConferenceCallback({
                eventGeneration: generation,
                currentGeneration: generationRef.current,
                callbackConference: liveConference,
                currentConference: runtimeRef.current?.conference ?? runtime.conference,
                stale: staleLifecycleRef.current,
                mounted: mountedRef.current,
              })
            ) {
              return;
            }
            runtime.conferenceConnected = false;
            const reason = event.payload?.reason ?? "Отключено.";
            logProviderRecovery({
              surface: "session-room",
              sessionId,
              generation,
              event: "provider_disconnect",
              reason,
            });
            const sessionOperable =
              isSessionOperableRef.current?.() ??
              isSessionOperableForProviderRejoin({ isClosed: false });
            const kind = classifyProviderDisconnect({
              intent: disconnectIntentRef.current,
              eventGeneration: generation,
              currentGeneration: generationRef.current,
              mounted: mountedRef.current,
              stale: staleLifecycleRef.current,
              sessionOperable,
            });
            if (kind !== "unexpected") {
              pendingTerminalRecoveryRef.current = null;
              boundedRejoinRef.current.cancel();
              rejoinInProgressRef.current = false;
              setJoined(false);
              setStatus(`Отключено: ${reason}`);
              clearLiveRemoteState(generation);
              return;
            }
            if (isLocalEndedDisconnectReason(reason)) {
              setJoined(false);
              setStatus(`Отключено: ${reason}`);
              clearLiveRemoteState(generation);
              return;
            }
            const terminal = isTerminalConferenceIncident({
              kind: "disconnected",
              disconnectReason: reason,
            });
            if (!terminal) {
              if (sdkReconnectingRef.current) {
                publishLayer3(layer3AfterSdkReconnecting(layer3Ref.current));
              }
              return;
            }
            const { nextGeneration } = fenceCurrentGeneration(reason);
            runtime.generation = nextGeneration;
            setJoined(false);
            setStatus(`Отключено: ${reason}`);
            recoverTerminalConferenceRef.current(nextGeneration, reason);
          };
          const onEndpointAdded = (event: VoxConferenceEvent) => {
            if (
              !shouldApplyConferenceCallback({
                eventGeneration: generation,
                currentGeneration: generationRef.current,
                callbackConference: liveConference,
                currentConference: runtimeRef.current?.conference ?? runtime.conference,
                stale: staleLifecycleRef.current,
                mounted: mountedRef.current,
              })
            ) {
              return;
            }
            const endpointId = event.payload?.newEndpointId;
            if (!endpointId) return;
            const endpoint = liveConference.endpoints.value.get(endpointId);
            if (!endpoint) return;
            subscribeEndpoint(endpoint, generation);
          };
          const onEndpointRemoved = (event: VoxConferenceEvent) => {
            if (
              !shouldApplyConferenceCallback({
                eventGeneration: generation,
                currentGeneration: generationRef.current,
                callbackConference: liveConference,
                currentConference: runtimeRef.current?.conference ?? runtime.conference,
                stale: staleLifecycleRef.current,
                mounted: mountedRef.current,
              })
            ) {
              return;
            }
            const endpointId = event.payload?.removedEndpointId;
            if (!endpointId) return;
            unsubscribeEndpoint(runtime, endpointId);
            removeRemoteById(endpointId);
          };

          liveConference.addEventListener("Connected", onConnected);
          liveConference.addEventListener("Failed", onFailed);
          liveConference.addEventListener("Disconnected", onDisconnected);
          liveConference.addEventListener("EndpointAdded", onEndpointAdded);
          liveConference.addEventListener("EndpointRemoved", onEndpointRemoved);
          runtime.conferenceListeners = {
            onConnected,
            onFailed,
            onDisconnected,
            onEndpointAdded,
            onEndpointRemoved,
          };
        };
        bindConferenceRef.current = bindConferenceSession;
        bindConferenceSession(conference, runtimeState, joinGeneration);
        watchSdkStates(runtimeState, joinGeneration);

        // Step 6 — add streams to conference (each type added at most once).
        runtimeState.audioStreamAdded = await safeAddStream(conference, localAudioStream);
        assertGenerationCurrent(joinGeneration);
        setLocalAudioStreamAddedToConference(runtimeState.audioStreamAdded);

        if (localVideoStream) {
          runtimeState.videoStreamAdded = await safeAddStream(conference, localVideoStream);
          assertGenerationCurrent(joinGeneration);
        }

        // Step 7 — join.
        await conference.join();
        runtimeState.conferenceConnected = true;
        assertGenerationCurrent(joinGeneration);
        setHasEnteredRoom(true);
        publishLayer3({
          ...layer3Ref.current,
          hasEnteredRoom: true,
          keepShellMounted: true,
          keepHeartbeatActive: true,
        });

        // Detect conference.sendMessage() availability for recording relay.
        if (mountedRef.current && generationRef.current === joinGeneration) {
          setSendMessageAvailable(typeof (conference as VoxConference).sendMessage === "function");
        }

        // Step 8 — set initial UI state.
        const micIsReal = !isSilentAudio;
        setIsMicMuted(!micIsReal);
        if (isSilentAudio) {
          setMicCaptureStatus(disableInitialMic ? "not_requested" : "unavailable");
        } else {
          setMicCaptureStatus("active");
          // Start local mic level meter on the real microphone stream.
          const ms = streamToMediaStream(localAudioStream);
          if (ms) startMicLevelMeter(ms);
        }

        const cameraActive = localVideoStream !== null;
        setIsCameraOn(cameraActive);
        setCameraUnavailable(!cameraActive && !disableInitialCamera);
        if (cameraActive) {
          setLocalParticipant({
            id: "local",
            displayName,
            stream: streamToMediaStream(localVideoStream),
          });
        }

        if (initialWarnings.length > 0) {
          setMediaWarnings(initialWarnings);
          setStatus("Подключено (без части локальных устройств).");
        }

        // Subscribe to endpoints already in the conference at join time.
        for (const endpoint of conference.endpoints.value.values()) {
          subscribeEndpoint(endpoint, joinGeneration);
        }
        const resyncEndpoints = (generation: number) => {
          if (generationRef.current !== generation || staleLifecycleRef.current) return;
          const runtime = runtimeRef.current;
          if (!runtime || runtime.generation !== generation) return;
          const liveConference = runtime.conference;
          if (!liveConference) return;
          for (const endpoint of liveConference.endpoints.value.values()) {
            subscribeEndpoint(endpoint, generation);
            applyRemoteVideoStream(endpoint, generation);
          }
          const endpointIds = new Set(Array.from(liveConference.endpoints.value.keys()));
          commitRemoteParticipants((current) =>
            reconcileRemoteParticipantsFromSnapshot({
              current,
              snapshotIds: endpointIds,
              conferenceConnected: runtime.conferenceConnected,
            }).next,
          );
        };
        resyncEndpointsRef.current = (generation) => {
          resyncEndpoints(generation);
        };
        runtimeState.endpointSyncIntervalId = window.setInterval(() => {
          const generation = generationRef.current;
          if (staleLifecycleRef.current) return;
          resyncEndpoints(generation);
        }, 1000);
      } catch (joinError) {
        if (isVoxLifecycleAbortError(joinError)) {
          await cleanup(joinError.reason, {
            preserveStatus: true,
            skipInvalidation: true,
            expectedGeneration: joinGeneration,
          });
          return;
        }
        if (generationRef.current !== joinGeneration) {
          // Failed/Disconnected already fenced this generation for in-place recovery.
          return;
        }
        const message = toErrorMessage(joinError);
        setError(message);
        setStatus("Не удалось подключиться к Voximplant.");
        await cleanup("invalidated_generation");
      } finally {
        if (mountedRef.current) {
          setJoinLoading(false);
        }
        isJoiningRef.current = false;
      }
    };

    void join();

    return () => {
      isJoiningRef.current = false;
      if (rejoinInProgressRef.current && !isUnmountingRef.current) {
        return;
      }
      disconnectIntentRef.current = "unmount";
      pendingTerminalRecoveryRef.current = null;
      invalidateGeneration("component_unmounted");
      void cleanup("component_unmounted", { preserveStatus: true });
    };
  }, [
    assertGenerationCurrent,
    applyRemoteVideoStream,
    beginJoinGeneration,
    cleanup,
    clearLiveRemoteState,
    commitRemoteParticipants,
    disableInitialCamera,
    disableInitialMic,
    broadcastTakeoverClaimed,
    connectionId,
    handleStaleConnection,
    invalidateGeneration,
    fenceCurrentGeneration,
    publishLayer3,
    watchSdkStates,
    removeRemoteById,
    sessionId,
    skipRealtimeConnect,
    startMicLevelMeter,
    subscribeEndpoint,
    unsubscribeEndpoint,
  ]);

  useEffect(() => {
    isUnmountingRef.current = false;
    return () => {
      isUnmountingRef.current = true;
    };
  }, []);

  // ── Return value ──────────────────────────────────────────────────────────

  return useMemo(
    () => ({
      isLoading,
      isLeaving,
      joined,
      status,
      error,
      role,
      localDisplayName,
      conferenceName,
      participantType,
      localParticipant,
      remoteParticipants,
      isMicMuted,
      isCameraOn,
      cameraUnavailable,
      mediaWarnings,
      toggleMic,
      toggleCamera,
      leave,
      micCaptureStatus,
      localAudioStreamCreated,
      localAudioStreamAddedToConference,
      lastAudioError,
      micLevel,
      audioProcessingEnabled,
      remoteStreamCount: remoteParticipants.length,
      remoteAudioElementCount,
      remotePlaybackBlocked,
      lastRemoteAudioError,
      unlockAudioPlayback,
      sendConferenceMessage,
      sendMessageAvailable,
      providerRecovery,
      transportRecovery,
      layer3,
      layer3Banner: layer3BannerKind({
        status: layer3.status,
        mediaUsable: remoteParticipants.some((remote) => {
          const video = remote.stream?.getTracks().some((track) => track.readyState !== "ended");
          const audio = remote.audioStream
            ?.getTracks()
            .some((track) => track.readyState !== "ended");
          return Boolean(video || audio);
        }),
      }),
      hasEnteredRoom,
    }),
    [
      conferenceName,
      error,
      isCameraOn,
      isLeaving,
      isLoading,
      isMicMuted,
      cameraUnavailable,
      joined,
      lastAudioError,
      lastRemoteAudioError,
      leave,
      localAudioStreamAddedToConference,
      localAudioStreamCreated,
      localDisplayName,
      localParticipant,
      mediaWarnings,
      micCaptureStatus,
      micLevel,
      audioProcessingEnabled,
      participantType,
      remoteAudioElementCount,
      remoteParticipants,
      remotePlaybackBlocked,
      role,
      sendConferenceMessage,
      sendMessageAvailable,
      providerRecovery,
      status,
      toggleCamera,
      toggleMic,
      transportRecovery,
      layer3,
      hasEnteredRoom,
      unlockAudioPlayback,
    ],
  );
}
