"use client";

/**
 * Bounded, cancellable connect coordinator for a Voximplant surface.
 *
 * A surface hands in a single `attempt` implementation; this runner owns how
 * often it may run, how long it waits between attempts, when it gives up, and
 * what the surface should display in between. Retry is driven by the failure
 * classification rather than by the raw error, so a transport 408 during an
 * intentional handoff retries quietly while an authorization rejection stops
 * immediately.
 */

import {
  classifyVoxProviderFailure,
  type VoxClassification,
  type VoxLifecyclePhase,
} from "@/lib/voximplant/provider-error-classification";
import { emitVoxProviderDiagnostic } from "@/lib/voximplant/websdk-core";

export type ProviderConnectStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "degraded"
  | "terminal"
  | "cancelled";

export type ProviderConnectState = {
  status: ProviderConnectStatus;
  attempt: number;
  maxAttempts: number;
  /** Delay until the next scheduled attempt while `status` is `degraded`. */
  nextRetryInMs: number | null;
  /** Machine-readable classification reason for the latest failure. */
  reason: string | null;
  /** True once the surface should offer a manual retry control. */
  canRetryManually: boolean;
};

export type ProviderAttemptResult =
  | { outcome: "connected" }
  | { outcome: "aborted" }
  | { outcome: "failed"; error: unknown };

export type ProviderConnectRetryPolicy = {
  maxAttempts: number;
  initialDelayMs: number;
  factor: number;
  maxDelayMs: number;
};

/**
 * Four attempts over roughly seven seconds. Long enough to ride out a Session
 * teardown and a reverse-tunnel gateway hiccup, short enough that the lobby
 * reports a degraded state instead of spinning.
 */
export const DEFAULT_PROVIDER_CONNECT_RETRY_POLICY: ProviderConnectRetryPolicy = {
  maxAttempts: 4,
  initialDelayMs: 800,
  factor: 2,
  maxDelayMs: 4000,
};

export function computeProviderRetryDelayMs(
  attempt: number,
  policy: ProviderConnectRetryPolicy,
): number {
  const raw = policy.initialDelayMs * policy.factor ** Math.max(0, attempt - 1);
  return Math.min(raw, policy.maxDelayMs);
}

export type ProviderConnectRunnerOptions = {
  surface: string;
  attempt: (context: {
    attempt: number;
    isCancelled: () => boolean;
  }) => Promise<ProviderAttemptResult>;
  policy?: ProviderConnectRetryPolicy;
  onState?: (state: ProviderConnectState) => void;
  getPhase?: () => VoxLifecyclePhase;
  /** Injected in tests to keep retry scheduling deterministic. */
  delay?: (ms: number, isCancelled: () => boolean) => Promise<void>;
  classify?: (error: unknown, attempt: number) => VoxClassification;
};

export type ProviderConnectRunner = {
  start: () => Promise<void>;
  /** Reset the exhausted budget and run again, e.g. from a retry button. */
  retryNow: () => Promise<void>;
  cancel: () => void;
  getState: () => ProviderConnectState;
};

function defaultDelay(ms: number, isCancelled: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (isCancelled()) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    // Keep the tick from holding a Node test process open.
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

export function createProviderConnectRunner(
  options: ProviderConnectRunnerOptions,
): ProviderConnectRunner {
  const policy = options.policy ?? DEFAULT_PROVIDER_CONNECT_RETRY_POLICY;
  const delay = options.delay ?? defaultDelay;

  let cancelled = false;
  let cancelPublished = false;
  let running: Promise<void> | null = null;
  let wakeCancelledSleep: (() => void) | null = null;

  let state: ProviderConnectState = {
    status: "idle",
    attempt: 0,
    maxAttempts: policy.maxAttempts,
    nextRetryInMs: null,
    reason: null,
    canRetryManually: false,
  };

  const setState = (next: Partial<ProviderConnectState>) => {
    state = { ...state, ...next };
    // A cancelled runner belongs to an unmounted or superseded owner. It
    // publishes cancellation exactly once and nothing after that, so a late
    // attempt settling cannot write into a dead surface.
    if (cancelled) {
      if (next.status !== "cancelled" || cancelPublished) return;
      cancelPublished = true;
    }
    options.onState?.(state);
  };

  const classify = (error: unknown, attempt: number): VoxClassification => {
    if (options.classify) return options.classify(error, attempt);
    const context = {
      phase: options.getPhase?.() ?? ("connecting" as VoxLifecyclePhase),
      attempt,
      maxAttempts: policy.maxAttempts,
    };
    const classification = classifyVoxProviderFailure(error, context);
    emitVoxProviderDiagnostic(options.surface, classification, context);
    return classification;
  };

  const sleepBeforeRetry = async (ms: number) => {
    let resolveEarly: (() => void) | null = null;
    const early = new Promise<void>((resolve) => {
      resolveEarly = resolve;
    });
    wakeCancelledSleep = () => resolveEarly?.();
    try {
      await Promise.race([delay(ms, () => cancelled), early]);
    } finally {
      wakeCancelledSleep = null;
    }
  };

  const run = async () => {
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      if (cancelled) {
        setState({ status: "cancelled", nextRetryInMs: null });
        return;
      }

      setState({ status: "connecting", attempt, nextRetryInMs: null });
      const result = await options.attempt({ attempt, isCancelled: () => cancelled });

      if (cancelled) {
        setState({ status: "cancelled", nextRetryInMs: null });
        return;
      }
      if (result.outcome === "connected") {
        setState({
          status: "connected",
          nextRetryInMs: null,
          reason: null,
          canRetryManually: false,
        });
        return;
      }
      if (result.outcome === "aborted") {
        setState({ status: "cancelled", nextRetryInMs: null });
        return;
      }

      const classification = classify(result.error, attempt);
      const retryable =
        classification.class === "RECOVERABLE_TRANSIENT" ||
        classification.class === "EXPECTED_DURING_INTENTIONAL_TEARDOWN";

      if (!retryable || attempt >= policy.maxAttempts) {
        setState({
          status: "terminal",
          nextRetryInMs: null,
          reason: classification.reason,
          canRetryManually: true,
        });
        return;
      }

      const nextRetryInMs = computeProviderRetryDelayMs(attempt, policy);
      setState({
        status: "degraded",
        nextRetryInMs,
        reason: classification.reason,
        canRetryManually: false,
      });
      await sleepBeforeRetry(nextRetryInMs);
    }
  };

  const start = () => {
    if (running) return running;
    if (cancelled) return Promise.resolve();
    if (state.status === "connected") return Promise.resolve();
    running = run().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    start,
    retryNow: () => {
      if (cancelled) return Promise.resolve();
      if (running) return running;
      state = { ...state, status: "idle", attempt: 0, reason: null, canRetryManually: false };
      return start();
    },
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      wakeCancelledSleep?.();
      setState({ status: "cancelled", nextRetryInMs: null });
    },
    getState: () => state,
  };
}

/**
 * Wrap a media-release routine so repeated teardown paths (explicit leave plus
 * React unmount) can both call it while the hardware is released exactly once.
 */
export function createIdempotentRelease(release: () => void): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
  };
}
