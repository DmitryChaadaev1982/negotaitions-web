import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";

type HttpRequestCallback = (result: { code?: number; text?: string } | null) => void;
type HttpRequestResult = Parameters<HttpRequestCallback>[0];
type RuntimeEventListener = (event?: Record<string, unknown>) => void;

type ScenarioRuntime = {
  context: Record<string, unknown>;
  logs: string[];
};

type LoadScenarioRuntimeOptions = {
  processEnv?: Record<string, string>;
  getSecretValue?: ((secretName: string) => unknown) | null;
  createConference?: () => Record<string, unknown>;
  createRecorder?: (options: Record<string, unknown>) => Record<string, unknown>;
  onVoxEngineListener?: (eventName: string, handler: RuntimeEventListener) => void;
};

const scenarioPath = resolve(
  process.cwd(),
  "docs/voximplant/neg-conf.main-room.scenario.js",
);
const scenarioSource = readFileSync(scenarioPath, "utf8");

function sleep(ms: number) {
  return new Promise<void>((resolveSleep) => setTimeout(resolveSleep, ms));
}

function loadScenarioRuntime(options?: LoadScenarioRuntimeOptions): ScenarioRuntime {
  const logs: string[] = [];
  const context: Record<string, unknown> = {
    Math,
    Date,
    JSON,
    setTimeout,
    clearTimeout,
    process: { env: { ...(options?.processEnv ?? {}) } },
    Modules: {
      Conference: "Conference",
      Recorder: "Recorder",
    },
    require: () => ({}),
    Logger: {
      write: (message: unknown) => {
        logs.push(String(message));
      },
    },
    Net: {
      httpRequestAsync: () => {},
    },
    AppEvents: {
      Started: "Started",
      CallAlerting: "CallAlerting",
      HttpRequest: "HttpRequest",
      Terminating: "Terminating",
    },
    CallEvents: {
      MessageReceived: "MessageReceived",
      Disconnected: "Disconnected",
      Failed: "Failed",
    },
    ConferenceEvents: {
      Started: "Started",
      Stopped: "Stopped",
    },
    RecorderEvents: {
      Started: "Started",
      Paused: "Paused",
      Resumed: "Resumed",
      Stopped: "Stopped",
      Error: "Error",
    },
  };

  const defaultConferenceFactory = () => ({
    addEventListener: () => {},
    add: () => {},
    sendMediaTo: () => {},
  });

  const defaultRecorderFactory = () => ({
    addEventListener: () => {},
    stop: () => {},
    mute: () => {},
  });

  const voxEngine: Record<string, unknown> = {
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      if (typeof options?.onVoxEngineListener === "function") {
        options.onVoxEngineListener(eventName, handler);
      }
    },
    getLocalTag: () => "provider-session-1",
    createConference: options?.createConference ?? defaultConferenceFactory,
    createRecorder: options?.createRecorder ?? defaultRecorderFactory,
  };
  if (options?.getSecretValue) {
    voxEngine.getSecretValue = options.getSecretValue;
  }
  context.VoxEngine = voxEngine;

  vm.createContext(context);
  vm.runInContext(scenarioSource, context, {
    filename: "neg-conf.main-room.scenario.js",
  });
  return { context, logs };
}

function setupRegistrationContext(runtime: ScenarioRuntime) {
  runtime.context.SERVER_STOP_CALLBACK_SECRET = "x".repeat(32);
  runtime.context.providerControlAccessSecureUrl =
    "https://provider.example/control/private";
  runtime.context.providerSessionId = null;
  runtime.context.RECORDING_CONTROL_BINDING = {
    sessionId: "session-1",
    conferenceName: "negotiation-session-1",
    webhookBaseUrl: "https://local.negotaitions.ru",
  };
}

function buildBoundClaims() {
  return {
    sessionId: "session-1",
    conferenceName: "negotiation-session-1",
    webhookBaseUrl: "https://local.negotaitions.ru",
  };
}

function createSecretReader(
  values: Record<string, string>,
  options?: { throwsFor?: string[] },
) {
  const throwingKeys = new Set(options?.throwsFor ?? []);
  return (secretName: string) => {
    if (throwingKeys.has(secretName)) {
      throw new Error(`secret read failure for ${secretName}`);
    }
    if (!Object.prototype.hasOwnProperty.call(values, secretName)) {
      return null;
    }
    return values[secretName];
  };
}

