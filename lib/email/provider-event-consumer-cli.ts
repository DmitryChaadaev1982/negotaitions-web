import type { EmailConfig } from "@/lib/email/config";
import {
  ProviderEventConsumerError,
  type ProviderEventConsumerCounters,
} from "@/lib/email/provider-event-consumer";

type ProviderEventIngestionConfig = EmailConfig["providerEventIngestion"];

/**
 * Exit-code contract shared with `deploy/systemd/negotiations-email-provider-events.service`.
 *
 * Terminal codes are listed in `RestartPreventExitStatus` so a misconfiguration
 * or a revoked credential cannot produce an infinite restart loop.
 */
export const EXIT_OK = 0;
/** Terminal: invalid or incomplete configuration. Never restarted. */
export const EXIT_INVALID_CONFIG = 78;
/** Terminal: authentication or authorization failure. Never restarted. */
export const EXIT_AUTHENTICATION = 77;
/** Retryable runtime failure. Restarted under a bounded systemd start limit. */
export const EXIT_RETRYABLE = 75;

export function exitCodeForConsumerFailure(error: unknown): number {
  if (error instanceof ProviderEventConsumerError) {
    if (error.kind === "invalid_config") return EXIT_INVALID_CONFIG;
    if (error.kind === "authentication") return EXIT_AUTHENTICATION;
    return EXIT_RETRYABLE;
  }
  return EXIT_RETRYABLE;
}

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function errorCodeOf(error: unknown): string {
  if (error instanceof ProviderEventConsumerError) return error.code;
  return "PROVIDER_EVENT_CONSUMER_FAILED";
}

function errorClassOf(error: unknown): string {
  const raw =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: unknown }).name)
      : typeof error;
  return raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 60) || "Unknown";
}

export type ProviderEventConsumerCliLogger = (
  level: "info" | "warn" | "error",
  event: string,
  data: Record<string, unknown>,
) => void;

export type ProviderEventConsumerCliDeps = {
  loadConfig: () => ProviderEventIngestionConfig;
  run: (params: {
    signal: AbortSignal;
    once: boolean;
  }) => Promise<ProviderEventConsumerCounters>;
  log: ProviderEventConsumerCliLogger;
  /** Registers the shutdown handler for SIGTERM/SIGINT. */
  onShutdownSignal: (handler: (signalName: string) => void) => void;
  /** Overrides the configured shutdown budget; used by tests. */
  shutdownTimeoutMsOverride?: number;
};

/**
 * Runs the consumer with an enforced shutdown budget and a deterministic exit
 * code. After SIGTERM/SIGINT the consumer is aborted and awaited for at most
 * `EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS`; exceeding that budget emits a
 * sanitized `shutdown_timeout` event and exits through the retryable path.
 */
export async function runProviderEventConsumerCli(
  deps: ProviderEventConsumerCliDeps,
  options: { once?: boolean } = {},
): Promise<number> {
  let config: ProviderEventIngestionConfig;
  try {
    config = deps.loadConfig();
  } catch (error) {
    deps.log("error", "consumer_invalid_config", {
      code: errorCodeOf(error),
      errorClass: errorClassOf(error),
    });
    return EXIT_INVALID_CONFIG;
  }

  if (!config.enabled) {
    deps.log("info", "consumer_disabled", {
      reason: "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED is false",
    });
    return EXIT_OK;
  }

  const shutdownTimeoutMs =
    deps.shutdownTimeoutMsOverride ?? config.shutdownTimeoutMs;
  const controller = new AbortController();
  let shutdownRequested = false;

  deps.onShutdownSignal((signalName) => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    deps.log("info", "shutdown_requested", { signal: signalName });
    controller.abort();
  });

  const guarded: Promise<
    | { ok: true; counters: ProviderEventConsumerCounters }
    | { ok: false; error: unknown }
  > = deps
    .run({ signal: controller.signal, once: Boolean(options.once) })
    .then((counters) => ({ ok: true as const, counters }))
    .catch((error: unknown) => ({ ok: false as const, error }));

  const outcome = await new Promise<
    | { ok: true; counters: ProviderEventConsumerCounters }
    | { ok: false; error: unknown }
    | { timedOut: true }
  >((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => {
      if (settled) return;
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ timedOut: true });
      }, shutdownTimeoutMs);
    };

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      controller.signal.removeEventListener("abort", onAbort);
    };

    void guarded.then((value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    });

    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener("abort", onAbort);
  });

  if ("timedOut" in outcome) {
    deps.log("error", "shutdown_timeout", { shutdownTimeoutMs });
    return EXIT_RETRYABLE;
  }

  if (outcome.ok) {
    deps.log("info", "consumer_completed", { ...outcome.counters });
    return EXIT_OK;
  }

  if (isAbortLike(outcome.error)) {
    deps.log("info", "consumer_stopped", { reason: "aborted" });
    return EXIT_OK;
  }

  const exitCode = exitCodeForConsumerFailure(outcome.error);
  deps.log("error", "consumer_failed", {
    code: errorCodeOf(outcome.error),
    errorClass: errorClassOf(outcome.error),
    exitCode,
    restartable: exitCode === EXIT_RETRYABLE,
  });
  return exitCode;
}
