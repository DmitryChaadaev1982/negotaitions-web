"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoximplantMediaControls } from "@/components/voximplant-media-controls";
import { VoximplantParticipantTile } from "@/components/voximplant-participant-tile";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  acquireVoxClientOwnership,
  endIntentionalProviderHandoff,
  isIntentionalProviderHandoffActive,
  registerVoxClientDisconnect,
  waitForVoxClientIdle,
  type VoxClientOwnership,
} from "@/lib/voximplant/browser-client-lifecycle";
import {
  createIdempotentRelease,
  createProviderConnectRunner,
  type ProviderAttemptResult,
  type ProviderConnectRunner,
  type ProviderConnectState,
} from "@/lib/voximplant/provider-connect-retry";
import {
  VoxAccessError,
  type VoxLifecyclePhase,
} from "@/lib/voximplant/provider-error-classification";
import {
  createSyntheticProviderError,
  resolveVoxProviderFaultPlan,
  shouldFailAttempt,
  type VoxProviderFaultMode,
} from "@/lib/voximplant/provider-fault-simulation";
import {
  initVoxCore,
  registerVoxSdkLogSink,
  resetVoxSdkLogDedupe,
} from "@/lib/voximplant/websdk-core";
import {
  installVoxCameraErrorSuppressor,
  isAlreadyExistsStreamError,
  isRecoverableVoxMediaError,
} from "@/lib/voximplant/media-error-utils";
import { normalizeParticipantPresenceMedia } from "@/lib/voximplant/participant-presence-media-model";
import {
  createDroppedCauseReporter,
  installVoxReInviteSchemeSanitizer,
  type VoxConnectionSeam,
} from "@/lib/voximplant/reinvite-scheme-sanitizer";
import type { EventStateParticipant } from "@/lib/event-state";
import { isStaleConnectionResponse } from "@/lib/client/stale-connection";
import {
  hasLiveMediaTrack,
  reconcileLobbyDeviceWarning,
} from "@/lib/voximplant/lobby-device-warning";

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

type VoxLobbyParticipant = {
  id: string;
  identityKey: string;
  endpointUsername?: string | null;
  displayName: string;
  stream: MediaStream | null;
  micState: "on" | "off" | "unknown";
  cameraState: "on" | "off" | "unknown";
  firstSeenAtMs: number;
  updatedAtMs: number;
};

type AccessPayload = {
  provider: "voximplant";
  roomNameOrConferenceName: string;
  user: {
    sdkUsername: string;
    displayName: string;
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
};

type EventLobbyVoximplantRoomProps = {
  eventId: string;
  hostToken?: string;
  participantToken?: string;
  connectionId: string;
  participants: EventStateParticipant[];
  /** E2E-only scripted transport outcome; `"off"` in every real deployment. */
  providerFaultSimulation?: VoxProviderFaultMode;
  onStaleConnection?: () => void;
  onDeviceWarning?: (message: string | null) => void;
  onLocalMediaControllerChange?: (controller: {
    micEnabled: boolean;
    cameraEnabled: boolean;
    micBusy: boolean;
    cameraBusy: boolean;
    toggleMic: () => Promise<void> | void;
    toggleCamera: () => Promise<void> | void;
  } | null) => void;
};

type RuntimeState = {
  core: VoxCore;
  conference: VoxConference | null;
  localAudioStream: VoxStream | null;
  localVideoStream: VoxStream | null;
  audioAdded: boolean;
  videoAdded: boolean;
  endpointSubscriptions: Map<
    string,
    {
      endpoint: VoxEndpoint;
      onAdded: (event: VoxEndpointMediaEvent) => void;
      onRemoved: (event: VoxEndpointMediaEvent) => void;
    }
  >;
  endpointIdentityIndex: Map<string, string>;
  remoteAudioElements: Map<string, HTMLAudioElement>;
  endpointSyncIntervalId: number | null;
  conferenceListeners: {
    onConnected: (event: VoxConferenceEvent) => void;
    onFailed: (event: VoxConferenceEvent) => void;
    onDisconnected: (event: VoxConferenceEvent) => void;
    onEndpointAdded: (event: VoxConferenceEvent) => void;
    onEndpointRemoved: (event: VoxConferenceEvent) => void;
  } | null;
};

const MIC_UNKNOWN_GRACE_MS = 2500;
const SPEAKING_THRESHOLD = 8;

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ??
    null
  );
}

function createAudioLevelMeter(
  mediaStream: MediaStream,
  onLevel: (level: number) => void,
): () => void {
  try {
    const Ctor = getAudioContextCtor();
    if (!Ctor) return () => {};
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    const source = ctx.createMediaStreamSource(mediaStream);
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let rafId = 0;
    let stopped = false;
    let lastTickMs = 0;

    const tick = () => {
      if (stopped) return;
      rafId = requestAnimationFrame(tick);
      const now = Date.now();
      if (now - lastTickMs < 66) return;
      lastTickMs = now;
      analyser.getByteTimeDomainData(dataArray);
      let sumSq = 0;
      for (const value of dataArray) {
        const normalized = (value - 128) / 128;
        sumSq += normalized * normalized;
      }
      const rms = Math.sqrt(sumSq / dataArray.length);
      onLevel(Math.min(100, Math.round(rms * 300)));
    };

    rafId = requestAnimationFrame(tick);
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      try {
        source.disconnect();
      } catch {}
      try {
        analyser.disconnect();
      } catch {}
      void ctx.close().catch(() => {});
    };
  } catch {
    return () => {};
  }
}

function normalizeEndpointIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeProviderUsername(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeEndpointIdentity(value);
  if (!normalized) return null;
  return normalized.includes("@") ? (normalized.split("@")[0] ?? null) : normalized;
}

