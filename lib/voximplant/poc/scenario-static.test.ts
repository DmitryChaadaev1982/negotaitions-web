import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const scenarioPath = resolve(
  process.cwd(),
  "docs/voximplant/neg-conf.server-stop-poc.scenario.js",
);
const source = readFileSync(scenarioPath, "utf8");

test("POC scenario registers AppEvents.HttpRequest handler", () => {
  assert.match(source, /AppEvents\.HttpRequest/);
  assert.match(source, /handleHttpRequest/);
});

test("POC scenario allow-lists ping/get_recording_state/stop_recording", () => {
  assert.match(source, /"ping"/);
  assert.match(source, /"get_recording_state"/);
  assert.match(source, /"stop_recording"/);
});

test("POC scenario stops recorder and listens for RecorderEvents.Stopped", () => {
  assert.match(source, /recorder\.stop\(\)/);
  assert.match(source, /RecorderEvents\.Stopped/);
});

test("POC scenario validates HMAC and rejects replay/unknown action", () => {
  assert.match(source, /invalid_signature/);
  assert.match(source, /replayed_nonce/);
  assert.match(source, /unknown_action/);
  assert.match(source, /expired_timestamp/);
});

test("POC scenario uses separate CALLBACK_SECRET for async callbacks", () => {
  assert.match(source, /CALLBACK_SECRET/);
  assert.match(
    source,
    /__PASTE_VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET_HERE__/,
  );
  assert.match(source, /sendSignedPocCallback/);
  assert.match(source, /command_accepted/);
  assert.match(source, /recording_stopped/);
  // Must not HMAC callbacks with CONTROL_SECRET.
  assert.ok(!/hmacSha256Hex\(\s*body\s*,\s*CONTROL_SECRET\s*\)/.test(source));
  assert.match(source, /hmacSha256Hex\(signingPayload,\s*CALLBACK_SECRET\)/);
});

test("POC scenario identity constants present for callback payload", () => {
  assert.match(source, /SCENARIO_KIND\s*=\s*"voximplant_server_stop_poc"/);
  assert.match(source, /PROTOCOL_VERSION\s*=\s*1/);
  assert.match(source, /SCENARIO_SOURCE_NAME\s*=\s*"neg-conf-server-stop-poc"/);
  assert.match(source, /scenarioKind:\s*SCENARIO_KIND/);
  assert.match(source, /protocolVersion:\s*PROTOCOL_VERSION/);
});

test("POC scenario keeps dedicated conference name prefix", () => {
  assert.match(source, /CONFERENCE_NAME_PREFIX_POC\s*=\s*"neg-poc-server-stop-"/);
});

test("POC scenario warns not to log raw Application.Started", () => {
  assert.match(source, /Never log raw Application\.Started/);
});

test("POC scenario supports browser-originated recording_control start", () => {
  assert.match(source, /CallEvents\.MessageReceived/);
  assert.match(source, /handleRecordingControlMessage/);
  assert.match(source, /startRecordingFromBrowser/);
  assert.match(source, /recording_control/);
  assert.match(source, /conference\.sendMediaTo/);
  assert.match(source, /VoxEngine\.createRecorder/);
  assert.match(source, /recording_started/);
  // Auto-start on CallAlerting removed — browser message starts recording.
  assert.ok(!source.includes("ensureDemoRecorderIfNeeded"));
});

test("scenario callback-result logging redacts URL/signature/secret", () => {
  assert.match(source, /CALLBACK_HTTP_ACCEPTED/);
  assert.match(source, /CALLBACK_HTTP_REJECTED/);
  assert.match(source, /CALLBACK_HTTP_TIMEOUT/);
  assert.match(source, /logCallbackHttpResult/);
  assert.match(source, /callbackSecretSha256Prefix/);
  const fnStart = source.indexOf("function logCallbackHttpResult");
  assert.ok(fnStart > 0);
  const fnEnd = source.indexOf("function sendSignedPocCallback", fnStart);
  const fnBody = source.slice(fnStart, fnEnd);
  assert.ok(!fnBody.includes("POC_CALLBACK_URL"));
  assert.ok(!fnBody.includes("CALLBACK_SECRET"));
  assert.ok(!fnBody.includes("X-Neg-Poc-Callback-Signature"));
  assert.ok(!fnBody.includes("postData"));
});