function readStatusMessages(sentMessages: string[]) {
  return sentMessages
    .map((messageText) => {
      try {
        return JSON.parse(messageText) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((message): message is Record<string, unknown> => Boolean(message));
}

function buildSignedRecordingControlStartMessage(
  runtime: ScenarioRuntime,
  secret: string,
  overrides?: {
    requestId?: string;
    sessionId?: string;
    conferenceName?: string;
    nonce?: string;
    webhookBaseUrl?: string;
    issuedAt?: number;
    expiresAt?: number;
  },
) {
  const protocolVersion = String(runtime.context.RECORDING_CONTROL_PROTOCOL_VERSION);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionId = overrides?.sessionId ?? "session-rc5-1";
  const conferenceName = overrides?.conferenceName ?? `negotiation-${sessionId}`;
  const issuedAt = overrides?.issuedAt ?? nowSeconds - 5;
  const expiresAt = overrides?.expiresAt ?? issuedAt + 120;
  const claims = {
    protocolVersion,
    issuedAt,
    expiresAt,
    nonce: overrides?.nonce ?? "nonce-rc5-start-1",
    action: "start",
    requestId: overrides?.requestId ?? "req-rc5-start-1",
    sessionId,
    conferenceName,
    participantId: "participant-rc5-1",
    controllerUserId: "user-rc5-1",
    controllerRole: "facilitator",
    canControlRecording: true,
    webhookBaseUrl: overrides?.webhookBaseUrl ?? "https://local.negotaitions.ru",
  };

  const buildCanonicalPayload = runtime.context
    .buildRecordingControlCanonicalPayload as (claimsValue: Record<string, unknown>) => string;
  const computeSignature = runtime.context.computeRecordingControlSignature as (
    canonicalPayload: string,
    secretValue: string,
  ) => string | null;
  const canonicalPayload = buildCanonicalPayload(claims);
  const signature = computeSignature(canonicalPayload, secret);
  assert.ok(signature, "signature should be created for deterministic runtime payload");

  const signedPayload = {
    type: "recording_control",
    protocolVersion,
    claims,
    signature,
  };

  return JSON.stringify({
    name: "message",
    payload: JSON.stringify(signedPayload),
  });
}

function buildSignedRecordingControlMessage(
  runtime: ScenarioRuntime,
  secret: string,
  input: {
    action: "start" | "pause" | "resume" | "stop" | "status";
    requestId: string;
    nonce: string;
    sessionId: string;
    recordingAttemptId?: string;
  },
) {
  const protocolVersion = input.recordingAttemptId
    ? String(runtime.context.RECORDING_CONTROL_FENCED_PROTOCOL_VERSION)
    : String(runtime.context.RECORDING_CONTROL_PROTOCOL_VERSION);
  const issuedAt = Math.floor(Date.now() / 1000) - 5;
  const claims = {
    protocolVersion,
    issuedAt,
    expiresAt: issuedAt + 120,
    nonce: input.nonce,
    action: input.action,
    requestId: input.requestId,
    ...(input.recordingAttemptId
      ? { recordingAttemptId: input.recordingAttemptId }
      : {}),
    sessionId: input.sessionId,
    conferenceName: `negotiation-${input.sessionId}`,
    participantId: "participant-fencing-1",
    controllerUserId: "user-fencing-1",
    controllerRole: "facilitator",
    canControlRecording: true,
    webhookBaseUrl: "https://local.negotaitions.ru",
  };
  const buildCanonicalPayload = runtime.context
    .buildRecordingControlCanonicalPayload as (
    claimsValue: Record<string, unknown>,
  ) => string;
  const computeSignature = runtime.context
    .computeRecordingControlSignature as (
    canonicalPayload: string,
    secretValue: string,
  ) => string | null;
  const signature = computeSignature(buildCanonicalPayload(claims), secret);
  assert.ok(signature);
  return JSON.stringify({
    type: "recording_control",
    protocolVersion,
    claims,
    signature,
  });
}

test("registration watchdog times out stuck in-flight attempt and blocks duplicate dispatch", async () => {
  const runtime = loadScenarioRuntime();
  setupRegistrationContext(runtime);
  runtime.context.SERVER_STOP_REGISTRATION_ATTEMPT_TIMEOUT_MS = 20;

  let dispatchCount = 0;
  let pendingRequestCount = 0;
  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = () => {
    dispatchCount += 1;
    pendingRequestCount += 1;
    return new Promise<HttpRequestResult>(() => {});
  };

  const register = runtime.context.registerServerStopControlChannel as (
    claims: ReturnType<typeof buildBoundClaims>,
  ) => {
    ok: boolean;
    pending?: boolean;
    state: string;
    attempt?: number;
  };

  const first = register(buildBoundClaims());
  assert.equal(first.ok, true);
  assert.equal(first.state, "IN_FLIGHT");
  assert.equal(first.attempt, 1);

  const duplicateWhileInFlight = register(buildBoundClaims());
  assert.equal(duplicateWhileInFlight.ok, true);
  assert.equal(duplicateWhileInFlight.pending, true);
  assert.equal(duplicateWhileInFlight.state, "IN_FLIGHT");
  assert.equal(dispatchCount, 1);
  assert.equal(pendingRequestCount, 1);

  await sleep(40);

  const registration = runtime.context
    .SERVER_STOP_CONTROL_CHANNEL_REGISTRATION as Record<string, unknown>;
  assert.equal(registration.state, "FAILED_RETRYABLE");
  assert.equal(registration.inFlightAttempt, 0);
  assert.equal(registration.inFlightSinceMs, null);
  assert.equal(registration.inFlightWatchdogTimerId, null);
  assert.equal(registration.lastFailureCode, "ATTEMPT_TIMEOUT");
});

test("late registration callback after watchdog timeout is ignored", async () => {
  const runtime = loadScenarioRuntime();
  setupRegistrationContext(runtime);
  runtime.context.SERVER_STOP_REGISTRATION_ATTEMPT_TIMEOUT_MS = 20;

  let resolveRequest!: (result: HttpRequestResult) => void;
  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = () =>
    new Promise<HttpRequestResult>((resolveRequestPromise) => {
      resolveRequest = resolveRequestPromise;
    });

  const register = runtime.context.registerServerStopControlChannel as (
    claims: ReturnType<typeof buildBoundClaims>,
  ) => { ok: boolean };

  register(buildBoundClaims());
  const registrationState = runtime.context
    .SERVER_STOP_CONTROL_CHANNEL_REGISTRATION as Record<string, unknown>;
  await sleep(40);

  const nextRetryAtMsBefore = Number(registrationState.nextRetryAtMs);
  resolveRequest({
    code: 200,
    text: JSON.stringify({
      accepted: true,
      persisted: true,
      stateScope: "SESSION_SCOPED",
    }),
  });
  await sleep(0);

  assert.equal(registrationState.state, "FAILED_RETRYABLE");
  assert.equal(registrationState.acknowledgedAtMs, null);
  assert.equal(Number(registrationState.nextRetryAtMs), nextRetryAtMsBefore);
});

test("callback before timeout acknowledges and clears watchdog", async () => {
  const runtime = loadScenarioRuntime();
  setupRegistrationContext(runtime);
  runtime.context.SERVER_STOP_REGISTRATION_ATTEMPT_TIMEOUT_MS = 100;

  let resolveRequest!: (result: HttpRequestResult) => void;
  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = () =>
    new Promise<HttpRequestResult>((resolveRequestPromise) => {
      resolveRequest = resolveRequestPromise;
    });

  const register = runtime.context.registerServerStopControlChannel as (
    claims: ReturnType<typeof buildBoundClaims>,
  ) => { ok: boolean };

  register(buildBoundClaims());
  const registrationState = runtime.context
    .SERVER_STOP_CONTROL_CHANNEL_REGISTRATION as Record<string, unknown>;
  assert.notEqual(registrationState.inFlightWatchdogTimerId, null);

  resolveRequest({
    code: 200,
    text: JSON.stringify({
      accepted: true,
      persisted: true,
      stateScope: "SESSION_SCOPED",
    }),
  });
  await sleep(0);

  assert.equal(registrationState.state, "ACKNOWLEDGED");
  assert.equal(registrationState.inFlightAttempt, 0);
  assert.equal(registrationState.inFlightSinceMs, null);
  assert.equal(registrationState.inFlightWatchdogTimerId, null);

  await sleep(120);
  assert.equal(registrationState.state, "ACKNOWLEDGED");
});

test("synchronous Net.httpRequestAsync exception uses retryable failure path without leaking URL", () => {
  const runtime = loadScenarioRuntime();
  setupRegistrationContext(runtime);
  runtime.context.SERVER_STOP_REGISTRATION_ATTEMPT_TIMEOUT_MS = 50;

  const secretUrlMarker = "https://provider.example/control/private?token=super-secret";
  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = () => {
    throw new Error(`sync dispatch failed ${secretUrlMarker}`);
  };

  const register = runtime.context.registerServerStopControlChannel as (
    claims: ReturnType<typeof buildBoundClaims>,
  ) => { ok: boolean };
  register(buildBoundClaims());

  const registration = runtime.context
    .SERVER_STOP_CONTROL_CHANNEL_REGISTRATION as Record<string, unknown>;
  assert.notEqual(registration.state, "IN_FLIGHT");
  assert.equal(registration.state, "FAILED_RETRYABLE");
  assert.equal(registration.inFlightAttempt, 0);
  assert.equal(registration.inFlightSinceMs, null);
  assert.equal(registration.inFlightWatchdogTimerId, null);

  const joinedLogs = runtime.logs.join("\n");
  assert.equal(joinedLogs.includes(secretUrlMarker), false);
  assert.equal(joinedLogs.includes("super-secret"), false);
});

test("rule identity prefers dialplanName and then dialplanId from startup event", () => {
  const runtime = loadScenarioRuntime();
  const resolveRuleIdentity = runtime.context.resolveServerStopRuleIdentity as (
    event: Record<string, unknown> | null,
  ) => string;

  const identity = resolveRuleIdentity({
    dialplanName: "neg-conf-server-stop-poc-rule",
    dialplanId: 9175667,
    accessSecureURL: "https://provider.example/control/private",
    sessionId: "vox-1721550801000-abc123",
  });

  assert.equal(identity, "neg-conf-server-stop-poc-rule");
});

test("recording-status origin uses binding authoritatively when present", () => {
  const runtime = loadScenarioRuntime();
  const resolveOrigin = runtime.context.resolveRecordingStatusWebhookOrigin as (
    sessionId: string,
    conferenceName: string,
    preferredWebhookBaseUrl?: string | null,
  ) => { origin: string | null; source: string; code: string | null };

  runtime.context.RECORDING_CONTROL_BINDING = {
    sessionId: "session-1",
    conferenceName: "negotiation-session-1",
    webhookBaseUrl: "https://local.negotaitions.ru",
  };

  const localMatch = resolveOrigin(
    "session-1",
    "negotiation-session-1",
    "https://local.negotaitions.ru",
  );
  assert.equal(localMatch.origin, "https://local.negotaitions.ru");
  assert.equal(localMatch.code, null);

  runtime.context.RECORDING_CONTROL_BINDING = {
    sessionId: "session-2",
    conferenceName: "negotiation-session-2",
    webhookBaseUrl: "https://negotaitions.ru",
  };

  const productionMatch = resolveOrigin(
    "session-2",
    "negotiation-session-2",
    "https://negotaitions.ru",
  );
  assert.equal(productionMatch.origin, "https://negotaitions.ru");
  assert.equal(productionMatch.code, null);

  const localBindingWithProductionPreferred = resolveOrigin(
    "session-2",
    "negotiation-session-2",
    "https://local.negotaitions.ru",
  );
  assert.equal(localBindingWithProductionPreferred.origin, null);
  assert.equal(localBindingWithProductionPreferred.code, "BINDING_ORIGIN_MISMATCH");

  runtime.context.RECORDING_CONTROL_BINDING = {
    sessionId: "session-3",
    conferenceName: "negotiation-session-3",
    webhookBaseUrl: "https://local.negotaitions.ru",
  };
  const productionPreferredMismatch = resolveOrigin(
    "session-3",
    "negotiation-session-3",
    "https://negotaitions.ru",
  );
  assert.equal(productionPreferredMismatch.origin, null);
  assert.equal(productionPreferredMismatch.code, "BINDING_ORIGIN_MISMATCH");

  const conflictingConference = resolveOrigin(
    "session-3",
    "negotiation-session-OTHER",
    "https://local.negotaitions.ru",
  );
  assert.equal(conflictingConference.origin, null);
  assert.equal(conflictingConference.code, "RECORDING_CONTROL_BINDING_MISMATCH");
});

test("legacy static recording-status origin fallback is used only without binding", () => {
  const runtime = loadScenarioRuntime();
  const resolveOrigin = runtime.context.resolveRecordingStatusWebhookOrigin as (
    sessionId: string,
    conferenceName: string,
    preferredWebhookBaseUrl?: string | null,
  ) => { origin: string | null; source: string; code: string | null };

  runtime.context.WEBHOOK_BASE_URL = "https://negotaitions.ru";
  runtime.context.RECORDING_CONTROL_BINDING = null;
  const legacy = resolveOrigin("session-legacy", "negotiation-session-legacy", null);
  assert.equal(legacy.origin, "https://negotaitions.ru");
  assert.equal(legacy.source, "legacy_static_origin");
  assert.equal(legacy.code, null);
});

test("retry schedule is 1s, 2s, 4s and attempt 4 failure is terminal", () => {
  const runtime = loadScenarioRuntime();
  const backoff = runtime.context.buildServerStopRegistrationBackoffMs as (
    attempt: number,
  ) => number;
  assert.equal(backoff(1), 1000);
  assert.equal(backoff(2), 2000);
  assert.equal(backoff(3), 4000);

  const applyResult = runtime.context.applyServerStopRegistrationAttemptResult as (
    registrationKey: string,
    attemptNo: number,
    callbackResult: Record<string, unknown> | null,
  ) => void;
  const createState = runtime.context.createServerStopRegistrationState as (
    registrationKey: string,
  ) => Record<string, unknown>;
  const registration = createState("session-1|negotiation-session-1|provider|url|origin");
  registration.state = "IN_FLIGHT";
  registration.attemptCount = 4;
  registration.inFlightAttempt = 4;
  registration.inFlightSinceMs = Date.now();

  runtime.context.SERVER_STOP_CONTROL_CHANNEL_REGISTRATION = registration;
  applyResult(
    "session-1|negotiation-session-1|provider|url|origin",
    4,
    { __serverStopRegistrationWatchdogTimeout: true },
  );

  assert.equal(registration.state, "FAILED_TERMINAL");
  assert.equal(registration.nextRetryAtMs, 0);
  assert.equal(registration.lastFailureCode, "ATTEMPT_TIMEOUT");
});

test("secret loader prefers VoxEngine primary over alias and keeps logs secret-safe", () => {
  const primarySecret = "primary-secret-0123456789";
  const aliasSecret = "alias-secret-0123456789";
  const runtime = loadScenarioRuntime({
    processEnv: {
      VOXIMPLANT_RECORDING_WEBHOOK_SECRET: "env-primary-secret-0123456789",
      WEBHOOK_SECRET: "env-alias-secret-0123456789",
    },
    getSecretValue: createSecretReader({
      VOXIMPLANT_RECORDING_WEBHOOK_SECRET: `  ${primarySecret}  `,
      WEBHOOK_SECRET: aliasSecret,
    }),
  });

  const applyWebhookEnvironmentConfig = runtime.context
    .applyWebhookEnvironmentConfig as () => void;
  applyWebhookEnvironmentConfig();

  assert.equal(runtime.context.WEBHOOK_SECRET, primarySecret);
  const joinedLogs = runtime.logs.join("\n");
  assert.equal(
    joinedLogs.includes("webhook secret source=vox_secret_primary configured=true"),
    true,
  );
  assert.equal(joinedLogs.includes(primarySecret), false);
  assert.equal(joinedLogs.includes(aliasSecret), false);
});

test("secret loader uses VoxEngine alias when primary is absent", () => {
  const aliasSecret = "alias-only-secret-0123456789";
  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader({
      WEBHOOK_SECRET: aliasSecret,
    }),
  });

  const applyWebhookEnvironmentConfig = runtime.context
    .applyWebhookEnvironmentConfig as () => void;
  applyWebhookEnvironmentConfig();

  assert.equal(runtime.context.WEBHOOK_SECRET, aliasSecret);
  assert.equal(
    runtime.logs.join("\n").includes("webhook secret source=vox_secret_alias configured=true"),
    true,
  );
});

test("secret loader fails safely on provider exceptions and missing values", () => {
  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader(
      {
        VOXIMPLANT_RECORDING_CONTROL_SECRET: "   ",
      },
      { throwsFor: ["RECORDING_CONTROL_SECRET"] },
    ),
  });

  const applyRecordingControlEnvironmentConfig = runtime.context
    .applyRecordingControlEnvironmentConfig as () => void;
  applyRecordingControlEnvironmentConfig();

  assert.equal(runtime.context.RECORDING_CONTROL_SECRET, "");
  assert.equal(
    runtime.logs.join("\n").includes("recording-control secret source=missing configured=false"),
    true,
  );
});