function streamToMediaStream(stream: VoxStream | null): MediaStream | null {
  if (!stream) return null;
  if (stream.sourceStream) return stream.sourceStream;
  if (stream.track) return new MediaStream([stream.track]);
  return null;
}

function isRecoverableMediaError(error: unknown): boolean {
  return isRecoverableVoxMediaError(error);
}

function isAlreadyExistsError(error: unknown): boolean {
  return isAlreadyExistsStreamError(error);
}

async function safeAddStream(conference: VoxConference, stream: VoxStream): Promise<boolean> {
  try {
    await conference.addStream(stream);
    return true;
  } catch (e) {
    if (isAlreadyExistsError(e)) {
      return true;
    }
    throw e;
  }
}

function stopVoxStreamTracks(stream: VoxStream | null): void {
  if (!stream) return;
  try {
    stream.track?.stop();
  } catch {}
  if (stream.sourceStream) {
    try {
      for (const track of stream.sourceStream.getTracks()) {
        track.stop();
      }
    } catch {}
  }
}

function EventLobbyVoxVideoTile({
  participant,
  muted,
  subtitle,
  isSpeaking,
  explicitMicEnabled,
  explicitCameraEnabled,
}: {
  participant: VoxLobbyParticipant;
  muted: boolean;
  subtitle?: string;
  isSpeaking: boolean;
  explicitMicEnabled: boolean | null;
  explicitCameraEnabled: boolean | null;
}) {
  const { t } = useI18n();
  const model = normalizeParticipantPresenceMedia({
    displayName: participant.displayName,
    connectedSignal: true,
    videoStream: participant.stream,
    micSignal:
      explicitMicEnabled === null
        ? participant.micState
        : explicitMicEnabled
          ? "on"
          : "off",
    cameraSignal:
      explicitCameraEnabled === null
        ? participant.cameraState
        : explicitCameraEnabled
          ? "on"
          : "off",
  });
  return (
    <VoximplantParticipantTile
      stream={participant.stream}
      muted={muted}
      title={participant.displayName}
      subtitle={subtitle}
      connectionStatus={model.connectionStatus}
      micStatus={model.micStatus}
      cameraStatus={model.cameraStatus}
      micLabel={
        model.connectionStatus !== "connected"
          ? t("room.notConnected")
          : model.micStatus === "on"
            ? t("room.mediaMicOn")
            : model.micStatus === "off"
              ? t("room.mediaMicOff")
              : t("room.unknownMicState")
      }
      cameraLabel={
        model.connectionStatus !== "connected"
          ? t("room.notConnected")
          : model.cameraStatus === "on"
            ? t("room.mediaCameraOn")
            : model.cameraStatus === "off"
              ? t("room.mediaCameraOff")
              : t("room.mediaCameraOff")
      }
      isSpeaking={isSpeaking}
      className="w-full max-w-[420px]"
    />
  );
}

