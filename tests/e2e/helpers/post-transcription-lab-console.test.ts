import assert from "node:assert/strict";
import test from "node:test";

import { isUnrelatedPostProcessingLabRealtimeNoise } from "./post-transcription-lab-console";

test("matches the known Lab localStorage and signaling noise signatures", () => {
  assert.equal(
    isUnrelatedPostProcessingLabRealtimeNoise(
      "Item with key lk-user-choices does not exist in local storage.",
    ),
    true,
  );
  assert.equal(
    isUnrelatedPostProcessingLabRealtimeNoise(
      "websocket closed { code: 1006, participant: undefined }",
    ),
    true,
  );
  assert.equal(
    isUnrelatedPostProcessingLabRealtimeNoise("Couldn't connect to server, attempt 1 of 1"),
    true,
  );
  assert.equal(
    isUnrelatedPostProcessingLabRealtimeNoise(
      "ConnectionError: could not establish signal connection: Failed to fetch",
    ),
    true,
  );
});

test("does not treat genuine Product failures as Lab realtime noise", () => {
  assert.equal(
    isUnrelatedPostProcessingLabRealtimeNoise("Unexpected token '<'"),
    false,
  );
  assert.equal(
    isUnrelatedPostProcessingLabRealtimeNoise("materials/status 500"),
    false,
  );
});
