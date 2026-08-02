import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetVoxClientLifecycleForTests,
  acquireVoxClientOwnership,
  beginIntentionalProviderHandoff,
  endIntentionalProviderHandoff,
  isIntentionalProviderHandoffActive,
  registerVoxClientDisconnect,
  waitForVoxClientIdle,
} from "@/lib/voximplant/browser-client-lifecycle";
import {
  classifyVoxProviderFailure,
  parseVoxProviderSignal,
  logLevelForClassification,
  VoxAccessError,
} from "@/lib/voximplant/provider-error-classification";
import {
  createIdempotentRelease,
  createProviderConnectRunner,
  type ProviderAttemptResult,
} from "@/lib/voximplant/provider-connect-retry";
import { createVoxGenerationTracker } from "@/lib/voximplant/use-voximplant-room";

/** The three failures captured on the reported Session -> lobby transition. */
const TRANSPORT_408 =
  "[WEBSDK] [Connection] Transport creation failed with error TransportTimeoutError: Transport establishing failed with code 408. Rejected due to time";
const GATEWAY_NO_TRANSPORT =
  "[WEBSDK] [Connection] ConnectionNetworkError: Failed to connect to gateway. No transport established";
const ICE_RESTART_TIMEOUT =
  '[WEBSDK] [ReInviteQueue_conference_ev_1] Action failed: actionName: "IceRestartAction" reason: Action run failed to timeout';

const HANDOFF = { phase: "handoff" as const, intentionalHandoff: true };
const STEADY = { phase: "connected" as const, attempt: 1, maxAttempts: 4 };

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Deterministic scheduler so retry tests never depend on wall-clock delays. */
function createManualDelay() {
  const waits: number[] = [];
  return {
    waits,
    delay: async (ms: number) => {
      waits.push(ms);
    },
  };
}

test.beforeEach(() => {
  __resetVoxClientLifecycleForTests();
});

// 1 — Session generation becomes stale after navigation.
test("session generation becomes stale once navigation invalidates it", () => {
  const tracker = createVoxGenerationTracker();
  const sessionGeneration = tracker.begin();
  assert.equal(tracker.isCurrent(sessionGeneration), true);

  tracker.invalidate("component_unmounted");

  assert.equal(tracker.isCurrent(sessionGeneration), false);
});

// 2 — Stale Session callback cannot trigger reconnect.
test("stale session owner cannot reconnect or disconnect after lobby takeover", () => {
  const sessionOwnership = acquireVoxClientOwnership("session-room");
  assert.equal(sessionOwnership.isCurrent(), true);

  const lobbyOwnership = acquireVoxClientOwnership("event-lobby");

  const providerCalls: string[] = [];
  const staleSessionReconnect = () => {
    if (!sessionOwnership.isCurrent()) return;
    providerCalls.push("session-reconnect");
  };
  const staleSessionDisconnect = () => {
    if (!sessionOwnership.isCurrent()) return;
    providerCalls.push("session-disconnect");
  };
  staleSessionReconnect();
  staleSessionDisconnect();

  assert.deepEqual(providerCalls, []);
  assert.equal(lobbyOwnership.isCurrent(), true);
});

// 3 — Lobby join does not overlap unsafe Session teardown on a shared client.
test("lobby join waits for session teardown on the shared client", async () => {
  const teardown = createDeferred();
  const order: string[] = [];

  registerVoxClientDisconnect(
    teardown.promise.then(() => {
      order.push("session-disconnect-complete");
    }),
  );

  const lobbyJoin = waitForVoxClientIdle().then((result) => {
    order.push("lobby-connect");
    return result;
  });

  await Promise.resolve();
  assert.deepEqual(order, []);

  teardown.resolve();
  const result = await lobbyJoin;

  assert.deepEqual(order, ["session-disconnect-complete", "lobby-connect"]);
  assert.equal(result.idle, true);
  assert.equal(result.timedOut, false);
});

