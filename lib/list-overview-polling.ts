export const LIST_OVERVIEW_POLL_INTERVAL_MS = 2_000;

export type VisibleListPollRuntime = {
  setInterval: (handler: () => void, intervalMs: number) => number;
  clearInterval: (intervalId: number) => void;
  addEventListener: (type: "visibilitychange" | "focus", listener: () => void) => void;
  removeEventListener: (
    type: "visibilitychange" | "focus",
    listener: () => void,
  ) => void;
  visibilityState: () => DocumentVisibilityState;
};

function browserVisibleListPollRuntime(): VisibleListPollRuntime {
  return {
    setInterval: (handler, intervalMs) => window.setInterval(handler, intervalMs),
    clearInterval: (intervalId) => {
      window.clearInterval(intervalId);
    },
    addEventListener: (type, listener) => {
      if (type === "visibilitychange") {
        document.addEventListener(type, listener);
        return;
      }
      window.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      if (type === "visibilitychange") {
        document.removeEventListener(type, listener);
        return;
      }
      window.removeEventListener(type, listener);
    },
    visibilityState: () => document.visibilityState,
  };
}

export function startVisibleListPoll(params: {
  refresh: (signal: AbortSignal) => Promise<void>;
  intervalMs?: number;
  runtime?: VisibleListPollRuntime;
}): { stop: () => void } {
  const runtime = params.runtime ?? browserVisibleListPollRuntime();
  const intervalMs = params.intervalMs ?? LIST_OVERVIEW_POLL_INTERVAL_MS;
  let cancelled = false;
  let inFlight = false;
  let currentController: AbortController | null = null;

  const refresh = async () => {
    if (cancelled || inFlight) {
      return;
    }
    inFlight = true;
    currentController?.abort();
    const controller = new AbortController();
    currentController = controller;
    try {
      await params.refresh(controller.signal);
    } catch {
      // Ignore transient polling errors; the next cycle retries.
    } finally {
      inFlight = false;
    }
  };

  void refresh();
  const intervalId = runtime.setInterval(() => {
    if (runtime.visibilityState() === "visible") {
      void refresh();
    }
  }, intervalMs);
  const handleVisibilityChange = () => {
    if (runtime.visibilityState() === "visible") {
      void refresh();
    }
  };
  const handleFocus = () => {
    void refresh();
  };
  runtime.addEventListener("visibilitychange", handleVisibilityChange);
  runtime.addEventListener("focus", handleFocus);

  return {
    stop: () => {
      cancelled = true;
      currentController?.abort();
      runtime.clearInterval(intervalId);
      runtime.removeEventListener("visibilitychange", handleVisibilityChange);
      runtime.removeEventListener("focus", handleFocus);
    },
  };
}
