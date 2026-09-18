import assert from "node:assert/strict";
import test from "node:test";

import {
  isPostTranscriptionLabMode,
  isProductionRuntime,
  shouldConnectBrowserRealtimeTransport,
} from "@/lib/test-mode";

function withEnv(
  values: Record<string, string | undefined>,
  run: () => void,
): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production ignores POST_TRANSCRIPTION_LAB and keeps realtime transport connected", () => {
  withEnv({ NODE_ENV: "production", POST_TRANSCRIPTION_LAB: "1" }, () => {
    assert.equal(isProductionRuntime(), true);
    assert.equal(isPostTranscriptionLabMode(), false);
    assert.equal(shouldConnectBrowserRealtimeTransport(), true);
  });
});

test("non-production Lab runtimes may still suppress browser realtime transport", () => {
  for (const nodeEnv of ["test", "development"]) {
    withEnv({ NODE_ENV: nodeEnv, POST_TRANSCRIPTION_LAB: "1" }, () => {
      assert.equal(isProductionRuntime(), false);
      assert.equal(isPostTranscriptionLabMode(), true);
      assert.equal(shouldConnectBrowserRealtimeTransport(), false);
    });
  }
});

test("without the flag every runtime connects realtime transport normally", () => {
  for (const nodeEnv of ["production", "development", "test"]) {
    withEnv({ NODE_ENV: nodeEnv, POST_TRANSCRIPTION_LAB: undefined }, () => {
      assert.equal(isPostTranscriptionLabMode(), false);
      assert.equal(shouldConnectBrowserRealtimeTransport(), true);
    });
  }
});

test("a non-'1' flag value never suppresses transport", () => {
  for (const value of ["0", "true", "", "yes"]) {
    withEnv({ NODE_ENV: "development", POST_TRANSCRIPTION_LAB: value }, () => {
      assert.equal(isPostTranscriptionLabMode(), false);
      assert.equal(shouldConnectBrowserRealtimeTransport(), true);
    });
  }
});

test("production detection tolerates casing and surrounding whitespace", () => {
  for (const value of ["Production", " PRODUCTION ", "production"]) {
    withEnv({ NODE_ENV: value, POST_TRANSCRIPTION_LAB: "1" }, () => {
      assert.equal(isProductionRuntime(), true);
      assert.equal(shouldConnectBrowserRealtimeTransport(), true);
    });
  }
});
