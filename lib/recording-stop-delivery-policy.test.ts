import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveStartingNotReadyFailure,
  resolveVoxRelayFailure,
  scheduleStopRetry,
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
