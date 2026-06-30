"use client";

import type { ParticipantType } from "@/app/generated/prisma/enums";
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
};

type VoxEndpointMediaEvent = {
  payload?: {
    stream?: VoxStream;
  };
};

type VoxEndpoint = {
  id: string;
  userName: string;
  displayName: string;
  addEventListener: (
    eventName: "RemoteMediaAdded" | "RemoteMediaRemoved",
    listener: (event: VoxEndpointMediaEvent) => void,
  ) => void;
  removeEventListener: (
    eventName: "RemoteMediaAdded" | "RemoteMediaRemoved",
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
  stream: MediaStream | null;
};

// ─── Hook options & result ────────────────────────────────────────────────────

type UseVoximplantRoomOptions = {
  sessionId: string;
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
  /** True when conference.sendMessage() is available on the current SDK object. */
  sendMessageAvailable: boolean;
};

// ─── Runtime mutable state (lives in a ref, never triggers renders) ───────────

type RuntimeState = {
  core: VoxCore;
  /** Retained so toggles can create new streams after joining. */
  streamModule: VoxStreamModule;
  /** VideoQuality enum value from the SDK used for new camera streams. */
  videoQuality: unknown;
  conference: VoxConference | null;
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
      onAdded: (event: VoxEndpointMediaEvent) => void;
      onRemoved: (event: VoxEndpointMediaEvent) => void;
    }
  >;
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
};

// ─── Pure utility functions ───────────────────────────────────────────────────

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown Voximplant error.";
}

/**
 * Returns true for device-access errors that should be treated as non-fatal:
 * device busy, permission denied, device not found.
 */
function isNonFatalMediaError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = toErrorMessage(error).toLowerCase();
  return (
    name === "NotReadableError" ||
    name === "NotAllowedError" ||
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    message.includes("notreadableerror") ||
    message.includes("notallowederror") ||
    message.includes("notfounderror") ||
    message.includes("device in use") ||
    message.includes("permission denied") ||
    message.includes("could not start video source") ||
    message.includes("could not start audio source") ||
    message.includes("overconstrained")
  );
}

/**
 * Returns true for SDK "already exists" errors from addStream.
 * These indicate the conference already registered a stream of that type.
 */
function isAlreadyExistsError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("already exists") ||
    message.includes("streamupdatefailed") ||
    message.includes("stream with type")
  );
}

