"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RoleOption = {
  id: "participant_a" | "participant_b" | "facilitator";
  label: string;
};

type AccessPayload = {
  role: RoleOption["id"];
  roleLabel: string;
  username: string;
  password: string;
  /** Empty string = auto node selection. Do NOT default to NODE_1. */
  connectionNode: string;
  conferenceName: string;
  applicationName: string;
  accountName: string;
  scenarioName: string;
  ruleName: string;
  minimalJoinMode: boolean;
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
    text?: string;
  };
};

type VoxConference = {
  addEventListener: (
    eventName:
      | "Connected"
      | "Failed"
      | "Disconnected"
      | "EndpointAdded"
      | "EndpointRemoved"
      | "MessageReceived",
    listener: (event: VoxConferenceEvent) => void,
  ) => void;
  removeEventListener: (
    eventName:
      | "Connected"
      | "Failed"
      | "Disconnected"
      | "EndpointAdded"
      | "EndpointRemoved"
      | "MessageReceived",
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
  sendMessage?: (text: string) => void;
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
    statsReportInterval?: number;
  }) => VoxConference;
};

type VoxCore = {
  registerModules: (modules: unknown[]) => void;
  getModule: (token: unknown) => unknown;
  client: {
    /** Pass an empty object (no node property) for Voximplant SDK auto node selection. */
    connect: (options?: { node?: string }) => Promise<unknown>;
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
  sendMessageSupported: boolean;
  removeMessageListener: (() => void) | null;
};

type RecordingPanelState = {
  mode: "scenario_message_control";
  status:
    | "idle"
    | "starting"
    | "recording"
    | "stopping"
    | "stopped"
    | "not_recording"
    | "error"
    | "api_not_confirmed";
  sendMessageAvailable: boolean;
  lastAction: "start" | "stop" | "status" | null;
  lastRequestId: string | null;
  lastResponseTime: string | null;
  lastScenarioMessage: string | null;
  recordingUrl: string | null;
  recordingId: string | null;
  error: string | null;
};

const INITIAL_RECORDING_PANEL: RecordingPanelState = {
  mode: "scenario_message_control",
  status: "idle",
  sendMessageAvailable: false,
  lastAction: null,
  lastRequestId: null,
  lastResponseTime: null,
  lastScenarioMessage: null,
  recordingUrl: null,
  recordingId: null,
  error: null,
};

function genRequestId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

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

export default function VoximplantTestClient({
  recordingPanelEnabled = false,
}: {
  recordingPanelEnabled?: boolean;
}) {
  const [selectedRole, setSelectedRole] = useState<RoleOption["id"]>("participant_a");
  const [roleLabel, setRoleLabel] = useState<string>("Participant A");
  const [status, setStatus] = useState<string>("Idle");
  const [error, setError] = useState<string | null>(null);
  const [conferenceName, setConferenceName] = useState<string>("");
  const [joined, setJoined] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCameraSending, setIsCameraSending] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);

  // Diagnostics state — safe values only, never shows password or tokens
  const [safeUsername, setSafeUsername] = useState<string>("");
  const [userDomain, setUserDomain] = useState<string>("");
  const [applicationName, setApplicationName] = useState<string>("");
  const [configuredNode, setConfiguredNode] = useState<string>("");
  const [connectedNode, setConnectedNode] = useState<string>("");
  const [lastSdkEvent, setLastSdkEvent] = useState<string>("—");
  const [lastErrorCode, setLastErrorCode] = useState<string>("");
  const [lastErrorPhase, setLastErrorPhase] = useState<string>("");

  // Recording panel state — only used when recordingPanelEnabled=true and role=facilitator
  const [recordingPanel, setRecordingPanel] = useState<RecordingPanelState>(INITIAL_RECORDING_PANEL);

  const localVideoHostRef = useRef<HTMLDivElement | null>(null);
  const remoteVideoHostRef = useRef<HTMLDivElement | null>(null);
  const hiddenAudioHostRef = useRef<HTMLDivElement | null>(null);
  const sdkRef = useRef<SdkState | null>(null);
  // Ref-based joining guard prevents double-join race during async handshake
  const isJoiningRef = useRef(false);
  // Timeout for recording command replies — cleared when scenario responds
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedRoleLabel =
    ROLE_OPTIONS.find((item) => item.id === selectedRole)?.label ?? selectedRole;

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

  const handleScenarioMessage = useCallback((event: VoxConferenceEvent) => {
    try {
      const text =
        event.payload?.text ??
        (event as unknown as { text?: string }).text ??
        "";
      if (!text) return;
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const msg = parsed as Record<string, unknown>;
      if (msg.type !== "recording_status") return;

      const rawStatus = String(msg.status ?? "");
      const message = String(msg.message ?? "");
      const requestId = msg.requestId ? String(msg.requestId) : null;
      const recUrl = msg.recordingUrl ? String(msg.recordingUrl) : null;
      const recId = msg.recordingId ? String(msg.recordingId) : null;

      const panelStatus: RecordingPanelState["status"] =
        rawStatus === "recording" ? "recording" :
        rawStatus === "stopped" ? "stopped" :
        rawStatus === "starting" ? "starting" :
        rawStatus === "stopping" ? "stopping" :
        rawStatus === "not_recording" ? "not_recording" :
        rawStatus === "error" || rawStatus === "failed" ? "error" :
        "idle";

      // Clear the command timeout whenever any matching reply arrives
      const isTerminal = panelStatus === "recording" || panelStatus === "stopped";
      setRecordingPanel((prev) => {
        // Stale requestId guard: ignore intermediate statuses from old requests,
        // but always accept terminal states (recording, stopped) and errors.
        if (
          requestId &&
          prev.lastRequestId &&
          requestId !== prev.lastRequestId &&
          !isTerminal &&
          panelStatus !== "error"
        ) {
          return prev;
        }

        // A real response arrived — clear the client-side timeout
        if (recordingTimeoutRef.current !== null) {
          clearTimeout(recordingTimeoutRef.current);
          recordingTimeoutRef.current = null;
        }

        return {
          ...prev,
          status: panelStatus,
          lastRequestId: requestId ?? prev.lastRequestId,
          lastResponseTime: new Date().toISOString(),
          lastScenarioMessage: message || rawStatus,
          recordingUrl: recUrl ?? prev.recordingUrl,
          recordingId: recId ?? prev.recordingId,
          error: panelStatus === "error" ? (message || "Recording error from scenario") : null,
        };
      });
      setLastSdkEvent(`Scenario: ${rawStatus}`);
    } catch {
      // Ignore non-JSON or unexpected messages silently
    }
  }, []);

  const handleSendRecordingCommand = useCallback(
    (action: "start" | "stop" | "status") => {
      const sdk = sdkRef.current;
      if (!sdk?.conference) {
        setRecordingPanel((prev) => ({
          ...prev,
          error: "Not connected to conference. Join first.",
        }));
        return;
      }

      const conf = sdk.conference;
      if (typeof conf.sendMessage !== "function") {
        setRecordingPanel((prev) => ({
          ...prev,
          sendMessageAvailable: false,
          status: "api_not_confirmed",
          error:
            "conference.sendMessage() is not available on this SDK object. " +
            "Scenario message-based recording control is unavailable. " +
            "Check @voximplant/websdk version or enable RECORDING_AUTOSTART in the scenario.",
        }));
        return;
      }

      const requestId = genRequestId();
      const msg = JSON.stringify({ type: "recording_control", action, requestId });
      try {
        conf.sendMessage(msg);
        setRecordingPanel((prev) => ({
          ...prev,
          lastAction: action,
          lastRequestId: requestId,
          lastScenarioMessage: null,
          lastResponseTime: null,
          error: null,
          status:
            action === "start" ? "starting" :
            action === "stop" ? "stopping" :
            prev.status,
        }));
        setLastSdkEvent(`Sent: recording_control/${action}`);

        // Start a 15s timeout — if no scenario reply arrives, show a clear error.
        if (action === "start" || action === "stop") {
          if (recordingTimeoutRef.current !== null) {
            clearTimeout(recordingTimeoutRef.current);
          }
          recordingTimeoutRef.current = setTimeout(() => {
            recordingTimeoutRef.current = null;
            setRecordingPanel((prev) => {
              // Only fire if still waiting (starting/stopping with this requestId)
              if (
                prev.lastRequestId !== requestId ||
                (prev.status !== "starting" && prev.status !== "stopping")
              ) {
                return prev;
              }
              return {
                ...prev,
                status: "error",
                error:
                  "No scenario reply received within 15s. " +
                  "Check VoxEngine logs for [neg-conf-rec] recording_control received. " +
                  "If absent, conference.sendMessage() may not be reaching the scenario.",
              };
            });
          }, 15000);
        }
      } catch (sendErr) {
        const errMsg = `sendMessage failed: ${toErrorMessage(sendErr)}`;
        setRecordingPanel((prev) => ({ ...prev, error: errMsg }));
      }
    },
    [],
  );

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

    sdk.removeMessageListener?.();
    sdk.removeMessageListener = null;

    if (recordingTimeoutRef.current !== null) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
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
    setLastSdkEvent("—");
    setLastErrorCode("");
    setRecordingPanel(INITIAL_RECORDING_PANEL);
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
    // Set safe diagnostics — access.username is shortUser@userDomain, no password exposed
    setSafeUsername(access.username);
    setUserDomain(access.username.split("@")[1] ?? "");
    setApplicationName(access.applicationName);
    // Empty connectionNode = auto; never show "NODE_1 (default)"
    setConfiguredNode(access.connectionNode || "auto");
    setConnectedNode("");
    setStatus("Initializing Voximplant SDK...");

    const [{ Core, ConnectionNode }, conferenceModule, streamModulePackage] =
      await Promise.all([
        import("@voximplant/websdk"),
        import("@voximplant/websdk/modules/conference-manager"),
        import("@voximplant/websdk/modules/stream"),
      ]);

    // Guard against double-initialization on hot reload or repeated join attempts
    if (sdkRef.current) {
      await cleanup();
    }

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
      sendMessageSupported: false,
      removeMessageListener: null,
    };
    sdkRef.current = sdkState;

    // ── Connect ──────────────────────────────────────────────────────────────
    // If VOXIMPLANT_CONNECTION_NODE is not set (connectionNode is empty), let
    // the SDK auto-select the node. Do NOT fall back to NODE_1 or any fixed
    // node — wrong node is the leading cause of 502 Bad Gateway.
    if (access.connectionNode) {
      const nodeLabel = access.connectionNode.trim().toUpperCase();
      const nodeValue = (ConnectionNode as Record<string, string>)[nodeLabel];
      if (!nodeValue) {
        throw new Error(
          `Unknown VOXIMPLANT_CONNECTION_NODE value: "${nodeLabel}". ` +
          `Remove VOXIMPLANT_CONNECTION_NODE from .env.local to use auto node selection.`,
        );
      }
      setStatus(`Connecting to Voximplant Cloud (node: ${nodeLabel})...`);
      await core.client.connect({ node: nodeValue });
      setConnectedNode(nodeLabel);
      setLastSdkEvent(`Client connected to node ${nodeLabel}`);
    } else {
      // Auto node selection — preferred when node is unknown
      setStatus("Connecting to Voximplant Cloud (auto node)...");
      await core.client.connect({});
      setConnectedNode("auto");
      setLastSdkEvent("Client connected (auto node)");
    }

    // ── Login ────────────────────────────────────────────────────────────────
    setStatus(`Logging in as ${access.roleLabel}...`);
    await core.client.login({
      username: access.username,
      password: access.password,
    });
    setLastSdkEvent(`Logged in as ${access.roleLabel}`);

    // ── Media ────────────────────────────────────────────────────────────────
    setStatus("Acquiring media devices...");
    // audioProcessing:true activates the browser's full WebRTC audio processing
    // pipeline (echo cancellation, noise suppression, auto gain control).
    // The Voximplant WebSDK streamManager.createAudioStream() only exposes this
    // single flag — individual constraints (echoCancellation, noiseSuppression,
    // autoGainControl) are not accessible through this API.
    // Do NOT bypass via getUserMedia() directly — it would create a second,
    // unmanaged audio track that bypasses SDK lifecycle and could break the join flow.
    const localAudioStream = await streamModule.streamManager.createAudioStream({
      audioProcessing: true,
    });
    const localVideoStream = await streamModule.streamManager.createVideoStream(
      streamModulePackage.VideoQuality.Medium,
    );

    sdkState.localAudioStream = localAudioStream;
    sdkState.localVideoStream = localVideoStream;
    mountRenderer(localVideoStream, "local");

    // ── Conference join ──────────────────────────────────────────────────────
    // In minimal mode: use exactly one deterministic conference name, no retry.
    // This ensures all participants always join the same VoxEngine session.
    const resolvedConferenceName = access.conferenceName;
    setConferenceName(resolvedConferenceName);

    const conference = conferenceManager.createConference({
      conferenceName: resolvedConferenceName,
      muteAudio: access.role === "facilitator",
      reportStats: !access.minimalJoinMode,
      statsReportInterval: access.minimalJoinMode ? undefined : 1000,
    });

    let handshakeResolve: (() => void) | null = null;
    let handshakeReject: ((reason: Error) => void) | null = null;
    let settled = false;
    const handshake = new Promise<void>((resolve, reject) => {
      handshakeResolve = resolve;
      handshakeReject = reject;
    });
    const settleOk = () => {
      if (settled) return;
      settled = true;
      handshakeResolve?.();
    };
    const settleFail = (message: string) => {
      if (settled) return;
      settled = true;
      handshakeReject?.(new Error(message));
    };

    const onConnected = () => {
      setStatus("Connected to conference.");
      setLastSdkEvent("Conference Connected");
      setJoined(true);
      setIsMicMuted(conference.isMicrophoneMuted.value);
      const localVideoTrack = getVideoTrack(localVideoStream);
      setIsCameraSending(localVideoTrack ? localVideoTrack.enabled : true);
      settleOk();
    };
    const onFailed = (event: VoxConferenceEvent) => {
      const code = event.payload?.code ?? "unknown";
      const reason = event.payload?.reason ?? "No reason provided.";
      const codeStr = String(code);
      setLastSdkEvent(`Conference Failed (${codeStr})`);
      setLastErrorCode(`${codeStr}: ${reason}`);
      setLastErrorPhase("after-conference-join");
      setStatus(`Conference failed (${codeStr}): ${reason}`);
      settleFail(`Conference error ${codeStr}: ${reason}`);
    };
    const onDisconnected = (event: VoxConferenceEvent) => {
      const reason = event.payload?.reason ?? "unknown";
      setStatus(`Conference disconnected: ${reason}`);
      setLastSdkEvent(`Conference Disconnected: ${reason}`);
      setLastErrorPhase("after-conference-join");
      setJoined(false);
      settleFail(`Conference disconnected: ${reason}`);
    };
    const onEndpointAdded = (event: VoxConferenceEvent) => {
      const endpointId = event.payload?.newEndpointId;
      if (!endpointId) return;
      setLastSdkEvent(`Endpoint Added: ${endpointId.slice(0, 8)}`);
      const endpoint = conference.endpoints.value.get(endpointId);
      if (endpoint) {
        subscribeEndpoint(endpoint);
      }
    };
    const onEndpointRemoved = (event: VoxConferenceEvent) => {
      const endpointId = event.payload?.removedEndpointId;
      if (!endpointId) return;
      setLastSdkEvent(`Endpoint Removed: ${endpointId.slice(0, 8)}`);
      unsubscribeEndpoint(endpointId);
    };

    conference.addEventListener("Connected", onConnected);
    conference.addEventListener("Failed", onFailed);
    conference.addEventListener("Disconnected", onDisconnected);
    conference.addEventListener("EndpointAdded", onEndpointAdded);
    conference.addEventListener("EndpointRemoved", onEndpointRemoved);

    try {
      await conference.addStream(localAudioStream);
      await conference.addStream(localVideoStream);
      setStatus(`Joining conference "${resolvedConferenceName}"...`);
      await conference.join();
      await handshake;

      sdkState.conference = conference;
      sdkState.conferenceListeners = {
        onConnected,
        onFailed,
        onDisconnected,
        onEndpointAdded,
        onEndpointRemoved,
      };

      // ── Recording message wiring ─────────────────────────────────────────
      // Only wire when recording panel is enabled AND role is facilitator.
      // This block must not affect the video-only join flow.
      if (recordingPanelEnabled && access.role === "facilitator") {
        const canSend = typeof conference.sendMessage === "function";
        sdkState.sendMessageSupported = canSend;

        if (canSend) {
          // Try to listen for recording_status replies from VoxEngine
          try {
            const onMsg = (event: VoxConferenceEvent) => handleScenarioMessage(event);
            conference.addEventListener("MessageReceived", onMsg);
            sdkState.removeMessageListener = () => {
              try {
                conference.removeEventListener("MessageReceived", onMsg);
              } catch {
                // ignore cleanup errors
              }
            };
            setLastSdkEvent("Recording: sendMessage available, MessageReceived registered");
          } catch (msgRegErr) {
            // MessageReceived registration failed — we can still send but won't auto-receive replies
            setLastSdkEvent(
              "Recording: sendMessage available, MessageReceived unavailable (" +
              toErrorMessage(msgRegErr) + ")",
            );
          }
        }

        setRecordingPanel((prev) => ({
          ...prev,
          sendMessageAvailable: canSend,
          status: canSend ? "idle" : "api_not_confirmed",
          error: canSend
            ? null
            : "conference.sendMessage() not found on SDK object. " +
              "Scenario message control is unavailable. " +
              "Check @voximplant/websdk version or enable RECORDING_AUTOSTART in the scenario.",
        }));
      }

      sdkState.unwatchers.push(
        conference.isMicrophoneMuted.watch((next) => setIsMicMuted(next)),
      );
      sdkState.unwatchers.push(
        conference.voiceActivityDetected.watch((next) => setIsLocalSpeaking(next)),
      );
      sdkState.unwatchers.push(
        core.client.state.watch((next) => setStatus(`Client state: ${next}`)),
      );

      for (const endpoint of conference.endpoints.value.values()) {
        subscribeEndpoint(endpoint);
      }
    } catch (conferenceError) {
      conference.removeEventListener("Connected", onConnected);
      conference.removeEventListener("Failed", onFailed);
      conference.removeEventListener("Disconnected", onDisconnected);
      conference.removeEventListener("EndpointAdded", onEndpointAdded);
      conference.removeEventListener("EndpointRemoved", onEndpointRemoved);
      throw conferenceError;
    }
  }, [cleanup, handleScenarioMessage, mountRenderer, recordingPanelEnabled, selectedRole, subscribeEndpoint, unsubscribeEndpoint]);

  const handleJoin = useCallback(async () => {
    if (isJoiningRef.current || joined) return;
    isJoiningRef.current = true;
    setIsJoining(true);
    setError(null);
    setLastErrorCode("");
    setLastErrorPhase("");
    try {
      await join();
    } catch (joinError) {
      const msg = toErrorMessage(joinError);
      if (msg.includes("502") || msg.toLowerCase().includes("bad gateway")) {
        setError(
          "502 Bad Gateway — Conference connection refused. " +
          "Check: (1) VoxEngine scenario in Console matches " +
          (recordingPanelEnabled
            ? "docs/voximplant/neg-conf.recording.scenario.js"
            : "docs/voximplant/neg-conf.video-only.baseline.js") +
          ", (2) routing rule negotaitions-conference-rule points to neg-conf, " +
          "(3) VOXIMPLANT_CONNECTION_NODE is unset (auto) in .env.local, " +
          "(4) all users belong to application negotaitions-video-poc. " +
          "See Diagnostics below for details.",
        );
      } else {
        setError(msg);
      }
      setLastErrorPhase((prev) => prev || "before-conference-join");
      setStatus("Join failed — see error above");
      await cleanup();
    } finally {
      isJoiningRef.current = false;
      setIsJoining(false);
    }
  }, [cleanup, join, joined, recordingPanelEnabled]);

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
            disabled={isJoining || joined}
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
            disabled={isJoining || joined}
          >
            {isJoining ? "Connecting…" : "Join conference"}
          </button>
          <button
            type="button"
            className="rounded bg-slate-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void cleanup()}
            disabled={isJoining || !joined}
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
            onClick={toggleCamera}
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

      <details className="rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm">
        <summary className="cursor-pointer select-none font-semibold text-slate-300">
          Diagnostics
        </summary>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-slate-400">Role</dt>
          <dd className="text-slate-200">{joined ? roleLabel : selectedRoleLabel}</dd>
          <dt className="text-slate-400">Username</dt>
          <dd className="break-all font-mono text-slate-200">{safeUsername || "—"}</dd>
          <dt className="text-slate-400">Domain</dt>
          <dd className="font-mono text-slate-200">{userDomain || "—"}</dd>
          <dt className="text-slate-400">Application</dt>
          <dd className="font-mono text-slate-200">{applicationName || "—"}</dd>
          <dt className="text-slate-400">Conference</dt>
          <dd className="font-mono text-slate-200">{conferenceName || "—"}</dd>
          <dt className="text-slate-400">Configured node</dt>
          <dd className="font-mono text-slate-200">{configuredNode || "auto (unset)"}</dd>
          <dt className="text-slate-400">Connected node</dt>
          <dd className="font-mono text-slate-200">{connectedNode || "—"}</dd>
          <dt className="text-slate-400">Scenario in use</dt>
          <dd className="font-mono text-slate-200">
            {recordingPanelEnabled
              ? "neg-conf.recording.scenario.js (recording enabled)"
              : "neg-conf.video-only.baseline.js (video-only baseline)"}
          </dd>
          <dt className="text-slate-400">Recording panel</dt>
          <dd className="font-mono text-slate-200">
            {recordingPanelEnabled ? "enabled (VOXIMPLANT_RECORDING_PANEL_ENABLED=true)" : "disabled (default)"}
          </dd>
          <dt className="text-slate-400">Connection state</dt>
          <dd className="text-slate-200">{status}</dd>
          <dt className="text-slate-400">Last SDK event</dt>
          <dd className="text-slate-200">{lastSdkEvent}</dd>
          {lastErrorCode ? (
            <>
              <dt className="text-rose-400">Last error</dt>
              <dd className="text-rose-300">{lastErrorCode}</dd>
              {lastErrorPhase ? (
                <>
                  <dt className="text-rose-400">Error phase</dt>
                  <dd className="text-rose-300">{lastErrorPhase}</dd>
                </>
              ) : null}
            </>
          ) : null}
        </dl>
        <p className="mt-3 text-xs text-slate-500">
          No passwords or tokens are shown here.
          Configured node shows &quot;auto (unset)&quot; when VOXIMPLANT_CONNECTION_NODE is not set (recommended).
          Error phase indicates whether the error occurred before or after conference join.
        </p>
      </details>

      {recordingPanelEnabled && selectedRole === "facilitator" ? (
        <section className="rounded-lg border border-violet-700 bg-violet-950/30 p-4 text-sm">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-violet-300">
            Recording panel
          </h2>
          <p className="mb-1 text-xs text-violet-400">
            Facilitator only · Experimental · Requires{" "}
            <code>neg-conf.recording.scenario.js</code> in Voximplant Console
          </p>
          {!joined ? (
            <p className="mb-3 text-xs text-slate-500">
              Join the conference first to enable recording controls.
            </p>
          ) : !recordingPanel.sendMessageAvailable ? (
            <p className="mb-3 rounded border border-amber-500/60 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">
              <strong>SDK message sending unavailable.</strong>{" "}
              {recordingPanel.error ||
                "conference.sendMessage() not found. Check @voximplant/websdk version."}
            </p>
          ) : null}
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              onClick={() => handleSendRecordingCommand("start")}
              disabled={
                !joined ||
                !recordingPanel.sendMessageAvailable ||
                recordingPanel.status === "recording" ||
                recordingPanel.status === "starting"
              }
            >
              Start recording
            </button>
            <button
              type="button"
              className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              onClick={() => handleSendRecordingCommand("stop")}
              disabled={
                !joined ||
                !recordingPanel.sendMessageAvailable ||
                recordingPanel.status === "idle" ||
                recordingPanel.status === "stopped" ||
                recordingPanel.status === "api_not_confirmed"
              }
            >
              Stop recording
            </button>
            <button
              type="button"
              className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
              onClick={() => handleSendRecordingCommand("status")}
              disabled={!joined || !recordingPanel.sendMessageAvailable}
            >
              Check status
            </button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-slate-400">Mode</dt>
            <dd className="font-mono text-slate-200">scenario_message_control</dd>
            <dt className="text-slate-400">Status</dt>
            <dd className={`font-mono ${
              recordingPanel.status === "recording"
                ? "text-emerald-400"
                : recordingPanel.status === "error" || recordingPanel.status === "api_not_confirmed"
                  ? "text-rose-400"
                  : recordingPanel.status === "starting" || recordingPanel.status === "stopping"
                    ? "text-amber-300"
                    : "text-slate-200"
            }`}>
              {recordingPanel.status}
            </dd>
            <dt className="text-slate-400">Send message</dt>
            <dd className="font-mono text-slate-200">
              {recordingPanel.sendMessageAvailable ? "available" : "unavailable"}
            </dd>
            {recordingPanel.lastAction ? (
              <>
                <dt className="text-slate-400">Last action</dt>
                <dd className="font-mono text-slate-200">{recordingPanel.lastAction}</dd>
              </>
            ) : null}
            {recordingPanel.lastRequestId ? (
              <>
                <dt className="text-slate-400">Last request ID</dt>
                <dd className="font-mono text-slate-200">{recordingPanel.lastRequestId}</dd>
              </>
            ) : null}
            {recordingPanel.lastScenarioMessage ? (
              <>
                <dt className="text-slate-400">Last scenario reply</dt>
                <dd className="text-slate-200">{recordingPanel.lastScenarioMessage}</dd>
              </>
            ) : null}
            {recordingPanel.lastResponseTime ? (
              <>
                <dt className="text-slate-400">Last reply at</dt>
                <dd className="font-mono text-slate-200">{recordingPanel.lastResponseTime}</dd>
              </>
            ) : null}
            {recordingPanel.recordingUrl ? (
              <>
                <dt className="text-slate-400">Recording URL</dt>
                <dd className="break-all font-mono text-emerald-300">{recordingPanel.recordingUrl}</dd>
              </>
            ) : null}
            {recordingPanel.recordingId ? (
              <>
                <dt className="text-slate-400">Recording ID</dt>
                <dd className="font-mono text-slate-200">{recordingPanel.recordingId}</dd>
              </>
            ) : null}
            {recordingPanel.error ? (
              <>
                <dt className="text-rose-400">Error</dt>
                <dd className="text-rose-300">{recordingPanel.error}</dd>
              </>
            ) : null}
          </dl>
          <p className="mt-3 text-xs text-slate-500">
            Paste <code>docs/voximplant/neg-conf.recording.scenario.js</code> into
            Voximplant Console before testing. If status does not update after sending
            a command, check VoxEngine logs for{" "}
            <code>[neg-conf-rec] recording_control received</code> and{" "}
            <code>recording_started</code>.
          </p>
        </section>
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
