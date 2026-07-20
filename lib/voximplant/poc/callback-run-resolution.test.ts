import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { processPocCallback } from "@/lib/voximplant/poc/callback-handler";
import {
  buildPocCallbackPayload,
  buildSignedCallbackRequest,
} from "@/lib/voximplant/poc/callback-signature";
import { readPrivateControlState } from "@/lib/voximplant/poc/private-control-state";
import {
  createEmptyPocState,
  readPocRunState,
  seedWaitingForProviderSession,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";
import {
  activatePocRun,
  getPocLegacyStatePath,
  getPocRunPaths,
} from "@/lib/voximplant/poc/poc-run-store";
import {
  POC_EXPECTED_SCENARIO_BUILD,
  POC_SCENARIO_SOURCE_NAME,
} from "@/lib/voximplant/poc/poc-safety";

const callbackSecret = "poc-callback-secret-16chars!!";
const controlSecret = "poc-control-secret-must-differ!";

function envForCallback(): NodeJS.ProcessEnv {
  return {
    VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED: "true",
    VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET: callbackSecret,
    VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET: controlSecret,
  };
}

function seedRun(
  root: string,
  runId: string,
  conferenceName: string,
): void {
  let state = createEmptyPocState({
    pocId: runId,
    conferenceName,
    linkedSessionId: `session-${runId}`,
  });
  state = seedWaitingForProviderSession(state);
  writePocState(state, root);
}

function signedCallback(params: {
  eventType?: "session_registered" | "command_accepted" | "recording_started" | "recording_stopped";
  action?: string | null;
  operationId: string;
  conferenceName: string;
  providerSessionId?: string;
}): ReturnType<typeof buildSignedCallbackRequest> {
  const eventType = params.eventType ?? "command_accepted";
  if (eventType === "session_registered") {
    const providerSessionId = params.providerSessionId ?? "hist-1";
    return buildSignedCallbackRequest({
      payload: buildPocCallbackPayload({
        eventType: "session_registered",
        action: "register",
        operationId: params.operationId,
        conferenceName: params.conferenceName,
        callSessionHistoryId: providerSessionId,
        providerSessionId,
        scenarioBuild: POC_EXPECTED_SCENARIO_BUILD,
        scenarioSource: POC_SCENARIO_SOURCE_NAME,
        routingRuleIdentity: "neg-poc-server-stop-rule",
        mediaSessionAccessSecureUrl: "https://example.invalid/session/ctrl",
        mediaSessionAccessUrl: "https://example.invalid/session/ctrl",
      }),
      secret: callbackSecret,
    });
  }
  return buildSignedCallbackRequest({
    payload: buildPocCallbackPayload({
      eventType,
      action: params.action ?? "ping",
      operationId: params.operationId,
      conferenceName: params.conferenceName,
      callSessionHistoryId: params.providerSessionId ?? null,
      providerSessionId: params.providerSessionId ?? null,
      recorderState:
        eventType === "recording_started"
          ? "recording_started"
          : eventType === "recording_stopped"
            ? "stop_completed"
            : "absent",
    }),
    secret: callbackSecret,
  });
}

test("callback resolves active run by exact conferenceName", () => {
  const root = mkdtempSync(join(tmpdir(), "poc-cb-resolve-"));
  seedRun(root, "run-target", "neg-poc-server-stop-run-target");
  activatePocRun({
    runId: "run-target",
    linkedSessionId: "session-run-target",
    stateRoot: root,
  });
  const signed = signedCallback({
    operationId: "op-active-match",
    conferenceName: "neg-poc-server-stop-run-target",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd: root,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.stateScope, "RUN_SCOPED");
    assert.equal(result.runId, "run-target");
  }
});

test("stale active pointer falls back to exact retained run lookup", () => {
  const root = mkdtempSync(join(tmpdir(), "poc-cb-fallback-"));
  seedRun(root, "run-stale", "neg-poc-server-stop-run-stale");
  seedRun(root, "run-expected", "neg-poc-server-stop-run-expected");
  activatePocRun({
    runId: "run-stale",
    linkedSessionId: "session-run-stale",
    stateRoot: root,
  });
  const signed = signedCallback({
    operationId: "op-fallback",
    conferenceName: "neg-poc-server-stop-run-expected",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd: root,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.runId, "run-expected");
    const state = readPocRunState("run-expected", root);
    assert.ok(
      state?.callbackEvents.some((event) => event.operationId === "op-fallback"),
    );
  }
});

test("missing run returns POC_CALLBACK_RUN_NOT_FOUND", () => {
  const root = mkdtempSync(join(tmpdir(), "poc-cb-not-found-"));
  seedRun(root, "run-a", "neg-poc-server-stop-run-a");
  const signed = signedCallback({
    operationId: "op-missing",
    conferenceName: "neg-poc-server-stop-run-missing",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd: root,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "POC_CALLBACK_RUN_NOT_FOUND");
});

test("ambiguous matching runs are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "poc-cb-ambiguous-"));
  seedRun(root, "run-other", "neg-poc-server-stop-run-other");
  seedRun(root, "run-dup-1", "neg-poc-server-stop-run-dup");
  seedRun(root, "run-dup-2", "neg-poc-server-stop-run-dup");
  activatePocRun({
    runId: "run-other",
    linkedSessionId: "session-run-other",
    stateRoot: root,
  });
  const signed = signedCallback({
    operationId: "op-ambiguous",
    conferenceName: "neg-poc-server-stop-run-dup",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd: root,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "POC_CALLBACK_RUN_AMBIGUOUS");
});

test("legacy global state is refused for browser-first callback", () => {
  const root = mkdtempSync(join(tmpdir(), "poc-cb-legacy-"));
  const legacyPath = getPocLegacyStatePath(root);
  mkdirSync(dirname(legacyPath), { recursive: true });
  writeFileSync(
    legacyPath,
    JSON.stringify({
      pocId: "legacy",
      conferenceName: "neg-poc-server-stop-legacy",
      callbackEvents: [],
      seenCallbackNonces: [],
    }),
    "utf8",
  );
  const signed = signedCallback({
    operationId: "op-legacy-refused",
    conferenceName: "neg-poc-server-stop-legacy",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd: root,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "POC_CALLBACK_LEGACY_STATE_REFUSED");
  const legacyRaw = readFileSync(legacyPath, "utf8");
  assert.ok(!legacyRaw.includes("op-legacy-refused"));
});

test("session_registered writes private state, run state, and run events", () => {
  const root = mkdtempSync(join(tmpdir(), "poc-cb-session-reg-"));
  seedRun(root, "run-register", "neg-poc-server-stop-run-register");
  const signed = signedCallback({
    eventType: "session_registered",
    operationId: "session-register-hist-1",
    conferenceName: "neg-poc-server-stop-run-register",
    providerSessionId: "hist-1",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd: root,
  });
  assert.equal(result.ok, true);

  const privateState = readPrivateControlState("run-register", root);
  assert.ok(privateState);
  assert.ok(privateState?.mediaSessionAccessSecureUrl?.includes("example.invalid"));

  const runState = readPocRunState("run-register", root);
  assert.equal(runState?.runtimeStatus, "ACTIVE");
  assert.equal(runState?.providerSessionId, "hist-1");

  const eventsPath = getPocRunPaths("run-register", root).eventsPath;
  const eventsRaw = JSON.parse(readFileSync(eventsPath, "utf8")) as {
    callbackEvents?: Array<{ operationId?: string | null }>;
  };
  const opFound = Array.isArray(eventsRaw.callbackEvents)
    ? eventsRaw.callbackEvents.some(
        (event) => event.operationId === "session-register-hist-1",
      )
    : false;
  assert.equal(opFound, true);
});

test("write failure returns non-2xx and persisted=false never reports success", () => {
  const root = mkdtempSync(join(tmpdir(), "poc-cb-write-fail-"));
  seedRun(root, "run-write-fail", "neg-poc-server-stop-run-write-fail");
  const eventsPath = getPocRunPaths("run-write-fail", root).eventsPath;
  if (existsSync(eventsPath)) unlinkSync(eventsPath);
  mkdirSync(eventsPath, { recursive: true });

  const signed = signedCallback({
    operationId: "op-events-write-fail",
    conferenceName: "neg-poc-server-stop-run-write-fail",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd: root,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 500);
    assert.equal(result.errorCode, "POC_CALLBACK_EVENTS_WRITE_FAILED");
    assert.notEqual(result.status, 200);
    assert.equal(result.persisted, false);
    assert.equal(result.accepted, false);
  }
  rmSync(eventsPath, { recursive: true, force: true });
});

test("recording_started, command_accepted, recording_stopped resolve the same run", () => {
  const root = mkdtempSync(join(tmpdir(), "poc-cb-multi-event-"));
  seedRun(root, "run-same", "neg-poc-server-stop-run-same");
  seedRun(root, "run-other", "neg-poc-server-stop-run-other");
  activatePocRun({
    runId: "run-other",
    linkedSessionId: "session-run-other",
    stateRoot: root,
  });

  const events: Array<{
    eventType: "recording_started" | "command_accepted" | "recording_stopped";
    action: string;
    operationId: string;
  }> = [
    {
      eventType: "recording_started",
      action: "start",
      operationId: "op-recording-started",
    },
    {
      eventType: "command_accepted",
      action: "stop_recording",
      operationId: "op-command-accepted",
    },
    {
      eventType: "recording_stopped",
      action: "stop_recording",
      operationId: "op-recording-stopped",
    },
  ];

  for (const item of events) {
    const signed = signedCallback({
      eventType: item.eventType,
      action: item.action,
      operationId: item.operationId,
      conferenceName: "neg-poc-server-stop-run-same",
      providerSessionId: "hist-same",
    });
    const result = processPocCallback({
      rawBody: signed.body,
      headers: signed.headers,
      env: envForCallback(),
      cwd: root,
    });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.runId, "run-same");
  }
});
