import assert from "node:assert/strict";
import test from "node:test";

import { shouldSkipStartRelayForStatus } from "@/lib/voximplant/recording-start-guard";

test("duplicate start command is skipped when recording already STARTING", () => {
  assert.equal(shouldSkipStartRelayForStatus("STARTING"), true);
});

test("duplicate start command is skipped when recording already RECORDING", () => {
  assert.equal(shouldSkipStartRelayForStatus("RECORDING"), true);
});

test("start command is allowed before provider confirms recording", () => {
  assert.equal(shouldSkipStartRelayForStatus("NOT_STARTED"), false);
  assert.equal(shouldSkipStartRelayForStatus("FAILED"), false);
  assert.equal(shouldSkipStartRelayForStatus("STOPPED"), false);
  assert.equal(shouldSkipStartRelayForStatus(null), false);
});
