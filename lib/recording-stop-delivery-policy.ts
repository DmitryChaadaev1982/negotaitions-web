export const STOP_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
export const STOP_RETRY_BASE_DELAY_MS = 15 * 1000;
export const STOP_RETRY_MAX_EXPONENTIAL_ATTEMPT = 8;
export const VOX_BROWSER_RELAY_MAX_ATTEMPTS = 6;
export const STARTING_NOT_READY_MAX_ATTEMPTS = 8;
export const SERVER_CONTROL_MISSING_REGISTRATION_MAX_ATTEMPTS = 8;
export const SERVER_CONTROL_TRANSPORT_MAX_ATTEMPTS = 8;

export const TERMINAL_STOP_RETRY_ERROR_CLASSES = [
  "VOXIMPLANT_BROWSER_RELAY_REQUIRED_TERMINAL",
  "RECORDING_STARTING_NOT_READY_TERMINAL",
  "VOXIMPLANT_SERVER_CONTROL_REGISTRATION_MISSING_TERMINAL",
  "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_TIMEOUT_TERMINAL",
  "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_NETWORK_FAILED_TERMINAL",
  "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_APPLICATION_REJECTED_TERMINAL",
  "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_RESPONSE_INVALID_TERMINAL",
] as const;

export function shouldDeferStartingStopForMissingProviderId(input: {
  provider: "livekit" | "voximplant";
  recordingStatus: string;
  egressId: string | null;
}) {
  return (
    input.provider === "livekit" &&
    input.recordingStatus === "STARTING" &&
    !input.egressId
  );
}

export function isTerminalStopRetryErrorClass(value: string | null | undefined) {
  if (!value) return false;
  return TERMINAL_STOP_RETRY_ERROR_CLASSES.includes(
    value as (typeof TERMINAL_STOP_RETRY_ERROR_CLASSES)[number],
  );
}

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

export function resolveServerControlMissingRegistrationFailure(
  attemptCount: number,
) {
  const terminal =
    attemptCount >= SERVER_CONTROL_MISSING_REGISTRATION_MAX_ATTEMPTS;
  return {
    terminal,
    lastErrorClass: terminal
      ? "VOXIMPLANT_SERVER_CONTROL_REGISTRATION_MISSING_TERMINAL"
      : "VOXIMPLANT_SERVER_CONTROL_REGISTRATION_MISSING",
    lastError: terminal
      ? "voximplantServerControlRegistrationMissingTerminal"
      : "voximplantServerControlRegistrationMissing",
    nextRetryAt: terminal ? null : scheduleStopRetry(attemptCount),
  };
}

export function resolveServerControlTransportFailure(
  attemptCount: number,
  code:
    | "TRANSPORT_TIMEOUT"
    | "TRANSPORT_NETWORK_FAILED"
    | "TRANSPORT_APPLICATION_REJECTED"
    | "TRANSPORT_RESPONSE_INVALID",
) {
  const terminal = attemptCount >= SERVER_CONTROL_TRANSPORT_MAX_ATTEMPTS;
  const base =
    code === "TRANSPORT_TIMEOUT"
      ? {
          lastErrorClass: "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_TIMEOUT",
          lastError: "voximplantServerControlTransportTimeout",
        }
      : code === "TRANSPORT_NETWORK_FAILED"
        ? {
            lastErrorClass: "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_NETWORK_FAILED",
            lastError: "voximplantServerControlTransportNetworkFailed",
          }
        : code === "TRANSPORT_APPLICATION_REJECTED"
          ? {
              lastErrorClass: "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_APPLICATION_REJECTED",
              lastError: "voximplantServerControlTransportApplicationRejected",
            }
          : {
              lastErrorClass: "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_RESPONSE_INVALID",
              lastError: "voximplantServerControlTransportResponseInvalid",
            };

  return {
    terminal,
    lastErrorClass: terminal
      ? `${base.lastErrorClass}_TERMINAL`
      : base.lastErrorClass,
    lastError: terminal ? `${base.lastError}Terminal` : base.lastError,
    nextRetryAt: terminal ? null : scheduleStopRetry(attemptCount),
  };
}