test("a hung session teardown releases the barrier instead of blocking the lobby", async () => {
  const neverSettles = new Promise<void>(() => {});
  registerVoxClientDisconnect(neverSettles, { timeoutMs: 20 });

  const result = await waitForVoxClientIdle({ timeoutMs: 60 });

  assert.equal(result.idle, true, "bounded teardown must free the shared client");
});

test("waitForVoxClientIdle reports a timeout rather than waiting forever", async () => {
  const neverSettles = new Promise<void>(() => {});
  registerVoxClientDisconnect(neverSettles, { timeoutMs: 10_000 });

  const result = await waitForVoxClientIdle({ timeoutMs: 30 });

  assert.equal(result.timedOut, true);
  assert.equal(result.idle, false);
});

// 4 — Lobby route may render before media connection.
test("lobby reports a non-terminal connecting state while media is pending", async () => {
  const pending = createDeferred<ProviderAttemptResult>();
  const states: string[] = [];

  const runner = createProviderConnectRunner({
    surface: "event-lobby",
    attempt: () => pending.promise,
    onState: (state) => states.push(state.status),
  });
  const run = runner.start();
  await Promise.resolve();

  assert.deepEqual(states, ["connecting"]);
  assert.equal(runner.getState().status, "connecting");
  assert.notEqual(runner.getState().status, "terminal");

  pending.resolve({ outcome: "connected" });
  await run;
  assert.equal(runner.getState().status, "connected");
});

// 5 — Transport 408 during handoff is recoverable.
test("transport 408 during handoff is expected teardown noise, never console.error", () => {
  const classification = classifyVoxProviderFailure(TRANSPORT_408, HANDOFF);

  assert.equal(classification.class, "EXPECTED_DURING_INTENTIONAL_TEARDOWN");
  assert.equal(classification.signal.errorType, "TransportTimeoutError");
  assert.equal(classification.signal.transportCode, 408);
  assert.equal(logLevelForClassification(classification), "debug");
});

// 6 — ConnectionNetworkError during handoff is recoverable.
test("gateway ConnectionNetworkError during handoff is expected teardown noise", () => {
  const classification = classifyVoxProviderFailure(GATEWAY_NO_TRANSPORT, HANDOFF);

  assert.equal(classification.class, "EXPECTED_DURING_INTENTIONAL_TEARDOWN");
  assert.equal(classification.signal.errorType, "ConnectionNetworkError");
  assert.notEqual(logLevelForClassification(classification), "error");
});

// 7 — ICE restart timeout during intentional teardown is expected/recoverable.
test("ICE restart timeout during intentional teardown is expected", () => {
  const classification = classifyVoxProviderFailure(ICE_RESTART_TIMEOUT, HANDOFF);

  assert.equal(classification.class, "EXPECTED_DURING_INTENTIONAL_TEARDOWN");
  assert.equal(classification.signal.actionName, "IceRestartAction");
  assert.equal(logLevelForClassification(classification), "debug");
});

// 8 — Same provider error outside teardown enters the correct retry or terminal path.
test("the same provider errors outside teardown retry, then become terminal", () => {
  for (const message of [TRANSPORT_408, GATEWAY_NO_TRANSPORT, ICE_RESTART_TIMEOUT]) {
    const retrying = classifyVoxProviderFailure(message, {
      phase: "connecting",
      attempt: 1,
      maxAttempts: 4,
    });
    assert.equal(retrying.class, "RECOVERABLE_TRANSIENT", message);
    assert.equal(retrying.retryable, true, message);
    assert.equal(logLevelForClassification(retrying), "warn", message);
  }

  const exhausted = classifyVoxProviderFailure(TRANSPORT_408, {
    phase: "connecting",
    attempt: 4,
    maxAttempts: 4,
  });
  assert.equal(exhausted.class, "TERMINAL_PROVIDER_FAILURE");
  assert.equal(exhausted.reason, "transport_retry_budget_exhausted");
});

test("authorization rejection is terminal and never retried", () => {
  const classification = classifyVoxProviderFailure(
    "[WEBSDK] [Login] AuthError: invalid one time key",
    STEADY,
  );

  assert.equal(classification.class, "TERMINAL_PROVIDER_FAILURE");
  assert.equal(classification.retryable, false);
  assert.equal(
    logLevelForClassification(classification),
    "warn",
    "a known provider outage renders a controlled error panel, not a dev overlay",
  );
});

