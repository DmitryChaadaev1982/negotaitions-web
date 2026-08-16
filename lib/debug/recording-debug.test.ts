import assert from "node:assert/strict";
import test from "node:test";

import { isRecordingDebugEnabled } from "@/lib/debug/recording-debug";

const mutableEnv = process.env as Record<string, string | undefined>;

const GATE_KEYS = [
  "NODE_ENV",
  "RECORDING_DEBUG_PANEL",
  "NEXT_PUBLIC_RECORDING_DEBUG_PANEL",
] as const;

function withRecordingDebugEnv(
  values: Partial<Record<(typeof GATE_KEYS)[number], string | undefined>>,
  operation: () => void,
): void {
  const original = Object.fromEntries(
    GATE_KEYS.map((key) => [key, mutableEnv[key]]),
  ) as Record<(typeof GATE_KEYS)[number], string | undefined>;
  try {
    for (const key of GATE_KEYS) {
      if (values[key] === undefined) {
        Reflect.deleteProperty(mutableEnv, key);
      } else {
        mutableEnv[key] = values[key];
      }
    }
    operation();
  } finally {
    for (const key of GATE_KEYS) {
      if (original[key] === undefined) {
        Reflect.deleteProperty(mutableEnv, key);
      } else {
        mutableEnv[key] = original[key];
      }
    }
  }
}

test("production refuses RECORDING_DEBUG_PANEL=true", () => {
  withRecordingDebugEnv(
    {
      NODE_ENV: "production",
      RECORDING_DEBUG_PANEL: "true",
    },
    () => {
      assert.equal(isRecordingDebugEnabled(), false);
    },
  );
});

test("production refuses NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true", () => {
  withRecordingDebugEnv(
    {
      NODE_ENV: "production",
      NEXT_PUBLIC_RECORDING_DEBUG_PANEL: "true",
    },
    () => {
      assert.equal(isRecordingDebugEnabled(), false);
    },
  );
});

test("production refuses both recording-debug flags", () => {
  withRecordingDebugEnv(
    {
      NODE_ENV: "production",
      RECORDING_DEBUG_PANEL: "true",
      NEXT_PUBLIC_RECORDING_DEBUG_PANEL: "true",
    },
    () => {
      assert.equal(isRecordingDebugEnabled(), false);
    },
  );
});

test("non-production enables RECORDING_DEBUG_PANEL=true", () => {
  withRecordingDebugEnv(
    {
      NODE_ENV: "development",
      RECORDING_DEBUG_PANEL: "true",
    },
    () => {
      assert.equal(isRecordingDebugEnabled(), true);
    },
  );
});

test("non-production enables NEXT_PUBLIC_RECORDING_DEBUG_PANEL=true", () => {
  withRecordingDebugEnv(
    {
      NODE_ENV: "test",
      NEXT_PUBLIC_RECORDING_DEBUG_PANEL: "true",
    },
    () => {
      assert.equal(isRecordingDebugEnabled(), true);
    },
  );
});

test("unset or false flags disable recording debug", () => {
  withRecordingDebugEnv({}, () => {
    assert.equal(isRecordingDebugEnabled(), false);
  });
  withRecordingDebugEnv(
    {
      NODE_ENV: "development",
      RECORDING_DEBUG_PANEL: "false",
      NEXT_PUBLIC_RECORDING_DEBUG_PANEL: "false",
    },
    () => {
      assert.equal(isRecordingDebugEnabled(), false);
    },
  );
  withRecordingDebugEnv({ NODE_ENV: "production" }, () => {
    assert.equal(isRecordingDebugEnabled(), false);
  });
});
