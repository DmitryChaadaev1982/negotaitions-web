import assert from "node:assert/strict";
import test from "node:test";

import { __resetVoxClientLifecycleForTests } from "@/lib/voximplant/browser-client-lifecycle";
import {
  __resetVoxCoreForTests,
  dispatchVoxSdkLog,
  initVoxCore,
  registerVoxSdkLogSink,
} from "@/lib/voximplant/websdk-core";

const TRANSPORT_408 =
  "[WEBSDK] [Connection] Transport creation failed with error TransportTimeoutError: Transport establishing failed with code 408. Rejected due to time";

/**
 * Mirrors the installed SDK: `Core.init` returns the first instance and logs
 * "Voximplant already initialized. Skip new options." for every later call.
 */
function createSingletonCoreStub() {
  let instance: { options: unknown } | null = null;
  const initCalls: unknown[] = [];
  return {
    initCalls,
    Core: {
      init(options: unknown) {
        initCalls.push(options);
        if (instance) return instance;
        instance = { options };
        return instance;
      },
    },
    LogLevel: { Error: "ERROR" },
    getInstalledOptions: () =>
      (instance?.options ?? null) as { logger?: Record<string, unknown> } | null,
  };
}

function captureConsole() {
  const original = { debug: console.debug, warn: console.warn, error: console.error };
  const lines = { debug: [] as string[], warn: [] as string[], error: [] as string[] };
  console.debug = (message?: unknown) => lines.debug.push(String(message));
  console.warn = (message?: unknown) => lines.warn.push(String(message));
  console.error = (message?: unknown) => lines.error.push(String(message));
  return {
    lines,
    restore: () => {
      console.debug = original.debug;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

test.beforeEach(() => {
  __resetVoxClientLifecycleForTests();
  __resetVoxCoreForTests();
});

test("both surfaces share one core and one classifying log callback", () => {
  const stub = createSingletonCoreStub();

  const sessionCore = initVoxCore<{ options: unknown }>(stub);
  const lobbyCore = initVoxCore<{ options: unknown }>(stub);

  assert.equal(sessionCore, lobbyCore, "Core.init is a page-wide singleton");
  assert.equal(stub.initCalls.length, 2);

  const installed = stub.getInstalledOptions();
  assert.equal(
    installed?.logger?.enableConsoleLogger,
    false,
    "the SDK console logger must never win, whichever surface mounts first",
  );
  assert.equal(typeof installed?.logger?.onLogCallback, "function");
});

test("the lobby sink replaces the session sink for shared-client logs", () => {
  const received: string[] = [];
  const releaseSession = registerVoxSdkLogSink({
    surface: "session-room",
    getContext: () => ({ phase: "connected" }),
    onClassified: () => received.push("session-room"),
  });
  registerVoxSdkLogSink({
    surface: "event-lobby",
    getContext: () => ({ phase: "connecting" }),
    onClassified: () => received.push("event-lobby"),
  });

  // The Session room unmounts after the lobby has taken over.
  releaseSession();

  const captured = captureConsole();
  try {
    dispatchVoxSdkLog({ fullMessage: TRANSPORT_408, message: [TRANSPORT_408] });
  } finally {
    captured.restore();
  }

  assert.deepEqual(received, ["event-lobby"]);
  assert.equal(captured.lines.error.length, 0, "recoverable transport errors never reach console.error");
  assert.match(captured.lines.warn.join("\n"), /surface=event-lobby/);
});

test("a recoverable transport error during handoff produces no console.error", () => {
  registerVoxSdkLogSink({
    surface: "event-lobby",
    getContext: () => ({ phase: "handoff", intentionalHandoff: true }),
  });

  const captured = captureConsole();
  try {
    dispatchVoxSdkLog({ fullMessage: TRANSPORT_408, message: [TRANSPORT_408] });
  } finally {
    captured.restore();
  }

  assert.equal(captured.lines.error.length, 0);
  assert.equal(captured.lines.debug.length, 1);
  assert.match(captured.lines.debug[0]!, /class=EXPECTED_DURING_INTENTIONAL_TEARDOWN/);
});

test("logs arriving with no owning surface are still classified, not dropped", () => {
  const captured = captureConsole();
  try {
    dispatchVoxSdkLog({ fullMessage: TRANSPORT_408, message: [TRANSPORT_408] });
  } finally {
    captured.restore();
  }

  assert.equal(captured.lines.error.length, 0);
  assert.match(captured.lines.warn.join("\n"), /surface=detached/);
});

test("an unclassified SDK failure keeps its fatal diagnostic", () => {
  registerVoxSdkLogSink({
    surface: "event-lobby",
    getContext: () => ({ phase: "connected" }),
  });
  const message = "[WEBSDK] [Connection] QuantumFluxError: unknown provider fault";

  const captured = captureConsole();
  try {
    dispatchVoxSdkLog({ fullMessage: message, message: [message] });
  } finally {
    captured.restore();
  }

  assert.equal(captured.lines.error.length, 1);
  assert.match(captured.lines.error[0]!, /class=TERMINAL_PROVIDER_FAILURE/);
});

test("known benign SDK race logs stay a single warn line", () => {
  const message =
    "[WEBSDK] [ConferenceManager] Message subscriber handleReInvite failed: TypeError: Cannot read properties of undefined (reading 'mids')";

  const captured = captureConsole();
  try {
    dispatchVoxSdkLog({ fullMessage: message, message: [message] });
    dispatchVoxSdkLog({ fullMessage: message, message: [message] });
  } finally {
    captured.restore();
  }

  assert.equal(captured.lines.error.length, 0);
  assert.equal(captured.lines.warn.length, 1);
});
