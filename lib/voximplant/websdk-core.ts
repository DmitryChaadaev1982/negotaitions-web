"use client";

/**
 * Single owner of the Voximplant `Core` singleton and of its log callback.
 *
 * `Core.init(options)` returns the already-created instance and discards the new
 * options ("Voximplant already initialized. Skip new options."). Whichever
 * surface mounts first therefore owns the logger for the whole page. Before this
 * module, the Session room installed a callback bound to its own hook instance;
 * after navigating to the Event lobby that unmounted callback kept receiving the
 * lobby's transport errors and forwarded them to `console.error`, which raises
 * the Next.js development overlay.
 *
 * Both surfaces now initialise through {@link initVoxCore}, which installs one
 * stable callback that dispatches to whichever surface currently owns media.
 */

import {
  classifyVoxProviderFailure,
  formatVoxProviderLog,
  logLevelForClassification,
  type VoxClassification,
  type VoxClassificationContext,
} from "@/lib/voximplant/provider-error-classification";
import {
  createWebSdkLogFilterAdapter,
  isBenignWebSdkRaceLog,
} from "@/lib/voximplant/websdk-log-filter";
import { isIntentionalProviderHandoffActive } from "@/lib/voximplant/browser-client-lifecycle";

export type VoxSdkLogProps = {
  fullMessage: string;
  message: unknown[];
  extraData?: { level?: string; scope?: string };
};

export type VoxSdkLogSink = {
  /** Stable surface name used in structured logs, e.g. `event-lobby`. */
  surface: string;
  /** Lifecycle context evaluated at log time, never captured at mount time. */
  getContext: () => VoxClassificationContext;
  /** Optional hook so a surface can drive non-blocking connection status UI. */
  onClassified?: (classification: VoxClassification) => void;
};

type VoxCoreStore = {
  sink: VoxSdkLogSink | null;
  sinkSeq: number;
  benignFilter: ReturnType<typeof createWebSdkLogFilterAdapter> | null;
};

const STORE_KEY = "__negotaitionsVoxCoreStore";

function getStore(): VoxCoreStore {
  const globalScope = globalThis as typeof globalThis & {
    [STORE_KEY]?: VoxCoreStore;
  };
  if (!globalScope[STORE_KEY]) {
    globalScope[STORE_KEY] = { sink: null, sinkSeq: 0, benignFilter: null };
  }
  return globalScope[STORE_KEY]!;
}

/**
 * Page-level deduplicator for the known benign SDK race signatures. It runs
 * before classification so those signatures keep producing exactly one warn
 * line per page instead of one per surface.
 */
function getBenignFilter(store: VoxCoreStore) {
  if (!store.benignFilter) {
    store.benignFilter = createWebSdkLogFilterAdapter({
      emitWarn: (message) => console.warn(message),
      // Handled by classification below; the adapter must not reach console.error.
      emitError: () => {},
    });
  }
  return store.benignFilter;
}

/** Re-arm the once-per-signature benign warnings for a fresh join lifecycle. */
export function resetVoxSdkLogDedupe(): void {
  getStore().benignFilter?.reset();
}

/** Test-only reset so unit tests do not inherit another test's log sink. */
export function __resetVoxCoreForTests(): void {
  const store = getStore();
  store.sink = null;
  store.sinkSeq = 0;
  store.benignFilter = null;
}

/**
 * Claim the SDK log callback for a surface. The returned release function only
 * clears the sink when it is still the current one, so a late unmount from the
 * Session room cannot detach the Event lobby that already took over.
 */
export function registerVoxSdkLogSink(sink: VoxSdkLogSink): () => void {
  const store = getStore();
  store.sinkSeq += 1;
  const seq = store.sinkSeq;
  store.sink = sink;
  return () => {
    if (store.sink === sink && store.sinkSeq === seq) {
      store.sink = null;
    }
  };
}

export function getVoxSdkLogSink(): VoxSdkLogSink | null {
  return getStore().sink;
}

const consoleByLevel = {
  debug: (message: string) => console.debug(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
} as const;

/**
 * Route one classified provider failure to the console.
 *
 * Only terminal provider failures and application invariant failures are
 * allowed to reach `console.error`; everything the application recovers from
 * stays at warn/debug so it cannot raise the development error overlay.
 */
export function emitVoxProviderDiagnostic(
  surface: string,
  classification: VoxClassification,
  context: VoxClassificationContext,
): void {
  const level = logLevelForClassification(classification);
  consoleByLevel[level](formatVoxProviderLog(surface, classification, context));
}

/**
 * Classify and report a provider failure on behalf of `surface`, returning the
 * classification so callers can drive retry and UI state from the same verdict.
 */
export function reportVoxProviderFailure(
  surface: string,
  error: unknown,
  context: VoxClassificationContext,
): VoxClassification {
  const classification = classifyVoxProviderFailure(error, context);
  emitVoxProviderDiagnostic(surface, classification, context);
  return classification;
}

/**
 * Context used while no surface owns media — for example between the Session
 * room unmounting and the Event lobby registering. Errors the SDK emits in that
 * gap belong to the handoff, so the global handoff marker still applies.
 */
function detachedContext(): VoxClassificationContext {
  const intentionalHandoff = isIntentionalProviderHandoffActive();
  return { phase: intentionalHandoff ? "handoff" : "idle", intentionalHandoff };
}

/** Entry point for every WebSDK log line, bound once for the page lifetime. */
export function dispatchVoxSdkLog(props: VoxSdkLogProps): void {
  const store = getStore();
  const fullMessage = props.fullMessage || props.message.map(String).join(" ");
  const logProps = { ...props, fullMessage };

  if (isBenignWebSdkRaceLog(logProps)) {
    getBenignFilter(store).onLog(logProps);
    return;
  }

  const sink = store.sink;
  const surface = sink?.surface ?? "detached";
  const context = sink ? sink.getContext() : detachedContext();
  const classification = classifyVoxProviderFailure({ fullMessage }, context);
  emitVoxProviderDiagnostic(surface, classification, context);
  sink?.onClassified?.(classification);
}

/**
 * `TOptions` and `TLogLevel` are inferred from the SDK module the caller
 * imported, so no call site has to restate the vendor's option types.
 */
type VoxCoreInitDeps<TOptions, TLogLevel> = {
  Core: { init: (options: TOptions) => unknown };
  LogLevel: { Error: TLogLevel };
};

/**
 * Initialise (or reuse) the WebSDK core with the shared classifying logger.
 *
 * Passing the options on every call is intentional: they only take effect on
 * the very first call of the page, and doing it here guarantees the SDK's own
 * `enableConsoleLogger` default never wins, whichever surface mounts first.
 */
export function initVoxCore<TOptions, TLogLevel>({
  Core,
  LogLevel,
}: VoxCoreInitDeps<TOptions, TLogLevel>): unknown {
  const options = {
    logger: {
      enableConsoleLogger: false,
      callbackLogLevel: LogLevel.Error,
      onLogCallback: (props: VoxSdkLogProps) => {
        dispatchVoxSdkLog(props);
      },
    },
  } as unknown as TOptions;
  return Core.init(options);
}
