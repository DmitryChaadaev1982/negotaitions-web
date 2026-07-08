import assert from "node:assert/strict";
import test from "node:test";

import { shouldRunLivekitRecordingLifecycle } from "@/lib/session-control-recording-policy";

test("livekit recording lifecycle runs only on START/FINISH actions", () => {
  assert.equal(shouldRunLivekitRecordingLifecycle("START"), true);
  assert.equal(shouldRunLivekitRecordingLifecycle("FINISH"), true);
  assert.equal(shouldRunLivekitRecordingLifecycle("PAUSE"), false);
  assert.equal(shouldRunLivekitRecordingLifecycle("RESUME"), false);
  assert.equal(shouldRunLivekitRecordingLifecycle("START_PREPARATION"), false);
  assert.equal(shouldRunLivekitRecordingLifecycle("STOP_PREPARATION"), false);
});