test("process.env fallback is used only when VoxEngine secret API is unavailable", () => {
  const envSecret = "env-fallback-secret-0123456789";
  const fallbackRuntime = loadScenarioRuntime({
    processEnv: {
      RECORDING_CONTROL_SECRET: `  ${envSecret}  `,
    },
    getSecretValue: null,
  });
  const applyRecordingControlFallback = fallbackRuntime.context
    .applyRecordingControlEnvironmentConfig as () => void;
  applyRecordingControlFallback();

  assert.equal(fallbackRuntime.context.RECORDING_CONTROL_SECRET, envSecret);
  assert.equal(
    fallbackRuntime.logs.join("\n").includes(
      "recording-control secret source=process_env_fallback configured=true",
    ),
    true,
  );

  const providerRuntime = loadScenarioRuntime({
    processEnv: {
      RECORDING_CONTROL_SECRET: envSecret,
    },
    getSecretValue: createSecretReader({}),
  });
  const applyRecordingControlProvider = providerRuntime.context
    .applyRecordingControlEnvironmentConfig as () => void;
  applyRecordingControlProvider();

  assert.equal(providerRuntime.context.RECORDING_CONTROL_SECRET, "");
  assert.equal(
    providerRuntime.logs.join("\n").includes(
      "recording-control secret source=missing configured=false",
    ),
    true,
  );
});

test("all current POC secret names are recognized in VoxEngine Secret Storage", () => {
  const webhookAlias = "poc-webhook-secret-0123456789";
  const controlPrimary = "poc-recording-control-0123456789";
  const stopControlPrimary = "poc-stop-control-0123456789";
  const stopCallbackPrimary = "poc-stop-callback-0123456789";
  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader({
      WEBHOOK_SECRET: webhookAlias,
      RECORDING_CONTROL_SECRET: controlPrimary,
      SERVER_STOP_CONTROL_SECRET: stopControlPrimary,
      SERVER_STOP_CALLBACK_SECRET: stopCallbackPrimary,
    }),
  });

  (runtime.context.applyWebhookEnvironmentConfig as () => void)();
  (runtime.context.applyRecordingControlEnvironmentConfig as () => void)();
  (runtime.context.applyServerStopEnvironmentConfig as () => void)();

  assert.equal(runtime.context.WEBHOOK_SECRET, webhookAlias);
  assert.equal(runtime.context.RECORDING_CONTROL_SECRET, controlPrimary);
  assert.equal(runtime.context.SERVER_STOP_CONTROL_SECRET, stopControlPrimary);
  assert.equal(runtime.context.SERVER_STOP_CALLBACK_SECRET, stopCallbackPrimary);

  const joinedLogs = runtime.logs.join("\n");
  assert.equal(
    joinedLogs.includes("webhook secret source=vox_secret_alias configured=true"),
    true,
  );
  assert.equal(
    joinedLogs.includes("recording-control secret source=vox_secret_primary configured=true"),
    true,
  );
  assert.equal(
    joinedLogs.includes("server-stop control source=vox_secret_primary configured=true"),
    true,
  );
  assert.equal(
    joinedLogs.includes("server-stop callback source=vox_secret_primary configured=true"),
    true,
  );
  assert.equal(joinedLogs.includes(webhookAlias), false);
  assert.equal(joinedLogs.includes(controlPrimary), false);
  assert.equal(joinedLogs.includes(stopControlPrimary), false);
  assert.equal(joinedLogs.includes(stopCallbackPrimary), false);
});

