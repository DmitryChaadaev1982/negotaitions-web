import assert from "node:assert/strict";
import test from "node:test";

import {
  LAYER3_RECOVERY_MUST_NOT_DISPATCH_RECORDING,
  shouldSkipStartRelayForStatus,
} from "@/lib/voximplant/recording-start-guard";

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

test("Layer-3 media recovery must not dispatch recording START or STOP", () => {
  assert.equal(LAYER3_RECOVERY_MUST_NOT_DISPATCH_RECORDING.start, false);
  assert.equal(LAYER3_RECOVERY_MUST_NOT_DISPATCH_RECORDING.stop, false);
});
