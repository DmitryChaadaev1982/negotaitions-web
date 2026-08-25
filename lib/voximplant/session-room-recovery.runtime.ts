/**
 * Testable Session-room provider media runtime.
 * The hook applies the same transitions; tests drive this object directly.
 */

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
  shouldIgnoreProviderCallback,
  type ProviderDisconnectIntent,
  type ProviderRecoveryStatus,
  type SessionCloseForRejoin,
} from "@/lib/voximplant/provider-disconnect-recovery";
import { logProviderRecovery } from "@/lib/voximplant/provider-recovery-log";

export type RuntimeRemote = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
  generation: number;
};

export type SessionRoomRecoveryRuntime = {
  generation: number;
  joined: boolean;
  conferenceConnected: boolean;
  remotes: RuntimeRemote[];
  recovery: ProviderRecoveryStatus;
  rejoinAttempts: number;
  cameraUnavailable: boolean;
  lastResyncCount: number;
};

export function createSessionRoomRecoveryRuntime(options: {
  surface?: string;
  sessionId?: string;
  getMounted?: () => boolean;
  getStale?: () => boolean;
  getCloseState?: () => SessionCloseForRejoin;
  getIntent?: () => ProviderDisconnectIntent;
  onRejoin?: (generation: number) => boolean | Promise<boolean>;
}) {
  const rejoin = createBoundedProviderRejoin();
  const surface = options.surface ?? "session-room";
  const sessionId = options.sessionId ?? "session-test";

  const state: SessionRoomRecoveryRuntime = {
    generation: 0,
    joined: false,
    conferenceConnected: false,
    remotes: [],
    recovery: "idle",
    rejoinAttempts: 0,
    cameraUnavailable: false,
    lastResyncCount: 0,
  };

  const mounted = () => options.getMounted?.() ?? true;
  const stale = () => options.getStale?.() ?? false;
  const sessionOperable = () =>
    isSessionOperableForProviderRejoin(options.getCloseState?.() ?? { isClosed: false });
  const intent = () => options.getIntent?.() ?? "none";

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

  return {
    getState(): SessionRoomRecoveryRuntime {
      return {
        ...state,
        remotes: [...state.remotes],
        recovery: rejoin.getStatus(),
      };
    },
    beginGeneration,
    markJoined(generation: number) {
      if (ignore(generation)) return;
      state.joined = true;
      state.conferenceConnected = true;
      if (rejoin.getStatus() === "recovering") {
        state.recovery = rejoin.succeed();
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
      const next = { ...remote, generation };
      const index = state.remotes.findIndex((item) => item.id === next.id);
      if (index === -1) state.remotes.push(next);
      else state.remotes[index] = next;
    },
    applyUnexpectedDisconnect(eventGeneration: number) {
      return this.applyDisconnect(eventGeneration, intent());
    },
    applyDisconnect(eventGeneration: number, disconnectIntent: ProviderDisconnectIntent) {
      if (eventGeneration !== state.generation) {
        return { kind: "ignore_stale_generation" as const, rejoined: false };
      }
      state.joined = false;
      state.conferenceConnected = false;
      state.remotes = remotesAfterProviderDisconnect();
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
      const decision = rejoin.decide(kind);
      if (!decision.shouldRejoin) {
        return { kind, rejoined: false, decision };
      }

      state.recovery = rejoin.begin();
      state.rejoinAttempts += 1;
      const nextGeneration = beginGeneration();
      logProviderRecovery({
        surface,
        sessionId,
        generation: nextGeneration,
        event: "recovery_started",
        reason: decision.reason,
      });
      const ok = options.onRejoin?.(nextGeneration);
      return { kind, rejoined: true, nextGeneration, join: ok, decision };
    },
    completeRejoin(success: boolean, generation: number) {
      if (ignore(generation) && !success) {
        state.recovery = rejoin.fail();
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
      state.recovery = rejoin.fail();
      logProviderRecovery({
        surface,
        sessionId,
        generation,
        event: "recovery_failed",
      });
    },
    applyEndpointRemoved(eventGeneration: number, endpointId: string) {
      if (ignore(eventGeneration)) return;
      state.remotes = remotesAfterEndpointRemoved(state.remotes, endpointId);
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
  };
}