test("provider relay wrapper start command succeeds with VoxEngine recording secret", () => {
  const recordingControlSecret = "test-recording-control-secret-0123456789";
  const callbackSecret = "test-server-stop-callback-secret-0123456789";
  const webhookSecret = "test-webhook-secret-0123456789";
  const sentMessages: string[] = [];
  const recorderListeners: Record<string, RuntimeEventListener> = {};
  const callListeners: Record<string, RuntimeEventListener> = {};
  const httpRequests: Array<{ url: string; options: Record<string, unknown> | null }> = [];
  let createRecorderCalls = 0;
  let sendMediaToCalls = 0;

  const recorder = {
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      recorderListeners[eventName] = handler;
    },
    stop: () => {},
    mute: () => {},
  };

  const conference = {
    addEventListener: () => {},
    add: () => {},
    sendMediaTo: (target: unknown) => {
      sendMediaToCalls += 1;
      assert.equal(target, recorder);
    },
  };

  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader({
      RECORDING_CONTROL_SECRET: recordingControlSecret,
      SERVER_STOP_CALLBACK_SECRET: callbackSecret,
      WEBHOOK_SECRET: webhookSecret,
    }),
    createConference: () => conference,
    createRecorder: () => {
      createRecorderCalls += 1;
      return recorder;
    },
  });

  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = (
    url: string,
    options: Record<string, unknown>,
    callback: HttpRequestCallback,
  ) => {
    httpRequests.push({ url, options });
    const postData = typeof options?.postData === "string" ? options.postData : "";
    if (postData.includes('"eventType":"provider_session_registered"')) {
      callback({
        code: 200,
        text: JSON.stringify({
          accepted: true,
          persisted: true,
          stateScope: "SESSION_SCOPED",
        }),
      });
      return;
    }
    callback({ code: 200, text: JSON.stringify({ ok: true }) });
  };

  const onAppStarted = runtime.context.onAppStarted as (
    event: Record<string, unknown>,
  ) => void;
  onAppStarted({
    dialplanName: "neg-conf-server-stop-test-rule",
    accessSecureURL: "https://provider.example/control/private",
  });

  const call = {
    id: () => "call-rc5-1",
    answer: () => {},
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      callListeners[eventName] = handler;
    },
    sendMessage: (messageText: string) => {
      sentMessages.push(messageText);
    },
  };

  const handleIncomingCall = runtime.context.handleIncomingCall as (
    event: Record<string, unknown>,
  ) => void;
  handleIncomingCall({ call, scheme: "WSS" });

  const messageHandler = callListeners.MessageReceived;
  assert.equal(typeof messageHandler, "function");

  const sessionId = "cmrv682580004souavvnxxu88";
  const providerMessageText = buildSignedRecordingControlStartMessage(
    runtime,
    recordingControlSecret,
    {
      requestId: "req-provider-shape-1",
      sessionId,
      conferenceName: `negotiation-${sessionId}`,
      nonce: "nonce-provider-shape-1",
      webhookBaseUrl: "https://local.negotaitions.ru",
    },
  );

  messageHandler?.({ text: providerMessageText });
  recorderListeners.Started?.({
    id: "rec-rc5-1",
    url: "https://storage.example.net/recordings/audio-file.webm",
  });

  const statuses = readStatusMessages(sentMessages);
  assert.equal(
    statuses.some(
      (statusPayload) =>
        statusPayload.errorCode === "RECORDING_CONTROL_SECRET_UNAVAILABLE",
    ),
    false,
  );
  assert.equal(
    statuses.some((statusPayload) => statusPayload.status === "starting"),
    true,
  );
  assert.equal(createRecorderCalls, 1);
  assert.equal(sendMediaToCalls, 1);
  assert.equal(
    runtime.logs.join("\n").includes("recording_control verified action=start"),
    true,
  );

  const binding = runtime.context
    .RECORDING_CONTROL_BINDING as Record<string, unknown> | null;
  assert.ok(binding);
  assert.equal(binding?.sessionId, sessionId);
  assert.equal(binding?.webhookBaseUrl, "https://local.negotaitions.ru");

  const registrationRequest = httpRequests.find((request) => {
    const postData = request.options?.postData;
    return typeof postData === "string" &&
      postData.includes('"eventType":"provider_session_registered"');
  });
  assert.ok(registrationRequest);
  const registrationPostData =
    registrationRequest &&
      registrationRequest.options &&
      typeof registrationRequest.options.postData === "string"
      ? registrationRequest.options.postData
      : null;
  const registrationPayload = registrationPostData
    ? JSON.parse(registrationPostData)
    : null;
  assert.equal(
    registrationPayload?.accessSecureUrl,
    "https://provider.example/control/private",
  );
  assert.equal(
    registrationPayload?.controlUrl,
    "https://provider.example/control/private",
  );
});

test("provider relay wrapper accepts +11 second recording-control clock delta", () => {
  const recordingControlSecret = "test-recording-control-secret-011-clock-skew";
  const callbackSecret = "test-server-stop-callback-secret-011";
  const webhookSecret = "test-webhook-secret-011";
  const sentMessages: string[] = [];
  const recorderListeners: Record<string, RuntimeEventListener> = {};
  const callListeners: Record<string, RuntimeEventListener> = {};
  const httpRequests: Array<{ url: string; options: Record<string, unknown> | null }> = [];
  let createRecorderCalls = 0;
  let sendMediaToCalls = 0;

  const recorder = {
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      recorderListeners[eventName] = handler;
    },
    stop: () => {},
    mute: () => {},
  };

  const conference = {
    addEventListener: () => {},
    add: () => {},
    sendMediaTo: (target: unknown) => {
      sendMediaToCalls += 1;
      assert.equal(target, recorder);
    },
  };

  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader({
      RECORDING_CONTROL_SECRET: recordingControlSecret,
      SERVER_STOP_CALLBACK_SECRET: callbackSecret,
      WEBHOOK_SECRET: webhookSecret,
    }),
    createConference: () => conference,
    createRecorder: () => {
      createRecorderCalls += 1;
      return recorder;
    },
  });

  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = (
    url: string,
    options: Record<string, unknown>,
    callback: HttpRequestCallback,
  ) => {
    httpRequests.push({ url, options });
    const postData = typeof options?.postData === "string" ? options.postData : "";
    if (postData.includes('"eventType":"provider_session_registered"')) {
      callback({
        code: 200,
        text: JSON.stringify({
          accepted: true,
          persisted: true,
          stateScope: "SESSION_SCOPED",
        }),
      });
      return;
    }
    callback({ code: 200, text: JSON.stringify({ ok: true }) });
  };

  const onAppStarted = runtime.context.onAppStarted as (
    event: Record<string, unknown>,
  ) => void;
  onAppStarted({
    dialplanName: "neg-conf-server-stop-test-rule",
    accessSecureURL: "https://provider.example/control/private",
  });

  const call = {
    id: () => "call-clock-skew-11",
    answer: () => {},
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      callListeners[eventName] = handler;
    },
    sendMessage: (messageText: string) => {
      sentMessages.push(messageText);
    },
  };

  const handleIncomingCall = runtime.context.handleIncomingCall as (
    event: Record<string, unknown>,
  ) => void;
  handleIncomingCall({ call, scheme: "WSS" });

  const messageHandler = callListeners.MessageReceived;
  assert.equal(typeof messageHandler, "function");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionId = "cmrv682580004souavvnxxu89";
  const providerMessageText = buildSignedRecordingControlStartMessage(
    runtime,
    recordingControlSecret,
    {
      requestId: "req-clock-skew-11",
      sessionId,
      conferenceName: `negotiation-${sessionId}`,
      nonce: "nonce-clock-skew-11",
      webhookBaseUrl: "https://local.negotaitions.ru",
      issuedAt: nowSeconds + 11,
      expiresAt: nowSeconds + 131,
    },
  );

  messageHandler?.({ text: providerMessageText });
  recorderListeners.Started?.({
    id: "rec-clock-skew-11",
    url: "https://storage.example.net/recordings/audio-file.webm",
  });

  const statuses = readStatusMessages(sentMessages);
  assert.equal(
    statuses.some((statusPayload) => statusPayload.status === "starting"),
    true,
  );
  assert.equal(
    statuses.some((statusPayload) => statusPayload.status === "recording"),
    true,
  );
  assert.equal(
    statuses.some(
      (statusPayload) =>
        statusPayload.errorCode === "RECORDING_CONTROL_NOT_YET_VALID",
    ),
    false,
  );
  assert.equal(createRecorderCalls, 1);
  assert.equal(sendMediaToCalls, 1);
  assert.equal(
    httpRequests.some((request) => {
      const postData = request.options?.postData;
      return (
        typeof postData === "string" &&
        postData.includes('"eventType":"provider_session_registered"')
      );
    }),
    true,
  );
});

