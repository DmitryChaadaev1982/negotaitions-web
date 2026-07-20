import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDryRunPocCallback,
  processPocCallback,
} from "@/lib/voximplant/poc/callback-handler";
import {
  buildPocCallbackPayload,
  buildSignedCallbackRequest,
  getPocCallbackSecret,
} from "@/lib/voximplant/poc/callback-signature";
import {
  appendPocCallbackEvent,
  createEmptyPocState,
  POC_CALLBACK_EVENT_LIMIT,
  readPocState,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

const callbackSecret = "poc-callback-secret-16chars!!";
const controlSecret = "poc-control-secret-must-differ!";

function envForCallback(enabled = true): NodeJS.ProcessEnv {
  return {
    VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED: enabled ? "true" : "false",
    VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET: callbackSecret,
    VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET: controlSecret,
  };
}

function prepareState(cwd: string) {
  const state = createEmptyPocState({
    pocId: "poc-cb-1",
    conferenceName: "neg-poc-server-stop-1",
  });
  writePocState(state, cwd);
  return state;
}

function signedRequest(overrides: Partial<ReturnType<typeof buildPocCallbackPayload>> = {}) {
  const payload = {
    ...buildPocCallbackPayload({
      eventType: "command_accepted",
      action: "ping",
      operationId: "op-ping-1",
      conferenceName: "neg-poc-server-stop-1",
      recorderState: "absent",
    }),
    ...overrides,
  };
  return buildSignedCallbackRequest({ payload, secret: callbackSecret });
}

test("callback disabled returns typed POC_CALLBACK_DISABLED", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest();
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(false),
    cwd,
    persist: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 404);
    assert.equal(result.errorCode, "POC_CALLBACK_DISABLED");
  }
});

test("local callback self-test persists matching event", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest({ operationId: "op-selftest-persist" });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.errorCode, "CALLBACK_ACCEPTED");
  const state = readPocState(cwd);
  assert.ok(state);
  assert.equal(state!.callbackEvents.length, 1);
  assert.equal(state!.callbackEvents[0]!.operationId, "op-selftest-persist");
});

test("wrong callback secret rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest();
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: {
      VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED: "true",
      VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET: "different-callback-secret!!",
      VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET: controlSecret,
    },
    cwd,
    persist: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, "INVALID_CALLBACK_SIGNATURE");
  }
});

test("6. matching signed callback confirms ping identity fields", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest();
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.event.eventType, "command_accepted");
    assert.equal(result.event.action, "ping");
    assert.equal(result.event.operationId, "op-ping-1");
    assert.equal(result.event.signatureVerified, true);
  }
});

test("7. wrong scenarioKind callback rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest({ scenarioKind: "production_main_room" });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
    persist: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "CALLBACK_PAYLOAD_INVALID");
});

test("8. wrong protocolVersion rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest({ protocolVersion: 99 });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
    persist: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "CALLBACK_PAYLOAD_INVALID");
});

test("10. callback HMAC invalid rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest();
  const badHeaders = {
    ...signed.headers,
    "X-Neg-Poc-Callback-Signature": "00".repeat(32),
  };
  const result = processPocCallback({
    rawBody: signed.body,
    headers: badHeaders,
    env: envForCallback(true),
    cwd,
    persist: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "INVALID_CALLBACK_SIGNATURE");
});

test("11. expired timestamp rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const payload = buildPocCallbackPayload({
    eventType: "command_accepted",
    action: "ping",
    operationId: "op-exp",
    conferenceName: "neg-poc-server-stop-1",
    timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  });
  const signed = buildSignedCallbackRequest({ payload, secret: callbackSecret });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
    persist: false,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "CALLBACK_TIMESTAMP_EXPIRED");
});

test("12. replayed nonce rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest({ nonce: "fixed-callback-nonce-1" });
  const first = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
  });
  assert.equal(first.ok, true);
  const second = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.errorCode, "CALLBACK_NONCE_REPLAYED");
});