/** Stop all underlying browser MediaStreamTracks to release the hardware device. */
function stopVoxStreamTracks(stream: VoxStream | null): void {
  if (!stream) return;
  try { stream.track?.stop(); } catch { /* ignore */ }
  if (stream.sourceStream) {
    try {
      for (const track of stream.sourceStream.getTracks()) track.stop();
    } catch { /* ignore */ }
  }
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
  if (typeof process === "undefined" || process.env.NODE_ENV !== "development") {
    return () => {};
  }
  const original = console.error;
  console.error = (...args: Parameters<typeof console.error>) => {
    const combined = args
      .map((a) =>
        typeof a === "string"
          ? a
          : a instanceof Error
            ? `${a.name}: ${a.message}`
            : String(a),
      )
      .join(" ");
    const lower = combined.toLowerCase();
    const isCameraDeviceBusy =
      (lower.includes("[streammanager]") && lower.includes("notreadableerror")) ||
      lower.includes("notreadableerror: device in use") ||
      (lower.includes("device in use") && lower.includes("[streammanager]"));
    if (!isCameraDeviceBusy) {
      original.apply(console, args);
    }
    // Suppressed: known Voximplant WebSDK camera-busy message.
    // The UI warning is displayed separately via mediaWarnings state.
  };
  return () => {
    console.error = original;
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVoximplantRoom({
  sessionId,
  disableInitialCamera = false,
  disableInitialMic = false,
}: UseVoximplantRoomOptions): UseVoximplantRoomResult {
  const runtimeRef = useRef<RuntimeState | null>(null);
  const mountedRef = useRef(true);
  const isJoiningRef = useRef(false);
  /** Stable ref for display name so toggle callbacks avoid stale closures. */
  const localDisplayNameRef = useRef("");

  // ── React state ──────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(true);
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
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [mediaWarnings, setMediaWarnings] = useState<string[]>([]);
  // Audio diagnostics
  const [micCaptureStatus, setMicCaptureStatus] = useState<MicCaptureStatus>("not_requested");
  const [localAudioStreamCreated, setLocalAudioStreamCreated] = useState(false);
  const [localAudioStreamAddedToConference, setLocalAudioStreamAddedToConference] = useState(false);
  const [lastAudioError, setLastAudioError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
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
          const level = Math.min(100, Math.round(rms * 300));
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

  // ── Remote audio attachment ───────────────────────────────────────────────

  /**
   * Create an HTMLAudioElement for a remote audio VoxStream and start playback.
   * Handles autoplay blocking by setting remotePlaybackBlocked state.
   * Safe to call multiple times for the same key (idempotent).
   */
  const attachRemoteAudioStream = useCallback(
    (endpointId: string, voxStream: VoxStream) => {
      const rt = runtimeRef.current;
      if (!rt) return;

      const ms = streamToMediaStream(voxStream);
      if (!ms) return;

      const key = `${endpointId}-${voxStream.id}`;
      if (rt.remoteAudioElements.has(key)) return;

      const audio = new Audio();
      audio.srcObject = ms;
      audio.autoplay = true;
      rt.remoteAudioElements.set(key, audio);
      setRemoteAudioElementCount(rt.remoteAudioElements.size);

      audio.play().then(() => {
        if (mountedRef.current) setRemotePlaybackBlocked(false);
      }).catch((err: unknown) => {
        if (!mountedRef.current) return;
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
    [],
  );

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
  }, []);

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
    if (!rt?.conference) return false;
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

  const upsertRemote = useCallback((next: VoxRoomParticipant) => {
    setRemoteParticipants((current) => {
      const index = current.findIndex((item) => item.id === next.id);
      if (index === -1) return [...current, next];
      const copy = [...current];
      copy[index] = next;
      return copy;
    });
  }, []);

  const removeRemoteById = useCallback(
    (endpointId: string) => {
      setRemoteParticipants((current) => current.filter((item) => item.id !== endpointId));
      detachRemoteAudioStreams(endpointId);
    },
    [detachRemoteAudioStreams],
  );

  /** Refresh the remote video stream for an endpoint. */
  const applyRemoteVideoStream = useCallback(
    (endpoint: VoxEndpoint) => {
      const stream = endpoint.getAnyVideoStreams()[0] ?? null;
      upsertRemote({
        id: endpoint.id,
        displayName: endpoint.displayName || endpoint.userName || endpoint.id,
        stream: streamToMediaStream(stream),
      });
    },
    [upsertRemote],
  );

  // ── Cleanup ───────────────────────────────────────────────────────────────

  const cleanup = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    // Stop mic level meter in-place (don't use stopMicLevelMeter callback to avoid dep cycle).
    if (runtime.animFrameId !== null) {
      cancelAnimationFrame(runtime.animFrameId);
      runtime.animFrameId = null;
    }
    if (runtime.analyserNode) {
      try { runtime.analyserNode.disconnect(); } catch { /* ignore */ }
      runtime.analyserNode = null;
    }
    if (runtime.analyserCtx) {
      void runtime.analyserCtx.close();
      runtime.analyserCtx = null;
    }

    // Release remote audio elements.
    for (const audio of runtime.remoteAudioElements.values()) {
      audio.pause();
      audio.srcObject = null;
    }
    runtime.remoteAudioElements.clear();

    // Unsubscribe endpoint listeners.
    for (const { endpoint, onAdded, onRemoved } of runtime.endpointSubscriptions.values()) {
      endpoint.removeEventListener("RemoteMediaAdded", onAdded);
      endpoint.removeEventListener("RemoteMediaRemoved", onRemoved);
    }
    runtime.endpointSubscriptions.clear();

    // Unsubscribe conference listeners.
    if (runtime.conference && runtime.conferenceListeners) {
      runtime.conference.removeEventListener("Connected", runtime.conferenceListeners.onConnected);
      runtime.conference.removeEventListener("Failed", runtime.conferenceListeners.onFailed);
      runtime.conference.removeEventListener("Disconnected", runtime.conferenceListeners.onDisconnected);
      runtime.conference.removeEventListener("EndpointAdded", runtime.conferenceListeners.onEndpointAdded);
      runtime.conference.removeEventListener("EndpointRemoved", runtime.conferenceListeners.onEndpointRemoved);
    }

    if (runtime.conference) {
      try { runtime.conference.hangup(); } catch { /* ignore */ }
    }

    // Stop browser tracks to release hardware. Silent stream close() also closes AudioContext.
    stopVoxStreamTracks(runtime.localAudioStream);
    stopVoxStreamTracks(runtime.localVideoStream);
    runtime.localAudioStream?.close?.();
    runtime.localVideoStream?.close?.();

    try { await runtime.core.client.disconnect(); } catch { /* ignore */ }

    runtimeRef.current = null;
  }, []);

  // ── Leave ─────────────────────────────────────────────────────────────────

  const leave = useCallback(async () => {
    if (isLeaving) return;
    setIsLeaving(true);
    await cleanup();
    if (!mountedRef.current) return;
    setJoined(false);
    setStatus("Отключено.");
    setRemoteParticipants([]);
    setLocalParticipant(null);
    setIsMicMuted(false);
    setIsCameraOn(false);
    setIsLeaving(false);
    setMicCaptureStatus("not_requested");
    setLocalAudioStreamCreated(false);
    setLocalAudioStreamAddedToConference(false);
    setMicLevel(0);
    setRemoteAudioElementCount(0);
    setRemotePlaybackBlocked(false);
    setSendMessageAvailable(false);
  }, [cleanup, isLeaving]);

  // ── Endpoint subscription ─────────────────────────────────────────────────

  const subscribeEndpoint = useCallback(
    (endpoint: VoxEndpoint) => {
      const runtime = runtimeRef.current;
      if (!runtime || runtime.endpointSubscriptions.has(endpoint.id)) return;

      const onAdded = (event: VoxEndpointMediaEvent) => {
        if (!event.payload?.stream) return;
        const stream = event.payload.stream;
        if (stream.type === "audio") {
          attachRemoteAudioStream(endpoint.id, stream);
        } else {
          applyRemoteVideoStream(endpoint);
        }
      };
      const onRemoved = () => { applyRemoteVideoStream(endpoint); };

      endpoint.addEventListener("RemoteMediaAdded", onAdded);
      endpoint.addEventListener("RemoteMediaRemoved", onRemoved);
      runtime.endpointSubscriptions.set(endpoint.id, { endpoint, onAdded, onRemoved });

      // Apply any streams already present on this endpoint.
      applyRemoteVideoStream(endpoint);
      for (const audioStream of endpoint.getAnyAudioStreams()) {
        attachRemoteAudioStream(endpoint.id, audioStream);
      }
    },
    [applyRemoteVideoStream, attachRemoteAudioStream],
  );

  // ── Microphone toggle ─────────────────────────────────────────────────────
  //
  // Audio acquisition is entirely independent of video:
  //   • createAudioStream is called only here and in join (never createVideoStream).
  //   • camera state/stream is never touched.

  const toggleMic = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime?.conference || runtime.audioOpPending) return;

    runtime.audioOpPending = true;
    const nextMuted = !isMicMuted;

    void (async () => {
      try {
        if (nextMuted) {
          // ── Mute path ──
          if (!runtime.isSilentAudio) {
            const audioTrack = getAudioTrack(runtime.localAudioStream);
            if (audioTrack) audioTrack.enabled = false;
          }
          runtime.conference!.muteMicrophone();
          setIsMicMuted(true);
          setMicCaptureStatus("muted");
        } else {
          // ── Unmute path ──
          // If we were using a silent placeholder, release it so we can create a real stream.
          if (runtime.isSilentAudio) {
            stopVoxStreamTracks(runtime.localAudioStream);
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
              const audioStream = await runtime.streamModule.streamManager.createAudioStream({
                audioProcessing: true,
              });
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
            setLocalAudioStreamAddedToConference(runtime.audioStreamAdded);
            removeMediaWarningsByKeyword("микрофон");
          }

          const audioTrack = getAudioTrack(runtime.localAudioStream);
          if (audioTrack) audioTrack.enabled = true;
          runtime.conference!.unmuteMicrophone();
          setIsMicMuted(false);
          setMicCaptureStatus("active");
        }
      } catch (e) {
        setLastAudioError(toErrorMessage(e));
        addMediaWarning(`Не удалось изменить состояние микрофона: ${toErrorMessage(e)}`);
      } finally {
        runtime.audioOpPending = false;
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
    if (!runtime || runtime.videoOpPending) return;

    runtime.videoOpPending = true;
    const nextOn = !isCameraOn;

    void (async () => {
      try {
        if (!nextOn) {
          // Turn camera off: release hardware tracks.
          stopVoxStreamTracks(runtime.localVideoStream);
          runtime.localVideoStream?.close?.();
          runtime.localVideoStream = null;
          runtime.videoStreamAdded = false;
          setLocalParticipant(null);
          setIsCameraOn(false);
        } else {
          // Turn camera on: video-only stream, does not request audio.
          let videoStream: VoxStream | null = null;
          const restoreCameraFilter = installCameraErrorSuppressor();
          try {
            videoStream = await runtime.streamModule.streamManager.createVideoStream(
              runtime.videoQuality,
            );
          } catch (e) {
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

          if (!runtime.videoStreamAdded) {
            try {
              runtime.videoStreamAdded = await safeAddStream(runtime.conference!, videoStream);
            } catch (addErr) {
              addMediaWarning(
                `Не удалось добавить видеопоток в конференцию: ${toErrorMessage(addErr)}`,
              );
              stopVoxStreamTracks(videoStream);
              runtime.localVideoStream = null;
              return;
            }
          }

          setLocalParticipant({
            id: "local",
            displayName: localDisplayNameRef.current,
            stream: streamToMediaStream(videoStream),
          });
          setIsCameraOn(true);
          removeMediaWarningsByKeyword("камера");
        }
      } catch (e) {
        addMediaWarning(`Не удалось изменить состояние камеры: ${toErrorMessage(e)}`);
      } finally {
        runtime.videoOpPending = false;
      }
    })();
  }, [isCameraOn, addMediaWarning, removeMediaWarningsByKeyword]);

  // ── Join effect ───────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    const join = async () => {
      if (isJoiningRef.current) return;
      isJoiningRef.current = true;
      setError(null);

      try {
        // Step 1 — fetch initial access token.
        const initialResponse = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/voximplant/access`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          },
        );

        const initialPayload = (await initialResponse.json().catch(() => ({}))) as AccessReadyPayload;
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
        const roomName = initialPayload.roomNameOrConferenceName;
        const displayName = initialPayload.user.displayName || "User";
        const userRole = initialPayload.user.role ?? "unknown";

        setRole(userRole);
        setParticipantType(mapParticipantType(userRole));
        setLocalDisplayName(displayName);
        localDisplayNameRef.current = displayName;
        setConferenceName(roomName);

        // Step 2 — load SDK modules.
        setStatus("Инициализация Voximplant SDK...");
        const [{ Core }, conferenceModule, streamModulePackage] = await Promise.all([
          import("@voximplant/websdk"),
          import("@voximplant/websdk/modules/conference-manager"),
          import("@voximplant/websdk/modules/stream"),
        ]);

        const core = Core.init({}) as unknown as VoxCore;
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

        // Step 3 — connect and authenticate.
        setStatus("Подключение к Voximplant...");
        await core.client.connect({});

        setStatus("Запрос одноразового ключа...");
        const oneTimeKey = await core.client.requestOneTimeKey({ username: sdkUsername });

        setStatus("Завершение безопасного входа...");
        const readyResponse = await fetch(
          `/api/sessions/${encodeURIComponent(sessionId)}/voximplant/access`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oneTimeKey }),
          },
        );
        const readyPayload = (await readyResponse.json().catch(() => ({}))) as AccessReadyPayload;
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
              audioProcessing: true,
            });
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
          } catch (videoError) {
            if (isNonFatalMediaError(videoError)) {
              initialWarnings.push(
                "Камера занята или недоступна. Вы остались в комнате без видео.",
              );
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
          core,
          streamModule,
          videoQuality,
          conference,
          localAudioStream,
          localVideoStream,
          isSilentAudio,
          audioStreamAdded: false,
          videoStreamAdded: false,
          audioOpPending: false,
          videoOpPending: false,
          endpointSubscriptions: new Map(),
          conferenceListeners: null,
          analyserNode: null,
          analyserCtx: null,
          animFrameId: null,
          lastMicLevelTs: 0,
          remoteAudioElements: new Map(),
        };
        runtimeRef.current = runtimeState;

        const onConnected = () => {
          setJoined(true);
          setStatus("Подключено к переговорной комнате.");
        };
        const onFailed = (event: VoxConferenceEvent) => {
          const reason = event.payload?.reason ?? "Неизвестная ошибка конференции.";
          setError(`Ошибка подключения к конференции: ${reason}`);
        };
        const onDisconnected = (event: VoxConferenceEvent) => {
          const reason = event.payload?.reason ?? "Отключено.";
          setJoined(false);
          setStatus(`Отключено: ${reason}`);
        };
        const onEndpointAdded = (event: VoxConferenceEvent) => {
          const endpointId = event.payload?.newEndpointId;
          if (!endpointId) return;
          const endpoint = conference.endpoints.value.get(endpointId);
          if (!endpoint) return;
          subscribeEndpoint(endpoint);
        };
        const onEndpointRemoved = (event: VoxConferenceEvent) => {
          const endpointId = event.payload?.removedEndpointId;
          if (!endpointId) return;
          removeRemoteById(endpointId);
        };

        conference.addEventListener("Connected", onConnected);
        conference.addEventListener("Failed", onFailed);
        conference.addEventListener("Disconnected", onDisconnected);
        conference.addEventListener("EndpointAdded", onEndpointAdded);
        conference.addEventListener("EndpointRemoved", onEndpointRemoved);
        runtimeState.conferenceListeners = {
          onConnected,
          onFailed,
          onDisconnected,
          onEndpointAdded,
          onEndpointRemoved,
        };

        // Step 6 — add streams to conference (each type added at most once).
        runtimeState.audioStreamAdded = await safeAddStream(conference, localAudioStream);
        setLocalAudioStreamAddedToConference(runtimeState.audioStreamAdded);

        if (localVideoStream) {
          runtimeState.videoStreamAdded = await safeAddStream(conference, localVideoStream);
        }

        // Step 7 — join.
        await conference.join();

        // Detect conference.sendMessage() availability for recording relay.
        if (mountedRef.current) {
          setSendMessageAvailable(typeof (conference as VoxConference).sendMessage === "function");
        }

        // Step 8 — set initial UI state.
        const micIsReal = !isSilentAudio;
        setIsMicMuted(!micIsReal);
        if (isSilentAudio) {
          conference.muteMicrophone();
          setMicCaptureStatus(disableInitialMic ? "not_requested" : "unavailable");
        } else {
          setMicCaptureStatus("active");
          // Start local mic level meter on the real microphone stream.
          const ms = streamToMediaStream(localAudioStream);
          if (ms) startMicLevelMeter(ms);
        }

        const cameraActive = localVideoStream !== null;
        setIsCameraOn(cameraActive);
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
          subscribeEndpoint(endpoint);
        }
      } catch (joinError) {
        const message = toErrorMessage(joinError);
        setError(message);
        setStatus("Не удалось подключиться к Voximplant.");
        await cleanup();
      } finally {
        if (mountedRef.current) setIsLoading(false);
        isJoiningRef.current = false;
      }
    };

    void join();

    return () => {
      mountedRef.current = false;
      void cleanup();
    };
  }, [
    cleanup,
    disableInitialCamera,
    disableInitialMic,
    removeRemoteById,
    sessionId,
    startMicLevelMeter,
    subscribeEndpoint,
  ]);

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
      mediaWarnings,
      toggleMic,
      toggleCamera,
      leave,
      micCaptureStatus,
      localAudioStreamCreated,
      localAudioStreamAddedToConference,
      lastAudioError,
      micLevel,
      remoteStreamCount: remoteParticipants.length,
      remoteAudioElementCount,
      remotePlaybackBlocked,
      lastRemoteAudioError,
      unlockAudioPlayback,
      sendConferenceMessage,
      sendMessageAvailable,
    }),
    [
      conferenceName,
      error,
      isCameraOn,
      isLeaving,
      isLoading,
      isMicMuted,
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
      participantType,
      remoteAudioElementCount,
      remoteParticipants,
      remotePlaybackBlocked,
      role,
      sendConferenceMessage,
      sendMessageAvailable,
      status,
      toggleCamera,
      toggleMic,
      unlockAudioPlayback,
    ],
  );
}