test("provider relay wrapper rejects start command beyond future skew and persists deterministic failure", () => {
  const recordingControlSecret = "test-recording-control-secret-012-skew-reject";
  const callbackSecret = "test-server-stop-callback-secret-012";
  const webhookSecret = "test-webhook-secret-012";
  const sentMessages: string[] = [];
  const callListeners: Record<string, RuntimeEventListener> = {};
  const httpRequests: Array<{ url: string; options: Record<string, unknown> | null }> = [];
  let createRecorderCalls = 0;
  let sendMediaToCalls = 0;

  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader({
      RECORDING_CONTROL_SECRET: recordingControlSecret,
      SERVER_STOP_CALLBACK_SECRET: callbackSecret,
      WEBHOOK_SECRET: webhookSecret,
    }),
    createConference: () => ({
      addEventListener: () => {},
      add: () => {},
      sendMediaTo: () => {
        sendMediaToCalls += 1;
      },
    }),
    createRecorder: () => {
      createRecorderCalls += 1;
      return {
        addEventListener: () => {},
        stop: () => {},
        mute: () => {},
      };
    },
  });

  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = (
    url: string,
    options: Record<string, unknown>,
    callback: HttpRequestCallback,
  ) => {
    httpRequests.push({ url, options });
    callback({ code: 200, text: JSON.stringify({ ok: true }) });
  };

  const onAppStarted = runtime.context.onAppStarted as (
    event: Record<string, unknown>,
  ) => void;
  onAppStarted({
    dialplanName: "neg-conf-server-stop-test-rule",
    accessSecureURL: "https://provider.example/control/private",
  });

  const call = {
    id: () => "call-clock-skew-reject",
    answer: () => {},
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      callListeners[eventName] = handler;
    },
    sendMessage: (messageText: string) => {
      sentMessages.push(messageText);
    },
  };

  const handleIncomingCall = runtime.context.handleIncomingCall as (
    event: Record<string, unknown>,
  ) => void;
  handleIncomingCall({ call, scheme: "WSS" });

  const messageHandler = callListeners.MessageReceived;
  assert.equal(typeof messageHandler, "function");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionId = "cmrv682580004souavvnxxu90";
  const providerMessageText = buildSignedRecordingControlStartMessage(
    runtime,
    recordingControlSecret,
    {
      requestId: "req-clock-skew-reject",
      sessionId,
      conferenceName: `negotiation-${sessionId}`,
      nonce: "nonce-clock-skew-reject",
      webhookBaseUrl: "https://local.negotaitions.ru",
      issuedAt: nowSeconds + 120,
      expiresAt: nowSeconds + 240,
    },
  );

  messageHandler?.({ text: providerMessageText });

  const statuses = readStatusMessages(sentMessages);
  assert.equal(
    statuses.some(
      (statusPayload) =>
        statusPayload.errorCode === "RECORDING_CONTROL_NOT_YET_VALID",
    ),
    true,
  );
  assert.equal(createRecorderCalls, 0);
  assert.equal(sendMediaToCalls, 0);

  const recordingStatusWebhook = httpRequests.find(
    (request) =>
      request.url.includes("/voximplant/recording-status") &&
      typeof request.options?.postData === "string" &&
      request.options.postData.includes(
        '"errorCode":"RECORDING_CONTROL_NOT_YET_VALID"',
      ),
  );
  assert.ok(recordingStatusWebhook);
  assert.equal(
    httpRequests.some((request) => request.url.includes("/voximplant/server-stop-callback")),
    false,
  );

  const wrapped = JSON.parse(providerMessageText) as { payload: string };
  const signedPayload = JSON.parse(wrapped.payload) as { signature: string };
  const joinedLogs = runtime.logs.join("\n");
  assert.equal(joinedLogs.includes(recordingControlSecret), false);
  assert.equal(joinedLogs.includes(signedPayload.signature), false);
});

test("provider relay wrapper rejects expired command beyond past skew with deterministic code", () => {
  const recordingControlSecret = "test-recording-control-secret-013-expired";
  const callbackSecret = "test-server-stop-callback-secret-013";
  const webhookSecret = "test-webhook-secret-013";
  const sentMessages: string[] = [];
  const callListeners: Record<string, RuntimeEventListener> = {};
  const httpRequests: Array<{ url: string; options: Record<string, unknown> | null }> = [];
  let createRecorderCalls = 0;

  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader({
      RECORDING_CONTROL_SECRET: recordingControlSecret,
      SERVER_STOP_CALLBACK_SECRET: callbackSecret,
      WEBHOOK_SECRET: webhookSecret,
    }),
    createConference: () => ({
      addEventListener: () => {},
      add: () => {},
      sendMediaTo: () => {},
    }),
    createRecorder: () => {
      createRecorderCalls += 1;
      return {
        addEventListener: () => {},
        stop: () => {},
        mute: () => {},
      };
    },
  });

  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = (
    url: string,
    options: Record<string, unknown>,
    callback: HttpRequestCallback,
  ) => {
    httpRequests.push({ url, options });
    callback({ code: 200, text: JSON.stringify({ ok: true }) });
  };

  const onAppStarted = runtime.context.onAppStarted as (
    event: Record<string, unknown>,
  ) => void;
  onAppStarted({
    dialplanName: "neg-conf-server-stop-test-rule",
    accessSecureURL: "https://provider.example/control/private",
  });

  const call = {
    id: () => "call-clock-skew-expired",
    answer: () => {},
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      callListeners[eventName] = handler;
    },
    sendMessage: (messageText: string) => {
      sentMessages.push(messageText);
    },
  };

  const handleIncomingCall = runtime.context.handleIncomingCall as (
    event: Record<string, unknown>,
  ) => void;
  handleIncomingCall({ call, scheme: "WSS" });

  const messageHandler = callListeners.MessageReceived;
  assert.equal(typeof messageHandler, "function");

  const nowSeconds = Math.floor(Date.now() / 1000);
  const sessionId = "cmrv682580004souavvnxxu91";
  const providerMessageText = buildSignedRecordingControlStartMessage(
    runtime,
    recordingControlSecret,
    {
      requestId: "req-clock-skew-expired",
      sessionId,
      conferenceName: `negotiation-${sessionId}`,
      nonce: "nonce-clock-skew-expired",
      webhookBaseUrl: "https://local.negotaitions.ru",
      issuedAt: nowSeconds - 200,
      expiresAt: nowSeconds - 100,
    },
  );

  messageHandler?.({ text: providerMessageText });

  const statuses = readStatusMessages(sentMessages);
  assert.equal(
    statuses.some(
      (statusPayload) =>
        statusPayload.errorCode === "RECORDING_CONTROL_EXPIRED",
    ),
    true,
  );
  assert.equal(createRecorderCalls, 0);
  assert.equal(
    httpRequests.some((request) =>
      request.url.includes("/voximplant/recording-status"),
    ),
    true,
  );
});

test("replayed nonce remains idempotent and does not recreate recorder", () => {
  const recordingControlSecret = "test-recording-control-secret-014-replay";
  const callbackSecret = "test-server-stop-callback-secret-014";
  const webhookSecret = "test-webhook-secret-014";
  const sentMessages: string[] = [];
  const callListeners: Record<string, RuntimeEventListener> = {};
  let createRecorderCalls = 0;

  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader({
      RECORDING_CONTROL_SECRET: recordingControlSecret,
      SERVER_STOP_CALLBACK_SECRET: callbackSecret,
      WEBHOOK_SECRET: webhookSecret,
    }),
    createConference: () => ({
      addEventListener: () => {},
      add: () => {},
      sendMediaTo: () => {},
    }),
    createRecorder: () => {
      createRecorderCalls += 1;
      return {
        addEventListener: () => {},
        stop: () => {},
        mute: () => {},
      };
    },
  });

  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = (
    _url: string,
    _options: Record<string, unknown>,
    callback: HttpRequestCallback,
  ) => {
    callback({
      code: 200,
      text: JSON.stringify({
        accepted: true,
        persisted: true,
        stateScope: "SESSION_SCOPED",
      }),
    });
  };

  const onAppStarted = runtime.context.onAppStarted as (
    event: Record<string, unknown>,
  ) => void;
  onAppStarted({
    dialplanName: "neg-conf-server-stop-test-rule",
    accessSecureURL: "https://provider.example/control/private",
  });

  const call = {
    id: () => "call-replay-idempotent",
    answer: () => {},
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      callListeners[eventName] = handler;
    },
    sendMessage: (messageText: string) => {
      sentMessages.push(messageText);
    },
  };

  const handleIncomingCall = runtime.context.handleIncomingCall as (
    event: Record<string, unknown>,
  ) => void;
  handleIncomingCall({ call, scheme: "WSS" });
  const messageHandler = callListeners.MessageReceived;
  assert.equal(typeof messageHandler, "function");

  const sessionId = "cmrv682580004souavvnxxu92";
  const providerMessageText = buildSignedRecordingControlStartMessage(
    runtime,
    recordingControlSecret,
    {
      requestId: "req-replay-idempotent",
      sessionId,
      conferenceName: `negotiation-${sessionId}`,
      nonce: "nonce-replay-idempotent",
      webhookBaseUrl: "https://local.negotaitions.ru",
    },
  );

  messageHandler?.({ text: providerMessageText });
  messageHandler?.({ text: providerMessageText });

  assert.equal(createRecorderCalls, 1);
  const statuses = readStatusMessages(sentMessages);
  assert.equal(
    statuses.some((statusPayload) => statusPayload.status === "starting"),
    true,
  );
});

