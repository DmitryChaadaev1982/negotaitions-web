import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const scenarioPath = resolve(
  process.cwd(),
  "docs/voximplant/neg-conf.main-room.scenario.js",
);
const scenarioSource = readFileSync(scenarioPath, "utf8");

// Stage 3.10 traceability:
// ST310-VOX-011, ST310-VOX-012, ST310-VOX-013, ST310-VOX-014, ST310-VOX-015, ST310-VOX-016

test("scenario build marker is bumped for A7 checkpoint", () => {
  assert.match(
    scenarioSource,
    /SCENARIO_BUILD_ID\s*=\s*"server-poc-webhook-fix-2026-07-13-a7"/,
  );
});

test("ConferenceEvents.Stopped requests recorder shutdown stop", () => {
  assert.match(
    scenarioSource,
    /ConferenceEvents", "Stopped"[\s\S]*requestRecorderStopForScenarioShutdown\("ConferenceEvents\.Stopped"\)/,
  );
});

test("AppEvents.Terminating requests recorder shutdown stop", () => {
  assert.match(
    scenarioSource,
    /AppEvents", "Terminating"[\s\S]*requestRecorderStopForScenarioShutdown\("AppEvents\.Terminating"\)/,
  );
});

test("CallEvents.Disconnected remains participant counter only", () => {
  const disconnectedBlock =
    scenarioSource.match(
      /CallEvents", "Disconnected", function \(\) \{[\s\S]*?\n  \}, "CallEvents\.Disconnected"\);/,
    )?.[0] ?? "";
  assert.ok(disconnectedBlock.length > 0);
  assert.ok(!disconnectedBlock.includes("stopRecording("));
  assert.ok(!disconnectedBlock.includes("requestRecorderStopForScenarioShutdown("));
});

test("stopRecording handles already-stopping and already-stopped states", () => {
  assert.match(
    scenarioSource,
    /if \(recordingState === STATE_STOPPING\) \{[\s\S]*Recording stop is already in progress\./,
  );
  assert.match(
    scenarioSource,
    /if \(recordingState === STATE_IDLE \|\| recordingState === STATE_STOPPED\) \{[\s\S]*Recording is not active\./,
  );
});
