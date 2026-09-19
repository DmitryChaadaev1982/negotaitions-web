/**
 * Testable Session-room provider media runtime.
 * The hook applies the same transitions; tests drive this object directly.
 */

import {
  createLayer3State,
  decide408Action,
  fenceGeneration,
  hideRemoteMediaFields,
  isSdkReconnecting,
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
  permittedProviderMutations,
  shouldDeferTerminalRecovery,
  upsertLiveRemoteMedia,
  type Layer3ConnectivityState,
  type Layer3ConnectivityStatus,
} from "@/lib/voximplant/layer3-media-connectivity";
import {
  reconcileRemoteParticipantsFromSnapshot,
  remotesAfterEndpointRemoved,
  remotesAfterProviderDisconnect,
} from "@/lib/voximplant/endpoint-reconciliation";
import {
  classifyProviderDisconnect,
  createBoundedProviderRejoin,
  isLocalMediaDeviceClassification,
  isMediaRecoveryClassification,
  isSessionOperableForProviderRejoin,
  retainPendingTerminalIncident,
  shouldCancelPendingTerminalIncident,
  shouldIgnoreProviderCallback,
  takePendingTerminalIncident,
  type PendingTerminalRecoveryIncident,
  type ProviderDisconnectIntent,
  type ProviderRecoveryStatus,
  type SessionCloseForRejoin,
  type TerminalRecoveryAttemptPhase,
} from "@/lib/voximplant/provider-disconnect-recovery";
import { logProviderRecovery } from "@/lib/voximplant/provider-recovery-log";
import {
  createConferenceStateWatcherOwner,
  wrapConferenceEventCallback,
} from "@/lib/voximplant/conference-callback-ownership";
import {
  bindEndpointStreamLiveness,
  createEndpointStreamLivenessRegistry,
  disposeAllEndpointStreamLiveness,
  disposeEndpointStreamLiveness,
  disposeEndpointStreamLivenessBinding,
  endpointStreamLivenessCount,
  hasEndpointStreamLiveness,
  isAutomaticStopReceivingReason,
  pruneMissingEndpointStreamLiveness,
} from "@/lib/voximplant/media-liveness";

export type RuntimeRemote = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
  generation: number;
  streamLive?: boolean;
  audioLive?: boolean;
};

export type SessionRoomRecoveryRuntime = {
  generation: number;
  joined: boolean;
  conferenceConnected: boolean;
  remotes: RuntimeRemote[];
  recovery: ProviderRecoveryStatus;
  layer3: Layer3ConnectivityStatus;
  rejoinAttempts: number;
  cameraUnavailable: boolean;
  lastResyncCount: number;
  shellMounted: boolean;
  heartbeatActive: boolean;
  connectionId: string;
  conferenceCreateCount: number;
  conferenceJoinCount: number;
  clientConnectCount: number;
  clientDisconnectCount: number;
  conferenceHangupCount: number;
  recordingStartCount: number;
  recordingStopCount: number;
  fencedGenerations: number[];
  eventOrder: string[];
  sdkClientState: string | null;
  sdkConferenceState: string | null;
  mediaUsable: boolean;
  pendingTerminalRecovery: boolean;
  sdkReconnectSettledCount: number;
  sdkReconnectedLogCount: number;
  streamLivenessCount: number;
  healthyFastPathSteps: string[];
  recoveryAttempt: TerminalRecoveryAttemptPhase;
  currentConferenceId: string | null;
};

export type RecoveryJoinPhase =
  | "created"
  | "audio_added"
  | "video_added"
  | "before_join"
  | "joining";

export type RuntimeConferenceHandle = {
  id: string;
};

export type RuntimeConferenceCallbacks = {
  onConnected: () => void;
  onFailed: (reason?: string) => void;
  onDisconnected: (reason?: string) => void;
  onEndpointAdded: (endpointId: string) => void;
  onEndpointRemoved: (endpointId: string) => void;
  watch: (next: string) => void;
};