test("provider relay wrapper fails closed when recording control secret is unavailable", () => {
  const sentMessages: string[] = [];
  const callListeners: Record<string, RuntimeEventListener> = {};
  let createRecorderCalls = 0;
  let registrationAttempts = 0;
  const deterministicSecret = "test-missing-secret-payload-signing-only-0123456789";

  const runtime = loadScenarioRuntime({
    getSecretValue: createSecretReader({
      SERVER_STOP_CALLBACK_SECRET: "callback-secret-available-0123456789",
      WEBHOOK_SECRET: "webhook-secret-available-0123456789",
    }),
    createConference: () => ({
      addEventListener: () => {},
      add: () => {},
      sendMediaTo: () => {},
    }),
    createRecorder: () => {
      createRecorderCalls += 1;
      return {
        addEventListener: () => {},
        stop: () => {},
        mute: () => {},
      };
    },
  });

  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = () => {
    registrationAttempts += 1;
  };

  const onAppStarted = runtime.context.onAppStarted as (
    event: Record<string, unknown>,
  ) => void;
  onAppStarted({
    dialplanName: "neg-conf-server-stop-test-rule",
    accessSecureURL: "https://provider.example/control/private",
  });

  const call = {
    id: () => "call-rc5-fail-closed",
    answer: () => {},
    addEventListener: (eventName: string, handler: RuntimeEventListener) => {
      callListeners[eventName] = handler;
    },
    sendMessage: (messageText: string) => {
      sentMessages.push(messageText);
    },
  };

  const handleIncomingCall = runtime.context.handleIncomingCall as (
    event: Record<string, unknown>,
  ) => void;
  handleIncomingCall({ call, scheme: "WSS" });

  const messageHandler = callListeners.MessageReceived;
  assert.equal(typeof messageHandler, "function");
  const sessionId = "cmrv682580004souavvnxxu88";
  const providerMessageText = buildSignedRecordingControlStartMessage(
    runtime,
    deterministicSecret,
    {
      requestId: "req-provider-shape-fail-1",
      sessionId,
      conferenceName: `negotiation-${sessionId}`,
      nonce: "nonce-provider-shape-fail-1",
      webhookBaseUrl: "https://local.negotaitions.ru",
    },
  );

  messageHandler?.({ text: providerMessageText });

  const statuses = readStatusMessages(sentMessages);
  const secretUnavailableStatus = statuses.find(
    (statusPayload) =>
      statusPayload.errorCode === "RECORDING_CONTROL_SECRET_UNAVAILABLE",
  );
  assert.ok(secretUnavailableStatus);
  assert.equal(createRecorderCalls, 0);
  assert.equal(runtime.context.RECORDING_CONTROL_BINDING, null);
  assert.equal(registrationAttempts, 0);
});

test("late recorder A events stay tagged A and cannot mutate current recorder B", async () => {
  const listenerSets: Array<Record<string, RuntimeEventListener>> = [];
  const stopCalls: number[] = [];
  const httpBodies: Array<Record<string, unknown>> = [];
  let recorderIndex = 0;
  const runtime = loadScenarioRuntime({
    createRecorder: () => {
      const index = recorderIndex++;
      const listeners: Record<string, RuntimeEventListener> = {};
      listenerSets[index] = listeners;
      stopCalls[index] = 0;
      return {
        addEventListener: (
          eventName: string,
          handler: RuntimeEventListener,
        ) => {
          listeners[eventName] = handler;
        },
        stop: () => {
          stopCalls[index] += 1;
        },
        mute: () => {},
      };
    },
  });
  runtime.context.conference = {
    sendMediaTo: () => {},
  };
  runtime.context.WEBHOOK_SECRET = "webhook-secret-attempt-events-0123456789";
  runtime.context.RECORDING_CONTROL_BINDING = {
    sessionId: "session-attempt-events",
    conferenceName: "negotiation-session-attempt-events",
    webhookBaseUrl: "https://local.negotaitions.ru",
    providerSessionId: "provider-session-1",
  };
  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = (
    _url: string,
    options: { postData?: string },
  ) => {
    if (options.postData) {
      httpBodies.push(JSON.parse(options.postData) as Record<string, unknown>);
    }
    return Promise.resolve({ code: 200, text: JSON.stringify({ ok: true }) });
  };
  runtime.context.STARTING_TIMEOUT_MS = 5;

  const sentA: string[] = [];
  const sentB: string[] = [];
  const callA = { sendMessage: (message: string) => sentA.push(message) };
  const callB = { sendMessage: (message: string) => sentB.push(message) };
  const startRecording = runtime.context.startRecording as (
    call: Record<string, unknown>,
    requestId: string,
  ) => void;

  runtime.context.currentRecordingContext = {
    protocolVersion: runtime.context.RECORDING_CONTROL_FENCED_PROTOCOL_VERSION,
    recordingAttemptId: "attempt-a",
    sessionId: "session-attempt-events",
    conferenceName: "negotiation-session-attempt-events",
    webhookBaseUrl: "https://local.negotaitions.ru",
    participantId: "participant-a",
    startRequestId: "start-a",
    stopRequestId: null,
  };
  startRecording(callA, "start-a");
  const contextA = runtime.context.currentRecordingContext as Record<
    string,
    unknown
  >;
  const recorderA = contextA.recorder;
  await sleep(20);

  assert.equal(runtime.context.recordingState, "error");
  assert.equal(stopCalls[0], 1);
  assert.equal(contextA.cleanupRequested, true);
  assert.equal(contextA.recorder, recorderA);

  runtime.context.currentRecordingContext = {
    protocolVersion: runtime.context.RECORDING_CONTROL_FENCED_PROTOCOL_VERSION,
    recordingAttemptId: "attempt-b",
    sessionId: "session-attempt-events",
    conferenceName: "negotiation-session-attempt-events",
    webhookBaseUrl: "https://local.negotaitions.ru",
    participantId: "participant-b",
    startRequestId: "start-b",
    stopRequestId: null,
  };
  const bodiesBeforeB = httpBodies.length;
  startRecording(callB, "start-b");
  listenerSets[1]?.Started?.({
    id: "provider-b",
    url: "https://storage.yandexcloud.net/negotiation-room/audio/b.flac",
  });
  await sleep(0);

  const bStartBodies = httpBodies.slice(bodiesBeforeB);
  const bStarting = bStartBodies.find((body) => body.status === "starting");
  const bRecording = bStartBodies.find((body) => body.status === "recording");
  assert.ok(bStarting);
  assert.equal("startedAt" in bStarting, false);
  assert.equal(typeof bRecording?.startedAt, "string");

  const contextB = runtime.context.currentRecordingContext as Record<
    string,
    unknown
  >;
  const recorderB = contextB.recorder;
  const expectedBState = {
    state: runtime.context.recordingState,
    recorder: runtime.context.recorder,
    context: runtime.context.currentRecordingContext,
    recordingUrl: runtime.context.recordingUrl,
    recordingId: runtime.context.recordingId,
    objectKey: runtime.context.objectKey,
  };
  assert.equal(expectedBState.state, "recording");
  const sentBBeforeLateA = [...sentB];

  httpBodies.length = 0;
  listenerSets[0]?.Started?.({
    id: "provider-a",
    url: "https://storage.yandexcloud.net/negotiation-room/audio/a.flac",
  });
  await sleep(0);
  const lateStarted = httpBodies.find((body) => body.status === "recording");
  assert.equal(lateStarted, undefined);
  assert.equal(contextA.recordingId, "provider-a");
  assert.equal(
    contextA.recordingUrl,
    "https://storage.yandexcloud.net/negotiation-room/audio/a.flac",
  );
  assert.equal(stopCalls[0], 2);

  listenerSets[0]?.Started?.({
    id: "provider-a",
    url: "https://storage.yandexcloud.net/negotiation-room/audio/a.flac",
  });
  await sleep(0);
  assert.equal(stopCalls[0], 2, "cleanup retries must remain bounded");
  assert.equal(
    httpBodies.some((body) => body.status === "recording"),
    false,
  );

  httpBodies.length = 0;
  listenerSets[0]?.Stopped?.({
    id: "provider-a",
    url: "https://storage.yandexcloud.net/negotiation-room/audio/a.flac",
  });
  await sleep(0);
  const lateStopped = httpBodies.find((body) => body.status === "stopped");
  assert.equal(lateStopped?.recordingAttemptId, "attempt-a");
  assert.equal(lateStopped?.recordingId, "provider-a");

  httpBodies.length = 0;
  listenerSets[0]?.Error?.({
    code: "LATE_A_ERROR",
    message: "late recorder A error",
  });
  await sleep(0);
  const lateError = httpBodies.find((body) => body.status === "error");
  assert.equal(lateError?.recordingAttemptId, "attempt-a");
  assert.equal(lateError?.errorCode, "LATE_A_ERROR");

  assert.equal(runtime.context.recordingState, expectedBState.state);
  assert.equal(runtime.context.recorder, recorderB);
  assert.equal(runtime.context.recorder, expectedBState.recorder);
  assert.equal(runtime.context.currentRecordingContext, contextB);
  assert.equal(
    runtime.context.currentRecordingContext,
    expectedBState.context,
  );
  assert.equal(runtime.context.recordingUrl, expectedBState.recordingUrl);
  assert.equal(runtime.context.recordingId, expectedBState.recordingId);
  assert.equal(runtime.context.objectKey, expectedBState.objectKey);
  assert.equal(contextB.recordingAttemptId, "attempt-b");
  assert.equal(contextB.state, "recording");
  assert.deepEqual(sentB, sentBBeforeLateA);
  const lateAttemptAStatuses = readStatusMessages(sentA);
  assert.equal(
    lateAttemptAStatuses.some((status) => status.status === "recording"),
    false,
  );
  assert.equal(
    lateAttemptAStatuses.some(
      (status) =>
        status.status === "stopped" &&
        status.recordingAttemptId === "attempt-a",
    ),
    true,
  );
  assert.equal(
    lateAttemptAStatuses.some(
      (status) =>
        status.status === "error" &&
        status.recordingAttemptId === "attempt-a",
    ),
    true,
  );
  assert.equal(sentA.length > 0, true);
  assert.equal(sentB.length > 0, true);
});

