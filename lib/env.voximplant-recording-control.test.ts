import assert from "node:assert/strict";
import test from "node:test";

import { getVoximplantRecordingControlSecret } from "@/lib/env";

const KEY = "VOXIMPLANT_RECORDING_CONTROL_SECRET";

function withEnv(
  updates: Record<string, string | undefined>,
  run: () => void,
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("recording control secret is required", () => {
  withEnv({ [KEY]: undefined }, () => {
    assert.throws(
      () => getVoximplantRecordingControlSecret(),
      /Missing required VOXIMPLANT_RECORDING_CONTROL_SECRET/,
    );
  });
});

test("recording control secret must be at least 16 chars", () => {
  withEnv({ [KEY]: "short-secret" }, () => {
    assert.throws(
      () => getVoximplantRecordingControlSecret(),
      /Expected at least 16 characters/,
    );
  });
});

test("recording control secret returns trimmed value", () => {
  withEnv({ [KEY]: " 0123456789abcdef " }, () => {
    assert.equal(getVoximplantRecordingControlSecret(), "0123456789abcdef");
  });
});
