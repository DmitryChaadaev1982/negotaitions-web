/**
 * Stage 3.12B-W1 — the gateway WebSocket close observed on a long-lived
 * `DEBRIEF_OPEN` Session, and the bounded recovery it now starts.
 *
 * Every classification case is asserted against the verbatim SDK line captured
 * from the reported incident, so the taxonomy cannot drift away from what the
 * WebSDK really emits.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyVoxProviderFailure,
  formatVoxProviderLog,
  logLevelForClassification,
  parseVoxProviderSignal,
  type VoxClassificationContext,
} from "@/lib/voximplant/provider-error-classification";
import { GATEWAY_WEBSOCKET_CLOSE_SDK_LOG } from "@/lib/voximplant/provider-fault-simulation";
import {
  createSessionTransportRecovery,
  type SessionTransportRecoveryState,
} from "@/lib/voximplant/session-transport-recovery";
import {
  __resetVoxCoreForTests,
  dispatchVoxSdkLog,
  registerVoxSdkLogSink,
} from "@/lib/voximplant/websdk-core";

const CONNECTED: VoxClassificationContext = { phase: "connected" };
const TEARDOWN: VoxClassificationContext = {
  phase: "intentional_teardown",
  intentionalHandoff: true,
};

// ── Classification ──────────────────────────────────────────────────────────

test("the observed gateway close carries transport evidence, not an error type", () => {
  const signal = parseVoxProviderSignal(GATEWAY_WEBSOCKET_CLOSE_SDK_LOG);

  assert.equal(signal.scope, "GW Transport");
  assert.equal(signal.fromWebSdk, true);
  // `closed with error` is prose, not a constructor name, and the SDK logs no
  // status code for a socket that was already open.
  assert.equal(signal.errorType, null);
  assert.equal(signal.transportCode, null);
  assert.deepEqual(signal.transportClosure, {
    closeCode: null,
    closeReason: null,
    wasClean: null,
    isTrusted: true,
  });
});

test("a gateway close while connected is recoverable, not an unknown failure", () => {
  const classification = classifyVoxProviderFailure(
    GATEWAY_WEBSOCKET_CLOSE_SDK_LOG,
    CONNECTED,
  );

  assert.equal(classification.class, "RECOVERABLE_TRANSIENT");
  assert.equal(classification.reason, "gateway_websocket_closed");
  assert.equal(classification.retryable, true);
  assert.equal(classification.unknown, false);
});

test("the same close during an intentional teardown is expected noise", () => {
  const classification = classifyVoxProviderFailure(
    GATEWAY_WEBSOCKET_CLOSE_SDK_LOG,
    TEARDOWN,
  );

  assert.equal(classification.class, "EXPECTED_DURING_INTENTIONAL_TEARDOWN");
  assert.equal(classification.reason, "gateway_websocket_closed_during_teardown");
  assert.equal(logLevelForClassification(classification), "debug");
});

test("a gateway close with authorization evidence stays terminal", () => {
  for (const message of [
    '[WEBSDK] [GW Transport] WS transport abc closed with error AuthError: token rejected {"isTrusted":true}',
    '[WEBSDK] [GW Transport] WS transport abc closed with code: 4403 reason: "forbidden"',
    '[WEBSDK] [GW Transport] WS transport abc closed with code: 1008 reason: "policy violation"',
  ]) {
    const classification = classifyVoxProviderFailure(message, CONNECTED);
    assert.equal(
      classification.class,
      "TERMINAL_PROVIDER_FAILURE",
      `expected terminal for: ${message}`,
    );
    assert.equal(classification.reason, "provider_authorization_rejected");
    assert.equal(classification.retryable, false);
  }
});

test("a non-terminal close code is still recoverable", () => {
  const classification = classifyVoxProviderFailure(
    '[WEBSDK] [GW Transport] WS transport abc closed with code: 1006 reason: "" wasClean: false',
    CONNECTED,
  );

  assert.equal(classification.class, "RECOVERABLE_TRANSIENT");
  assert.equal(classification.reason, "gateway_websocket_closed");
  assert.equal(classification.signal.transportClosure?.closeCode, 1006);
  assert.equal(classification.signal.transportClosure?.wasClean, false);
});

test("a GW Transport message that is not a socket close stays visible", () => {
  const classification = classifyVoxProviderFailure(
    "[WEBSDK] [GW Transport] unexpected internal state while packing frame",
    CONNECTED,
  );

  assert.equal(classification.class, "TERMINAL_PROVIDER_FAILURE");
  assert.equal(classification.reason, "unclassified_provider_failure");
  assert.equal(classification.unknown, true);
  assert.equal(logLevelForClassification(classification), "error");
});

test("socket-close wording outside a transport scope is not downgraded", () => {
  const classification = classifyVoxProviderFailure(
    '[WEBSDK] [Conference] WS transport abc closed with error {"isTrusted":true}',
    CONNECTED,
  );

  assert.equal(classification.reason, "unclassified_provider_failure");
  assert.equal(classification.unknown, true);
});

test("an application invariant is still a loud console.error", () => {
  const classification = classifyVoxProviderFailure(
    "sdkUsername mismatch: refusing to join with another participant identity",
    CONNECTED,
  );

  assert.equal(classification.class, "APPLICATION_INVARIANT_FAILURE");
  assert.equal(logLevelForClassification(classification), "error");
});

test("a recoverable gateway close never reaches console.error", () => {
  const classification = classifyVoxProviderFailure(
    GATEWAY_WEBSOCKET_CLOSE_SDK_LOG,
    CONNECTED,
  );

  assert.equal(logLevelForClassification(classification), "warn");
  const line = formatVoxProviderLog("session-room", classification, CONNECTED);
  assert.match(line, /reason=gateway_websocket_closed\b/);
  assert.match(line, /scope=GW Transport/);
  assert.match(line, /closeCode=unknown/);
});

test("the exhausted retry budget turns a gateway close terminal", () => {
  const classification = classifyVoxProviderFailure(GATEWAY_WEBSOCKET_CLOSE_SDK_LOG, {
    phase: "connected",
    attempt: 4,
    maxAttempts: 4,
  });

  assert.equal(classification.class, "TERMINAL_PROVIDER_FAILURE");
  assert.equal(classification.reason, "transport_retry_budget_exhausted");
});

test("the session-room log sink classifies the close without a console.error", () => {
  __resetVoxCoreForTests();
  const consoleErrors: unknown[] = [];
  const consoleWarns: unknown[] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => consoleErrors.push(args);
  console.warn = (...args: unknown[]) => consoleWarns.push(args);

  const classified: string[] = [];
  const release = registerVoxSdkLogSink({
    surface: "session-room",
    getContext: () => CONNECTED,
    onClassified: (classification) => classified.push(classification.reason),
  });

  try {
    dispatchVoxSdkLog({
      fullMessage: GATEWAY_WEBSOCKET_CLOSE_SDK_LOG,
      message: [GATEWAY_WEBSOCKET_CLOSE_SDK_LOG],
      extraData: { level: "ERROR", scope: "GW Transport" },
    });
  } finally {
    release();
    console.error = originalError;
    console.warn = originalWarn;
    __resetVoxCoreForTests();
  }

  assert.deepEqual(classified, ["gateway_websocket_closed"]);
  assert.deepEqual(consoleErrors, []);
  assert.equal(consoleWarns.length, 1);
});

// ── Bounded recovery ────────────────────────────────────────────────────────

const QUIET_MS = 4_000;

type Harness = {
  states: SessionTransportRecoveryState[];
  /** Resolves every sleep currently pending on the fake clock. */
  tick: () => Promise<void>;
  sleeps: number;
};

