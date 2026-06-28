"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type RoleOption = {
  id: "participant_a" | "participant_b" | "facilitator";
  label: string;
};

type AccessPayload = {
  role: RoleOption["id"];
  roleLabel: string;
  username: string;
  password: string;
  connectionNode: string;
  conferenceName: string;
  applicationName: string;
  accountName: string;
  scenarioName: string;
  ruleName: string;
  isProductionSafe: boolean;
  loginMode: string;
};

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

type VoxRendererBase = {
  clear: () => void;
};

type VoxVideoRenderer = VoxRendererBase & {
  getElement: () => HTMLVideoElement;
  mirror: () => void;
};

type VoxAudioRenderer = VoxRendererBase & {
  getElement: () => HTMLAudioElement;
};

type VoxRendererInfo = {
  renderer: VoxRendererBase;
  holder: HTMLElement;
  badgeEl?: HTMLDivElement;
  labelBase?: string;
};

type VoxEndpointMediaEvent = {
  payload?: {
    stream?: VoxStream;
  };
};

type VoxEndpoint = {
  id: string;
  voiceActivityDetected: VoxWatchable<boolean>;
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
    code?: number;
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
  removeStream: (stream: VoxStream) => Promise<void>;
  muteMicrophone: () => void;
  unmuteMicrophone: () => void;
  voiceActivityDetected: VoxWatchable<boolean>;
  isMicrophoneMuted: VoxWatchable<boolean>;
  endpoints: VoxWatchable<Map<string, VoxEndpoint>>;
};

type VoxStreamModule = {
  rendererManager: {
    createVideoRenderer: (stream: VoxStream) => VoxVideoRenderer;
    createAudioRenderer: (stream: VoxStream) => VoxAudioRenderer;
  };
  streamManager: {
    createAudioStream: (config: { audioProcessing: boolean }) => Promise<VoxStream>;
    createVideoStream: (config: unknown) => Promise<VoxStream>;
  };
};

type VoxConferenceManager = {
  createConference: (options: {
    conferenceName: string;
    muteAudio: boolean;
    reportStats: boolean;
  }) => VoxConference;
};

type VoxCore = {
  registerModules: (modules: unknown[]) => void;
  getModule: (token: unknown) => unknown;
  client: {
    connect: (options: { node: string }) => Promise<unknown>;
    login: (options: { username: string; password: string }) => Promise<unknown>;
    disconnect: () => Promise<unknown>;
    state: VoxWatchable<string>;
  };
};

type SdkState = {
  core: VoxCore;
  conference: VoxConference | null;
  streamModule: VoxStreamModule;
  localAudioStream: VoxStream | null;
  localVideoStream: VoxStream | null;
  localVideoRenderer: VoxVideoRenderer | null;
  remoteRenderers: Map<string, VoxRendererInfo>;
  endpointSubscriptions: Map<
    string,
    {
      endpoint: VoxEndpoint;
      onRemoteMediaAdded: (event: VoxEndpointMediaEvent) => void;
      onRemoteMediaRemoved: (event: VoxEndpointMediaEvent) => void;
      stopVoiceActivityWatch?: () => void;
    }
  >;
  conferenceListeners: {
    onConnected: (event: VoxConferenceEvent) => void;
    onFailed: (event: VoxConferenceEvent) => void;
    onDisconnected: (event: VoxConferenceEvent) => void;
    onEndpointAdded: (event: VoxConferenceEvent) => void;
    onEndpointRemoved: (event: VoxConferenceEvent) => void;
  } | null;
  unwatchers: Array<() => void>;
};

const ROLE_OPTIONS: RoleOption[] = [
  { id: "participant_a", label: "Participant A" },
  { id: "participant_b", label: "Participant B" },
  { id: "facilitator", label: "Facilitator" },
];

function isVideoType(type: unknown): boolean {
  return type === "video" || type === "screen_video";
}

function isAudioType(type: unknown): boolean {
  return type === "audio" || type === "screen_audio";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown Voximplant error.";
}

function getAudioTrack(stream: VoxStream | null): MediaStreamTrack | null {
  if (!stream) return null;
  if (stream.track?.kind === "audio") return stream.track;
  return stream.sourceStream?.getAudioTracks()[0] ?? null;
}