test("late Started after timeout without B stays non-authoritative until stopped recovery", async () => {
  const listeners: Record<string, RuntimeEventListener> = {};
  const httpBodies: Array<Record<string, unknown>> = [];
  let stopCalls = 0;
  const runtime = loadScenarioRuntime({
    createRecorder: () => ({
      addEventListener: (
        eventName: string,
        handler: RuntimeEventListener,
      ) => {
        listeners[eventName] = handler;
      },
      stop: () => {
        stopCalls += 1;
      },
      mute: () => {},
    }),
  });
  runtime.context.conference = { sendMediaTo: () => {} };
  runtime.context.WEBHOOK_SECRET =
    "webhook-no-b-cleanup-secret-0123456789";
  runtime.context.RECORDING_CONTROL_BINDING = {
    sessionId: "session-no-b-cleanup",
    conferenceName: "negotiation-session-no-b-cleanup",
    webhookBaseUrl: "https://local.negotaitions.ru",
    providerSessionId: "provider-session-1",
  };
  (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync = (
    _url: string,
    options: { postData?: string },
  ) => {
    if (options.postData) {
      httpBodies.push(JSON.parse(options.postData) as Record<string, unknown>);
    }
    return Promise.resolve({ code: 200, text: JSON.stringify({ ok: true }) });
  };
  runtime.context.STARTING_TIMEOUT_MS = 5;
  runtime.context.currentRecordingContext = {
    protocolVersion: runtime.context.RECORDING_CONTROL_FENCED_PROTOCOL_VERSION,
    recordingAttemptId: "attempt-a-no-b",
    sessionId: "session-no-b-cleanup",
    conferenceName: "negotiation-session-no-b-cleanup",
    webhookBaseUrl: "https://local.negotaitions.ru",
    participantId: "participant-a",
    startRequestId: "start-a-no-b",
    stopRequestId: null,
  };
  const sent: string[] = [];
  const startRecording = runtime.context.startRecording as (
    call: Record<string, unknown>,
    requestId: string,
  ) => void;
  startRecording(
    { sendMessage: (message: string) => sent.push(message) },
    "start-a-no-b",
  );
  const contextA = runtime.context.currentRecordingContext as Record<
    string,
    unknown
  >;
  await sleep(20);

  assert.equal(runtime.context.recordingState, "error");
  assert.equal(runtime.context.recorder, null);
  assert.equal(stopCalls, 1);
  httpBodies.length = 0;

  listeners.Started?.({
    id: "provider-a-no-b",
    url: "https://storage.yandexcloud.net/negotiation-room/audio/a-no-b.flac",
  });
  await sleep(0);
  assert.equal(runtime.context.recordingState, "error");
  assert.equal(runtime.context.currentRecordingContext, contextA);
  assert.equal(contextA.state, "error");
  assert.equal(contextA.recordingId, "provider-a-no-b");
  assert.equal(stopCalls, 2);
  assert.equal(
    httpBodies.some((body) => body.status === "recording"),
    false,
  );
  assert.equal(
    readStatusMessages(sent).some((status) => status.status === "recording"),
    false,
  );

  listeners.Started?.({
    id: "provider-a-no-b",
    url: "https://storage.yandexcloud.net/negotiation-room/audio/a-no-b.flac",
  });
  assert.equal(stopCalls, 2);

  httpBodies.length = 0;
  listeners.Stopped?.({
    id: "provider-a-no-b",
    url: "https://storage.yandexcloud.net/negotiation-room/audio/a-no-b.flac",
  });
  await sleep(0);
  const stopped = httpBodies.find((body) => body.status === "stopped");
  assert.equal(stopped?.recordingAttemptId, "attempt-a-no-b");
  assert.equal(stopped?.recordingId, "provider-a-no-b");
  assert.equal(runtime.context.recordingState, "stopped");
  assert.equal(runtime.context.currentRecordingContext, null);
});

test("obsolete fenced PAUSE, RESUME, STATUS, and START during RESUMING leave B unchanged", () => {
  const runtime = loadScenarioRuntime();
  const secret = "recording-control-fencing-secret-0123456789";
  const sessionId = "session-command-fencing";
  let muteCalls = 0;
  let createRecorderCalls = 0;
  const recorderB = {
    mute: () => {
      muteCalls += 1;
    },
    stop: () => {},
  };
  const contextB = {
    recorder: recorderB,
    protocolVersion: runtime.context.RECORDING_CONTROL_FENCED_PROTOCOL_VERSION,
    recordingAttemptId: "attempt-b",
    sessionId,
    conferenceName: `negotiation-${sessionId}`,
    webhookBaseUrl: "https://local.negotaitions.ru",
    participantId: "participant-b",
    startRequestId: "start-b",
    stopRequestId: null,
    controllerCall: null,
    state: "recording",
  };
  runtime.context.RECORDING_CONTROL_SECRET = secret;
  runtime.context.RECORDING_CONTROL_BINDING = {
    sessionId,
    conferenceName: `negotiation-${sessionId}`,
    webhookBaseUrl: "https://local.negotaitions.ru",
    providerSessionId: "provider-session-1",
  };
  runtime.context.currentRecordingContext = contextB;
  runtime.context.recorder = recorderB;
  runtime.context.recordingState = "recording";
  (runtime.context.VoxEngine as Record<string, unknown>).createRecorder = () => {
    createRecorderCalls += 1;
    return {};
  };

  const sent: string[] = [];
  const call = { sendMessage: (message: string) => sent.push(message) };
  const onMessage = runtime.context.onRecordingControlMessage as (
    callValue: Record<string, unknown>,
    rawPayload: string,
  ) => void;
  const send = (
    action: "start" | "pause" | "resume" | "status",
    suffix: string,
  ) => {
    onMessage(
      call,
      buildSignedRecordingControlMessage(runtime, secret, {
        action,
        requestId: `${action}-${suffix}`,
        nonce: `nonce-${action}-${suffix}`,
        sessionId,
        recordingAttemptId: "attempt-a",
      }),
    );
  };

  send("pause", "late-a");
  assert.equal(muteCalls, 0);
  assert.equal(runtime.context.recordingState, "recording");
  assert.equal(runtime.context.currentRecordingContext, contextB);

  runtime.context.recordingState = "paused";
  contextB.state = "paused";
  send("resume", "late-a");
  assert.equal(muteCalls, 0);
  assert.equal(runtime.context.recordingState, "paused");
  assert.equal(runtime.context.currentRecordingContext, contextB);

  runtime.context.recordingState = "recording";
  contextB.state = "recording";
  send("status", "late-a");
  const statusRejection = readStatusMessages(sent).at(-1);
  assert.equal(statusRejection?.errorCode, "RECORDING_ATTEMPT_UNKNOWN");
  assert.equal(statusRejection?.recordingAttemptId, "attempt-a");
  assert.equal(statusRejection?.recordingUrl, null);

  runtime.context.recordingState = "resuming";
  contextB.state = "resuming";
  send("start", "while-resuming");
  assert.equal(createRecorderCalls, 0);
  assert.equal(runtime.context.recordingState, "resuming");
  assert.equal(runtime.context.currentRecordingContext, contextB);
  assert.equal(
    readStatusMessages(sent).at(-1)?.errorCode,
    "RECORDING_ATTEMPT_MISMATCH",
  );
});

test("RC4 terminal cache returns immutable attempt A after B becomes current", () => {
  const runtime = loadScenarioRuntime();
  const sent: string[] = [];
  const terminalA = {
    recordingAttemptId: "attempt-a",
    protocolVersion: "rc3-hmac-sha256-recording-attempt-v1",
    sessionId: "session-terminal-cache",
    conferenceName: "negotiation-session-terminal-cache",
    state: "stopped",
    recordingUrl: "https://provider.example/a.mp4",
    recordingId: "provider-a",
    objectKey: "negotiation-room/audio/a.mp4",
    startedAt: "2026-08-12T10:00:00.000Z",
    stoppedAt: "2026-08-12T10:05:00.000Z",
    errorCode: null,
    errorMessage: null,
    terminalConfirmed: true,
  };
  const cacheTerminal = runtime.context.cacheTerminalRecorderContext as (
    context: Record<string, unknown>,
  ) => void;
  cacheTerminal(terminalA);
  terminalA.state = "error";
  terminalA.objectKey = "mutated-after-cache";

  runtime.context.currentRecordingContext = {
    recordingAttemptId: "attempt-b",
    protocolVersion: "rc3-hmac-sha256-recording-attempt-v1",
    sessionId: "session-terminal-cache",
    conferenceName: "negotiation-session-terminal-cache",
    state: "recording",
  };
  const sendCurrentStatus = runtime.context.sendCurrentStatus as (
    call: { sendMessage: (message: string) => void },
    requestId: string,
    recordingAttemptId: string,
  ) => boolean;
  const found = sendCurrentStatus(
    { sendMessage: (message) => sent.push(message) },
    "status-attempt-a",
    "attempt-a",
  );
  assert.equal(found, true);
  const statusA = readStatusMessages(sent).at(-1);
  assert.equal(statusA?.recordingAttemptId, "attempt-a");
  assert.equal(statusA?.status, "stopped");
  assert.equal(statusA?.objectKey, "negotiation-room/audio/a.mp4");

  const unknown = sendCurrentStatus(
    { sendMessage: (message) => sent.push(message) },
    "status-unknown",
    "unknown-attempt",
  );
  assert.equal(unknown, false);
  assert.equal(
    readStatusMessages(sent).at(-1)?.errorCode,
    "RECORDING_ATTEMPT_UNKNOWN",
  );
  assert.equal(
    (runtime.context.currentRecordingContext as { recordingAttemptId: string })
      .recordingAttemptId,
    "attempt-b",
  );
});

test("fenced server-stop without current attempt context returns repeatable 409", () => {
  const runtime = loadScenarioRuntime();
  const secret = "server-stop-control-fencing-secret-0123456789";
  const sessionId = "session-server-stop-fencing";
  let recorderStopCalls = 0;
  runtime.context.SERVER_STOP_CONTROL_SECRET = secret;
  runtime.context.providerSessionId = "provider-session-1";
  runtime.context.RECORDING_CONTROL_BINDING = {
    sessionId,
    conferenceName: `negotiation-${sessionId}`,
    webhookBaseUrl: "https://local.negotaitions.ru",
    providerSessionId: "provider-session-1",
  };
  runtime.context.currentRecordingContext = null;
  runtime.context.recordingState = "recording";
  runtime.context.recorder = {
    stop: () => {
      recorderStopCalls += 1;
    },
  };

  const payload = {
    action: "stop_recording",
    operationId: "operation-no-context",
    recordingAttemptId: "attempt-a",
    sessionId,
    conferenceName: `negotiation-${sessionId}`,
    providerSessionId: "provider-session-1",
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = "nonce-server-stop-no-context";
  const sha256Hex = runtime.context.sha256Hex as (value: string) => string;
  const bodyHash = sha256Hex(body);
  const buildSignature = runtime.context.buildServerStopSignature as (
    protocol: string,
    timestampValue: string,
    nonceValue: string,
    bodyHashValue: string,
    secretValue: string,
  ) => string;
  const signature = buildSignature("v1", timestamp, nonce, bodyHash, secret);
  const responses: Array<{ status: number; body: string }> = [];
  const makeEvent = () => {
    let status = 0;
    return {
      method: "POST",
      path: "/control",
      body,
      headers: {
        "x-vox-stop-protocol": "v1",
        "x-vox-stop-timestamp": timestamp,
        "x-vox-stop-nonce": nonce,
        "x-vox-stop-body-sha256": bodyHash,
        "x-vox-stop-signature": signature,
      },
      response: {
        writeHead: (nextStatus: number) => {
          status = nextStatus;
        },
        end: (responseBody: string) => {
          responses.push({ status, body: responseBody });
        },
      },
    };
  };
  const handleServerStop = runtime.context.handleServerStopHttpRequest as (
    event: Record<string, unknown>,
  ) => unknown;

  handleServerStop(makeEvent());
  handleServerStop(makeEvent());
  assert.deepEqual(
    responses.map((response) => response.status),
    [409, 409],
  );
  assert.equal(
    responses.every((response) =>
      response.body.includes("recording_attempt_context_missing"),
    ),
    true,
  );
  assert.equal(recorderStopCalls, 0);
  assert.equal(runtime.context.currentRecordingContext, null);
  assert.equal(runtime.context.recordingState, "recording");
});

test("resolved Vox transient result codes retry while unknown negative code does not", async () => {
  for (const transientCode of [-4, -6, -7, -8]) {
    const runtime = loadScenarioRuntime();
    runtime.context.WEBHOOK_SECRET =
      "webhook-negative-code-secret-0123456789";
    runtime.context.RECORDING_CONTROL_BINDING = {
      sessionId: "session-negative-code",
      conferenceName: "negotiation-session-negative-code",
      webhookBaseUrl: "https://local.negotaitions.ru",
      providerSessionId: "provider-session-1",
    };
    runtime.context.setTimeout = (handler: () => void) => {
      handler();
      return 1;
    };
    let calls = 0;
    (runtime.context.Net as { httpRequestAsync: unknown }).httpRequestAsync =
      () => {
        calls += 1;
        return Promise.resolve({
          code: calls === 1 ? transientCode : 200,
          text: "",
        });
      };
    const sendWebhook = runtime.context.sendRecordingWebhook as (
      sessionId: string,
      payload: Record<string, unknown>,
      extra: null,
      origin: string,
      conferenceName: string,
    ) => void;
    sendWebhook(
      "session-negative-code",
      {
        status: "recording",
        requestId: `request-${transientCode}`,
        protocolVersion:
          runtime.context.RECORDING_CONTROL_FENCED_PROTOCOL_VERSION,
        recordingAttemptId: `attempt-${transientCode}`,
      },
      null,
      "https://local.negotaitions.ru",
      "negotiation-session-negative-code",
    );
    await sleep(0);
    await sleep(0);
    assert.equal(calls, 2, `code ${transientCode} should retry`);
  }

  const deterministicRuntime = loadScenarioRuntime();
  deterministicRuntime.context.WEBHOOK_SECRET =
    "webhook-deterministic-code-secret-0123456789";
  deterministicRuntime.context.RECORDING_CONTROL_BINDING = {
    sessionId: "session-negative-code",
    conferenceName: "negotiation-session-negative-code",
    webhookBaseUrl: "https://local.negotaitions.ru",
    providerSessionId: "provider-session-1",
  };
  let deterministicCalls = 0;
  (
    deterministicRuntime.context.Net as { httpRequestAsync: unknown }
  ).httpRequestAsync = () => {
    deterministicCalls += 1;
    return Promise.resolve({ code: -2, text: "deterministic input error" });
  };
  (
    deterministicRuntime.context.sendRecordingWebhook as (
      sessionId: string,
      payload: Record<string, unknown>,
      extra: null,
      origin: string,
      conferenceName: string,
    ) => void
  )(
    "session-negative-code",
    {
      status: "recording",
      requestId: "request-deterministic",
      protocolVersion:
        deterministicRuntime.context
          .RECORDING_CONTROL_FENCED_PROTOCOL_VERSION,
      recordingAttemptId: "attempt-deterministic",
    },
    null,
    "https://local.negotaitions.ru",
    "negotiation-session-negative-code",
  );
  await sleep(0);
  assert.equal(deterministicCalls, 1);
});