export function createSessionRoomRecoveryRuntime(options: {
  surface?: string;
  sessionId?: string;
  connectionId?: string;
  getMounted?: () => boolean;
  getStale?: () => boolean;
  getCloseState?: () => SessionCloseForRejoin;
  getIntent?: () => ProviderDisconnectIntent;
  onRejoin?: (generation: number) => boolean | Promise<boolean>;
  onCreateConference?: (generation: number) => void;
} = {}) {
  const rejoin = createBoundedProviderRejoin();
  const surface = options.surface ?? "session-room";
  const sessionId = options.sessionId ?? "session-test";
  const connectionId = options.connectionId ?? "conn-stable";

  let layer3: Layer3ConnectivityState = createLayer3State({
    status: "connected",
    hasEnteredRoom: false,
  });

  const state: Omit<
    SessionRoomRecoveryRuntime,
    | "recovery"
    | "layer3"
    | "shellMounted"
    | "heartbeatActive"
    | "pendingTerminalRecovery"
    | "streamLivenessCount"
    | "recoveryAttempt"
    | "currentConferenceId"
  > & {
    remotes: RuntimeRemote[];
  } = {
    generation: 0,
    joined: false,
    conferenceConnected: false,
    remotes: [],
    rejoinAttempts: 0,
    cameraUnavailable: false,
    lastResyncCount: 0,
    connectionId,
    conferenceCreateCount: 0,
    conferenceJoinCount: 0,
    clientConnectCount: 0,
    clientDisconnectCount: 0,
    conferenceHangupCount: 0,
    recordingStartCount: 0,
    recordingStopCount: 0,
    fencedGenerations: [],
    eventOrder: [],
    sdkClientState: null,
    sdkConferenceState: null,
    mediaUsable: true,
    sdkReconnectSettledCount: 0,
    sdkReconnectedLogCount: 0,
    healthyFastPathSteps: [],
  };

  let pendingTerminalIncident: PendingTerminalRecoveryIncident | null = null;
  const streamLivenessRegistry = createEndpointStreamLivenessRegistry();
  const streamEndedEmitters = new Map<string, Map<string, Set<() => void>>>();
  const trackEndedEmitters = new Map<string, Map<string, Set<() => void>>>();
  const conferenceWatcherOwner = createConferenceStateWatcherOwner();
  const boundConferences = new Map<
    string,
    {
      conference: RuntimeConferenceHandle;
      generation: number;
      callbacks: RuntimeConferenceCallbacks;
    }
  >();
  let currentConference: RuntimeConferenceHandle | null = null;
  let conferenceSerial = 0;
  let recoveryJoinPhase: RecoveryJoinPhase | "idle" | "joined" = "idle";
  let recoveryJoinShouldFail = false;
  let recoveryPhaseInterceptor: ((phase: RecoveryJoinPhase) => void) | null = null;

  const mounted = () => options.getMounted?.() ?? true;
  const stale = () => options.getStale?.() ?? false;
  const sessionOperable = () =>
    isSessionOperableForProviderRejoin(options.getCloseState?.() ?? { isClosed: false });
  const intent = () => options.getIntent?.() ?? "none";

  const mutationsAllowed = () =>
    permittedProviderMutations({
      sdkReconnecting: isSdkReconnecting(state.sdkClientState, state.sdkConferenceState),
      stale: stale(),
      explicitLeave: intent() === "explicit_leave",
    });

  const note = (step: string) => {
    state.eventOrder.push(step);
  };

  const beginGeneration = () => {
    state.generation += 1;
    return state.generation;
  };

  const ignore = (eventGeneration: number) =>
    shouldIgnoreProviderCallback({
      eventGeneration,
      currentGeneration: state.generation,
      stale: stale(),
      mounted: mounted(),
    });

  const publishLayer3 = (next: Layer3ConnectivityState) => {
    layer3 = next;
  };

  const fenceCurrent = (reason: string) => {
    const { fencedGeneration, nextGeneration } = fenceGeneration(state.generation);
    note("fence");
    state.fencedGenerations.push(fencedGeneration);
    state.generation = nextGeneration;
    logProviderRecovery({
      surface,
      sessionId,
      generation: fencedGeneration,
      event: "generation_fenced",
      reason,
    });
    return { fencedGeneration, nextGeneration };
  };

  const countAppCreateIfAllowed = () => {
    const allowed = mutationsAllowed();
    if (!allowed.join) return false;
    state.conferenceCreateCount += 1;
    options.onCreateConference?.(state.generation);
    return true;
  };

  const countAppJoinIfAllowed = () => {
    const allowed = mutationsAllowed();
    if (!allowed.join) return false;
    state.conferenceJoinCount += 1;
    return true;
  };

  const cancelPendingTerminal = () => {
    pendingTerminalIncident = null;
  };

  const cancelInFlightRecovery = () => {
    cancelPendingTerminal();
    rejoin.cancel();
    recoveryJoinPhase = "idle";
  };

  const pauseSameRecoveryAttempt = (reason: string) => {
    rejoin.pause();
    pendingTerminalIncident = retainPendingTerminalIncident(pendingTerminalIncident, {
      generation: state.generation,
      reason,
    });
    publishLayer3(layer3AfterSdkReconnecting(layer3));
    logProviderRecovery({
      surface,
      sessionId,
      generation: state.generation,
      event: "recovery_paused",
      reason,
    });
  };

  const bindConference = (generation: number) => {
    conferenceSerial += 1;
    const conference: RuntimeConferenceHandle = { id: `conf-${conferenceSerial}` };
    currentConference = conference;
    const watcherEpoch = conferenceWatcherOwner.claim(conference);
    const onConnected = wrapConferenceEventCallback(
      {
        eventGeneration: generation,
        callbackConference: conference,
        getCurrentGeneration: () => state.generation,
        getCurrentConference: () => currentConference,
        getStale: stale,
        getMounted: mounted,
      },
      () => {
        state.conferenceConnected = true;
        if (rejoin.getStatus() === "recovering") {
          rejoin.succeed();
          recoveryJoinPhase = "joined";
          logProviderRecovery({
            surface,
            sessionId,
            generation,
            event: "recovery_succeeded",
          });
        }
      },
    );
    const onFailed = wrapConferenceEventCallback(
      {
        eventGeneration: generation,
        callbackConference: conference,
        getCurrentGeneration: () => state.generation,
        getCurrentConference: () => currentConference,
        getStale: stale,
        getMounted: mounted,
      },
      () => {
        state.conferenceConnected = false;
      },
    );
    const onDisconnected = wrapConferenceEventCallback(
      {
        eventGeneration: generation,
        callbackConference: conference,
        getCurrentGeneration: () => state.generation,
        getCurrentConference: () => currentConference,
        getStale: stale,
        getMounted: mounted,
      },
      () => {
        state.conferenceConnected = false;
      },
    );
    const onEndpointAdded = wrapConferenceEventCallback(
      {
        eventGeneration: generation,
        callbackConference: conference,
        getCurrentGeneration: () => state.generation,
        getCurrentConference: () => currentConference,
        getStale: stale,
        getMounted: mounted,
      },
      (endpointId: string) => {
        if (ignore(generation) || !state.joined) return;
        state.remotes = upsertLiveRemoteMedia({
          current: state.remotes,
          next: {
            id: endpointId,
            displayName: endpointId,
            generation: state.generation,
            streamLive: true,
            audioLive: true,
          },
        });
      },
    );
    const onEndpointRemoved = wrapConferenceEventCallback(
      {
        eventGeneration: generation,
        callbackConference: conference,
        getCurrentGeneration: () => state.generation,
        getCurrentConference: () => currentConference,
        getStale: stale,
        getMounted: mounted,
      },
      (endpointId: string) => {
        if (ignore(generation)) return;
        disposeEndpointStreamLiveness(streamLivenessRegistry, endpointId);
        state.remotes = remotesAfterEndpointRemoved(state.remotes, endpointId);
      },
    );
    const watch = conferenceWatcherOwner.wrap(conference, watcherEpoch, (next: string) => {
      const wasReconnecting = isSdkReconnecting(state.sdkClientState, state.sdkConferenceState);
      state.sdkConferenceState = next;
      applySdkReconnectObservation(wasReconnecting);
    });
    const callbacks: RuntimeConferenceCallbacks = {
      onConnected,
      onFailed,
      onDisconnected,
      onEndpointAdded,
      onEndpointRemoved,
      watch,
    };
    boundConferences.set(conference.id, { conference, generation, callbacks });
    return conference;
  };

  const releaseCurrentConference = () => {
    if (currentConference) {
      conferenceWatcherOwner.release(currentConference);
    }
    currentConference = null;
  };

  const continueRecoveryJoin = (reason: string) => {
    if (
      shouldCancelPendingTerminalIncident({
        stale: stale(),
        mounted: mounted(),
        intent: intent(),
        sessionOperable: sessionOperable(),
      })
    ) {
      cancelInFlightRecovery();
      return { rejoined: false as const, deferred: false as const, canceled: true as const };
    }

    const afterPhase = (phase: RecoveryJoinPhase) => {
      recoveryPhaseInterceptor?.(phase);
      if (
        shouldDeferTerminalRecovery(
          isSdkReconnecting(state.sdkClientState, state.sdkConferenceState),
        )
      ) {
        pauseSameRecoveryAttempt(reason);
        return true;
      }
      return false;
    };

    if (recoveryJoinPhase === "idle") {
      if (!countAppCreateIfAllowed()) {
        pauseSameRecoveryAttempt(reason);
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
      bindConference(state.generation);
      recoveryJoinPhase = "created";
      if (afterPhase("created")) {
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
    }

    if (recoveryJoinPhase === "created") {
      if (
        shouldDeferTerminalRecovery(
          isSdkReconnecting(state.sdkClientState, state.sdkConferenceState),
        )
      ) {
        pauseSameRecoveryAttempt(reason);
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
      note("audio_added");
      recoveryJoinPhase = "audio_added";
      if (afterPhase("audio_added")) {
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
    }

    if (recoveryJoinPhase === "audio_added") {
      if (
        shouldDeferTerminalRecovery(
          isSdkReconnecting(state.sdkClientState, state.sdkConferenceState),
        )
      ) {
        pauseSameRecoveryAttempt(reason);
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
      note("video_added");
      recoveryJoinPhase = "video_added";
      if (afterPhase("video_added")) {
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
    }

    if (recoveryJoinPhase === "video_added") {
      if (afterPhase("before_join")) {
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
      if (!countAppJoinIfAllowed()) {
        pauseSameRecoveryAttempt(reason);
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
      recoveryJoinPhase = "joining";
      if (recoveryJoinShouldFail) {
        rejoin.fail();
        recoveryJoinPhase = "idle";
        publishLayer3(layer3AfterTerminalRecoveryFailed(layer3, "recovery_join_failed"));
        logProviderRecovery({
          surface,
          sessionId,
          generation: state.generation,
          event: "recovery_failed",
          reason: "recovery_join_failed",
        });
        return { rejoined: false as const, deferred: false as const, failed: true as const };
      }
      const ok = options.onRejoin?.(state.generation);
      void Promise.resolve(ok).then((success) => {
        if (success === false) return;
      });
      recoveryJoinPhase = "joined";
      return {
        rejoined: true as const,
        deferred: false as const,
        nextGeneration: state.generation,
        join: ok,
      };
    }

    return { rejoined: false as const, deferred: false as const };
  };

  const startTerminalRecovery = (reason: string) => {
    if (
      shouldCancelPendingTerminalIncident({
        stale: stale(),
        mounted: mounted(),
        intent: intent(),
        sessionOperable: sessionOperable(),
      })
    ) {
      cancelInFlightRecovery();
      return { rejoined: false as const, deferred: false as const };
    }

    const sdkReconnecting = isSdkReconnecting(
      state.sdkClientState,
      state.sdkConferenceState,
    );

    if (rejoin.isPaused() && !shouldDeferTerminalRecovery(sdkReconnecting)) {
      rejoin.resume();
      logProviderRecovery({
        surface,
        sessionId,
        generation: state.generation,
        event: "recovery_resumed",
        reason,
      });
      return { ...continueRecoveryJoin(reason), resumed: true as const };
    }

    if (shouldDeferTerminalRecovery(sdkReconnecting)) {
      if (rejoin.getStatus() === "recovering") {
        pauseSameRecoveryAttempt(reason);
        return { rejoined: false as const, deferred: true as const, paused: true as const };
      }
      pendingTerminalIncident = retainPendingTerminalIncident(pendingTerminalIncident, {
        generation: state.generation,
        reason,
      });
      publishLayer3(layer3AfterSdkReconnecting(layer3));
      return { rejoined: false as const, deferred: true as const };
    }

    const kind = classifyProviderDisconnect({
      intent: intent(),
      eventGeneration: state.generation,
      currentGeneration: state.generation,
      mounted: mounted(),
      stale: stale(),
      sessionOperable: sessionOperable(),
    });
    const decision = rejoin.decide(kind);
    if (!decision.shouldRejoin) {
      if (decision.reason === "already_in_flight") {
        if (rejoin.isPaused()) {
          return { rejoined: false as const, deferred: true as const, paused: true as const, kind, decision };
        }
        return { rejoined: false as const, deferred: false as const, kind, decision };
      }
      if (kind === "unexpected") {
        publishLayer3(
          layer3AfterTerminalRecoveryFailed(
            { ...layer3, hasEnteredRoom: true },
            decision.reason,
          ),
        );
      }
      return { rejoined: false as const, deferred: false as const, kind, decision };
    }

    note("reset");
    state.joined = false;
    state.conferenceConnected = false;
    state.remotes = remotesAfterProviderDisconnect();
    state.mediaUsable = false;
    disposeAllEndpointStreamLiveness(streamLivenessRegistry);
    streamEndedEmitters.clear();
    trackEndedEmitters.clear();
    releaseCurrentConference();
    if (mutationsAllowed().hangup) {
      state.conferenceHangupCount += 1;
    }

    rejoin.begin();
    recoveryJoinPhase = "idle";
    publishLayer3(layer3DuringTerminalRecovery(layer3, reason));
    state.rejoinAttempts += 1;
    const nextGeneration = state.generation;
    logProviderRecovery({
      surface,
      sessionId,
      generation: nextGeneration,
      event: "recovery_started",
      reason: decision.reason,
    });
    const joinResult = continueRecoveryJoin(reason);
    return { kind, ...joinResult, nextGeneration, decision };
  };

  const maybeFlushPendingTerminal = () => {
    if (
      shouldCancelPendingTerminalIncident({
        stale: stale(),
        mounted: mounted(),
        intent: intent(),
        sessionOperable: sessionOperable(),
      })
    ) {
      cancelPendingTerminal();
      return;
    }
    if (shouldDeferTerminalRecovery(
      isSdkReconnecting(state.sdkClientState, state.sdkConferenceState),
    )) {
      return;
    }
    const { incident, remaining } = takePendingTerminalIncident(pendingTerminalIncident);
    pendingTerminalIncident = remaining;
    if (!incident) return;
    startTerminalRecovery(incident.reason);
  };

  const applySdkReconnectObservation = (wasReconnecting: boolean) => {
    const observation = observeSdkReconnectTransition({
      wasReconnecting,
      clientState: state.sdkClientState,
      conferenceState: state.sdkConferenceState,
    });
    if (observation.episodeStarted) {
      note("sdk_reconnecting");
      publishLayer3(layer3AfterSdkReconnecting(layer3));
      logProviderRecovery({
        surface,
        sessionId,
        generation: state.generation,
        event: "sdk_reconnecting",
      });
      return;
    }
    if (!observation.episodeSettled) {
      return;
    }
    note("sdk_reconnected");
    state.sdkReconnectSettledCount += 1;
    state.sdkReconnectedLogCount += 1;
    logProviderRecovery({
      surface,
      sessionId,
      generation: state.generation,
      event: "sdk_reconnected",
    });
    if (pendingTerminalIncident) {
      maybeFlushPendingTerminal();
      return;
    }
    if (isTerminalConferenceState(state.sdkConferenceState)) {
      return;
    }
    publishLayer3(layer3AfterSdkReconnectSettled(layer3));
    if (state.conferenceConnected) {
      state.lastResyncCount += 1;
    }
  };

  return {
    getState(): SessionRoomRecoveryRuntime {
      const status = layer3.status;
      return {
        ...state,
        remotes: [...state.remotes],
        recovery: rejoin.getStatus(),
        layer3: status,
        pendingTerminalRecovery: pendingTerminalIncident !== null,
        streamLivenessCount: endpointStreamLivenessCount(streamLivenessRegistry),
        recoveryAttempt: rejoin.getAttempt(),
        currentConferenceId: currentConference?.id ?? null,
        shellMounted: layer3.keepShellMounted || layer3.hasEnteredRoom,
        heartbeatActive: layer3.keepHeartbeatActive || layer3.hasEnteredRoom,
      };
    },
    getLayer3(): Layer3ConnectivityState {
      return { ...layer3 };
    },
    getBannerKind() {
      return layer3BannerKind({
        status: layer3.status,
        mediaUsable: state.mediaUsable,
      });
    },
    beginGeneration,
    markJoined(generation: number) {
      if (ignore(generation)) return;
      if (!currentConference) {
        bindConference(generation);
      }
      state.joined = true;
      state.conferenceConnected = true;
      state.mediaUsable = state.remotes.some(
        (remote) => remote.streamLive !== false || remote.audioLive !== false,
      )
        ? true
        : state.mediaUsable;
      layer3 = {
        ...layer3,
        hasEnteredRoom: true,
        keepShellMounted: true,
        keepHeartbeatActive: true,
        status: "connected",
        reason: null,
      };
      if (rejoin.getStatus() === "recovering") {
        rejoin.succeed();
        logProviderRecovery({
          surface,
          sessionId,
          generation,
          event: "recovery_succeeded",
        });
      }
    },
    upsertRemote(generation: number, remote: Omit<RuntimeRemote, "generation">) {
      if (ignore(generation) || !state.joined) return;
      const next = {
        streamLive: true,
        audioLive: true,
        ...remote,
        generation,
      };
      state.remotes = upsertLiveRemoteMedia({
        current: state.remotes,
        next,
      });
      if (next.streamLive || next.audioLive) state.mediaUsable = true;
    },
    applyLiveRemoteMedia(
      generation: number,
      remote: Omit<RuntimeRemote, "generation">,
    ) {
      state.healthyFastPathSteps = ["usable_media"];
      if (ignore(generation)) {
        state.healthyFastPathSteps.push("ignored_fenced_generation");
        return;
      }
      const next = {
        streamLive: true,
        audioLive: remote.audioLive ?? true,
        ...remote,
        generation,
      };
      // Conference Connected is not a render gate for an already-usable track.
      state.remotes = upsertLiveRemoteMedia({
        current: state.remotes,
        next,
      });
      state.mediaUsable = true;
      state.healthyFastPathSteps.push("remote_state_update");
      state.healthyFastPathSteps.push("tile_eligible");
      if (layer3.status === "degraded" || layer3.status === "reconnecting") {
        publishLayer3(
          layer3AfterUsableRemoteMedia(
            layer3,
            isSdkReconnecting(state.sdkClientState, state.sdkConferenceState),
          ),
        );
      }
    },
    applyUnexpectedDisconnect(eventGeneration: number) {
      return this.applyDisconnect(eventGeneration, intent());
    },
    applyDisconnect(
      eventGeneration: number,
      disconnectIntent: ProviderDisconnectIntent,
      disconnectReason?: string | null,
    ) {
      if (eventGeneration !== state.generation) {
        return { kind: "ignore_stale_generation" as const, rejoined: false };
      }
      logProviderRecovery({
        surface,
        sessionId,
        generation: eventGeneration,
        event: "provider_disconnect",
        reason: disconnectIntent,
      });

      const kind = classifyProviderDisconnect({
        intent: disconnectIntent,
        eventGeneration,
        currentGeneration: state.generation,
        mounted: mounted(),
        stale: stale(),
        sessionOperable: sessionOperable(),
      });
      if (kind !== "unexpected") {
        cancelInFlightRecovery();
        state.joined = false;
        state.conferenceConnected = false;
        state.remotes = remotesAfterProviderDisconnect();
        const decision = rejoin.decide(kind);
        return { kind, rejoined: false, decision };
      }

      const terminal = isTerminalConferenceIncident({
        kind: "disconnected",
        disconnectReason: disconnectReason ?? null,
      });
      if (!terminal) {
        if (isSdkReconnecting(state.sdkClientState, state.sdkConferenceState)) {
          publishLayer3(layer3AfterSdkReconnecting(layer3));
        }
        return { kind, rejoined: false };
      }
      fenceCurrent(disconnectReason ?? "unexpected_disconnect");
      const result = startTerminalRecovery(disconnectReason ?? "unexpected_disconnect");
      return { kind, ...result };
    },
    applyConferenceFailed(eventGeneration: number, reason = "conference_failed") {
      if (eventGeneration !== state.generation) {
        return { kind: "ignore_stale_generation" as const, rejoined: false };
      }
      const kind = classifyProviderDisconnect({
        intent: intent(),
        eventGeneration,
        currentGeneration: state.generation,
        mounted: mounted(),
        stale: stale(),
        sessionOperable: sessionOperable(),
      });
      fenceCurrent(reason);
      if (kind !== "unexpected") {
        state.joined = false;
        state.conferenceConnected = false;
        state.remotes = remotesAfterProviderDisconnect();
        return { kind, rejoined: false };
      }
      return { kind, ...startTerminalRecovery(reason) };
    },
    applyConnectionLost(eventGeneration: number) {
      return this.applyDisconnect(eventGeneration, intent(), "CONNECTION_LOST");
    },
    observeSdkClientState(next: string) {
      const wasReconnecting = isSdkReconnecting(state.sdkClientState, state.sdkConferenceState);
      state.sdkClientState = next;
      applySdkReconnectObservation(wasReconnecting);
    },
    observeSdkConferenceState(next: string) {
      const wasReconnecting = isSdkReconnecting(state.sdkClientState, state.sdkConferenceState);
      state.sdkConferenceState = next;
      applySdkReconnectObservation(wasReconnecting);
    },
    applyTransport408() {
      const action = decide408Action({
        sdkReconnecting: isSdkReconnecting(state.sdkClientState, state.sdkConferenceState),
        mediaUsable: state.mediaUsable,
        conferenceTerminal: !state.conferenceConnected && layer3.status === "failed",
      });
      if (action === "observe_sdk") {
        publishLayer3(layer3AfterSdkReconnecting({ ...layer3, hasEnteredRoom: true }));
        return { action, rejoined: false };
      }
      if (action === "keep") {
        return { action, rejoined: false };
      }
      if (action === "resync") {
        state.lastResyncCount += 1;
        publishLayer3(layer3AfterMediaDegraded(layer3, "transport_unavailable:408"));
        return { action, rejoined: false, resync: true };
      }
      return { action, ...startTerminalRecovery("transport_unavailable:408") };
    },
    completeRejoin(success: boolean, generation: number) {
      if (ignore(generation) && !success) {
        rejoin.fail();
        publishLayer3(layer3AfterTerminalRecoveryFailed(layer3, "recovery_failed"));
        logProviderRecovery({
          surface,
          sessionId,
          generation,
          event: "recovery_failed",
        });
        return;
      }
      if (success) {
        this.markJoined(generation);
        return;
      }
      state.joined = false;
      state.conferenceConnected = false;
      state.remotes = remotesAfterProviderDisconnect();
      rejoin.fail();
      publishLayer3(layer3AfterTerminalRecoveryFailed(layer3, "recovery_failed"));
      logProviderRecovery({
        surface,
        sessionId,
        generation,
        event: "recovery_failed",
      });
    },
    applyEndpointRemoved(eventGeneration: number, endpointId: string) {
      if (ignore(eventGeneration)) return;
      disposeEndpointStreamLiveness(streamLivenessRegistry, endpointId);
      state.remotes = remotesAfterEndpointRemoved(state.remotes, endpointId);
    },
    attachStreamLiveness(eventGeneration: number, endpointId: string, streamId: string) {
      if (ignore(eventGeneration)) return false;
      const ensureEmitter = (
        store: Map<string, Map<string, Set<() => void>>>,
      ) => {
        let streams = store.get(endpointId);
        if (!streams) {
          streams = new Map();
          store.set(endpointId, streams);
        }
        let handlers = streams.get(streamId);
        if (!handlers) {
          handlers = new Set();
          streams.set(streamId, handlers);
        }
        return handlers;
      };
      const streamHandlers = ensureEmitter(streamEndedEmitters);
      const trackHandlers = ensureEmitter(trackEndedEmitters);
      return bindEndpointStreamLiveness({
        registry: streamLivenessRegistry,
        endpointId,
        streamId,
        addStreamEndedListener: (handler) => {
          streamHandlers.add(handler);
        },
        removeStreamEndedListener: (handler) => {
          streamHandlers.delete(handler);
        },
        addTrackEndedListener: (handler) => {
          trackHandlers.add(handler);
        },
        removeTrackEndedListener: (handler) => {
          trackHandlers.delete(handler);
        },
        onEnded: () => {
          if (ignore(eventGeneration)) return;
          const existing = state.remotes.some((remote) => remote.id === endpointId);
          if (!existing) {
            state.remotes = upsertLiveRemoteMedia({
              current: state.remotes,
              next: {
                id: endpointId,
                displayName: endpointId,
                generation: state.generation,
                streamLive: true,
                audioLive: true,
              },
            });
          }
        },
      });
    },
    emitStreamEnded(endpointId: string, streamId: string) {
      const handlers = streamEndedEmitters.get(endpointId)?.get(streamId);
      if (!handlers) return;
      for (const handler of Array.from(handlers)) {
        handler();
      }
    },
    emitNativeTrackEnded(endpointId: string, streamId: string) {
      const handlers = trackEndedEmitters.get(endpointId)?.get(streamId);
      if (!handlers) return;
      for (const handler of Array.from(handlers)) {
        handler();
      }
    },
    teardownAllStreamLiveness() {
      disposeAllEndpointStreamLiveness(streamLivenessRegistry);
      streamEndedEmitters.clear();
      trackEndedEmitters.clear();
    },
    applySnapshot(
      eventGeneration: number,
      snapshotIds: ReadonlySet<string>,
      conferenceConnected = state.conferenceConnected,
    ) {
      if (ignore(eventGeneration)) return;
      const result = reconcileRemoteParticipantsFromSnapshot({
        current: state.remotes,
        snapshotIds,
        conferenceConnected,
      });
      state.remotes = result.next;
    },
    applyMediaRecoverySignal(eventGeneration: number, reason: string) {
      if (ignore(eventGeneration)) return { fullRejoin: false, resync: false };
      if (isLocalMediaDeviceClassification(reason)) {
        state.cameraUnavailable = true;
        return { fullRejoin: false, resync: false };
      }
      if (isMediaRecoveryClassification(reason) && state.conferenceConnected) {
        state.lastResyncCount += 1;
        logProviderRecovery({
          surface,
          sessionId,
          generation: eventGeneration,
          event: "endpoint_resync",
          classification: "RECOVERABLE_TRANSIENT",
          reason,
        });
        return { fullRejoin: false, resync: true };
      }
      return { fullRejoin: false, resync: false };
    },
    applyRemoteMediaRemoved(
      eventGeneration: number,
      endpointId: string,
      options?: {
        streamId?: string;
        presentStreamIds?: ReadonlySet<string>;
        remainingStreamLive?: boolean;
        remainingAudioLive?: boolean;
      },
    ) {
      if (ignore(eventGeneration)) return;
      if (options?.streamId) {
        disposeEndpointStreamLivenessBinding(
          streamLivenessRegistry,
          endpointId,
          options.streamId,
        );
      } else if (options?.presentStreamIds) {
        pruneMissingEndpointStreamLiveness(
          streamLivenessRegistry,
          endpointId,
          options.presentStreamIds,
        );
      }
      const remainingSpecified =
        options?.remainingStreamLive !== undefined ||
        options?.remainingAudioLive !== undefined;
      state.remotes = state.remotes.map((remote) => {
        if (remote.id !== endpointId) return remote;
        if (!remainingSpecified) {
          return hideRemoteMediaFields(remote, "both");
        }
        return {
          ...remote,
          streamLive: options.remainingStreamLive ?? remote.streamLive,
          audioLive: options.remainingAudioLive ?? remote.audioLive,
        };
      });
      state.mediaUsable = state.remotes.some(
        (remote) => remote.streamLive === true || remote.audioLive === true,
      );
    },
    applyStreamEnded(eventGeneration: number, endpointId: string, kind: "video" | "audio" = "video") {
      if (ignore(eventGeneration)) return;
      state.remotes = state.remotes.map((remote) =>
        remote.id === endpointId ? hideRemoteMediaFields(remote, kind) : remote,
      );
      state.mediaUsable = state.remotes.some(
        (remote) => remote.streamLive === true || remote.audioLive === true,
      );
      if (!state.mediaUsable) {
        publishLayer3(layer3AfterMediaDegraded(layer3, "stream_ended"));
      }
    },
    applyNativeTrackEnded(eventGeneration: number, endpointId: string) {
      if (ignore(eventGeneration)) return;
      state.remotes = state.remotes.map((remote) =>
        remote.id === endpointId ? hideRemoteMediaFields(remote, "both") : remote,
      );
      state.mediaUsable = state.remotes.some(
        (remote) => remote.streamLive === true || remote.audioLive === true,
      );
      if (!state.mediaUsable) {
        publishLayer3(layer3AfterMediaDegraded(layer3, "native_track_ended"));
      }
    },
    applyAutomaticStopReceiving(eventGeneration: number, endpointId: string, reason = "Automatic") {
      if (ignore(eventGeneration)) return { fullRejoin: false };
      if (!isAutomaticStopReceivingReason(reason)) {
        return { fullRejoin: false };
      }
      state.remotes = state.remotes.map((remote) =>
        remote.id === endpointId ? hideRemoteMediaFields(remote, "video") : remote,
      );
      state.mediaUsable = state.remotes.some(
        (remote) => remote.streamLive === true || remote.audioLive === true,
      );
      publishLayer3(layer3AfterMediaDegraded(layer3, "stop_receiving_automatic"));
      return { fullRejoin: false, resync: false };
    },
    requestRecordingStart() {
      if (layer3.status === "recovering" || layer3.status === "reconnecting") return;
      state.recordingStartCount += 1;
    },
    requestRecordingStop() {
      if (layer3.status === "recovering" || layer3.status === "reconnecting") return;
      state.recordingStopCount += 1;
    },
    tryAppConnect() {
      if (!mutationsAllowed().connect) return false;
      state.clientConnectCount += 1;
      return true;
    },
    tryAppDisconnect() {
      if (!mutationsAllowed().disconnect) return false;
      state.clientDisconnectCount += 1;
      return true;
    },
    tryAppHangup() {
      if (!mutationsAllowed().hangup) return false;
      state.conferenceHangupCount += 1;
      return true;
    },
    tryAppJoin() {
      if (!mutationsAllowed().join) return false;
      state.conferenceJoinCount += 1;
      return true;
    },
    getCurrentConference() {
      return currentConference;
    },
    getConferenceCallbacks(conference: RuntimeConferenceHandle | null | undefined) {
      if (!conference) return null;
      return boundConferences.get(conference.id)?.callbacks ?? null;
    },
    hasStreamLiveness(endpointId: string, streamId: string) {
      return hasEndpointStreamLiveness(streamLivenessRegistry, endpointId, streamId);
    },
    onRecoveryPhase(interceptor: ((phase: RecoveryJoinPhase) => void) | null) {
      recoveryPhaseInterceptor = interceptor;
    },
    setRecoveryJoinFailure(shouldFail: boolean) {
      recoveryJoinShouldFail = shouldFail;
    },
  };
}
