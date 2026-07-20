/**
 * Provider-free tests for browser-first full mode + session_registered.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildPocCallbackPayload,
  buildSignedCallbackRequest,
} from "@/lib/voximplant/poc/callback-signature";
import { processPocCallback } from "@/lib/voximplant/poc/callback-handler";
import {
  planPocConferenceJoin,
  resolveVoximplantConferenceNameForAccess,
} from "@/lib/voximplant/poc/conference-join-flag";
import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import {
  createEmptyPocState,
  getActiveControlUrl,
  readPocState,
  seedWaitingForProviderSession,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";
import {
  POC_EXPECTED_SCENARIO_BUILD,
  POC_SCENARIO_SOURCE_NAME,
} from "@/lib/voximplant/poc/poc-safety";
import {
  applySessionRegisteredToState,
  correlateProviderSessionIds,
} from "@/lib/voximplant/poc/session-registration";
import {
  evaluateFullPass,
  plannedPhasesForMode,
  type PocOrchestratorReport,
} from "@/lib/voximplant/poc/orchestrator/types";
import {
  buildDryRunPlan,
  runPocOrchestrator,
  type OrchestratorDeps,
} from "@/lib/voximplant/poc/orchestrator/run-orchestrator";
import { emptyBrowserContextEvidence } from "@/lib/voximplant/poc/orchestrator/browser-stages";
import type { BrowserJoinResult } from "@/lib/voximplant/poc/orchestrator/browser-join";

const callbackSecret = "poc-callback-secret-16chars!!";
const controlSecret = "poc-control-secret-must-differ!";

function envForCallback(): NodeJS.ProcessEnv {
  return {
    VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED: "true",
    VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET: callbackSecret,
    VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET: controlSecret,
  };
}

function waitingState(cwd: string, conferenceName: string, sessionId: string) {
  let state = createEmptyPocState({
    pocId: "run-bf-1",
    conferenceName,
    linkedSessionId: sessionId,
  });
  state = seedWaitingForProviderSession(state);
  writePocState(state, cwd);
  return state;
}

function signedSessionRegistered(
  overrides: Partial<ReturnType<typeof buildPocCallbackPayload>> = {},
) {
  const payload = buildPocCallbackPayload({
    eventType: "session_registered",
    action: "register",
    operationId: "session-register-hist-1",
    conferenceName: "neg-poc-server-stop-run-bf-1",
    callSessionHistoryId: "hist-1",
    providerSessionId: "hist-1",
    scenarioBuild: POC_EXPECTED_SCENARIO_BUILD,
    scenarioSource: POC_SCENARIO_SOURCE_NAME,
    routingRuleIdentity: "neg-poc-server-stop-rule",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/ctrl-a",
    mediaSessionAccessUrl: "https://example.invalid/session/ctrl-a",
    ...overrides,
  });
  return buildSignedCallbackRequest({ payload, secret: callbackSecret });
}

test("1. full mode planned phases do not include start_conference", () => {
  const phases = plannedPhasesForMode("full");
  assert.ok(!phases.includes("start_conference"));
  assert.ok(phases.includes("seed_waiting_run"));
  assert.ok(phases.includes("provider_session_registration"));
  assert.ok(phases.includes("browser_join_release"));
});

test("2. run starts WAITING_FOR_PROVIDER_SESSION", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-wait-"));
  const state = waitingState(
    cwd,
    "neg-poc-server-stop-run-bf-1",
    "sess-bf-1",
  );
  assert.equal(state.runtimeStatus, "WAITING_FOR_PROVIDER_SESSION");
  assert.equal(state.singleProviderSessionConfirmed, false);
  assert.equal(getActiveControlUrl(state, cwd), null);
});

test("3. valid session_registered activates the run", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-act-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const signed = signedSessionRegistered();
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd,
  });
  assert.equal(result.ok, true);
  const state = readPocState(cwd)!;
  assert.equal(state.runtimeStatus, "ACTIVE");
  assert.equal(state.providerSessionId, "hist-1");
  assert.equal(state.hasControlUrl, true);
  assert.equal(state.singleProviderSessionConfirmed, true);
  assert.ok(state.controlUrlFingerprint);
  assert.equal(state.mediaSessionAccessUrl, null);
  assert.equal(state.mediaSessionAccessSecureUrl, null);
  assert.ok(getActiveControlUrl(state, cwd)?.includes("example.invalid"));
});

test("4. production rule callback is rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-rule-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const signed = signedSessionRegistered({
    routingRuleIdentity: "negotaitions-conference-rule",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, "POC_BROWSER_ROUTED_TO_PRODUCTION_RULE");
  }
});

test("5. production scenario build is rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-build-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const signed = signedSessionRegistered({
    scenarioBuild: "server-poc-webhook-fix-2026-07-04",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, "POC_UNEXPECTED_SCENARIO_BUILD");
  }
});

test("6. wrong conference prefix is rejected", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-prefix-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const signed = signedSessionRegistered({
    conferenceName: "negotiation-sess-bf-1",
  });
  const result = processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd,
  });
  assert.equal(result.ok, false);
});

test("7. duplicate provider session ID is idempotent", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-idem-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const firstSigned = signedSessionRegistered();
  const first = processPocCallback({
    rawBody: firstSigned.body,
    headers: firstSigned.headers,
    env: envForCallback(),
    cwd,
  });
  assert.equal(first.ok, true);
  const secondSigned = signedSessionRegistered({
    nonce: "second-nonce-aaaaaaaaaaaaaaaa",
    operationId: "session-register-hist-1-retry",
  });
  const second = processPocCallback({
    rawBody: secondSigned.body,
    headers: secondSigned.headers,
    env: envForCallback(),
    cwd,
  });
  assert.equal(second.ok, true);
  const state = readPocState(cwd)!;
  assert.equal(state.providerSessionId, "hist-1");
  assert.equal(state.runtimeStatus, "ACTIVE");
});

test("8. second different session ID fails the run", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-dup-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const firstSigned = signedSessionRegistered();
  processPocCallback({
    rawBody: firstSigned.body,
    headers: firstSigned.headers,
    env: envForCallback(),
    cwd,
  });
  const second = signedSessionRegistered({
    callSessionHistoryId: "hist-2",
    providerSessionId: "hist-2",
    operationId: "session-register-hist-2",
    nonce: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  const result = processPocCallback({
    rawBody: second.body,
    headers: second.headers,
    env: envForCallback(),
    cwd,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, "POC_MULTIPLE_PROVIDER_SESSIONS_DETECTED");
  }
  assert.equal(readPocState(cwd)!.runtimeStatus, "FAILED");
});

test("9. browser joins alone are not enough without session registration", () => {
  const draft = {
    callbackSelfTest: true,
    browserFacilitatorJoined: true,
    browserParticipantJoined: true,
    sameConferenceConfirmed: false,
    singleProviderSessionConfirmed: false,
    startConferenceCallCount: 0,
    registeredProviderSessionId: null,
    recordingStarted: false,
    transportAccepted: false,
    commandAccepted: false,
    providerTerminal: false,
    stopIdempotent: false,
    browserRelayUsed: false,
    artifactAvailable: false,
  } as unknown as Omit<PocOrchestratorReport, "result">;
  assert.equal(evaluateFullPass(draft), false);
});

test("10. matching conferenceName with differing session IDs fails", () => {
  const correlation = correlateProviderSessionIds({
    registeredProviderSessionId: "4888576286",
    browserProviderSessionId: "4888562278",
    recordingProviderSessionId: "4888562278",
    stopProviderSessionId: "4888576286",
    historyProviderSessionId: null,
  });
  assert.equal(correlation.ok, false);
  assert.equal(correlation.code, "POC_PROVIDER_SESSION_ID_MISMATCH");
});

test("11. recording command targets the registered session", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-rec-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const signed = signedSessionRegistered();
  processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd,
  });
  const state = readPocState(cwd)!;
  assert.equal(state.providerSessionId, "hist-1");
  const url = getActiveControlUrl(state, cwd);
  assert.ok(url);
  assert.equal(state.providerConferenceName, "neg-poc-server-stop-run-bf-1");
});

test("12. recording_started correlation uses the registered session", () => {
  const correlation = correlateProviderSessionIds({
    registeredProviderSessionId: "hist-1",
    browserProviderSessionId: "hist-1",
    recordingProviderSessionId: "hist-1",
    stopProviderSessionId: null,
    historyProviderSessionId: null,
  });
  assert.equal(correlation.ok, true);
  assert.equal(correlation.canonicalId, "hist-1");
});

test("13. stop uses the registered session control URL", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-stop-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const signed = signedSessionRegistered();
  processPocCallback({
    rawBody: signed.body,
    headers: signed.headers,
    env: envForCallback(),
    cwd,
  });
  const state = readPocState(cwd)!;
  assert.equal(state.runtimeStatus, "ACTIVE");
  assert.ok(getActiveControlUrl(state, cwd));
});

test("14. stop with another session URL is rejected via identity check", () => {
  const correlation = correlateProviderSessionIds({
    registeredProviderSessionId: "hist-1",
    stopProviderSessionId: "hist-other",
  });
  assert.equal(correlation.ok, false);
  assert.equal(correlation.code, "POC_PROVIDER_SESSION_ID_MISMATCH");
});

test("15. transport mode still uses StartConference", () => {
  const phases = plannedPhasesForMode("transport");
  assert.ok(phases.includes("start_conference"));
  assert.ok(phases.includes("ping"));
});

test("16. full mode startConferenceCallCount remains zero (dry-run)", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-bf-dry-"));
  try {
    const plan = buildDryRunPlan({
      mode: "full",
      dryRun: true,
      confirmLivePoc: false,
      confirmLocalDbWrite: false,
      keepSession: false,
      keepBrowser: false,
      skipLogFetch: true,
      timeoutSeconds: 30,
      appBaseUrl: "http://localhost:3000",
      healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
      stateRoot,
    });
    assert.ok(!(plan.plannedPhases as string[]).includes("start_conference"));
    let startCalls = 0;
    const report = await runPocOrchestrator(
      {
        mode: "full",
        dryRun: true,
        confirmLivePoc: false,
        confirmLocalDbWrite: false,
        keepSession: false,
        keepBrowser: false,
        skipLogFetch: true,
        timeoutSeconds: 30,
        appBaseUrl: "http://localhost:3000",
        healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
        stateRoot,
      },
      {
        startConference: async () => {
          startCalls += 1;
          throw new Error("full dry-run must not StartConference");
        },
      } as OrchestratorDeps,
    );
    assert.equal(startCalls, 0);
    assert.equal(report.startConferenceCallCount, 0);
    assert.equal(report.result, "DRY_RUN_PASS");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("17. production/default flow remains unchanged when flag off", () => {
  const sessionId = "ordinary-session-xyz";
  const name = resolveVoximplantConferenceNameForAccess(sessionId, {
    VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "false",
  });
  assert.equal(name, buildVoximplantConferenceName(sessionId));
});

test("WAITING_FOR_PROVIDER_SESSION allows access conference selection", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-access-"));
  waitingState(cwd, "neg-poc-server-stop-run-bf-1", "sess-bf-1");
  const name = resolveVoximplantConferenceNameForAccess(
    "sess-bf-1",
    { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
    cwd,
  );
  assert.equal(name, "neg-poc-server-stop-run-bf-1");
  const plan = planPocConferenceJoin({
    sessionId: "sess-bf-1",
    env: { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
    stateRoot: cwd,
  });
  assert.equal(plan.selectionSource, "POC_STATE");
  assert.equal(plan.runtimeStatus, "WAITING_FOR_PROVIDER_SESSION");
});

test("applySessionRegistered refuses production scenario source", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-bf-src-"));
  const state = waitingState(
    cwd,
    "neg-poc-server-stop-run-bf-1",
    "sess-bf-1",
  );
  const applied = applySessionRegisteredToState(
    state,
    {
      conferenceName: "neg-poc-server-stop-run-bf-1",
      callSessionHistoryId: "hist-1",
      providerSessionId: "hist-1",
      scenarioBuild: POC_EXPECTED_SCENARIO_BUILD,
      scenarioSource: "neg-conf",
      routingRuleIdentity: "neg-poc-server-stop-rule",
      mediaSessionAccessSecureUrl: "https://example.invalid/session/ctrl",
      mediaSessionAccessUrl: null,
    },
    { stateRoot: cwd },
  );
  assert.equal(applied.ok, false);
  if (!applied.ok) assert.equal(applied.code, "POC_UNEXPECTED_SCENARIO");
});

test("full live mode mock does not call StartConference", async () => {
  const previousDb = process.env.DATABASE_URL;
  const previousControl = process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET =
    "control-secret-16chars!!!";
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-bf-live-"));
  let startCalls = 0;

  const makeJoinResult = (conferenceName: string): BrowserJoinResult => ({
    facilitatorJoined: true,
    participantJoined: true,
    sameConferenceConfirmed: true,
    facilitatorConferenceName: conferenceName,
    participantConferenceName: conferenceName,
    browserRelayUsed: false,
    failureCode: null,
    facilitator: {
      ...emptyBrowserContextEvidence("facilitator", "s"),
      reachedStage: "JOIN_CONFIRMED",
      joined: true,
    },
    participant: {
      ...emptyBrowserContextEvidence("participant", "s"),
      reachedStage: "JOIN_CONFIRMED",
      joined: true,
    },
    timing: {
      browserPrewarmStartedAt: null,
      browserPrewarmCompletedAt: null,
      startConferenceStartedAt: null,
      startConferenceCompletedAt: null,
      activeRunPublishedAt: null,
      facilitatorAccessRequestedAt: null,
      participantAccessRequestedAt: null,
      facilitatorCallConnectedAt: null,
      participantCallConnectedAt: null,
      startConferenceToFirstAccessMs: null,
      startConferenceToFirstJoinMs: null,
      startConferenceToBothJoinedMs: null,
    },
    evidence: {},
    close: async () => {},
  });

  try {
    const report = await runPocOrchestrator(
      {
        mode: "full",
        dryRun: false,
        confirmLivePoc: true,
        confirmLocalDbWrite: true,
        keepSession: true,
        keepBrowser: false,
        skipLogFetch: true,
        timeoutSeconds: 30,
        appBaseUrl: "http://localhost:3000",
        healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
        stateRoot,
      },
      {
        resolveConfig: () => ({
          accountId: "1",
          applicationId: "2",
          applicationName: "app",
          ruleId: "9175667",
          ruleName: "poc-rule",
          auth: { type: "api_key", apiKey: "test-key" },
        }),
        createSession: async ({ runId }) => ({
          runId,
          namespace: `ns-${runId}`,
          sessionId: `session-${runId}`,
          caseId: `case-${runId}`,
          facilitatorAuth: {
            userId: `u-${runId}`,
            email: `f@test.local`,
            password: "x",
            authCookie: "auth_session=t",
            userSessionId: `us-f-${runId}`,
            role: "FACILITATOR" as const,
          },
          participantAuth: {
            userId: `p-${runId}`,
            email: `p@test.local`,
            password: "x",
            authCookie: "auth_session=p",
            userSessionId: `us-p-${runId}`,
            role: "PARTICIPANT" as const,
          },
          facilitatorUserId: `u-${runId}`,
          facilitatorEmail: `f@test.local`,
          facilitatorPassword: "x",
          facilitatorAuthCookie: "auth_session=t",
          participantUserId: `p-${runId}`,
          participantEmail: `p@test.local`,
          participantPassword: "x",
          participantAuthCookie: "auth_session=p",
          facilitatorJoinToken: "fac",
          participantJoinToken: "part",
          facilitatorParticipantId: `spf-${runId}`,
          participantParticipantId: `spp-${runId}`,
          facilitatorRoomUrl: `http://localhost:3000/room/session-${runId}`,
          participantRoomUrl: `http://localhost:3000/room/session-${runId}`,
          participantAccountRoomUrl: `http://localhost:3000/room/session-${runId}`,
          roomUrl: `http://localhost:3000/room/session-${runId}`,
          localDatabaseTargetSanitized: "postgres://localhost:5432/negotiations",
          cleanupManifest: {
            runId,
            namespace: `ns-${runId}`,
            createdAt: new Date().toISOString(),
            databaseTargetSanitized: "postgres://localhost:5432/negotiations",
            entities: [],
          },
        }),
        startConference: async () => {
          startCalls += 1;
          throw new Error("full mode must not StartConference");
        },
        callbackSelfTest: async () => ({
          passed: true,
          code: "CALLBACK_SELF_TEST_PASSED",
          details: {},
        }),
        browserPrewarm: async (params) => ({
          ok: true,
          failureCode: null,
          browserPrewarmStartedAt: new Date().toISOString(),
          browserPrewarmCompletedAt: new Date().toISOString(),
          facilitator: emptyBrowserContextEvidence("facilitator", params.sessionId),
          participant: emptyBrowserContextEvidence("participant", params.sessionId),
          evidence: {},
          liveJoin: async (live) => {
            const current = readPocState(params.stateRoot)!;
            const applied = applySessionRegisteredToState(
              current,
              {
                conferenceName: live.expectedConferenceName,
                callSessionHistoryId: "hist-browser-1",
                providerSessionId: "hist-browser-1",
                scenarioBuild: POC_EXPECTED_SCENARIO_BUILD,
                scenarioSource: POC_SCENARIO_SOURCE_NAME,
                routingRuleIdentity: "neg-poc-server-stop-rule",
                mediaSessionAccessSecureUrl:
                  "https://example.invalid/session/ctrl",
                mediaSessionAccessUrl: "https://example.invalid/session/ctrl",
              },
              { stateRoot: params.stateRoot },
            );
            writePocState(applied.ok ? applied.state : current, params.stateRoot);
            return makeJoinResult(live.expectedConferenceName);
          },
          close: async () => {},
        }),
        fetchImpl: (async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("recording-control")) {
            return new Response(
              JSON.stringify({ ok: false, error: "stop-before-provider" }),
              { status: 500 },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as typeof fetch,
        sleep: async () => {},
      },
    );

    assert.equal(startCalls, 0);
    assert.equal(report.startConferenceCallCount, 0);
    assert.equal(report.registeredProviderSessionId, "hist-browser-1");
    assert.equal(report.failureStage, "recording_start");
    assert.equal(report.result, "FAIL");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
    if (previousControl === undefined) {
      delete process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET;
    } else {
      process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET = previousControl;
    }
  }
});
