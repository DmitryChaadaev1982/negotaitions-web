"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VoximplantMediaControls } from "@/components/voximplant-media-controls";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  registerVoxClientDisconnect,
  waitForVoxClientIdle,
} from "@/lib/voximplant/browser-client-lifecycle";
import {
  installVoxCameraErrorSuppressor,
  installVoxRuntimeErrorSuppressor,
  isAlreadyExistsStreamError,
  isRecoverableVoxMediaError,
  toVoxErrorMessage,
} from "@/lib/voximplant/media-error-utils";

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
  displayName: string;
  stream: MediaStream | null;
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
  onDeviceWarning?: (message: string | null) => void;
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
  conferenceListeners: {
    onConnected: (event: VoxConferenceEvent) => void;
    onFailed: (event: VoxConferenceEvent) => void;
    onDisconnected: (event: VoxConferenceEvent) => void;
    onEndpointAdded: (event: VoxConferenceEvent) => void;
    onEndpointRemoved: (event: VoxConferenceEvent) => void;
  } | null;
};

function normalizeEndpointIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function toErrorMessage(error: unknown): string {
  return toVoxErrorMessage(error);
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

function EventLobbyVoxVideoTile({ participant, muted }: { participant: VoxLobbyParticipant; muted: boolean }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = participant.stream;
  }, [participant.stream]);

  return (
    <div className="relative aspect-video w-full max-w-[420px] overflow-hidden rounded-xl border border-slate-600/30 bg-slate-900 shadow-lg">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="h-full w-full bg-slate-950 object-cover"
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 py-2">
        <p className="truncate text-sm font-medium text-white">{participant.displayName}</p>
      </div>
    </div>
  );
}

