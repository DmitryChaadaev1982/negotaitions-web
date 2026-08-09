import assert from "node:assert/strict";
import test from "node:test";

import {
  getForgotPasswordTimingFloorMs,
  withResponseTimingFloor,
} from "@/lib/auth/response-timing-floor";

function withEnv<T>(
  patch: Record<string, string | undefined>,
  operation: () => T,
): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("getForgotPasswordTimingFloorMs fails closed when env is absent", () => {
  assert.throws(
    () =>
      withEnv(
        { PASSWORD_RESET_RESPONSE_FLOOR_MS: undefined },
        () => getForgotPasswordTimingFloorMs({}),
      ),
    /Missing required runtime setting: PASSWORD_RESET_RESPONSE_FLOOR_MS/,
  );
});

test("getForgotPasswordTimingFloorMs honours valid overrides", () => {
  assert.equal(getForgotPasswordTimingFloorMs({ PASSWORD_RESET_RESPONSE_FLOOR_MS: "0" }), 0);
  assert.equal(getForgotPasswordTimingFloorMs({ PASSWORD_RESET_RESPONSE_FLOOR_MS: "100" }), 100);
  assert.equal(getForgotPasswordTimingFloorMs({ PASSWORD_RESET_RESPONSE_FLOOR_MS: "400" }), 400);
});

test("getForgotPasswordTimingFloorMs rejects out-of-range values", () => {
  assert.throws(() =>
    getForgotPasswordTimingFloorMs({ PASSWORD_RESET_RESPONSE_FLOOR_MS: "-1" }),
  );
  assert.throws(() =>
    getForgotPasswordTimingFloorMs({ PASSWORD_RESET_RESPONSE_FLOOR_MS: "401" }),
  );
  assert.throws(() =>
    getForgotPasswordTimingFloorMs({ PASSWORD_RESET_RESPONSE_FLOOR_MS: "notanumber" }),
  );
  assert.throws(() =>
    getForgotPasswordTimingFloorMs({ PASSWORD_RESET_RESPONSE_FLOOR_MS: "1.5" }),
  );
});

test("withResponseTimingFloor: floor is enforced when operation is faster", async () => {
  const sleepDelays: number[] = [];
  const fakeSleep = async (ms: number) => {
    sleepDelays.push(ms);
  };
  let nowCallCount = 0;
  const fakeNow = () => {
    nowCallCount += 1;
    // startedAt = 1000, elapsed after operation = 50 ms
    return nowCallCount === 1 ? 1050 : 1050;
  };

  await withResponseTimingFloor({
    floorMs: 200,
    startedAtMs: 1000,
    operation: async () => "done",
    sleep: fakeSleep,
    now: fakeNow,
  });

  assert.equal(sleepDelays.length, 1);
  assert.equal(sleepDelays[0], 150); // 200 - 50 elapsed
});

test("withResponseTimingFloor: no sleep when operation exceeds floor", async () => {
  const sleepDelays: number[] = [];
  const fakeSleep = async (ms: number) => {
    sleepDelays.push(ms);
  };
  // startedAt = 0, now returns 300 — elapsed exceeds floorMs=180
  await withResponseTimingFloor({
    floorMs: 180,
    startedAtMs: 0,
    operation: async () => "done",
    sleep: fakeSleep,
    now: () => 300,
  });

  assert.equal(sleepDelays.length, 0, "sleep must not be called when already past floor");
});

test("withResponseTimingFloor: zero remaining means no sleep", async () => {
  const sleepDelays: number[] = [];
  await withResponseTimingFloor({
    floorMs: 100,
    startedAtMs: 0,
    operation: async () => undefined,
    sleep: async (ms) => { sleepDelays.push(ms); },
    now: () => 100, // exactly at floor
  });
  assert.equal(sleepDelays.length, 0);
});

test("withResponseTimingFloor: operation result is returned unchanged", async () => {
  const result = await withResponseTimingFloor({
    floorMs: 0,
    startedAtMs: 0,
    operation: async () => 42,
    sleep: async () => undefined,
    now: () => 0,
  });
  assert.equal(result, 42);
});

test("withResponseTimingFloor: sleep is called even when operation throws", async () => {
  const sleepDelays: number[] = [];
  const err = new Error("operation failed");

  await assert.rejects(
    () =>
      withResponseTimingFloor({
        floorMs: 200,
        startedAtMs: 0,
        operation: async () => { throw err; },
        sleep: async (ms) => { sleepDelays.push(ms); },
        now: () => 10,
      }),
    (thrown: unknown) => thrown === err,
  );

  assert.equal(sleepDelays.length, 1, "sleep must run in finally even on error");
  assert.equal(sleepDelays[0], 190);
});

test("withResponseTimingFloor: floorMs=0 never sleeps", async () => {
  const sleepDelays: number[] = [];
  await withResponseTimingFloor({
    floorMs: 0,
    startedAtMs: 0,
    operation: async () => undefined,
    sleep: async (ms) => { sleepDelays.push(ms); },
    now: () => 0,
  });
  assert.equal(sleepDelays.length, 0);
});

test("withResponseTimingFloor: default real clock/sleep path does not throw", async () => {
  // Does not inject sleeper — proves the default path is wired without error.
  const result = await withResponseTimingFloor({
    floorMs: 0,
    startedAtMs: Date.now(),
    operation: async () => "ok",
  });
  assert.equal(result, "ok");
});