export const EventLobbyVoximplantRoom = memo(function EventLobbyVoximplantRoom({
  eventId,
  hostToken,
  participantToken,
  connectionId,
  participants,
  providerFaultSimulation = "off",
  onStaleConnection,
  onDeviceWarning,
  onLocalMediaControllerChange,
}: EventLobbyVoximplantRoomProps) {
  const { t } = useI18n();
  const runtimeRef = useRef<RuntimeState | null>(null);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const mountedRef = useRef(true);
  const droppedCauseReporterRef = useRef(createDroppedCauseReporter());
  const clientOwnershipRef = useRef<VoxClientOwnership | null>(null);
  const lifecyclePhaseRef = useRef<VoxLifecyclePhase>("idle");
  const connectRunnerRef = useRef<ProviderConnectRunner | null>(null);

  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [connectState, setConnectState] = useState<ProviderConnectState | null>(null);
  const [joined, setJoined] = useState(false);
  const [localParticipant, setLocalParticipant] = useState<VoxLobbyParticipant | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<VoxLobbyParticipant[]>([]);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const speakerLevelByTrackRef = useRef(new Map<string, number>());
  const speakerMeterCleanupByTrackRef = useRef(new Map<string, () => void>());
  const micUnknownTimerByParticipantRef = useRef(new Map<string, number>());
  const lastPublishedMediaStatusRef = useRef<string | null>(null);
  const simulatedMediaStreamRef = useRef<MediaStream | null>(null);
  const onDeviceWarningRef = useRef(onDeviceWarning);
  const onStaleConnectionRef = useRef(onStaleConnection);
  const tRef = useRef(t);

  useEffect(() => {
    onDeviceWarningRef.current = onDeviceWarning;
    onStaleConnectionRef.current = onStaleConnection;
    tRef.current = t;
  }, [onDeviceWarning, onStaleConnection, t]);

  // Owns the shared SDK log callback while the lobby is the active surface, so
  // provider errors are classified against the lobby lifecycle rather than by a
  // Session-room callback that outlived its route.
  useEffect(() => {
    return registerVoxSdkLogSink({
      surface: "event-lobby",
      getContext: () => ({
        phase: lifecyclePhaseRef.current,
        intentionalHandoff: isIntentionalProviderHandoffActive(),
        attempt: connectRunnerRef.current?.getState().attempt,
        maxAttempts: connectRunnerRef.current?.getState().maxAttempts,
      }),
    });
  }, []);

  const recomputeActiveSpeaker = useCallback(() => {
    let nextSpeakerId: string | null = null;
    let highestLevel = SPEAKING_THRESHOLD;
    for (const [trackKey, level] of speakerLevelByTrackRef.current) {
      if (level <= highestLevel) continue;
      highestLevel = level;
      nextSpeakerId = trackKey.split(":", 1)[0] ?? null;
    }
    setActiveSpeakerId((current) => (current === nextSpeakerId ? current : nextSpeakerId));
  }, []);

  const clearSpeakerMeter = useCallback(
    (trackKey: string) => {
      const cleanup = speakerMeterCleanupByTrackRef.current.get(trackKey);
      if (cleanup) {
        cleanup();
        speakerMeterCleanupByTrackRef.current.delete(trackKey);
      }
      if (speakerLevelByTrackRef.current.delete(trackKey)) {
        recomputeActiveSpeaker();
      }
    },
    [recomputeActiveSpeaker],
  );

  const upsertSpeakerMeter = useCallback(
    (trackKey: string, mediaStream: MediaStream | null) => {
      clearSpeakerMeter(trackKey);
      if (!mediaStream) return;
      const cleanup = createAudioLevelMeter(mediaStream, (level) => {
        speakerLevelByTrackRef.current.set(trackKey, level);
        recomputeActiveSpeaker();
      });
      speakerMeterCleanupByTrackRef.current.set(trackKey, cleanup);
    },
    [clearSpeakerMeter, recomputeActiveSpeaker],
  );

  const clearUnknownMicTimer = useCallback((participantId: string) => {
    const timerId = micUnknownTimerByParticipantRef.current.get(participantId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      micUnknownTimerByParticipantRef.current.delete(participantId);
    }
  }, []);

  const scheduleUnknownMicResolution = useCallback(
    (participantId: string) => {
      clearUnknownMicTimer(participantId);
      const timerId = window.setTimeout(() => {
        micUnknownTimerByParticipantRef.current.delete(participantId);
        setRemoteParticipants((current) =>
          current.map((participant) =>
            participant.id === participantId && participant.micState === "unknown"
              ? { ...participant, micState: "off", updatedAtMs: Date.now() }
              : participant,
          ),
        );
      }, MIC_UNKNOWN_GRACE_MS);
      micUnknownTimerByParticipantRef.current.set(participantId, timerId);
    },
    [clearUnknownMicTimer],
  );

  const detachRemoteAudioStreams = useCallback((endpointId: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const prefix = `${endpointId}-`;
    for (const [key, audio] of runtime.remoteAudioElements) {
      if (key.startsWith(prefix)) {
        audio.pause();
        audio.srcObject = null;
        runtime.remoteAudioElements.delete(key);
        clearSpeakerMeter(`${endpointId}:${key}`);
      }
    }
  }, [clearSpeakerMeter]);

  const cleanup = useCallback(async () => {
    if (cleanupPromiseRef.current) {
      return cleanupPromiseRef.current;
    }
    const runtime = runtimeRef.current;
    setJoined(false);
    setLocalParticipant(null);
    setRemoteParticipants([]);
    setIsCameraOn(false);
    setCameraUnavailable(false);
    onDeviceWarningRef.current?.(null);
    if (!runtime) return;
    runtimeRef.current = null;

    const trackedCleanup = registerVoxClientDisconnect(
      (async () => {
        for (const audio of runtime.remoteAudioElements.values()) {
          audio.pause();
          audio.srcObject = null;
        }
        runtime.remoteAudioElements.clear();
        if (runtime.endpointSyncIntervalId !== null) {
          window.clearInterval(runtime.endpointSyncIntervalId);
          runtime.endpointSyncIntervalId = null;
        }
        for (const cleanup of speakerMeterCleanupByTrackRef.current.values()) {
          cleanup();
        }
        speakerMeterCleanupByTrackRef.current.clear();
        speakerLevelByTrackRef.current.clear();
        setActiveSpeakerId(null);
        for (const timerId of micUnknownTimerByParticipantRef.current.values()) {
          window.clearTimeout(timerId);
        }
        micUnknownTimerByParticipantRef.current.clear();

        for (const { endpoint, onAdded, onRemoved } of runtime.endpointSubscriptions.values()) {
          endpoint.removeEventListener("RemoteMediaAdded", onAdded);
          endpoint.removeEventListener("RemoteMediaRemoved", onRemoved);
        }
        runtime.endpointSubscriptions.clear();

        if (runtime.conference && runtime.conferenceListeners) {
          runtime.conference.removeEventListener("Connected", runtime.conferenceListeners.onConnected);
          runtime.conference.removeEventListener("Failed", runtime.conferenceListeners.onFailed);
          runtime.conference.removeEventListener("Disconnected", runtime.conferenceListeners.onDisconnected);
          runtime.conference.removeEventListener("EndpointAdded", runtime.conferenceListeners.onEndpointAdded);
          runtime.conference.removeEventListener("EndpointRemoved", runtime.conferenceListeners.onEndpointRemoved);
        }

        if (runtime.conference) {
          try {
            runtime.conference.hangup();
          } catch {}
        }

        const releaseLocalMedia = createIdempotentRelease(() => {
          stopVoxStreamTracks(runtime.localAudioStream);
          stopVoxStreamTracks(runtime.localVideoStream);
          runtime.localAudioStream?.close?.();
          runtime.localVideoStream?.close?.();
        });
        releaseLocalMedia();

        // Local hardware is always released; the shared client is only
        // disconnected while this surface still owns it.
        const ownership = clientOwnershipRef.current;
        clientOwnershipRef.current = null;
        if (!ownership || ownership.isCurrent()) {
          await runtime.core.client.disconnect().catch(() => undefined);
          ownership?.release();
        }
      })(),
    ).finally(() => {
      if (cleanupPromiseRef.current === trackedCleanup) {
        cleanupPromiseRef.current = null;
      }
    });

    cleanupPromiseRef.current = trackedCleanup;
    return trackedCleanup;
  }, []);

  const publishLobbyDeviceWarning = useCallback(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    onDeviceWarningRef.current?.(
      reconcileLobbyDeviceWarning({
        hasMicrophoneStream: hasLiveMediaTrack(
          streamToMediaStream(runtime.localAudioStream),
          "audio",
        ),
        hasCameraStream: hasLiveMediaTrack(
          streamToMediaStream(runtime.localVideoStream),
          "video",
        ),
      }),
    );
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const t = (
      key: Parameters<typeof tRef.current>[0],
      params?: Parameters<typeof tRef.current>[1],
    ) => tRef.current(key, params);
    const onDeviceWarning = (message: string | null) => {
      onDeviceWarningRef.current?.(message);
    };
    const onStaleConnection = () => {
      onStaleConnectionRef.current?.();
    };

    const upsertRemote = (next: VoxLobbyParticipant) => {
      setRemoteParticipants((current) => {
        const idx = current.findIndex((item) => item.id === next.id);
        if (idx === -1) return [...current, next];
        const previous = current[idx];
        const copy = [...current];
        copy[idx] = {
          ...next,
          firstSeenAtMs: previous?.firstSeenAtMs ?? next.firstSeenAtMs,
        };
        return copy;
      });
    };

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
      });

    /**
     * Scripted transport outcome used by the media-handoff E2E suite. Reached
     * only when the server is in external-services mock mode; every other part
     * of the lobby lifecycle stays real.
     */
    const runSimulatedProviderConnect = async (
      mode: VoxProviderFaultMode,
      attempt: number,
    ): Promise<"connected" | "aborted"> => {
      const plan = resolveVoxProviderFaultPlan(mode);
      setStatus(t("events.voxLobbyConnectingVideo"));
      if (plan.disconnectDelayMs > 0) await wait(plan.disconnectDelayMs);
      if (plan.connectDelayMs > 0) await wait(plan.connectDelayMs);
      if (cancelled || !mountedRef.current) return "aborted";

      if (shouldFailAttempt(plan, attempt)) {
        throw createSyntheticProviderError(mode);
      }

      let simulatedMediaStream: MediaStream | null = null;
      if (mode === "healthy-media" || mode === "media-acquisition") {
        try {
          simulatedMediaStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: true,
          });
          simulatedMediaStreamRef.current = simulatedMediaStream;
          if (mode === "healthy-media") {
            onDeviceWarning?.("cameraBusyOrUnavailable");
          }
        } catch {
          onDeviceWarning?.("cameraUnavailable");
        }
      }
      const hasMicrophoneStream = Boolean(
        simulatedMediaStream?.getAudioTracks().some((track) => track.readyState !== "ended"),
      );
      const hasCameraStream = Boolean(
        simulatedMediaStream?.getVideoTracks().some((track) => track.readyState !== "ended"),
      );
      onDeviceWarning?.(
        reconcileLobbyDeviceWarning({
          hasMicrophoneStream,
          hasCameraStream,
        }),
      );
      setJoined(true);
      setStatus(t("events.voxLobbyConnected"));
      setIsMicMuted(!hasMicrophoneStream);
      setIsCameraOn(hasCameraStream);
      setLocalParticipant({
        id: "local",
        identityKey: normalizeEndpointIdentity(connectionId) ?? connectionId,
        endpointUsername: null,
        displayName: t("common.you"),
        stream: simulatedMediaStream,
        micState: hasMicrophoneStream ? "on" : "off",
        cameraState: hasCameraStream ? "on" : "off",
        firstSeenAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
      lifecyclePhaseRef.current = "connected";
      endIntentionalProviderHandoff();
      return "connected";
    };

    const join = async (attempt: number): Promise<"connected" | "aborted"> => {
      setError(null);
      setErrorDetails(null);
      setStatus(t("events.voxLobbyAuthorizing"));
      lifecyclePhaseRef.current = "connecting";
      resetVoxSdkLogDedupe();

      try {
        setStatus(t("events.voxLobbyWaitingForPreviousDisconnect"));
        // Bounded: a Session teardown that never completes must degrade lobby
        // media, not keep the lobby waiting for it.
        await waitForVoxClientIdle();
        if (cancelled || !mountedRef.current) return "aborted";

        if (providerFaultSimulation !== "off") {
          return await runSimulatedProviderConnect(providerFaultSimulation, attempt);
        }

        setStatus(t("events.voxLobbyAuthorizing"));
        const initialResponse = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/voximplant-access`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(hostToken ? { hostToken } : {}),
              ...(participantToken ? { participantToken } : {}),
              connectionId,
              claimLease: true,
            }),
          },
        );
        if (cancelled || !mountedRef.current) return "aborted";
        const initialPayload = (await initialResponse.json().catch(() => ({}))) as AccessPayload & {
          code?: string;
        };
        if (!initialResponse.ok) {
          if (initialResponse.status === 409 && initialPayload.code === "STALE_CONNECTION") {
            onStaleConnection?.();
            return "aborted";
          }
          throw new VoxAccessError(
            initialResponse.status,
            initialPayload.error ?? `Vox access failed (${initialResponse.status}).`,
          );
        }
        if (
          initialPayload.provider !== "voximplant" ||
          initialPayload.credentials.status !== "one_time_key_required"
        ) {
          throw new Error("Unexpected Vox lobby access payload.");
        }

        const [{ Core, LogLevel, connectionToken }, conferenceModule, streamModulePackage] =
          await Promise.all([
            import("@voximplant/websdk"),
            import("@voximplant/websdk/modules/conference-manager"),
            import("@voximplant/websdk/modules/stream"),
          ]);
        if (cancelled || !mountedRef.current) return "aborted";
        const core = initVoxCore({ Core, LogLevel }) as VoxCore;

        // Must run before the conference module registers its own handleReInvite
        // subscriber. Core.init is a singleton, so whichever surface initializes
        // the SDK first owns this guard for the whole page.
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
        } catch {}

        const conferenceManager = core.getModule(
          conferenceModule.conferenceToken,
        ) as VoxConferenceManager;
        const streamModule = core.getModule(streamModulePackage.streamToken) as VoxStreamModule;

        setStatus(t("events.voxLobbyWaitingForPreviousDisconnect"));
        await waitForVoxClientIdle();
        if (cancelled || !mountedRef.current) return "aborted";

        // Claiming ownership immediately before connect means a Session teardown
        // that lands after this point cannot disconnect the lobby's transport.
        clientOwnershipRef.current = acquireVoxClientOwnership("event-lobby");
        setStatus(t("events.voxLobbyConnectingVideo"));
        await core.client.connect({});
        if (cancelled || !mountedRef.current) return "aborted";
        const oneTimeKey = await core.client.requestOneTimeKey({
          username: initialPayload.user.sdkUsername,
        });
        if (cancelled || !mountedRef.current) return "aborted";
        const readyResponse = await fetch(
          `/api/events/${encodeURIComponent(eventId)}/voximplant-access`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(hostToken ? { hostToken } : {}),
              ...(participantToken ? { participantToken } : {}),
              connectionId,
              claimLease: true,
              oneTimeKey,
            }),
          },
        );
        if (cancelled || !mountedRef.current) return "aborted";
        const readyPayload = (await readyResponse.json().catch(() => ({}))) as AccessPayload;
        if (!readyResponse.ok) {
          if (
            readyResponse.status === 409 &&
            (readyPayload as AccessPayload & { code?: string }).code === "STALE_CONNECTION"
          ) {
            onStaleConnection?.();
            return "aborted";
          }
          throw new VoxAccessError(
            readyResponse.status,
            readyPayload.error ?? `Vox access failed (${readyResponse.status}).`,
          );
        }
        if (
          readyPayload.provider !== "voximplant" ||
          readyPayload.credentials.status !== "ready"
        ) {
          throw new Error("Vox lobby access handshake failed.");
        }
        if (readyPayload.user.sdkUsername !== initialPayload.user.sdkUsername) {
          throw new Error("Security check failed: sdkUsername mismatch during one-time-key login.");
        }

        await core.client.loginOneTimeKey({
          username: readyPayload.user.sdkUsername,
          hash: readyPayload.credentials.oneTimeKeyHash,
        });
        if (cancelled || !mountedRef.current) return "aborted";

        let localAudioStream: VoxStream | null = null;
        let localVideoStream: VoxStream | null = null;
        try {
          localAudioStream = await streamModule.streamManager.createAudioStream({
            audioProcessing: true,
          });
        } catch (audioError) {
          if (!isRecoverableMediaError(audioError)) {
            throw audioError;
          }
        }
        try {
          const restoreCameraFilter = installVoxCameraErrorSuppressor();
          try {
            localVideoStream = await streamModule.streamManager.createVideoStream(
              streamModulePackage.VideoQuality.Medium,
            );
          } finally {
            restoreCameraFilter();
          }
        } catch (videoError) {
          if (isRecoverableMediaError(videoError)) {
            setCameraUnavailable(true);
          } else {
            throw videoError;
          }
        }

        const conference = conferenceManager.createConference({
          conferenceName: readyPayload.roomNameOrConferenceName,
          reportStats: false,
        });

        const runtime: RuntimeState = {
          core,
          conference,
          localAudioStream,
          localVideoStream,
          audioAdded: false,
          videoAdded: false,
          endpointSubscriptions: new Map(),
          endpointIdentityIndex: new Map(),
          remoteAudioElements: new Map(),
          endpointSyncIntervalId: null,
          conferenceListeners: null,
        };
        runtimeRef.current = runtime;
        const watchLocalTrackEnded = (stream: VoxStream | null) => {
          const media = streamToMediaStream(stream);
          for (const track of media?.getTracks() ?? []) {
            track.addEventListener("ended", () => {
              if (cancelled || !mountedRef.current) return;
              publishLobbyDeviceWarning();
            });
          }
        };
        watchLocalTrackEnded(localAudioStream);
        watchLocalTrackEnded(localVideoStream);
        publishLobbyDeviceWarning();

        const getTrackEnabled = (
          stream: VoxStream | null,
          kind: "audio" | "video",
        ): boolean | null => {
          const mediaStream = streamToMediaStream(stream);
          if (!mediaStream) return null;
          const tracks =
            kind === "audio" ? mediaStream.getAudioTracks() : mediaStream.getVideoTracks();
          if (tracks.length === 0) return null;
          return tracks.some((track) => track.enabled);
        };

        const attachRemoteAudio = (endpointId: string, stream: VoxStream) => {
          const runtimeState = runtimeRef.current;
          if (!runtimeState) return;
          const ms = streamToMediaStream(stream);
          if (!ms) return;
          const key = `${endpointId}-${stream.id}`;
          if (runtimeState.remoteAudioElements.has(key)) return;
          const audio = new Audio();
          audio.srcObject = ms;
          audio.autoplay = true;
          runtimeState.remoteAudioElements.set(key, audio);
          upsertSpeakerMeter(`${endpointId}:${key}`, ms);
          void audio.play().catch(() => {});
          clearUnknownMicTimer(endpointId);
          setRemoteParticipants((current) =>
            current.map((participant) =>
              participant.id === endpointId
                ? { ...participant, micState: "on", updatedAtMs: Date.now() }
                : participant,
            ),
          );
        };

        const applyRemoteVideo = (endpoint: VoxEndpoint) => {
          const videoStream = endpoint.getAnyVideoStreams()[0] ?? null;
          const audioStream = endpoint.getAnyAudioStreams()[0] ?? null;
          const hasAudio = audioStream !== null;
          const audioEnabled = getTrackEnabled(audioStream, "audio");
          const videoEnabled = getTrackEnabled(videoStream, "video");
          const now = Date.now();
          if (!hasAudio) {
            scheduleUnknownMicResolution(endpoint.id);
          } else {
            clearUnknownMicTimer(endpoint.id);
          }
          const identityKey = normalizeEndpointIdentity(
            endpoint.userName || endpoint.displayName || endpoint.id,
          );
          upsertRemote({
            id: endpoint.id,
            identityKey,
            endpointUsername: endpoint.userName ?? null,
            displayName: endpoint.displayName || endpoint.userName || endpoint.id,
            stream: streamToMediaStream(videoStream),
            micState: hasAudio ? (audioEnabled === false ? "off" : "on") : "unknown",
            cameraState: videoStream ? (videoEnabled === false ? "off" : "on") : "off",
            firstSeenAtMs: now,
            updatedAtMs: now,
          });
        };

        const subscribeEndpoint = (endpoint: VoxEndpoint) => {
          if (runtime.endpointSubscriptions.has(endpoint.id)) return;
          const identityKey = normalizeEndpointIdentity(
            endpoint.userName || endpoint.displayName || endpoint.id,
          );
          const previousEndpointId = runtime.endpointIdentityIndex.get(identityKey);
          if (previousEndpointId && previousEndpointId !== endpoint.id) {
            const previousSubscription =
              runtime.endpointSubscriptions.get(previousEndpointId);
            if (previousSubscription) {
              previousSubscription.endpoint.removeEventListener(
                "RemoteMediaAdded",
                previousSubscription.onAdded,
              );
              previousSubscription.endpoint.removeEventListener(
                "RemoteMediaRemoved",
                previousSubscription.onRemoved,
              );
              runtime.endpointSubscriptions.delete(previousEndpointId);
            }
            detachRemoteAudioStreams(previousEndpointId);
            clearUnknownMicTimer(previousEndpointId);
            setRemoteParticipants((current) =>
              current.filter((item) => item.id !== previousEndpointId),
            );
          }
          runtime.endpointIdentityIndex.set(identityKey, endpoint.id);
          const onAdded = (event: VoxEndpointMediaEvent) => {
            if (!event.payload?.stream) return;
            if (event.payload.stream.type === "audio") {
              attachRemoteAudio(endpoint.id, event.payload.stream);
            } else {
              applyRemoteVideo(endpoint);
            }
          };
          const onRemoved = () => {
            applyRemoteVideo(endpoint);
          };
          endpoint.addEventListener("RemoteMediaAdded", onAdded);
          endpoint.addEventListener("RemoteMediaRemoved", onRemoved);
          runtime.endpointSubscriptions.set(endpoint.id, {
            endpoint,
            onAdded,
            onRemoved,
          });
          applyRemoteVideo(endpoint);
          for (const stream of endpoint.getAnyAudioStreams()) {
            attachRemoteAudio(endpoint.id, stream);
          }
        };

        const onConnected = () => {
          setJoined(true);
          setStatus(t("events.voxLobbyConnected"));
        };
        const onFailed = (event: VoxConferenceEvent) => {
          const reason = event.payload?.reason ?? "unknown";
          setError(t("events.voxLobbyUnableToConnect"));
          setErrorDetails(reason);
        };
        const onDisconnected = (event: VoxConferenceEvent) => {
          setJoined(false);
          setStatus(
            t("events.voxLobbyDisconnected", {
              reason: event.payload?.reason ?? "unknown",
            }),
          );
        };
        const onEndpointAdded = (event: VoxConferenceEvent) => {
          const endpointId = event.payload?.newEndpointId;
          if (!endpointId) return;
          const endpoint = conference.endpoints.value.get(endpointId);
          if (endpoint) subscribeEndpoint(endpoint);
        };
        const onEndpointRemoved = (event: VoxConferenceEvent) => {
          const endpointId = event.payload?.removedEndpointId;
          if (!endpointId) return;
          for (const [identityKey, trackedEndpointId] of runtime.endpointIdentityIndex) {
            if (trackedEndpointId === endpointId) {
              runtime.endpointIdentityIndex.delete(identityKey);
            }
          }
          setRemoteParticipants((current) =>
            current.filter((item) => item.id !== endpointId),
          );
          clearUnknownMicTimer(endpointId);
          detachRemoteAudioStreams(endpointId);
        };

        conference.addEventListener("Connected", onConnected);
        conference.addEventListener("Failed", onFailed);
        conference.addEventListener("Disconnected", onDisconnected);
        conference.addEventListener("EndpointAdded", onEndpointAdded);
        conference.addEventListener("EndpointRemoved", onEndpointRemoved);
        runtime.conferenceListeners = {
          onConnected,
          onFailed,
          onDisconnected,
          onEndpointAdded,
          onEndpointRemoved,
        };

        runtime.endpointSyncIntervalId = window.setInterval(() => {
          if (cancelled || !mountedRef.current) return;
          for (const endpoint of conference.endpoints.value.values()) {
            subscribeEndpoint(endpoint);
            applyRemoteVideo(endpoint);
          }
          const liveEndpointIds = new Set(Array.from(conference.endpoints.value.keys()));
          setRemoteParticipants((current) =>
            current.filter((participant) => liveEndpointIds.has(participant.id)),
          );
          publishLobbyDeviceWarning();
        }, 1000);

        if (localAudioStream) {
          runtime.audioAdded = await safeAddStream(conference, localAudioStream);
        }
        if (localVideoStream) {
          runtime.videoAdded = await safeAddStream(conference, localVideoStream);
          setCameraUnavailable(false);
        }
        await conference.join();

        setIsMicMuted(!localAudioStream);
        setIsCameraOn(Boolean(localVideoStream));
        publishLobbyDeviceWarning();
        setLocalParticipant({
          id: "local",
          identityKey: normalizeEndpointIdentity(
            readyPayload.user.sdkUsername || readyPayload.user.displayName || "local",
          ),
          endpointUsername: readyPayload.user.sdkUsername ?? null,
          displayName: readyPayload.user.displayName,
          stream: streamToMediaStream(localVideoStream),
          micState: localAudioStream ? "on" : "off",
          cameraState: localVideoStream ? "on" : "off",
          firstSeenAtMs: Date.now(),
          updatedAtMs: Date.now(),
        });
        upsertSpeakerMeter("local:local", streamToMediaStream(localAudioStream));

        for (const endpoint of conference.endpoints.value.values()) {
          subscribeEndpoint(endpoint);
        }

        lifecyclePhaseRef.current = "connected";
        // The Session room that opened the handoff window has unmounted by now,
        // so the lobby is what closes it.
        endIntentionalProviderHandoff();
        return "connected";
      } catch (joinError) {
        // Release the partially built runtime so the next attempt starts clean
        // and never holds a second room membership or camera track.
        await cleanup();
        throw joinError;
      }
    };

    const attemptJoin = async ({
      attempt,
    }: {
      attempt: number;
    }): Promise<ProviderAttemptResult> => {
      try {
        const outcome = await join(attempt);
        return outcome === "connected" ? { outcome: "connected" } : { outcome: "aborted" };
      } catch (joinError) {
        if (cancelled || !mountedRef.current) return { outcome: "aborted" };
        return { outcome: "failed", error: joinError };
      }
    };

    const runner = createProviderConnectRunner({
      surface: "event-lobby",
      attempt: attemptJoin,
      getPhase: () => lifecyclePhaseRef.current,
      onState: (next) => {
        if (!mountedRef.current) return;
        setConnectState(next);
        if (next.status === "terminal") {
          setError(t("events.voxLobbyUnableToConnect"));
          setErrorDetails(next.reason);
          setStatus(t("events.voxLobbyUnableToConnect"));
          return;
        }
        if (next.status === "degraded") {
          setError(null);
          setStatus(t("events.voxLobbyRetryingVideo"));
        }
      },
    });
    connectRunnerRef.current = runner;

    void runner.start();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      lifecyclePhaseRef.current = "intentional_teardown";
      runner.cancel();
      connectRunnerRef.current = null;
      for (const track of simulatedMediaStreamRef.current?.getTracks() ?? []) {
        track.stop();
      }
      simulatedMediaStreamRef.current = null;
      void cleanup();
    };
  }, [
    cleanup,
    connectionId,
    clearUnknownMicTimer,
    detachRemoteAudioStreams,
    eventId,
    providerFaultSimulation,
    hostToken,
    participantToken,
    publishLobbyDeviceWarning,
    scheduleUnknownMicResolution,
    upsertSpeakerMeter,
  ]);

  const toggleMic = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime?.conference || isBusy) return;
    setIsBusy(true);
    try {
      if (isMicMuted) {
        const track = streamToMediaStream(runtime.localAudioStream)?.getAudioTracks()[0] ?? null;
        if (track) {
          track.enabled = true;
          runtime.conference.unmuteMicrophone();
          setIsMicMuted(false);
          upsertSpeakerMeter("local:local", streamToMediaStream(runtime.localAudioStream));
          setLocalParticipant((current) =>
            current ? { ...current, micState: "on", updatedAtMs: Date.now() } : current,
          );
        }
      } else {
        const track = streamToMediaStream(runtime.localAudioStream)?.getAudioTracks()[0] ?? null;
        if (track) {
          track.enabled = false;
        }
        runtime.conference.muteMicrophone();
        setIsMicMuted(true);
        clearSpeakerMeter("local:local");
        setLocalParticipant((current) =>
            current ? { ...current, micState: "off", updatedAtMs: Date.now() } : current,
        );
      }
    } finally {
      setIsBusy(false);
    }
  }, [clearSpeakerMeter, isBusy, isMicMuted, upsertSpeakerMeter]);

  const toggleCamera = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime?.conference || isBusy) return;
    setIsBusy(true);
    try {
      const track = streamToMediaStream(runtime.localVideoStream)?.getVideoTracks()[0] ?? null;
      if (track) {
        const nextOn = !isCameraOn;
        track.enabled = nextOn;
        setIsCameraOn(nextOn);
        setLocalParticipant((current) =>
          current
            ? {
                ...current,
                cameraState: nextOn ? "on" : "off",
                updatedAtMs: Date.now(),
              }
            : current,
        );
        if (nextOn) {
          setCameraUnavailable(false);
          onDeviceWarning?.(null);
        }
      }
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, isCameraOn, onDeviceWarning]);

  useEffect(() => {
    onLocalMediaControllerChange?.({
      micEnabled: !isMicMuted,
      cameraEnabled: isCameraOn,
      micBusy: isBusy,
      cameraBusy: isBusy,
      toggleMic,
      toggleCamera,
    });
    return () => onLocalMediaControllerChange?.(null);
  }, [
    isCameraOn,
    isBusy,
    isMicMuted,
    onLocalMediaControllerChange,
    toggleCamera,
    toggleMic,
  ]);

  const visibleRemoteParticipants = useMemo(() => {
    const byIdentity = new Map<string, VoxLobbyParticipant>();
    for (const participant of remoteParticipants) {
      const existing = byIdentity.get(participant.identityKey);
      if (!existing) {
        byIdentity.set(participant.identityKey, participant);
        continue;
      }
      const existingHasVideo = Boolean(existing.stream?.getVideoTracks().length);
      const candidateHasVideo = Boolean(participant.stream?.getVideoTracks().length);
      if (
        (candidateHasVideo && !existingHasVideo) ||
        participant.updatedAtMs > existing.updatedAtMs
      ) {
        byIdentity.set(participant.identityKey, participant);
      }
    }
    return Array.from(byIdentity.values());
  }, [remoteParticipants]);

  const sortedParticipants = useMemo(() => {
    const all = localParticipant
      ? [localParticipant, ...visibleRemoteParticipants]
      : visibleRemoteParticipants;
    return [...all].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }),
    );
  }, [localParticipant, visibleRemoteParticipants]);

  const remoteExplicitStatusByIdentity = useMemo(() => {
    const map = new Map<
      string,
      {
        micEnabled: boolean | null;
        cameraEnabled: boolean | null;
      }
    >();
    for (const participant of participants) {
      const identity = normalizeProviderUsername(participant.voximplantProviderUsername);
      if (!identity) continue;
      map.set(identity, {
        micEnabled: participant.micEnabled ?? null,
        cameraEnabled: participant.cameraEnabled ?? null,
      });
    }
    return map;
  }, [participants]);

  useEffect(() => {
    if (!joined) return;
    const payloadKey = JSON.stringify({
      micEnabled: !isMicMuted,
      cameraEnabled: isCameraOn,
      connectionId,
    });
    if (payloadKey === lastPublishedMediaStatusRef.current) {
      return;
    }
    lastPublishedMediaStatusRef.current = payloadKey;
    void (async () => {
      try {
        const response = await fetch(`/api/events/${encodeURIComponent(eventId)}/media-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(hostToken ? { hostToken } : {}),
            ...(participantToken ? { participantToken } : {}),
            connectionId,
            micEnabled: !isMicMuted,
            cameraEnabled: isCameraOn,
          }),
        });
        if (await isStaleConnectionResponse(response)) {
          onStaleConnection?.();
        }
      } catch {
        // Ignore transient network errors.
      }
    })();
  }, [
    connectionId,
    eventId,
    hostToken,
    isCameraOn,
    isMicMuted,
    joined,
    onStaleConnection,
    participantToken,
  ]);

  useEffect(() => {
    if (!joined) return;
    publishLobbyDeviceWarning();
  }, [joined, isCameraOn, isMicMuted, localParticipant, publishLobbyDeviceWarning]);

  if (error) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-rose-300"
        data-testid="event-lobby-voximplant-error"
      >
        <p>{error}</p>
        {errorDetails ? <p className="text-xs text-slate-400">{errorDetails}</p> : null}
        <button
          type="button"
          className="mt-1 rounded-md border border-slate-500/50 px-3 py-1 text-xs text-slate-200 hover:bg-slate-700/40"
          data-testid="event-lobby-voximplant-retry"
          onClick={() => {
            setError(null);
            setErrorDetails(null);
            void connectRunnerRef.current?.retryNow();
          }}
        >
          {t("events.voxLobbyRetryVideo")}
        </button>
      </div>
    );
  }

  const isReconnectingVideo =
    connectState?.status === "degraded" || connectState?.status === "connecting";

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0f172a]"
      data-testid="event-lobby-voximplant-room"
    >
      {providerFaultSimulation === "healthy-media" ||
      providerFaultSimulation === "media-acquisition" ? (
        <div
          data-testid="event-lobby-media-health"
          data-microphone={isMicMuted ? "unhealthy" : "healthy"}
          data-camera={isCameraOn ? "healthy" : "unhealthy"}
        />
      ) : null}
      {isReconnectingVideo && !joined ? (
        <p
          className="shrink-0 border-b border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-xs text-slate-300"
          data-testid="event-lobby-video-connecting"
        >
          {connectState?.status === "degraded"
            ? t("events.voxLobbyRetryingVideo")
            : t("events.voxLobbyConnectingVideo")}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {sortedParticipants.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-slate-400">{status || t("common.loading")}</div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 content-start justify-items-center gap-3 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
            {sortedParticipants.map((participant) => {
              const isLocal = participant.id === "local";
              const explicit = isLocal
                ? { micEnabled: !isMicMuted, cameraEnabled: isCameraOn }
                : remoteExplicitStatusByIdentity.get(
                    normalizeProviderUsername(participant.endpointUsername) ??
                      normalizeProviderUsername(participant.identityKey) ??
                      participant.identityKey,
                  ) ?? { micEnabled: null, cameraEnabled: null };
              return (
                <EventLobbyVoxVideoTile
                  key={participant.id}
                  participant={participant}
                  muted={isLocal}
                  {...(isLocal ? { subtitle: t("common.you") } : {})}
                  isSpeaking={activeSpeakerId === participant.id}
                  explicitMicEnabled={explicit.micEnabled}
                  explicitCameraEnabled={explicit.cameraEnabled}
                />
              );
            })}
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-slate-800 bg-slate-900 px-3 py-2">
        <VoximplantMediaControls
          joined={joined}
          busy={isBusy}
          micState={isMicMuted ? "off" : "on"}
          cameraState={cameraUnavailable ? "locked" : isCameraOn ? "on" : "off"}
          onToggleMic={() => void toggleMic()}
          onToggleCamera={() => void toggleCamera()}
          statusText={status || null}
          testIdPrefix="vox-lobby"
        />
      </div>
    </div>
  );
});
