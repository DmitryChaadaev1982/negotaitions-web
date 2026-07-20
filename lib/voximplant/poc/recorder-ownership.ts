/**
 * Process-local recorder ownership / idempotency model for the POC.
 * Mirrors the scenario-side registry semantics; used by unit tests and docs.
 */

export type PocRecorderPhase =
  | "absent"
  | "exists"
  | "recording_started"
  | "stop_requested"
  | "stop_completed";

export type PocRecorderRegistry = {
  phase: PocRecorderPhase;
  lastOperationId: string | null;
  stopCallCount: number;
  terminalResults: Map<string, PocStopResult>;
};

export type PocStopResult = {
  ok: boolean;
  action: "stop_recording";
  operationId: string;
  state: string;
  errorCode: string | null;
  stopInvoked: boolean;
  reused: boolean;
};

export function createPocRecorderRegistry(
  initial: Partial<PocRecorderRegistry> = {},
): PocRecorderRegistry {
  return {
    phase: initial.phase ?? "absent",
    lastOperationId: initial.lastOperationId ?? null,
    stopCallCount: initial.stopCallCount ?? 0,
    terminalResults: initial.terminalResults ?? new Map(),
  };
}

export function applyRecorderStarted(registry: PocRecorderRegistry): void {
  registry.phase = "recording_started";
}

export function applyRecorderStopped(
  registry: PocRecorderRegistry,
  operationId: string | null,
): void {
  registry.phase = "stop_completed";
  if (operationId) {
    registry.lastOperationId = operationId;
    registry.terminalResults.set(operationId, {
      ok: true,
      action: "stop_recording",
      operationId,
      state: "stop_completed",
      errorCode: null,
      stopInvoked: false,
      reused: true,
    });
  }
}

/**
 * Idempotent stop:
 * - first operationId while recording → invoke stop once
 * - repeated same operationId → reuse result, no second stop
 * - new operationId after terminal → already_stopped, no restop
 */
export function handleStopRecordingCommand(
  registry: PocRecorderRegistry,
  operationId: string,
  invokeStop: () => void,
): PocStopResult {
  const prior = registry.terminalResults.get(operationId);
  if (prior) {
    return { ...prior, reused: true, stopInvoked: false };
  }

  if (registry.phase === "stop_completed") {
    const result: PocStopResult = {
      ok: true,
      action: "stop_recording",
      operationId,
      state: "already_stopped",
      errorCode: "already_stopped",
      stopInvoked: false,
      reused: true,
    };
    registry.terminalResults.set(operationId, result);
    return result;
  }

  if (registry.phase === "stop_requested") {
    if (registry.lastOperationId === operationId) {
      return {
        ok: true,
        action: "stop_recording",
        operationId,
        state: "stop_requested",
        errorCode: null,
        stopInvoked: false,
        reused: true,
      };
    }
    return {
      ok: true,
      action: "stop_recording",
      operationId,
      state: "stop_requested",
      errorCode: "stop_in_progress",
      stopInvoked: false,
      reused: true,
    };
  }

  if (registry.phase !== "recording_started" && registry.phase !== "exists") {
    return {
      ok: false,
      action: "stop_recording",
      operationId,
      state: registry.phase,
      errorCode: "recording_not_active",
      stopInvoked: false,
      reused: false,
    };
  }

  invokeStop();
  registry.stopCallCount += 1;
  registry.phase = "stop_requested";
  registry.lastOperationId = operationId;

  const result: PocStopResult = {
    ok: true,
    action: "stop_recording",
    operationId,
    state: "stop_requested",
    errorCode: null,
    stopInvoked: true,
    reused: false,
  };
  registry.terminalResults.set(operationId, result);
  return result;
}

/** Converge HTTP accept + Stopped event race to one terminal registry state. */
export function convergeStopRace(
  registry: PocRecorderRegistry,
  operationId: string,
  invokeStop: () => void,
): { http: PocStopResult; afterStopped: PocRecorderPhase } {
  handleStopRecordingCommand(registry, operationId, invokeStop);
  applyRecorderStopped(registry, operationId);
  const replay = handleStopRecordingCommand(registry, operationId, invokeStop);
  return {
    http: replay,
    afterStopped: registry.phase,
  };
}
