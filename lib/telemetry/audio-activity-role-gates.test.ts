import assert from "node:assert/strict";
import test from "node:test";

import { shouldEnableLocalMicTelemetryForRole } from "@/lib/telemetry/audio-activity-role-gates";

test("participant role enables local tracker", () => {
  assert.equal(shouldEnableLocalMicTelemetryForRole("PARTICIPANT"), true);
});

test("facilitator role disables local tracker", () => {
  assert.equal(shouldEnableLocalMicTelemetryForRole("FACILITATOR"), false);
});

test("observer role disables local tracker", () => {
  assert.equal(shouldEnableLocalMicTelemetryForRole("OBSERVER"), false);
});

test("unknown role disables local tracker until known", () => {
  assert.equal(shouldEnableLocalMicTelemetryForRole(null), false);
  assert.equal(shouldEnableLocalMicTelemetryForRole(undefined), false);
});

