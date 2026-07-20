import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRecorderStarted,
  applyRecorderStopped,
  convergeStopRace,
  createPocRecorderRegistry,
  handleStopRecordingCommand,
} from "@/lib/voximplant/poc/recorder-ownership";

test("first stop calls recorder.stop once", () => {
  const registry = createPocRecorderRegistry();
  applyRecorderStarted(registry);
  let stops = 0;
  const result = handleStopRecordingCommand(registry, "op-1", () => {
    stops += 1;
  });
  assert.equal(result.stopInvoked, true);
  assert.equal(stops, 1);
  assert.equal(registry.stopCallCount, 1);
  assert.equal(result.state, "stop_requested");
});

test("repeated operationId does not stop twice", () => {
  const registry = createPocRecorderRegistry();
  applyRecorderStarted(registry);
  let stops = 0;
  handleStopRecordingCommand(registry, "op-1", () => {
    stops += 1;
  });
  const second = handleStopRecordingCommand(registry, "op-1", () => {
    stops += 1;
  });
  assert.equal(stops, 1);
  assert.equal(second.stopInvoked, false);
  assert.equal(second.reused, true);
});

test("already-stopped state returns reused terminal result", () => {
  const registry = createPocRecorderRegistry();
  applyRecorderStarted(registry);
  handleStopRecordingCommand(registry, "op-1", () => {});
  applyRecorderStopped(registry, "op-1");
  const again = handleStopRecordingCommand(registry, "op-1", () => {
    throw new Error("should not stop again");
  });
  assert.equal(again.reused, true);
  assert.equal(again.state, "stop_completed");

  const otherOp = handleStopRecordingCommand(registry, "op-2", () => {
    throw new Error("must not restop");
  });
  assert.equal(otherOp.errorCode, "already_stopped");
  assert.equal(otherOp.stopInvoked, false);
});

test("command/report race converges", () => {
  const registry = createPocRecorderRegistry();
  applyRecorderStarted(registry);
  let stops = 0;
  const { http, afterStopped } = convergeStopRace(registry, "op-race", () => {
    stops += 1;
  });
  assert.equal(stops, 1);
  assert.equal(afterStopped, "stop_completed");
  assert.equal(http.reused, true);
});
