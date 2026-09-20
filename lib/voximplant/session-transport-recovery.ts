"use client";

/**
 * Stage 3.12B-W1 — bounded recovery for a gateway socket that drops under an
 * already established Session.
 *
 * The WebSDK owns the gateway WebSocket and re-establishes it itself. What was
 * missing was an application-side verdict: the close was classified as an
 * unknown terminal failure, so it reached `console.error` and raised the Next.js
 * development overlay while the Session was in fact fine.
 *
 * This controller supplies that verdict without touching the connection. It
 * never connects, logs in, joins or acquires media, so it cannot create a second
 * provider membership or re-prompt for the camera. It observes whether the SDK
 * got the link back: after each closure it waits a quiet period and then checks
 * that no further closure arrived and that the conference still reports itself
 * connected. Retry scheduling, the attempt budget and cancellation are delegated
 * to the existing {@link createProviderConnectRunner}, so there is one retry
 * engine in the codebase rather than two.
 *
 * SDK autoReconnect is the authoritative first response. Extra gateway closes
 * during that reconnect extend the same quiet period; they must not consume the
 * attempt budget or declare the link lost. An explicit SDK reconnect-settled
 * edge ({@link SessionTransportRecovery.noteRecovered}) marks the incident
 * stable immediately.
 *
 * The `SessionRoomConnection` heartbeat, the recording lifecycle and the
 * `OPEN -> DEBRIEF_OPEN -> CLOSED` transitions are all independent of this
 * controller and are deliberately left alone: a client-side socket blip is not
 * evidence that the participant left or that the Session should close.
 */

import {
  createProviderConnectRunner,
  DEFAULT_PROVIDER_CONNECT_RETRY_POLICY,
  type ProviderConnectRetryPolicy,
  type ProviderConnectState,
} from "@/lib/voximplant/provider-connect-retry";
import type { VoxClassification } from "@/lib/voximplant/provider-error-classification";

/**
 * How long the link must stay quiet before the closure counts as recovered.
 * Long enough for the SDK's own reconnect to complete or to fail again, short
 * enough that the participant is not left staring at a stale banner.
 */
export const SESSION_TRANSPORT_RECOVERY_QUIET_PERIOD_MS = 4_000;

export type SessionTransportStatus = "stable" | "recovering" | "lost";

export type SessionTransportRecoveryState = {
  status: SessionTransportStatus;
  attempt: number;
  maxAttempts: number;
  /** Classification reason for the closure being recovered from. */
  reason: string | null;
  /** True once the budget is spent and only the user can decide what to do. */
  canRetryManually: boolean;
};

export type SessionTransportRecoveryOptions = {
  /** The conference's own view of its state, from the SDK's lifecycle events. */
  isConferenceConnected: () => boolean;
  /**
   * False once this room's generation was superseded, the tab went stale or the
   * component unmounted. A stale owner must never keep driving recovery.
   */
  isOwnerCurrent: () => boolean;
  onState: (state: SessionTransportRecoveryState) => void;
  quietPeriodMs?: number;
  policy?: ProviderConnectRetryPolicy;
  /** Injected in tests so the quiet period and backoff use a fake clock. */
  delay?: (ms: number, isCancelled: () => boolean) => Promise<void>;
};

export type SessionTransportRecovery = {
  /** Report a classified, recoverable transport closure. Idempotent per incident. */
  noteTransportLoss: (classification: VoxClassification) => void;
  /**
   * SDK reconnect settled (or Conference Connected). Clears a stale recovering
   * or lost verdict without connect/join/hangup/disconnect.
   */
  noteRecovered: () => void;
  cancel: () => void;
  getState: () => SessionTransportRecoveryState;
};