function getVideoTrack(stream: VoxStream | null): MediaStreamTrack | null {
  if (!stream) return null;
  if (stream.track?.kind === "video") return stream.track;
  return stream.sourceStream?.getVideoTracks()[0] ?? null;
}

export default function VoximplantTestClient() {
  const [selectedRole, setSelectedRole] = useState<RoleOption["id"]>("participant_a");
  const [roleLabel, setRoleLabel] = useState<string>("Participant A");
  const [status, setStatus] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);
  const [conferenceName, setConferenceName] = useState<string>("");
  const [joined, setJoined] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraSending, setIsCameraSending] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);

  const localVideoHostRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoHostRef = useRef<HTMLDivElement | null>(null);
  const hiddenAudioHostRef = useRef<HTMLDivElement | null>(null);
  const sdkRef = useRef<SdkState | null>(null);

  const selectedRoleLabel = useMemo(
    () => ROLE_OPTIONS.find((item) => item.id === selectedRole)?.label ?? selectedRole,
    [selectedRole],
  );

  const mountRenderer = useCallback((stream: VoxStream, kind: "local" | "remote") => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    const rendererManager = sdk.streamModule.rendererManager;

    if (sdk.remoteRenderers.has(stream.id)) {
      return;
    }

    if (isVideoType(stream.type)) {
      const renderer = rendererManager.createVideoRenderer(stream);
      const el = renderer.getElement();
      el.className =
        "aspect-video w-full rounded border border-slate-600 bg-slate-950 object-cover";
      if (kind === "local") {
        renderer.mirror();
      }
      const holder = document.createElement("div");
      holder.className = "space-y-1";
      const badge = document.createElement("div");
      badge.className = "text-xs text-slate-400";
      badge.textContent = kind === "local" ? "Local preview" : `Remote stream: ${stream.id}`;
      holder.appendChild(badge);
      holder.appendChild(el);

      if (kind === "local") {
        localVideoHostRef.current?.replaceChildren(holder);
        sdk.localVideoRenderer = renderer;
      } else {
        remoteVideoHostRef.current?.appendChild(holder);
      }

      sdk.remoteRenderers.set(stream.id, {
        renderer,
        holder,
        badgeEl: kind === "remote" ? badge : undefined,
        labelBase: kind === "remote" ? `Remote stream: ${stream.id}` : undefined,
      });
      return;
    }

    if (isAudioType(stream.type) && kind === "remote") {
      const renderer = rendererManager.createAudioRenderer(stream);
      const el = renderer.getElement();
      el.autoplay = true;
      hiddenAudioHostRef.current?.appendChild(el);
      sdk.remoteRenderers.set(stream.id, { renderer, holder: el });
    }
  }, []);

  const unmountRenderer = useCallback((streamId: string) => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    const rendererInfo = sdk.remoteRenderers.get(streamId);
    if (!rendererInfo) return;
    rendererInfo.renderer.clear();
    rendererInfo.holder.remove();
    sdk.remoteRenderers.delete(streamId);
  }, []);

  const updateEndpointSpeaking = useCallback((endpoint: VoxEndpoint, speaking: boolean) => {
    const sdk = sdkRef.current;
    if (!sdk) return;

    for (const stream of endpoint.getAnyVideoStreams()) {
      const rendererInfo = sdk.remoteRenderers.get(stream.id);
      if (!rendererInfo) continue;

      if (speaking) {
        rendererInfo.holder.classList.add("ring-2", "ring-emerald-400");
      } else {
        rendererInfo.holder.classList.remove("ring-2", "ring-emerald-400");
      }

      if (rendererInfo.badgeEl && rendererInfo.labelBase) {
        rendererInfo.badgeEl.textContent = speaking
          ? `${rendererInfo.labelBase} • Speaking`
          : rendererInfo.labelBase;
      }
    }
  }, []);

  const subscribeEndpoint = useCallback(
    (endpoint: VoxEndpoint) => {
      const sdk = sdkRef.current;
      if (!sdk || sdk.endpointSubscriptions.has(endpoint.id)) return;

      const onRemoteMediaAdded = (event: VoxEndpointMediaEvent) => {
        const stream = event.payload?.stream;
        if (!stream) return;
        mountRenderer(stream, "remote");
        updateEndpointSpeaking(endpoint, endpoint.voiceActivityDetected.value);
      };
      const onRemoteMediaRemoved = (event: VoxEndpointMediaEvent) => {
        const stream = event.payload?.stream;
        if (!stream) return;
        unmountRenderer(stream.id);
      };

      endpoint.addEventListener("RemoteMediaAdded", onRemoteMediaAdded);
      endpoint.addEventListener("RemoteMediaRemoved", onRemoteMediaRemoved);

      for (const stream of endpoint.getAnyAudioStreams()) {
        mountRenderer(stream, "remote");
      }
      for (const stream of endpoint.getAnyVideoStreams()) {
        mountRenderer(stream, "remote");
      }

      const stopVoiceActivityWatch = endpoint.voiceActivityDetected.watch((speaking) => {
        updateEndpointSpeaking(endpoint, speaking);
      });
      updateEndpointSpeaking(endpoint, endpoint.voiceActivityDetected.value);

      sdk.endpointSubscriptions.set(endpoint.id, {
        endpoint,
        onRemoteMediaAdded,
        onRemoteMediaRemoved,
        stopVoiceActivityWatch,
      });
    },
    [mountRenderer, unmountRenderer, updateEndpointSpeaking],
  );

  const unsubscribeEndpoint = useCallback((endpointId: string) => {
    const sdk = sdkRef.current;
    if (!sdk) return;
    const subscription = sdk.endpointSubscriptions.get(endpointId);
    if (!subscription) return;
    subscription.endpoint.removeEventListener(
      "RemoteMediaAdded",
      subscription.onRemoteMediaAdded,
    );
    subscription.endpoint.removeEventListener(
      "RemoteMediaRemoved",
      subscription.onRemoteMediaRemoved,
    );
    subscription.stopVoiceActivityWatch?.();
    for (const stream of subscription.endpoint.getAnyAudioStreams()) {
      unmountRenderer(stream.id);
    }
    for (const stream of subscription.endpoint.getAnyVideoStreams()) {
      unmountRenderer(stream.id);
    }
    sdk.endpointSubscriptions.delete(endpointId);
  }, [unmountRenderer]);

  const cleanup = useCallback(async () => {
    const sdk = sdkRef.current;
    if (!sdk) return;

    for (const endpointId of sdk.endpointSubscriptions.keys()) {
      unsubscribeEndpoint(endpointId);
    }

    if (sdk.conference && sdk.conferenceListeners) {
      sdk.conference.removeEventListener("Connected", sdk.conferenceListeners.onConnected);
      sdk.conference.removeEventListener("Failed", sdk.conferenceListeners.onFailed);
      sdk.conference.removeEventListener(
        "Disconnected",
        sdk.conferenceListeners.onDisconnected,
      );
      sdk.conference.removeEventListener(
        "EndpointAdded",
        sdk.conferenceListeners.onEndpointAdded,
      );
      sdk.conference.removeEventListener(
        "EndpointRemoved",
        sdk.conferenceListeners.onEndpointRemoved,
      );
    }

    for (const fn of sdk.unwatchers) {
      fn();
    }
    sdk.unwatchers.length = 0;

    for (const [, rendererInfo] of sdk.remoteRenderers) {
      rendererInfo.renderer.clear();
      rendererInfo.holder.remove();
    }
    sdk.remoteRenderers.clear();

    if (sdk.localVideoRenderer) {
      sdk.localVideoRenderer.clear();
      sdk.localVideoRenderer = null;
    }
    localVideoHostRef.current?.replaceChildren();
    remoteVideoHostRef.current?.replaceChildren();
    hiddenAudioHostRef.current?.replaceChildren();

    if (sdk.conference) {
      try {
        sdk.conference.hangup();
      } catch {
        // ignore local cleanup errors
      }
    }

    if (sdk.localAudioStream) {
      sdk.localAudioStream.close?.();
    }
    if (sdk.localVideoStream) {
      sdk.localVideoStream.close?.();
    }

    try {
      await sdk.core.client.disconnect();
    } catch {
      // ignore disconnect errors during teardown
    }

    sdkRef.current = null;
    setJoined(false);
    setIsMicMuted(false);
    setIsCameraSending(false);
    setIsLocalSpeaking(false);
    setStatus("Disconnected");
  }, [unsubscribeEndpoint]);

  const join = useCallback(async () => {
    setError(null);
    setStatus("Requesting access data...");

    const response = await fetch("/api/voximplant-test/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: selectedRole }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `Access request failed (${response.status}).`);
    }

    const access = (await response.json()) as AccessPayload;
    setRoleLabel(access.roleLabel);
    setConferenceName(access.conferenceName);
    setStatus("Initializing Voximplant SDK...");

    const [{ Core, ConnectionNode }, conferenceModule, streamModulePackage] =
      await Promise.all([
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
      // Modules can already be registered when reconnecting in same tab.
    }

    const conferenceManager = core.getModule(
      conferenceModule.conferenceToken,
    ) as VoxConferenceManager | undefined;
    const streamModule = core.getModule(
      streamModulePackage.streamToken,
    ) as VoxStreamModule | undefined;
    if (!conferenceManager || !streamModule) {
      throw new Error("Failed to load Voximplant conference modules.");
    }

    const sdkState: SdkState = {
      core,
      conference: null,
      streamModule,
      localAudioStream: null,
      localVideoStream: null,
      localVideoRenderer: null,
      remoteRenderers: new Map(),
      endpointSubscriptions: new Map(),
      conferenceListeners: null,
      unwatchers: [],
    };
    sdkRef.current = sdkState;

    const connectionNode =
      (ConnectionNode as Record<string, string>)[access.connectionNode] ||
      ConnectionNode.NODE_1;

    setStatus(`Connecting to Voximplant Cloud (${connectionNode})...`);
    await core.client.connect({ node: connectionNode });

    setStatus(`Logging in as ${access.roleLabel}...`);
    await core.client.login({
      username: access.username,
      password: access.password,
    });

    setStatus("Acquiring media devices...");
    const localAudioStream = await streamModule.streamManager.createAudioStream({
      audioProcessing: true,
    });
    const localVideoStream = await streamModule.streamManager.createVideoStream(
      streamModulePackage.VideoQuality.Medium,
    );

    sdkState.localAudioStream = localAudioStream;
    sdkState.localVideoStream = localVideoStream;
    mountRenderer(localVideoStream, "local");

    const conference = conferenceManager.createConference({
      conferenceName: access.conferenceName,
      muteAudio: access.role === "facilitator",
      reportStats: true,
    });
    sdkState.conference = conference;

    const onConnected = () => {
      setStatus("Connected to conference.");
      setJoined(true);
      setIsMicMuted(conference.isMicrophoneMuted.value);
      const localVideoTrack = getVideoTrack(localVideoStream);
      setIsCameraSending(localVideoTrack ? localVideoTrack.enabled : true);
    };
    const onFailed = (event: VoxConferenceEvent) => {
      setStatus("Conference failed.");
      setError(
        `Conference error ${event.payload?.code ?? "unknown"}: ${
          event.payload?.reason ?? "No reason provided."
        }`,
      );
    };
    const onDisconnected = (event: VoxConferenceEvent) => {
      setStatus(`Conference disconnected: ${event.payload?.reason ?? "unknown"}`);
      setJoined(false);
    };
    const onEndpointAdded = (event: VoxConferenceEvent) => {
      const endpointId = event.payload?.newEndpointId;
      if (!endpointId) return;
      const endpoint = conference.endpoints.value.get(endpointId);
      if (endpoint) {
        subscribeEndpoint(endpoint);
      }
    };
    const onEndpointRemoved = (event: VoxConferenceEvent) => {
      const endpointId = event.payload?.removedEndpointId;
      if (!endpointId) return;
      unsubscribeEndpoint(endpointId);
    };

    sdkState.conferenceListeners = {
      onConnected,
      onFailed,
      onDisconnected,
      onEndpointAdded,
      onEndpointRemoved,
    };

    conference.addEventListener("Connected", onConnected);
    conference.addEventListener("Failed", onFailed);
    conference.addEventListener("Disconnected", onDisconnected);
    conference.addEventListener("EndpointAdded", onEndpointAdded);
    conference.addEventListener("EndpointRemoved", onEndpointRemoved);

    sdkState.unwatchers.push(
      conference.isMicrophoneMuted.watch((next) => setIsMicMuted(next)),
    );
    sdkState.unwatchers.push(
      conference.voiceActivityDetected.watch((next) => setIsLocalSpeaking(next)),
    );
    sdkState.unwatchers.push(
      core.client.state.watch((next) => setStatus(`Client state: ${next}`)),
    );

    await conference.addStream(localAudioStream);
    await conference.addStream(localVideoStream);
    setStatus("Joining conference...");
    await conference.join();

    // Attach already-connected endpoints after join completes.
    for (const endpoint of conference.endpoints.value.values()) {
      subscribeEndpoint(endpoint);
    }
  }, [mountRenderer, selectedRole, subscribeEndpoint, unsubscribeEndpoint]);

  const handleJoin = useCallback(async () => {
    if (sdkRef.current) {
      await cleanup();
    }
    try {
      await join();
    } catch (joinError) {
      setError(toErrorMessage(joinError));
      setStatus("Join failed");
      await cleanup();
    }
  }, [cleanup, join]);

  const toggleMute = useCallback(() => {
    const sdk = sdkRef.current;
    if (!sdk?.conference) return;

    const nextMuted = !isMicMuted;
    const audioTrack = getAudioTrack(sdk.localAudioStream);
    if (audioTrack) {
      audioTrack.enabled = !nextMuted;
    }

    if (nextMuted) {
      sdk.conference.muteMicrophone();
    } else {
      sdk.conference.unmuteMicrophone();
    }

    setIsMicMuted(nextMuted);
    setStatus(nextMuted ? "Microphone muted." : "Microphone unmuted.");
    setError(null);
  }, [isMicMuted]);

  const toggleCamera = useCallback(() => {
    const sdk = sdkRef.current;
    if (!sdk?.localVideoStream) return;

    const nextCameraEnabled = !isCameraSending;
    const videoTrack = getVideoTrack(sdk.localVideoStream);
    if (!videoTrack) {
      setError("Unable to toggle camera track. Rejoin conference and try again.");
      return;
    }

    videoTrack.enabled = nextCameraEnabled;
    setIsCameraSending(nextCameraEnabled);
    setStatus(nextCameraEnabled ? "Camera enabled." : "Camera disabled.");
    setError(null);
  }, [isCameraSending]);

  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, [cleanup]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6 text-slate-100">
      <div className="rounded-lg border border-amber-500/60 bg-amber-900/30 p-3 text-sm text-amber-200">
        Local smoke PoC only. This page intentionally uses static test user credentials
        from a local server endpoint and is not production-safe.
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-700 bg-slate-900 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-slate-300">Role</span>
          <select
            className="rounded border border-slate-600 bg-slate-950 px-3 py-2"
            value={selectedRole}
            onChange={(event) =>
              setSelectedRole(event.target.value as RoleOption["id"])
            }
            disabled={joined}
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role.id} value={role.id}>
                {role.label}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-1 text-sm">
          <p>
            <span className="text-slate-400">Selected role:</span>{" "}
            <strong>{joined ? roleLabel : selectedRoleLabel}</strong>
          </p>
          <p>
            <span className="text-slate-400">Conference:</span>{" "}
            <code>{conferenceName || "will be requested from API"}</code>
          </p>
          <p>
            <span className="text-slate-400">Status:</span> {status}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <button
            type="button"
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void handleJoin()}
          >
            Join conference
          </button>
          <button
            type="button"
            className="rounded bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void cleanup()}
            disabled={!joined}
          >
            Leave
          </button>
          <button
            type="button"
            className="rounded bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={toggleMute}
            disabled={!joined}
          >
            {isMicMuted ? "Unmute audio" : "Mute audio"}
          </button>
          <button
            type="button"
            className="rounded bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void toggleCamera()}
            disabled={!joined}
          >
            {isCameraSending ? "Camera off" : "Camera on"}
          </button>
          <p className="text-xs text-slate-400">
            Facilitator role requests join with muted microphone by default.
          </p>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-rose-500 bg-rose-950/40 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
            Local video
          </h2>
          <p className="mb-2 text-xs text-slate-400">
            Local voice: {isLocalSpeaking ? "Speaking" : "Silent"}
          </p>
          <div ref={localVideoHostRef} className="space-y-2" />
        </section>

        <section className="rounded-lg border border-slate-700 bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
            Remote participants
          </h2>
          <div
            ref={remoteVideoHostRef}
            className="grid gap-3 sm:grid-cols-2"
            aria-live="polite"
          />
          <div ref={hiddenAudioHostRef} className="hidden" />
        </section>
      </div>
    </div>
  );
}