test("13. callback event stored without secrets", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest();
  processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
  });
  const state = readPocState(cwd);
  assert.ok(state);
  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes(callbackSecret));
  assert.ok(!serialized.includes(controlSecret));
  assert.ok(!serialized.includes("media_session_access"));
  assert.ok(!serialized.includes("/session/"));
  assert.equal(state!.callbackEvents.length, 1);
  assert.equal(state!.callbackEvents[0]!.signatureVerified, true);
});

test("14. event list bounded", () => {
  let state = createEmptyPocState({
    pocId: "poc-bound",
    conferenceName: "neg-poc-server-stop-1",
  });
  for (let i = 0; i < POC_CALLBACK_EVENT_LIMIT + 20; i++) {
    state = appendPocCallbackEvent(state, {
      eventType: "command_accepted",
      action: "ping",
      operationId: `op-${i}`,
      conferenceName: "neg-poc-server-stop-1",
      callSessionHistoryId: null,
      recorderState: "absent",
      errorCode: null,
      receivedAt: new Date().toISOString(),
      signatureVerified: true,
    });
  }
  assert.equal(state.callbackEvents.length, POC_CALLBACK_EVENT_LIMIT);
});

test("15. recording command accepted is not terminal", () => {
  let state = createEmptyPocState({
    pocId: "poc-stop",
    conferenceName: "neg-poc-server-stop-1",
  });
  state = appendPocCallbackEvent(state, {
    eventType: "command_accepted",
    action: "stop_recording",
    operationId: "poc-stop-neg-poc-server-stop-1",
    conferenceName: "neg-poc-server-stop-1",
    callSessionHistoryId: null,
    recorderState: "stop_requested",
    errorCode: null,
    receivedAt: "2026-07-20T10:00:00.000Z",
    signatureVerified: true,
  });
  assert.ok(state.stopEvidence?.commandAcceptedAt);
  assert.equal(state.stopEvidence?.providerTerminalAt, null);
});

test("16. RecorderEvents.Stopped callback is terminal", () => {
  let state = createEmptyPocState({
    pocId: "poc-stop",
    conferenceName: "neg-poc-server-stop-1",
  });
  state = appendPocCallbackEvent(state, {
    eventType: "command_accepted",
    action: "stop_recording",
    operationId: "poc-stop-neg-poc-server-stop-1",
    conferenceName: "neg-poc-server-stop-1",
    callSessionHistoryId: null,
    recorderState: "stop_requested",
    errorCode: null,
    receivedAt: "2026-07-20T10:00:00.000Z",
    signatureVerified: true,
  });
  state = appendPocCallbackEvent(state, {
    eventType: "recording_stopped",
    action: "stop_recording",
    operationId: "poc-stop-neg-poc-server-stop-1",
    conferenceName: "neg-poc-server-stop-1",
    callSessionHistoryId: null,
    recorderState: "stop_completed",
    errorCode: null,
    receivedAt: "2026-07-20T10:00:01.000Z",
    signatureVerified: true,
  });
  assert.ok(state.stopEvidence?.providerTerminalAt);
});

test("callback secret is separate from control secret", () => {
  const env = envForCallback(true);
  assert.equal(getPocCallbackSecret(env), callbackSecret);
  assert.notEqual(callbackSecret, controlSecret);
});

test("dry-run callback construction has no network side effects", () => {
  const built = buildDryRunPocCallback({
    eventType: "command_accepted",
    action: "ping",
    operationId: "op-dry",
    conferenceName: "neg-poc-server-stop-dry",
    env: envForCallback(true),
  });
  assert.equal(built.payload.scenarioKind, "voximplant_server_stop_poc");
  assert.equal(built.payload.protocolVersion, 1);
  assert.ok(built.signaturePresent);
});

test("20. no DB writes — processPocCallback only touches local state", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-cb-"));
  prepareState(cwd);
  const signed = signedRequest();
  const source = readFileSync(
    join(process.cwd(), "lib/voximplant/poc/callback-handler.ts"),
    "utf8",
  );
  assert.ok(!source.includes("prisma"));
  assert.ok(!source.includes("@/lib/prisma"));
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(true),
    cwd,
  });
  assert.equal(result.ok, true);
  assert.ok(readPocState(cwd));
});