function defaultDelay(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (isCancelled()) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

export function createSessionTransportRecovery(
  options: SessionTransportRecoveryOptions,
): SessionTransportRecovery {
  const policy = options.policy ?? DEFAULT_PROVIDER_CONNECT_RETRY_POLICY;
  const quietPeriodMs =
    options.quietPeriodMs ?? SESSION_TRANSPORT_RECOVERY_QUIET_PERIOD_MS;
  const delay = options.delay ?? defaultDelay;

  let cancelled = false;
  let lossSeq = 0;
  let recoveredSeq = 0;
  let settledBySdk = false;
  let pendingRestart = false;
  let startNextIncident = () => {};
  let wakeQuiet: (() => void) | null = null;
  let lastClassification: VoxClassification | null = null;

  let state: SessionTransportRecoveryState = {
    status: "stable",
    attempt: 0,
    maxAttempts: policy.maxAttempts,
    reason: null,
    canRetryManually: false,
  };

  const publish = (next: SessionTransportRecoveryState) => {
    state = next;
    options.onState(state);
  };

  const waitQuiet = (ms: number, isDone: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      if (isDone()) {
        resolve();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        wakeQuiet = null;
        resolve();
      };
      wakeQuiet = finish;
      void delay(ms, isDone).then(finish);
    });

  const onRunnerState = (connect: ProviderConnectState) => {
    if (cancelled) return;
    // A cancelled runner belongs to an unmounted or superseded owner; it has
    // nothing to say about the transport.
    if (connect.status === "cancelled") return;
    // SDK settle already published stable; a late quiet-period fail/abort from
    // the same incident must not reopen recovering/lost chrome. A later
    // noteTransportLoss clears this latch.
    if (settledBySdk && connect.status !== "connected") return;

    if (connect.status === "connected") {
      publish({
        status: "stable",
        attempt: connect.attempt,
        maxAttempts: connect.maxAttempts,
        reason: null,
        canRetryManually: false,
      });
      if (pendingRestart) {
        pendingRestart = false;
        queueMicrotask(() => startNextIncident());
      }
      return;
    }

    if (connect.status === "terminal") {
      publish({
        status: "lost",
        attempt: connect.attempt,
        maxAttempts: connect.maxAttempts,
        reason: connect.reason ?? lastClassification?.reason ?? null,
        canRetryManually: true,
      });
      return;
    }

    publish({
      status: "recovering",
      attempt: connect.attempt,
      maxAttempts: connect.maxAttempts,
      reason: connect.reason ?? lastClassification?.reason ?? null,
      canRetryManually: false,
    });
  };

  const runner = createProviderConnectRunner({
    surface: "session-room",
    policy,
    delay,
    onState: onRunnerState,
    // The closure was already classified and already logged once by the SDK log
    // sink. Reclassifying here would emit a duplicate diagnostic for one event.
    classify: () => lastClassification!,
    attempt: async ({ isCancelled }) => {
      const myRecoveredSeq = recoveredSeq;
      const done = () =>
        isCancelled() ||
        cancelled ||
        recoveredSeq !== myRecoveredSeq ||
        !options.isOwnerCurrent();

      while (!done()) {
        const seqAtWaitStart = lossSeq;
        await waitQuiet(quietPeriodMs, done);
        if (recoveredSeq !== myRecoveredSeq) {
          return { outcome: "connected" };
        }
        if (isCancelled() || cancelled || !options.isOwnerCurrent()) {
          return { outcome: "aborted" };
        }
        if (lossSeq !== seqAtWaitStart) {
          // Another SDK autoReconnect close: extend this attempt's quiet period.
          continue;
        }
        break;
      }

      if (recoveredSeq !== myRecoveredSeq) {
        return { outcome: "connected" };
      }
      if (isCancelled() || cancelled || !options.isOwnerCurrent()) {
        return { outcome: "aborted" };
      }
      if (!options.isConferenceConnected()) {
        return {
          outcome: "failed",
          error: new Error("conference is not connected after the socket closed"),
        };
      }
      return { outcome: "connected" };
    },
  });
  startNextIncident = () => {
    void runner.retryNow();
  };

  return {
    noteTransportLoss: (classification) => {
      if (cancelled || !options.isOwnerCurrent()) return;
      lossSeq += 1;
      const wasSettled = settledBySdk;
      settledBySdk = false;
      lastClassification = classification;

      const runnerStatus = runner.getState().status;
      if (wasSettled || runnerStatus === "connected" || runnerStatus === "terminal") {
        if (runnerStatus === "connecting" || runnerStatus === "degraded") {
          pendingRestart = true;
          return;
        }
        queueMicrotask(() => startNextIncident());
        return;
      }
      void runner.start();
    },
    noteRecovered: () => {
      if (cancelled || !options.isOwnerCurrent()) return;
      recoveredSeq += 1;
      settledBySdk = true;
      publish({
        status: "stable",
        attempt: state.attempt,
        maxAttempts: state.maxAttempts,
        reason: null,
        canRetryManually: false,
      });
      wakeQuiet?.();
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      wakeQuiet?.();
      runner.cancel();
    },
    getState: () => state,
  };
}