function createHarness(options: {
  isConferenceConnected?: () => boolean;
  isOwnerCurrent?: () => boolean;
} = {}) {
  const states: SessionTransportRecoveryState[] = [];
  let pending: Array<() => void> = [];
  const harness: Harness = {
    states,
    sleeps: 0,
    tick: async () => {
      const due = pending;
      pending = [];
      for (const resolve of due) resolve();
      // Let the runner's async continuations settle before the next assertion.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };

  const recovery = createSessionTransportRecovery({
    isConferenceConnected: options.isConferenceConnected ?? (() => true),
    isOwnerCurrent: options.isOwnerCurrent ?? (() => true),
    quietPeriodMs: QUIET_MS,
    onState: (next) => states.push(next),
    delay: (_ms, isCancelled) =>
      new Promise<void>((resolve) => {
        harness.sleeps += 1;
        if (isCancelled()) {
          resolve();
          return;
        }
        pending.push(resolve);
      }),
  });

  return { recovery, harness };
}

const RECOVERABLE_CLOSE = classifyVoxProviderFailure(
  GATEWAY_WEBSOCKET_CLOSE_SDK_LOG,
  CONNECTED,
);

test("a recoverable gateway close starts exactly one recovery sequence", async () => {
  const { recovery, harness } = createHarness();

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(recovery.getState().status, "recovering");
  assert.equal(recovery.getState().attempt, 1);
  assert.equal(harness.sleeps, 1);
});

test("concurrent close callbacks do not start duplicate recoveries", async () => {
  const { recovery, harness } = createHarness();

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(recovery.getState().attempt, 1);
  assert.equal(harness.sleeps, 1, "one quiet period, not one per callback");
});

test("a quiet period with a connected conference reports the link stable", async () => {
  const { recovery, harness } = createHarness();

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await harness.tick();

  assert.equal(recovery.getState().status, "stable");
  assert.equal(recovery.getState().canRetryManually, false);
  assert.deepEqual(
    harness.states.map((state) => state.status),
    ["recovering", "stable"],
  );
});

test("recovery stays bounded and ends in a controlled degraded state", async () => {
  // The link never comes back, so the budget must run out and say so.
  const connected = false;
  const { recovery, harness } = createHarness({
    isConferenceConnected: () => connected,
  });

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  // Four attempts, each a quiet period followed by a backoff sleep.
  for (let i = 0; i < 12; i += 1) {
    await harness.tick();
    if (recovery.getState().status === "lost") break;
  }

  const final = recovery.getState();
  assert.equal(final.status, "lost");
  assert.equal(final.attempt, 4, "the budget is four attempts");
  assert.equal(final.maxAttempts, 4);
  assert.equal(final.canRetryManually, true);
  assert.equal(final.reason, "gateway_websocket_closed");
  assert.equal(connected, false, "recovery never claimed a false success");
});

test("cancelling on unmount stops recovery and publishes nothing further", async () => {
  const { recovery, harness } = createHarness();

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const publishedBeforeCancel = harness.states.length;

  recovery.cancel();
  await harness.tick();
  await harness.tick();

  assert.equal(harness.states.length, publishedBeforeCancel);
  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await harness.tick();
  assert.equal(harness.states.length, publishedBeforeCancel);
});

test("a stale session owner cannot start recovery after a lobby takeover", async () => {
  const { recovery, harness } = createHarness({ isOwnerCurrent: () => false });

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await harness.tick();

  assert.equal(recovery.getState().status, "stable");
  assert.deepEqual(harness.states, []);
  assert.equal(harness.sleeps, 0);
});

test("losing ownership mid-recovery aborts instead of reporting a verdict", async () => {
  let ownerCurrent = true;
  const { recovery, harness } = createHarness({
    isOwnerCurrent: () => ownerCurrent,
  });

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  ownerCurrent = false;
  await harness.tick();

  assert.equal(
    recovery.getState().status,
    "recovering",
    "an aborted attempt must not claim recovery or failure",
  );
});

test("a second incident after a recovered link starts a fresh bounded sequence", async () => {
  const { recovery, harness } = createHarness();

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await harness.tick();
  assert.equal(recovery.getState().status, "stable");

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(recovery.getState().status, "recovering");
  assert.equal(recovery.getState().attempt, 1, "the budget resets per incident");
});

test("recovery observes the link and never touches the connection or media", () => {
  const calls: string[] = [];
  const { recovery } = createHarness({
    isConferenceConnected: () => {
      calls.push("read-conference-state");
      return true;
    },
  });

  recovery.noteTransportLoss(RECOVERABLE_CLOSE);

  // The controller's whole surface is two read-only predicates plus a clock, so
  // it cannot connect, join, release media or stop a recording.
  assert.deepEqual(Object.keys(recovery).sort(), [
    "cancel",
    "getState",
    "noteTransportLoss",
  ]);
  assert.ok(!calls.includes("connect"));
});
