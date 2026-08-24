import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SESSION_ABANDONED_CLOSE_MS,
  DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS,
  DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS,
  getSessionAbandonedCloseMs,
  getSessionDebriefEmptyCloseMs,
  getSessionDebriefMaxDurationMs,
} from "@/lib/config/session-lifecycle-settings";

const KEYS = [
  "SESSION_DEBRIEF_EMPTY_CLOSE_MS",
  "SESSION_DEBRIEF_MAX_DURATION_MS",
  "SESSION_ABANDONED_CLOSE_MS",
  "DEBRIEF_AUTO_CLOSE_GRACE_MS",
] as const;

function withEnv(updates: Record<string, string | undefined>, fn: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of KEYS) previous.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("canonical empty-close default is 60000 when neither variable is set", () => {
  withEnv(
    {
      SESSION_DEBRIEF_EMPTY_CLOSE_MS: undefined,
      DEBRIEF_AUTO_CLOSE_GRACE_MS: undefined,
    },
    () => {
      assert.equal(
        getSessionDebriefEmptyCloseMs(),
        DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS,
      );
    },
  );
});

test("canonical empty-close wins over the legacy alias", () => {
  withEnv(
    {
      SESSION_DEBRIEF_EMPTY_CLOSE_MS: "90000",
      DEBRIEF_AUTO_CLOSE_GRACE_MS: "12000",
    },
    () => {
      assert.equal(getSessionDebriefEmptyCloseMs(), 90_000);
    },
  );
});

test("legacy alias is used only when the canonical variable is absent", () => {
  withEnv(
    {
      SESSION_DEBRIEF_EMPTY_CLOSE_MS: undefined,
      DEBRIEF_AUTO_CLOSE_GRACE_MS: "12000",
    },
    () => {
      assert.equal(getSessionDebriefEmptyCloseMs(), 12_000);
    },
  );
});

test("invalid canonical empty-close fails closed to the default and ignores the alias", () => {
  withEnv(
    {
      SESSION_DEBRIEF_EMPTY_CLOSE_MS: "not-a-number",
      DEBRIEF_AUTO_CLOSE_GRACE_MS: "12000",
    },
    () => {
      assert.equal(
        getSessionDebriefEmptyCloseMs(),
        DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS,
      );
    },
  );
});

test("out-of-range values fail closed to defaults", () => {
  withEnv(
    {
      SESSION_DEBRIEF_EMPTY_CLOSE_MS: "1000",
      SESSION_DEBRIEF_MAX_DURATION_MS: "10",
      SESSION_ABANDONED_CLOSE_MS: "999999999",
    },
    () => {
      assert.equal(
        getSessionDebriefEmptyCloseMs(),
        DEFAULT_SESSION_DEBRIEF_EMPTY_CLOSE_MS,
      );
      assert.equal(
        getSessionDebriefMaxDurationMs(),
        DEFAULT_SESSION_DEBRIEF_MAX_DURATION_MS,
      );
      assert.equal(
        getSessionAbandonedCloseMs(),
        DEFAULT_SESSION_ABANDONED_CLOSE_MS,
      );
    },
  );
});

test("reviewed defaults for max duration and abandoned close", () => {
  withEnv(
    {
      SESSION_DEBRIEF_MAX_DURATION_MS: undefined,
      SESSION_ABANDONED_CLOSE_MS: undefined,
    },
    () => {
      assert.equal(getSessionDebriefMaxDurationMs(), 7_200_000);
      assert.equal(getSessionAbandonedCloseMs(), 10_800_000);
    },
  );
});
