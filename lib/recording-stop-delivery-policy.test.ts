import test from "node:test";
import assert from "node:assert/strict";

import {
  isTerminalStopRetryErrorClass,
  resolveStartingNotReadyFailure,
  resolveServerControlMissingRegistrationFailure,
  resolveServerControlTransportFailure,
  resolveVoxRelayFailure,
  SERVER_CONTROL_MISSING_REGISTRATION_MAX_ATTEMPTS,
  SERVER_CONTROL_TRANSPORT_MAX_ATTEMPTS,
  scheduleStopRetry,
  shouldDeferStartingStopForMissingProviderId,
  STARTING_NOT_READY_MAX_ATTEMPTS,
  VOX_BROWSER_RELAY_MAX_ATTEMPTS,
} from "@/lib/recording-stop-delivery-policy";

// Stage 3.10 traceability:
// ST310-RECORDING-003, ST310-VOX-009, ST310-RACE-008

test("scheduleStopRetry increases delay with bounded cap", () => {
  const first = scheduleStopRetry(1).getTime();
  const sixth = scheduleStopRetry(6).getTime();
  const tenth = scheduleStopRetry(10).getTime();
  assert.ok(sixth > first);
  assert.ok(tenth >= sixth);
});

test("resolveVoxRelayFailure becomes terminal after max attempts", () => {
  const retryable = resolveVoxRelayFailure(VOX_BROWSER_RELAY_MAX_ATTEMPTS - 1);
  assert.equal(retryable.terminal, false);
  assert.ok(retryable.nextRetryAt instanceof Date);
  assert.equal(retryable.lastError, "voximplantBrowserRelayRequired");

  const terminal = resolveVoxRelayFailure(VOX_BROWSER_RELAY_MAX_ATTEMPTS);
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.nextRetryAt, null);
  assert.equal(terminal.lastError, "voximplantBrowserRelayRequiredTerminal");
});

test("resolveStartingNotReadyFailure becomes terminal after max attempts", () => {
  const retryable = resolveStartingNotReadyFailure(
    STARTING_NOT_READY_MAX_ATTEMPTS - 1,
  );
  assert.equal(retryable.terminal, false);
  assert.ok(retryable.nextRetryAt instanceof Date);
  assert.equal(retryable.lastError, "recordingStartingNotReady");

  const terminal = resolveStartingNotReadyFailure(
    STARTING_NOT_READY_MAX_ATTEMPTS,
  );
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.nextRetryAt, null);
  assert.equal(terminal.lastError, "recordingStartingNotReadyTerminal");
});

test("missing provider ID defers LiveKit STARTING but never blocks fenced Vox STOP", () => {
  assert.equal(
    shouldDeferStartingStopForMissingProviderId({
      provider: "livekit",
      recordingStatus: "STARTING",
      egressId: null,
    }),
    true,
  );
  assert.equal(
    shouldDeferStartingStopForMissingProviderId({
      provider: "voximplant",
      recordingStatus: "STARTING",
      egressId: null,
    }),
    false,
  );
});

test("resolveServerControlMissingRegistrationFailure schedules retry", () => {
  const result = resolveServerControlMissingRegistrationFailure(2);
  assert.equal(result.terminal, false);
  assert.equal(result.lastErrorClass, "VOXIMPLANT_SERVER_CONTROL_REGISTRATION_MISSING");
  assert.equal(result.lastError, "voximplantServerControlRegistrationMissing");
  assert.ok(result.nextRetryAt instanceof Date);
});

test("resolveServerControlMissingRegistrationFailure becomes terminal after max attempts", () => {
  const terminal = resolveServerControlMissingRegistrationFailure(
    SERVER_CONTROL_MISSING_REGISTRATION_MAX_ATTEMPTS,
  );
  assert.equal(terminal.terminal, true);
  assert.equal(
    terminal.lastErrorClass,
    "VOXIMPLANT_SERVER_CONTROL_REGISTRATION_MISSING_TERMINAL",
  );
  assert.equal(
    terminal.lastError,
    "voximplantServerControlRegistrationMissingTerminal",
  );
  assert.equal(terminal.nextRetryAt, null);
  assert.equal(
    isTerminalStopRetryErrorClass(terminal.lastErrorClass),
    true,
  );
});

test("resolveServerControlTransportFailure maps transport classes", () => {
  const timeout = resolveServerControlTransportFailure(2, "TRANSPORT_TIMEOUT");
  assert.equal(
    timeout.lastErrorClass,
    "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_TIMEOUT",
  );

  const network = resolveServerControlTransportFailure(
    2,
    "TRANSPORT_NETWORK_FAILED",
  );
  assert.equal(
    network.lastErrorClass,
    "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_NETWORK_FAILED",
  );

  const appRejected = resolveServerControlTransportFailure(
    2,
    "TRANSPORT_APPLICATION_REJECTED",
  );
  assert.equal(
    appRejected.lastErrorClass,
    "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_APPLICATION_REJECTED",
  );
});

test("resolveServerControlTransportFailure becomes terminal after max attempts", () => {
  const terminal = resolveServerControlTransportFailure(
    SERVER_CONTROL_TRANSPORT_MAX_ATTEMPTS,
    "TRANSPORT_TIMEOUT",
  );
  assert.equal(terminal.terminal, true);
  assert.equal(
    terminal.lastErrorClass,
    "VOXIMPLANT_SERVER_CONTROL_TRANSPORT_TIMEOUT_TERMINAL",
  );
  assert.equal(
    terminal.lastError,
    "voximplantServerControlTransportTimeoutTerminal",
  );
  assert.equal(terminal.nextRetryAt, null);
  assert.equal(
    isTerminalStopRetryErrorClass(terminal.lastErrorClass),
    true,
  );
});
