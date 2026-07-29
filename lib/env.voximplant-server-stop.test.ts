import assert from "node:assert/strict";
import test from "node:test";

import {
  getVoximplantServerStopCallbackSecret,
  getVoximplantServerStopMode,
  getVoximplantServerStopControlSecret,
  isVoximplantServerStopEnabled,
} from "@/lib/env";

const MODE_KEY = "VOXIMPLANT_SERVER_STOP_MODE";
const CONTROL_SECRET_KEY = "VOXIMPLANT_SERVER_STOP_CONTROL_SECRET";
const CALLBACK_SECRET_KEY = "VOXIMPLANT_SERVER_STOP_CALLBACK_SECRET";

function withEnv<T>(
  updates: Record<string, string | undefined>,
  callback: () => T,
): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(updates)) {
    previous[key] = process.env[key];
    const value = updates[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return callback();
  } finally {
    for (const key of Object.keys(updates)) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("VOXIMPLANT_SERVER_STOP_MODE defaults to disabled", () => {
  withEnv({ [MODE_KEY]: undefined }, () => {
    assert.equal(getVoximplantServerStopMode(), "disabled");
    assert.equal(isVoximplantServerStopEnabled(), false);
  });
});

test("VOXIMPLANT_SERVER_STOP_MODE supports allowed values", () => {
  withEnv(
    { [MODE_KEY]: "prefer_server_with_relay_fallback" },
    () => {
      assert.equal(
        getVoximplantServerStopMode(),
        "prefer_server_with_relay_fallback",
      );
      assert.equal(isVoximplantServerStopEnabled(), true);
    },
  );

  withEnv(
    { [MODE_KEY]: "prefer_server_no_relay_fallback" },
    () => {
      assert.equal(
        getVoximplantServerStopMode(),
        "prefer_server_no_relay_fallback",
      );
      assert.equal(isVoximplantServerStopEnabled(), true);
    },
  );
});

test("VOXIMPLANT_SERVER_STOP_MODE invalid value throws", () => {
  withEnv({ [MODE_KEY]: "unknown_mode" }, () => {
    assert.throws(() => getVoximplantServerStopMode(), /Invalid VOXIMPLANT_SERVER_STOP_MODE/);
  });
});

test("server-stop secrets are optional when mode is disabled", () => {
  withEnv(
    {
      [MODE_KEY]: "disabled",
      [CONTROL_SECRET_KEY]: undefined,
      [CALLBACK_SECRET_KEY]: undefined,
    },
    () => {
      assert.equal(getVoximplantServerStopControlSecret(), null);
      assert.equal(getVoximplantServerStopCallbackSecret(), null);
    },
  );
});

test("server-stop secrets are required when mode is enabled", () => {
  withEnv(
    {
      [MODE_KEY]: "prefer_server_with_relay_fallback",
      [CONTROL_SECRET_KEY]: undefined,
      [CALLBACK_SECRET_KEY]: undefined,
    },
    () => {
      assert.throws(
        () => getVoximplantServerStopControlSecret(),
        /Missing required VOXIMPLANT_SERVER_STOP_CONTROL_SECRET/,
      );
      assert.throws(
        () => getVoximplantServerStopCallbackSecret(),
        /Missing required VOXIMPLANT_SERVER_STOP_CALLBACK_SECRET/,
      );
    },
  );
});
