export type OwnedAnalysisFailure = {
  errorClass: string;
  userMessage: string;
  originalError: unknown;
};

export type OwnedAnalysisExecutionResult<T> =
  | { state: "completed"; value: T }
  | { state: "failed"; failure: OwnedAnalysisFailure }
  | { state: "ownership_lost" };

/**
 * Keeps durable terminalization ahead of all best-effort observability. The
 * callbacks are deliberately single-operation calls; callers must not wrap
 * `run` (which can call an external provider) in a database transaction.
 */
export async function executeOwnedAnalysis<T>(params: {
  run: () => Promise<T>;
  complete: (value: T) => Promise<boolean>;
  fail: (failure: OwnedAnalysisFailure) => Promise<boolean>;
  classifyFailure: (error: unknown) => OwnedAnalysisFailure;
  isOwnershipLost: (error: unknown) => boolean;
  observeSuccess?: (value: T) => void | Promise<void>;
  observeFailure?: (failure: OwnedAnalysisFailure) => void | Promise<void>;
  observeInstrumentationFailure?: (
    phase: "success" | "failure",
    error: unknown,
  ) => void;
}): Promise<OwnedAnalysisExecutionResult<T>> {
  try {
    const value = await params.run();
    if (!(await params.complete(value))) {
      return { state: "ownership_lost" };
    }
    try {
      await params.observeSuccess?.(value);
    } catch (error) {
      try {
        params.observeInstrumentationFailure?.("success", error);
      } catch {
        // Instrumentation must never change the durable result.
      }
    }
    return { state: "completed", value };
  } catch (error) {
    if (params.isOwnershipLost(error)) {
      return { state: "ownership_lost" };
    }
    const failure = params.classifyFailure(error);
    if (!(await params.fail(failure))) {
      return { state: "ownership_lost" };
    }
    try {
      await params.observeFailure?.(failure);
    } catch (loggingError) {
      try {
        params.observeInstrumentationFailure?.("failure", loggingError);
      } catch {
        // The original failure remains authoritative.
      }
    }
    return { state: "failed", failure };
  }
}