test("media-access endpoint rejections are provider failures, not application bugs", () => {
  const forbidden = classifyVoxProviderFailure(
    new VoxAccessError(403, "invalidAccess"),
    STEADY,
  );
  assert.equal(forbidden.class, "TERMINAL_PROVIDER_FAILURE");
  assert.equal(forbidden.reason, "provider_access_rejected:403");
  assert.notEqual(logLevelForClassification(forbidden), "error");

  const unavailable = classifyVoxProviderFailure(new VoxAccessError(503, "upstream down"), {
    phase: "connecting",
    attempt: 1,
    maxAttempts: 4,
  });
  assert.equal(unavailable.class, "RECOVERABLE_TRANSIENT");
  assert.equal(unavailable.retryable, true);
});

// 9 — Unknown error is not swallowed.
test("unknown provider and application errors stay visible", () => {
  const unknownSdk = classifyVoxProviderFailure(
    "[WEBSDK] [Connection] QuantumFluxError: something nobody has seen",
    STEADY,
  );
  assert.equal(unknownSdk.class, "TERMINAL_PROVIDER_FAILURE");
  assert.equal(unknownSdk.unknown, true);
  assert.equal(logLevelForClassification(unknownSdk), "error");

  const applicationBug = classifyVoxProviderFailure(
    new Error("Security check failed: sdkUsername mismatch during one-time-key login."),
    HANDOFF,
  );
  assert.equal(applicationBug.class, "APPLICATION_INVARIANT_FAILURE");
  assert.equal(logLevelForClassification(applicationBug), "error");
});

test("an application invariant failure stays fatal even during a handoff", () => {
  const classification = classifyVoxProviderFailure(
    new Error("Unexpected Vox lobby access payload."),
    HANDOFF,
  );

  assert.equal(classification.class, "APPLICATION_INVARIANT_FAILURE");
});

// 10 — Retry is bounded.
test("retry stops at the configured attempt budget", async () => {
  const manual = createManualDelay();
  let attempts = 0;

  const runner = createProviderConnectRunner({
    surface: "event-lobby",
    attempt: async () => {
      attempts += 1;
      return { outcome: "failed", error: TRANSPORT_408 };
    },
    getPhase: () => "connecting",
    policy: { maxAttempts: 3, initialDelayMs: 100, factor: 2, maxDelayMs: 400 },
    delay: manual.delay,
    classify: (error, attempt) =>
      classifyVoxProviderFailure(error, {
        phase: "connecting",
        attempt,
        maxAttempts: 3,
      }),
  });

  await runner.start();

  assert.equal(attempts, 3);
  assert.deepEqual(manual.waits, [100, 200], "bounded exponential backoff");
  assert.equal(runner.getState().status, "terminal");
  assert.equal(runner.getState().canRetryManually, true);
});

test("a successful retry clears the degraded state", async () => {
  const manual = createManualDelay();
  let attempts = 0;

  const runner = createProviderConnectRunner({
    surface: "event-lobby",
    attempt: async () => {
      attempts += 1;
      return attempts === 1
        ? { outcome: "failed", error: GATEWAY_NO_TRANSPORT }
        : { outcome: "connected" };
    },
    getPhase: () => "connecting",
    delay: manual.delay,
  });

  await runner.start();

  assert.equal(attempts, 2);
  assert.equal(runner.getState().status, "connected");
  assert.equal(runner.getState().reason, null);
});

// 11 — Unmount cancels pending retry.
test("cancel stops a pending retry and prevents further attempts", async () => {
  const attemptStarted = createDeferred();
  const releaseAttempt = createDeferred<ProviderAttemptResult>();
  let attempts = 0;

  const runner = createProviderConnectRunner({
    surface: "event-lobby",
    attempt: () => {
      attempts += 1;
      attemptStarted.resolve();
      return releaseAttempt.promise;
    },
    getPhase: () => "connecting",
    delay: async () => {},
  });

  const run = runner.start();
  await attemptStarted.promise;
  runner.cancel();
  releaseAttempt.resolve({ outcome: "failed", error: TRANSPORT_408 });
  await run;

  assert.equal(attempts, 1, "no retry may start after cancellation");
  assert.equal(runner.getState().status, "cancelled");
});

