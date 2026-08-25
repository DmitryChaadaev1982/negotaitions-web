import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyVoxProviderFailure,
  formatVoxProviderLog,
  logLevelForClassification,
  parseVoxProviderSignal,
} from "@/lib/voximplant/provider-error-classification";
import { __resetVoxCoreForTests, dispatchVoxSdkLog } from "@/lib/voximplant/websdk-core";

const CONNECTED = { phase: "connected" as const };

/**
 * Production observer line from session cmt8lfu7w0000w9m1xq6hlfpj
 * (Dima / facilitator, 2026-08-25T11:58:45.189Z).
 */
export const PRODUCTION_ICE_RESTART_JSON_MESSAGE =
  '[WEBSDK] [ReInviteQueue_9712a75b-ee67-41f5-97e4-d6bfd6dee6b2] Action failed: {"id":"375fad87-aaaa-4bbb-8ccc-ddddeeeeffff","callId":"9712a75b-ee67-41f5-97e4-d6bfd6dee6b2","actionName":"IceRestartAction"}; reason: Action run failed to timeout {"id":"375fad87-aaaa-4bbb-8ccc-ddddeeeeffff","callId":"9712a75b-ee67-41f5-97e4-d6bfd6dee6b2","actionName":"IceRestartAction"}';

const PRODUCTION_ICE_RESTART_ESCAPED =
  '[WEBSDK] [ReInviteQueue_9712a75b-ee67-41f5-97e4-d6bfd6dee6b2] Action failed: {\\"id\\":\\"375fad87-aaaa-4bbb-8ccc-ddddeeeeffff\\",\\"actionName\\":\\"IceRestartAction\\"}; reason: Action run failed to timeout {\\"actionName\\":\\"IceRestartAction\\"}';

const REINVITE_FAILED_DUE_TIMEOUT =
  "[WEBSDK] [ReInviteQueue_9712a75b-ee67-41f5-97e4-d6bfd6dee6b2] ReInviteFailedDueTimeout Action run failed to timeout";

const STREAMMANAGER_DEVICE_IN_USE =
  "[WEBSDK] [StreamManager] NotReadableError: Device in use";

test("C01 JSON-in-message actionName IceRestartAction is parsed", () => {
  const signal = parseVoxProviderSignal(PRODUCTION_ICE_RESTART_JSON_MESSAGE);
  assert.equal(signal.actionName, "IceRestartAction");
  assert.match(signal.scope ?? "", /ReInviteQueue/);

  const escaped = parseVoxProviderSignal(PRODUCTION_ICE_RESTART_ESCAPED);
  assert.equal(escaped.actionName, "IceRestartAction");
});

test("C02 ReInviteQueue IceRestart timeout is recoverable, not unclassified terminal", () => {
  const classification = classifyVoxProviderFailure(
    PRODUCTION_ICE_RESTART_JSON_MESSAGE,
    CONNECTED,
  );
  assert.equal(classification.class, "RECOVERABLE_TRANSIENT");
  assert.equal(classification.unknown, false);
  assert.equal(classification.reason, "media_recovery_failed:IceRestartAction");
  assert.notEqual(classification.class, "TERMINAL_PROVIDER_FAILURE");
  assert.notEqual(classification.reason, "unclassified_provider_failure");
  assert.equal(logLevelForClassification(classification), "warn");

  const formatted = formatVoxProviderLog("session-room", classification, CONNECTED);
  assert.match(formatted, /action=IceRestartAction/);
  assert.doesNotMatch(formatted, /TERMINAL_PROVIDER_FAILURE/);
});

test("C03 ReInviteFailedDueTimeout is classified as media recovery", () => {
  const signal = parseVoxProviderSignal(REINVITE_FAILED_DUE_TIMEOUT);
  assert.equal(signal.errorType, "ReInviteFailedDueTimeout");

  const classification = classifyVoxProviderFailure(
    REINVITE_FAILED_DUE_TIMEOUT,
    CONNECTED,
  );
  assert.equal(classification.class, "RECOVERABLE_TRANSIENT");
  assert.match(classification.reason, /^media_recovery_failed:/);
  assert.equal(classification.unknown, false);
});

test("C04 StreamManager NotReadableError Device in use is local-media non-terminal", () => {
  const signal = parseVoxProviderSignal(STREAMMANAGER_DEVICE_IN_USE);
  assert.equal(signal.errorType, "NotReadableError");

  const classification = classifyVoxProviderFailure(
    STREAMMANAGER_DEVICE_IN_USE,
    { phase: "connecting" },
  );
  assert.equal(classification.class, "RECOVERABLE_TRANSIENT");
  assert.equal(classification.reason, "local_media_device_failure:NotReadableError");
  assert.equal(classification.retryable, false);
  assert.equal(classification.unknown, false);
  assert.notEqual(classification.class, "TERMINAL_PROVIDER_FAILURE");
});

test("C05 genuinely terminal provider errors stay terminal", () => {
  const auth = classifyVoxProviderFailure(
    "[WEBSDK] [Login] AuthError: invalid one time key",
    CONNECTED,
  );
  assert.equal(auth.class, "TERMINAL_PROVIDER_FAILURE");
  assert.equal(auth.reason, "provider_authorization_rejected");
  assert.equal(auth.retryable, false);

  const unknown = classifyVoxProviderFailure(
    "[WEBSDK] [Connection] QuantumFluxError: something nobody has seen",
    CONNECTED,
  );
  assert.equal(unknown.class, "TERMINAL_PROVIDER_FAILURE");
  assert.equal(unknown.unknown, true);
  assert.equal(unknown.reason, "unclassified_provider_failure");
});

test("production IceRestart observer path no longer emits unclassified terminal", () => {
  __resetVoxCoreForTests();
  const errorLines: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => errorLines.push(String(message));
  try {
    dispatchVoxSdkLog({
      fullMessage: PRODUCTION_ICE_RESTART_JSON_MESSAGE,
      message: [PRODUCTION_ICE_RESTART_JSON_MESSAGE],
      extraData: {
        level: "ERROR",
        scope: "ReInviteQueue_9712a75b-ee67-41f5-97e4-d6bfd6dee6b2",
      },
    });
  } finally {
    console.error = originalError;
    __resetVoxCoreForTests();
  }
  assert.equal(errorLines.length, 0);
});
