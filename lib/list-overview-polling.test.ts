import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  LIST_OVERVIEW_POLL_INTERVAL_MS,
  startVisibleListPoll,
  type VisibleListPollRuntime,
} from "@/lib/list-overview-polling";

const ROOT = process.cwd();

function createRuntime(initialVisibility: DocumentVisibilityState = "visible") {
  const intervals = new Map<number, () => void>();
  let nextId = 1;
  const listeners = new Map<string, Set<() => void>>();
  let visibility = initialVisibility;

  const emit = (type: string) => {
    for (const listener of listeners.get(type) ?? []) {
      listener();
    }
  };

  const runtime: VisibleListPollRuntime & {
    intervalCount: () => number;
    listenerCount: () => number;
    tick: () => void;
    setVisibility: (next: DocumentVisibilityState) => void;
    focus: () => void;
  } = {
    setInterval: (handler) => {
      const id = nextId;
      nextId += 1;
      intervals.set(id, handler);
      return id;
    },
    clearInterval: (intervalId) => {
      intervals.delete(intervalId);
    },
    addEventListener: (type, listener) => {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener);
    },
    visibilityState: () => visibility,
    intervalCount: () => intervals.size,
    listenerCount: () =>
      [...listeners.values()].reduce((count, bucket) => count + bucket.size, 0),
    tick: () => {
      for (const handler of intervals.values()) {
        handler();
      }
    },
    setVisibility: (next) => {
      visibility = next;
      emit("visibilitychange");
    },
    focus: () => {
      emit("focus");
    },
  };

  return runtime;
}

test("T11 shared canonical polling cadence is exactly 2000 ms", () => {
  const source = readFileSync(join(ROOT, "lib/list-overview-polling.ts"), "utf8");
  const hook = readFileSync(join(ROOT, "lib/use-visible-list-poll.ts"), "utf8");
  const sessions = readFileSync(
    join(ROOT, "components/sessions-list-view.tsx"),
    "utf8",
  );
  const events = readFileSync(
    join(ROOT, "components/events-list-view.tsx"),
    "utf8",
  );
  const dashboard = readFileSync(
    join(ROOT, "components/account-dashboard-view.tsx"),
    "utf8",
  );

  assert.equal(LIST_OVERVIEW_POLL_INTERVAL_MS, 2_000);
  assert.match(source, /LIST_OVERVIEW_POLL_INTERVAL_MS = 2_000/);
  assert.match(source, /params\.intervalMs \?\? LIST_OVERVIEW_POLL_INTERVAL_MS/);
  assert.match(hook, /startVisibleListPoll/);
  assert.doesNotMatch(sessions, /POLL_INTERVAL_MS/);
  assert.doesNotMatch(events, /POLL_INTERVAL_MS/);
  assert.doesNotMatch(dashboard, /POLL_INTERVAL_MS/);
});

test("T08 polling cleanup occurs on unmount", async () => {
  const runtime = createRuntime();
  let refreshCount = 0;
  const poll = startVisibleListPoll({
    refresh: async () => {
      refreshCount += 1;
    },
    runtime,
  });

  await Promise.resolve();
  assert.equal(runtime.intervalCount(), 1);
  assert.equal(runtime.listenerCount(), 2);

  poll.stop();

  assert.equal(runtime.intervalCount(), 0);
  assert.equal(runtime.listenerCount(), 0);
  const afterStop = refreshCount;
  runtime.tick();
  runtime.focus();
  runtime.setVisibility("hidden");
  runtime.setVisibility("visible");
  await Promise.resolve();
  assert.equal(refreshCount, afterStop);
});

test("T09 ordinary re-renders do not create a second polling loop", async () => {
  const runtime = createRuntime();
  const poll = startVisibleListPoll({
    refresh: async () => undefined,
    runtime,
  });

  await Promise.resolve();
  assert.equal(runtime.intervalCount(), 1);
  runtime.tick();
  runtime.tick();
  assert.equal(runtime.intervalCount(), 1);

  poll.stop();
});

test("T10 Dashboard, Sessions, and Events share the canonical visible-list poll", () => {
  const hook = readFileSync(join(ROOT, "lib/use-visible-list-poll.ts"), "utf8");
  const sessions = readFileSync(
    join(ROOT, "components/sessions-list-view.tsx"),
    "utf8",
  );
  const events = readFileSync(
    join(ROOT, "components/events-list-view.tsx"),
    "utf8",
  );
  const dashboard = readFileSync(
    join(ROOT, "components/account-dashboard-view.tsx"),
    "utf8",
  );

  assert.match(hook, /startVisibleListPoll/);
  assert.match(hook, /refreshRef\.current = refresh/);
  assert.match(hook, /}, \[\]\);/);
  assert.match(sessions, /useVisibleListPoll/);
  assert.match(sessions, /\/api\/sessions\/list/);
  assert.match(sessions, /cache: "no-store"/);
  assert.doesNotMatch(sessions, /setInterval/);
  assert.match(events, /useVisibleListPoll/);
  assert.match(events, /\/api\/events\/list/);
  assert.match(events, /cache: "no-store"/);
  assert.doesNotMatch(events, /setInterval/);
  assert.match(dashboard, /useVisibleListPoll/);
  assert.doesNotMatch(dashboard, /setInterval/);
});

test("hidden documents skip interval ticks and refresh when they become visible", async () => {
  const runtime = createRuntime("visible");
  let refreshCount = 0;
  const poll = startVisibleListPoll({
    refresh: async () => {
      refreshCount += 1;
    },
    runtime,
  });

  await Promise.resolve();
  assert.equal(refreshCount, 1);

  runtime.setVisibility("hidden");
  runtime.tick();
  await Promise.resolve();
  assert.equal(refreshCount, 1);

  runtime.setVisibility("visible");
  await Promise.resolve();
  assert.equal(refreshCount, 2);

  poll.stop();
});

test("in-flight refresh suppresses overlapping requests", async () => {
  const runtime = createRuntime();
  let started = 0;
  let release!: () => void;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const poll = startVisibleListPoll({
    refresh: async () => {
      started += 1;
      await lock;
    },
    runtime,
  });

  await Promise.resolve();
  runtime.tick();
  runtime.focus();
  await Promise.resolve();
  assert.equal(started, 1);

  release();
  await Promise.resolve();
  poll.stop();
});
