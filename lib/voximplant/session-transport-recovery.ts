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

  const onRunnerState = (connect: ProviderConnectState) => {
    if (cancelled) return;
    // A cancelled runner belongs to an unmounted or superseded owner; it has
    // nothing to say about the transport.
    if (connect.status === "cancelled") return;

    if (connect.status === "connected") {
      publish({
        status: "stable",
        attempt: connect.attempt,
        maxAttempts: connect.maxAttempts,
        reason: null,
        canRetryManually: false,
      });
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
      const observedLossSeq = lossSeq;
      await delay(quietPeriodMs, isCancelled);

      if (isCancelled() || !options.isOwnerCurrent()) {
        return { outcome: "aborted" };
      }
      if (lossSeq !== observedLossSeq) {
        return {
          outcome: "failed",
          error: new Error("gateway socket closed again during recovery"),
        };
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

  return {
    noteTransportLoss: (classification) => {
      if (cancelled || !options.isOwnerCurrent()) return;
      lossSeq += 1;
      lastClassification = classification;

      // `start` returns the in-flight run when one is already going, so several
      // close callbacks arriving together extend the same bounded sequence
      // instead of racing two of them.
      const runnerStatus = runner.getState().status;
      if (runnerStatus === "connected" || runnerStatus === "terminal") {
        // A previous incident already settled; this is a new one.
        void runner.retryNow();
        return;
      }
      void runner.start();
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      runner.cancel();
    },
    getState: () => state,
  };
}
