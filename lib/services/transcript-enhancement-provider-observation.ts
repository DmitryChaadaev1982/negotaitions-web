export type EnhancementProviderCallObservation = {
  runId: string | null;
  transcriptId: string;
  chunkIndex: number;
  /** 1-based POST attempt for this chunk within the current run. */
  attemptNumber?: number;
  requestStartedAt: string | null;
  responseReceivedAt: string | null;
  httpClass: string | null;
  schemaValid: boolean | null;
  checkpointAccepted: boolean | null;
  checkpointRejectionReason: string | null;
};

export type EnhancementProviderCallObserver = (
  event: EnhancementProviderCallObservation,
) => Promise<void> | void;

/**
 * Next compiles `instrumentation` and App Router request handlers as separate
 * graphs. A module-local `let` therefore cannot carry the Isolated UAT
 * observer from `lib/instrumentation/node-runtime.ts` into
 * `executeTranscriptEnhancement`. One process-global slot is the observation
 * registry only; it does not change checkpoint or publication authority.
 */
const PROCESS_OBSERVER_KEY = "__negotaitionsEnhancementProviderCallObserver__";

type ObserverSlot = { current: EnhancementProviderCallObserver | null };

function processObserverSlot(): ObserverSlot {
  const scope = globalThis as typeof globalThis & {
    [PROCESS_OBSERVER_KEY]?: ObserverSlot;
  };
  scope[PROCESS_OBSERVER_KEY] ??= { current: null };
  return scope[PROCESS_OBSERVER_KEY];
}

export function setEnhancementProviderCallObserver(
  observer: EnhancementProviderCallObserver | null,
): void {
  processObserverSlot().current = observer;
}

export function getEnhancementProviderCallObserver(): EnhancementProviderCallObserver | null {
  return processObserverSlot().current;
}

export function resolveEnhancementProviderCallObserver(
  injected?: EnhancementProviderCallObserver | null,
): EnhancementProviderCallObserver | null {
  return injected ?? processObserverSlot().current;
}

export async function notifyEnhancementProviderCall(
  observer: EnhancementProviderCallObserver | null | undefined,
  event: EnhancementProviderCallObservation,
): Promise<void> {
  if (!observer) return;
  try {
    await observer(event);
  } catch {
    // Observation must never change provider, checkpoint, or publication results.
  }
}
