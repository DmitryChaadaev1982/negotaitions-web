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

test("POC scenario ping identity handshake constants are present", () => {
  assert.match(source, /scenarioKind:\s*SCENARIO_KIND/);
  assert.match(source, /protocolVersion:\s*PROTOCOL_VERSION/);
  assert.match(source, /SCENARIO_KIND\s*=\s*"voximplant_server_stop_poc"/);
  assert.match(source, /PROTOCOL_VERSION\s*=\s*1/);
  assert.match(source, /SCENARIO_SOURCE_NAME\s*=\s*"neg-conf-server-stop-poc"/);
});

test("POC scenario keeps dedicated conference name prefix", () => {
  assert.match(source, /CONFERENCE_NAME_PREFIX_POC\s*=\s*"neg-poc-server-stop-"/);
});
