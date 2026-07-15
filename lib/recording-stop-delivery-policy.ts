export const STOP_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
export const STOP_RETRY_BASE_DELAY_MS = 15 * 1000;
export const STOP_RETRY_MAX_EXPONENTIAL_ATTEMPT = 8;
export const VOX_BROWSER_RELAY_MAX_ATTEMPTS = 6;
export const STARTING_NOT_READY_MAX_ATTEMPTS = 8;

export function scheduleStopRetry(attemptCount: number) {
  const boundedAttempt = Math.max(
    1,
    Math.min(attemptCount, STOP_RETRY_MAX_EXPONENTIAL_ATTEMPT),
  );
  const retryDelayMs = Math.min(
    STOP_RETRY_MAX_DELAY_MS,
    STOP_RETRY_BASE_DELAY_MS * Math.pow(2, boundedAttempt - 1),
  );
  return new Date(Date.now() + retryDelayMs);
}

export function resolveVoxRelayFailure(attemptCount: number) {
  const terminal = attemptCount >= VOX_BROWSER_RELAY_MAX_ATTEMPTS;
  return {
    terminal,
    lastErrorClass: terminal
      ? "VOXIMPLANT_BROWSER_RELAY_REQUIRED_TERMINAL"
      : "VOXIMPLANT_BROWSER_RELAY_REQUIRED",
    lastError: terminal
      ? "voximplantBrowserRelayRequiredTerminal"
      : "voximplantBrowserRelayRequired",
    nextRetryAt: terminal ? null : scheduleStopRetry(attemptCount),
  };
}

export function resolveStartingNotReadyFailure(attemptCount: number) {
  const terminal = attemptCount >= STARTING_NOT_READY_MAX_ATTEMPTS;
  return {
    terminal,
    lastErrorClass: terminal
      ? "RECORDING_STARTING_NOT_READY_TERMINAL"
      : "RECORDING_STARTING_NOT_READY",
    lastError: terminal
      ? "recordingStartingNotReadyTerminal"
      : "recordingStartingNotReady",
    nextRetryAt: terminal ? null : scheduleStopRetry(attemptCount),
  };
}