test("retryNow is inert after cancellation", async () => {
  let attempts = 0;
  const runner = createProviderConnectRunner({
    surface: "event-lobby",
    attempt: async () => {
      attempts += 1;
      return { outcome: "connected" };
    },
  });

  runner.cancel();
  await runner.retryNow();

  assert.equal(attempts, 0);
});

// 12 — Double invocation is idempotent.
test("concurrent start calls produce a single connect sequence", async () => {
  const gate = createDeferred<ProviderAttemptResult>();
  let attempts = 0;

  const runner = createProviderConnectRunner({
    surface: "event-lobby",
    attempt: () => {
      attempts += 1;
      return gate.promise;
    },
  });

  const first = runner.start();
  const second = runner.start();
  gate.resolve({ outcome: "connected" });
  await Promise.all([first, second]);

  assert.equal(attempts, 1);
  assert.equal(runner.getState().status, "connected");
});

// 13 — Media-device release is called once.
test("media release runs once across overlapping teardown paths", () => {
  let releases = 0;
  const release = createIdempotentRelease(() => {
    releases += 1;
  });

  release();
  release();
  release();

  assert.equal(releases, 1);
});

// 14 — No state update occurs after owner generation is invalidated.
test("no state is published after the runner is cancelled", async () => {
  const gate = createDeferred<ProviderAttemptResult>();
  const states: string[] = [];

  const runner = createProviderConnectRunner({
    surface: "event-lobby",
    attempt: () => gate.promise,
    onState: (state) => states.push(state.status),
  });

  const run = runner.start();
  await Promise.resolve();
  runner.cancel();
  const afterCancel = states.length;

  gate.resolve({ outcome: "failed", error: TRANSPORT_408 });
  await run;

  assert.equal(states.at(-1), "cancelled");
  assert.equal(
    states.length,
    afterCancel,
    "a cancelled owner must not publish further state",
  );
});

// Handoff window semantics.
test("the handoff window opens, closes explicitly and self-heals", () => {
  assert.equal(isIntentionalProviderHandoffActive(), false);

  const release = beginIntentionalProviderHandoff();
  assert.equal(isIntentionalProviderHandoffActive(), true);
  release();
  assert.equal(isIntentionalProviderHandoffActive(), false);

  beginIntentionalProviderHandoff();
  endIntentionalProviderHandoff();
  assert.equal(
    isIntentionalProviderHandoffActive(),
    false,
    "the lobby can close a window the unmounted room opened",
  );

  beginIntentionalProviderHandoff({ windowMs: -1 });
  assert.equal(
    isIntentionalProviderHandoffActive(),
    false,
    "an abandoned window must expire on its own",
  );
});

// Signal parsing is driven by SDK types and codes, not by broad substrings.
test("provider signals are parsed from SDK type, code and action", () => {
  const transport = parseVoxProviderSignal(TRANSPORT_408);
  assert.equal(transport.scope, "Connection");
  assert.equal(transport.errorType, "TransportTimeoutError");
  assert.equal(transport.transportCode, 408);
  assert.equal(transport.fromWebSdk, true);

  const ice = parseVoxProviderSignal(ICE_RESTART_TIMEOUT);
  assert.equal(ice.actionName, "IceRestartAction");
  assert.equal(ice.scope, "ReInviteQueue_conference_ev_1");

  const applicationError = parseVoxProviderSignal(new Error("boom"));
  assert.equal(applicationError.fromWebSdk, false);
});

test("an unrelated message containing the word timeout is not auto-downgraded", () => {
  const classification = classifyVoxProviderFailure(
    new Error("Session timeout policy could not be applied"),
    HANDOFF,
  );

  assert.equal(classification.class, "APPLICATION_INVARIANT_FAILURE");
});