export const EventLobbyVoximplantRoom = memo(function EventLobbyVoximplantRoom({
  eventId,
  hostToken,
  participantToken,
  connectionId,
  onDeviceWarning,
}: EventLobbyVoximplantRoomProps) {
  const { t } = useI18n();
  const runtimeRef = useRef<RuntimeState | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [localParticipant, setLocalParticipant] = useState<VoxLobbyParticipant | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<VoxLobbyParticipant[]>([]);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const detachRemoteAudioStreams = useCallback((endpointId: string) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const prefix = `${endpointId}-`;
    for (const [key, audio] of runtime.remoteAudioElements) {
      if (key.startsWith(prefix)) {
        audio.pause();
        audio.srcObject = null;
        runtime.remoteAudioElements.delete(key);
      }
    }
  }, []);

  const cleanup = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    for (const audio of runtime.remoteAudioElements.values()) {
      audio.pause();
      audio.srcObject = null;
    }
    runtime.remoteAudioElements.clear();

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

    stopVoxStreamTracks(runtime.localAudioStream);
    stopVoxStreamTracks(runtime.localVideoStream);
    runtime.localAudioStream?.close?.();
    runtime.localVideoStream?.close?.();

    await registerVoxClientDisconnect(runtime.core.client.disconnect());

    runtimeRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const restoreRuntimeSuppressor = installVoxRuntimeErrorSuppressor();

    const upsertRemote = (next: VoxLobbyParticipant) => {
      setRemoteParticipants((current) => {
        const idx = current.findIndex((item) => item.id === next.id);
        if (idx === -1) return [...current, next];
        const copy = [...current];
        copy[idx] = next;
        return copy;
      });
    };

    const join = async () => {
      setError(null);
      setErrorDetails(null);
      setStatus(t("events.voxLobbyAuthorizing"));

      try {
        setStatus(t("events.voxLobbyWaitingForPreviousDisconnect"));
        await waitForVoxClientIdle();
        if (cancelled || !mountedRef.current) return;

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
        if (cancelled || !mountedRef.current) return;
        const initialPayload = (await initialResponse.json().catch(() => ({}))) as AccessPayload & {
          code?: string;
        };
        if (!initialResponse.ok) {
          throw new Error(initialPayload.error ?? `Vox access failed (${initialResponse.status}).`);
        }
        if (
          initialPayload.provider !== "voximplant" ||
          initialPayload.credentials.status !== "one_time_key_required"
        ) {
          throw new Error("Unexpected Vox lobby access payload.");
        }

        const [{ Core }, conferenceModule, streamModulePackage] = await Promise.all([
          import("@voximplant/websdk"),
          import("@voximplant/websdk/modules/conference-manager"),
          import("@voximplant/websdk/modules/stream"),
        ]);
        if (cancelled || !mountedRef.current) return;
        const core = Core.init({}) as unknown as VoxCore;
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

        await core.client.connect({});
        if (cancelled || !mountedRef.current) return;
        const oneTimeKey = await core.client.requestOneTimeKey({
          username: initialPayload.user.sdkUsername,
        });
        if (cancelled || !mountedRef.current) return;
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
        if (cancelled || !mountedRef.current) return;
        const readyPayload = (await readyResponse.json().catch(() => ({}))) as AccessPayload;
        if (!readyResponse.ok) {
          throw new Error(readyPayload.error ?? `Vox access failed (${readyResponse.status}).`);
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
        if (cancelled || !mountedRef.current) return;

        let localAudioStream: VoxStream | null = null;
        let localVideoStream: VoxStream | null = null;
        try {
          localAudioStream = await streamModule.streamManager.createAudioStream({
            audioProcessing: true,
          });
        } catch (audioError) {
          if (isRecoverableMediaError(audioError)) {
            onDeviceWarning?.("microphoneUnavailable");
          } else {
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
            onDeviceWarning?.("cameraBusyOrUnavailable");
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
          conferenceListeners: null,
        };
        runtimeRef.current = runtime;

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
          void audio.play().catch(() => {});
        };

        const applyRemoteVideo = (endpoint: VoxEndpoint) => {
          const stream = endpoint.getAnyVideoStreams()[0] ?? null;
          const identityKey = normalizeEndpointIdentity(
            endpoint.userName || endpoint.displayName || endpoint.id,
          );
          upsertRemote({
            id: endpoint.id,
            identityKey,
            displayName: endpoint.displayName || endpoint.userName || endpoint.id,
            stream: streamToMediaStream(stream),
            updatedAtMs: Date.now(),
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
        setLocalParticipant({
          id: "local",
          identityKey: normalizeEndpointIdentity(
            readyPayload.user.sdkUsername || readyPayload.user.displayName || "local",
          ),
          displayName: readyPayload.user.displayName,
          stream: streamToMediaStream(localVideoStream),
          updatedAtMs: Date.now(),
        });

        for (const endpoint of conference.endpoints.value.values()) {
          subscribeEndpoint(endpoint);
        }
      } catch (joinError) {
        const details = toErrorMessage(joinError);
        console.error("[EventLobbyVox] connect failed:", joinError);
        setError(t("events.voxLobbyUnableToConnect"));
        setErrorDetails(details);
        setStatus(t("events.voxLobbyUnableToConnect"));
        await cleanup();
      }
    };

    void join();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      restoreRuntimeSuppressor();
      void cleanup();
    };
  }, [
    cleanup,
    connectionId,
    detachRemoteAudioStreams,
    eventId,
    hostToken,
    onDeviceWarning,
    participantToken,
    t,
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
        }
      } else {
        const track = streamToMediaStream(runtime.localAudioStream)?.getAudioTracks()[0] ?? null;
        if (track) {
          track.enabled = false;
        }
        runtime.conference.muteMicrophone();
        setIsMicMuted(true);
      }
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, isMicMuted]);

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
        if (nextOn) {
          setCameraUnavailable(false);
          onDeviceWarning?.(null);
        }
      }
    } finally {
      setIsBusy(false);
    }
  }, [isBusy, isCameraOn, onDeviceWarning]);

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

  if (error) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-rose-300"
        data-testid="event-lobby-voximplant-error"
      >
        <p>{error}</p>
        {errorDetails ? <p className="text-xs text-slate-400">{errorDetails}</p> : null}
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden bg-[#0f172a]"
      data-testid="event-lobby-voximplant-room"
    >
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        {sortedParticipants.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-slate-400">{status || t("common.loading")}</div>
        ) : (
          <div className="grid h-full min-h-0 grid-cols-1 content-start justify-items-center gap-3 overflow-auto sm:grid-cols-2 xl:grid-cols-3">
            {sortedParticipants.map((participant) => (
              <EventLobbyVoxVideoTile
                key={participant.id}
                participant={participant}
                muted={participant.id === "local"}
              />
            ))}
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
