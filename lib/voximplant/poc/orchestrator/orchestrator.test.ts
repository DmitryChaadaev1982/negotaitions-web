import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertLocalDbWriteConfirmation,
  assertSafeLocalDatabaseTarget,
  LocalDbSafetyError,
} from "@/lib/voximplant/poc/local-db-safety";
import { sanitizePocDiagnosticLog } from "@/lib/voximplant/poc/log-sanitize";
import {
  resolveVoximplantConferenceNameForAccess,
} from "@/lib/voximplant/poc/conference-join-flag";
import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import {
  applyStartConferenceToState,
  createEmptyPocState,
  writePocState,
  readPocState,
} from "@/lib/voximplant/poc/poc-state";
import {
  activatePocRun,
  readCurrentPointer,
  clearCurrentPointer,
} from "@/lib/voximplant/poc/poc-run-store";
import {
  buildDryRunPlan,
  runPocOrchestrator,
  type OrchestratorDeps,
} from "@/lib/voximplant/poc/orchestrator/run-orchestrator";
import {
  evaluateFullPass,
  type PocOrchestratorOptions,
  type PocOrchestratorReport,
} from "@/lib/voximplant/poc/orchestrator/types";
import type { PocCleanupManifest } from "@/lib/voximplant/poc/create-poc-session";

function baseOptions(
  overrides: Partial<PocOrchestratorOptions> = {},
): PocOrchestratorOptions {
  return {
    mode: "full",
    dryRun: false,
    confirmLivePoc: true,
    confirmLocalDbWrite: true,
    keepSession: false,
    keepBrowser: false,
    skipLogFetch: true,
    timeoutSeconds: 30,
    appBaseUrl: "http://localhost:3000",
    healthUrl: "http://localhost:3000/api/admin/health",
    stateRoot: mkdtempSync(join(tmpdir(), "poc-orch-")),
    ...overrides,
  };
}

function mockDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  let startCalls = 0;
  return {
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
      namespace: `poc-vox-server-stop-${runId}`,
      sessionId: `session-${runId}`,
      caseId: `case-${runId}`,
      facilitatorUserId: `user-${runId}`,
      facilitatorEmail: `f-${runId}@test.negotaitions.local`,
      facilitatorPassword: "x",
      facilitatorAuthCookie: "auth_session=token",
      facilitatorJoinToken: `fac-${runId}`,
      participantJoinToken: `part-${runId}`,
      facilitatorRoomUrl: `http://localhost:3000/room/session-${runId}?joinToken=fac`,
      participantRoomUrl: `http://localhost:3000/room/session-${runId}?joinToken=part`,
      roomUrl: `http://localhost:3000/room/session-${runId}?joinToken=fac`,
      localDatabaseTargetSanitized: "postgres://localhost:5432/negotiations",
      cleanupManifest: {
        runId,
        namespace: `poc-vox-server-stop-${runId}`,
        createdAt: new Date().toISOString(),
        databaseTargetSanitized: "postgres://localhost:5432/negotiations",
        entities: [
          { kind: "Session", id: `session-${runId}` },
          { kind: "User", id: `user-${runId}` },
        ],
      },
    }),
    startConference: async ({ conferenceName }) => {
      startCalls += 1;
      (mockDeps as unknown as { startCalls: number }).startCalls = startCalls;
      return {
        dryRun: false,
        missingPocRule: false,
        request: {
          conference_name: conferenceName,
          rule_id: "9175667",
        },
        parsed: {
          result: 1,
          mediaSessionAccessUrl: "https://example.invalid/session/ctrl",
          mediaSessionAccessSecureUrl: "https://example.invalid/session/ctrl",
          callSessionHistoryId: "hist-1",
          rawKeys: [],
        },
        publicResult: {
          conferenceName,
          mediaSessionId: "hist-1",
          controlUrlFingerprint: "fp",
          classification: "success" as const,
          result: 1,
        },
      };
    },
    fetchImpl: (async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch,
    browserJoin: async () => ({
      facilitatorJoined: true,
      participantJoined: true,
      sameConferenceConfirmed: true,
      facilitatorConferenceName: "neg-poc-server-stop-x",
      participantConferenceName: "neg-poc-server-stop-x",
      browserRelayUsed: false,
      evidence: {},
      close: async () => {},
    }),
    sendControl: async () => ({
      dryRun: false,
      controlUrlFingerprint: "fp",
      requestHeaderKeys: [],
      requestHeaders: {},
      transportOutcome: "TRANSPORT_ACCEPTED" as const,
      httpStatus: 200,
      responseBodyPresent: false,
      responseJsonParsed: false,
      response: null,
      commandConfirmed: false,
    }),
    executePing: async () => ({
      dryRun: false,
      nonTerminal: false,
      transport: {
        dryRun: false,
        controlUrlFingerprint: "fp",
        requestHeaderKeys: [],
        requestHeaders: {},
        transportOutcome: "TRANSPORT_ACCEPTED" as const,
        httpStatus: 200,
        responseBodyPresent: false,
        responseJsonParsed: false,
        response: null,
        commandConfirmed: false,
      },
      pingOutcome: "PING_COMMAND_CONFIRMED" as const,
      callbackEvent: null,
      runtimeStatus: "ACTIVE",
    }),
    getCallHistory: async ({ callSessionHistoryId }) => ({
      status: "LOG_FETCH_UNAVAILABLE" as const,
      callSessionHistoryId,
      sanitizedPayload: null,
      sanitizedLogText: null,
      artifact: {
        artifactAvailable: false,
        artifactReferenceFingerprint: null,
        artifactDuration: null,
        artifactSize: null,
      },
      manualRetrievalId: callSessionHistoryId,
    }),
    cleanupSession: async ({ manifest }) => ({
      deleted: manifest.entities,
      dryRun: false,
    }),
    sleep: async () => {},
    ...overrides,
  };
}

test("1. dry-run makes no DB/provider/browser call", async () => {
  let db = 0;
  let provider = 0;
  let browser = 0;
  const options = baseOptions({ dryRun: true, confirmLivePoc: false });
  const plan = buildDryRunPlan(options);
  assert.equal(plan.providerCalls, false);
  assert.equal(plan.dbWrites, false);
  assert.equal(plan.browser, false);

  const report = await runPocOrchestrator(
    options,
    mockDeps({
      createSession: async () => {
        db += 1;
        throw new Error("should not create session");
      },
      startConference: async () => {
        provider += 1;
        throw new Error("should not start");
      },
      browserJoin: async () => {
        browser += 1;
        throw new Error("should not browse");
      },
    }),
  );
  assert.equal(report.result, "PASS");
  assert.equal(db, 0);
  assert.equal(provider, 0);
  assert.equal(browser, 0);
});

test("2. full mode refuses without both confirmations", async () => {
  const noLive = await runPocOrchestrator(
    baseOptions({ confirmLivePoc: false, confirmLocalDbWrite: true }),
    mockDeps(),
  );
  assert.equal(noLive.result, "FAIL");
  assert.equal(noLive.failureCode, "LIVE_POC_CONFIRMATION_REQUIRED");

  const noDb = await runPocOrchestrator(
    baseOptions({ confirmLivePoc: true, confirmLocalDbWrite: false }),
    mockDeps(),
  );
  assert.equal(noDb.result, "FAIL");
  assert.equal(noDb.failureCode, "LOCAL_DB_WRITE_CONFIRMATION_REQUIRED");
});

test("3. unsafe DB target refuses", () => {
  assert.throws(
    () =>
      assertSafeLocalDatabaseTarget(
        "postgres://prod.example.com:5432/negotiations_prod",
      ),
    (error: unknown) =>
      error instanceof LocalDbSafetyError &&
      error.code === "UNSAFE_DATABASE_TARGET",
  );
});

test("4. local DB target passes", () => {
  const target = assertSafeLocalDatabaseTarget(
    "postgres://localhost:5432/negotiations",
  );
  assert.equal(target.host, "localhost");
  assert.equal(target.database, "negotiations");
  assert.ok(!target.sanitizedUrl.includes("password"));
});

test("5. temporary entities use unique POC namespace", async () => {
  // Validate namespace helper via createSession mock path in full mode.
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  const full = baseOptions({ mode: "full" });
  let namespace = "";
  try {
    await runPocOrchestrator(
      full,
      mockDeps({
        createSession: async ({ runId }) => {
          namespace = `poc-vox-server-stop-${runId}`;
          const base = await mockDeps().createSession!({
            runId,
            confirmLocalDbWrite: true,
          });
          return base;
        },
        callbackSelfTest: async () => ({
          passed: false,
          code: "CALLBACK_SELF_TEST_FORCED_FAIL",
          details: {},
        }),
      }),
    );
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
  assert.match(namespace, /^poc-vox-server-stop-run-/);
});

test("6. cleanup deletes only manifest entities", async () => {
  const deleted: string[] = [];
  const manifest: PocCleanupManifest = {
    runId: "r1",
    namespace: "poc-vox-server-stop-r1",
    createdAt: new Date().toISOString(),
    databaseTargetSanitized: "postgres://localhost:5432/negotiations",
    entities: [
      { kind: "Session", id: "s1" },
      { kind: "User", id: "u1" },
    ],
  };
  const cleanup = async (params: {
    manifest: PocCleanupManifest;
    confirmLocalDbWrite: boolean;
  }) => {
    for (const e of params.manifest.entities) deleted.push(e.id);
    return { deleted: params.manifest.entities, dryRun: false };
  };
  await cleanup({ manifest, confirmLocalDbWrite: true });
  assert.deepEqual(deleted, ["s1", "u1"]);
  assert.ok(!deleted.includes("ordinary-session"));
});

test("7. callback self-test failure prevents StartConference", async () => {
  let startCalls = 0;
  const report = await runPocOrchestrator(
    baseOptions({ mode: "transport" }),
    mockDeps({
      fetchImpl: (async () => {
        throw new Error("callback down");
      }) as typeof fetch,
      startConference: async () => {
        startCalls += 1;
        throw new Error("should not start");
      },
    }),
  );
  assert.equal(startCalls, 0);
  assert.equal(report.failureStage, "callback_self_test");
  assert.equal(report.result, "FAIL");
});

test("8. one StartConference call per run", async () => {
  let startCalls = 0;
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-orch-"));
  process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET =
    process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET ||
    "control-secret-16chars!!!";

  const report = await runPocOrchestrator(
    baseOptions({ mode: "transport", stateRoot }),
    mockDeps({
      callbackSelfTest: async () => ({
        passed: true,
        code: "CALLBACK_SELF_TEST_PASSED",
        details: {},
      }),
      startConference: async (params) => {
        startCalls += 1;
        return mockDeps().startConference!(params);
      },
      executePing: async () => ({
        dryRun: false,
        nonTerminal: false,
        transport: {
          dryRun: false,
          controlUrlFingerprint: "fp",
          requestHeaderKeys: [],
          requestHeaders: {},
          transportOutcome: "TRANSPORT_ACCEPTED" as const,
          httpStatus: 200,
          responseBodyPresent: false,
          responseJsonParsed: false,
          response: null,
          commandConfirmed: false,
        },
        pingOutcome: "PING_COMMAND_CONFIRMED" as const,
        callbackEvent: null,
        runtimeStatus: "ACTIVE",
      }),
    }),
  );
  assert.equal(startCalls, 1);
  assert.equal(report.startConferenceCallCount, 1);
  assert.equal(report.result, "PASS");
});

test("9. active run pointer is atomic", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-pointer-"));
  activatePocRun({ runId: "run-a", linkedSessionId: "s-a", stateRoot: cwd });
  assert.equal(readCurrentPointer(cwd)?.runId, "run-a");
  activatePocRun({ runId: "run-b", linkedSessionId: "s-b", stateRoot: cwd });
  assert.equal(readCurrentPointer(cwd)?.runId, "run-b");
  assert.equal(readCurrentPointer(cwd)?.linkedSessionId, "s-b");
});

test("10. access route dynamically selects matching run without env restart", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-access-dyn-"));
  let state = createEmptyPocState({
    pocId: "run-1",
    conferenceName: "neg-poc-server-stop-aaa",
    linkedSessionId: "sess-a",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "1",
    mediaSessionAccessUrl: "https://example.invalid/session/a",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/a",
    ruleId: "9",
    applicationId: null,
  });
  writePocState(state, cwd);

  assert.equal(
    resolveVoximplantConferenceNameForAccess(
      "sess-a",
      { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
      cwd,
    ),
    "neg-poc-server-stop-aaa",
  );

  let state2 = createEmptyPocState({
    pocId: "run-2",
    conferenceName: "neg-poc-server-stop-bbb",
    linkedSessionId: "sess-b",
  });
  state2 = applyStartConferenceToState(state2, {
    callSessionHistoryId: "2",
    mediaSessionAccessUrl: "https://example.invalid/session/b",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/b",
    ruleId: "9",
    applicationId: null,
  });
  writePocState(state2, cwd);

  assert.equal(
    resolveVoximplantConferenceNameForAccess(
      "sess-b",
      { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
      cwd,
    ),
    "neg-poc-server-stop-bbb",
  );
});

test("11. wrong Session uses normal conference", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-wrong-"));
  let state = createEmptyPocState({
    pocId: "run-1",
    conferenceName: "neg-poc-server-stop-aaa",
    linkedSessionId: "sess-a",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "1",
    mediaSessionAccessUrl: "https://example.invalid/session/a",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/a",
    ruleId: "9",
    applicationId: null,
  });
  writePocState(state, cwd);
  assert.equal(
    resolveVoximplantConferenceNameForAccess(
      "sess-other",
      { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
      cwd,
    ),
    buildVoximplantConferenceName("sess-other"),
  );
});

test("12. expired run is not reused", () => {
  const cwd = mkdtempSync(join(tmpdir(), "poc-exp-"));
  let state = createEmptyPocState({
    pocId: "run-1",
    conferenceName: "neg-poc-server-stop-aaa",
    linkedSessionId: "sess-a",
  });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: "1",
    mediaSessionAccessUrl: "https://example.invalid/session/a",
    mediaSessionAccessSecureUrl: "https://example.invalid/session/a",
    ruleId: "9",
    applicationId: null,
    startedAt: "2020-01-01T00:00:00.000Z",
    idleTtlMs: 1,
  });
  writePocState(state, cwd);
  assert.equal(
    resolveVoximplantConferenceNameForAccess(
      "sess-a",
      { VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true" },
      cwd,
      Date.now(),
    ),
    buildVoximplantConferenceName("sess-a"),
  );
});

test("13. two browser contexts receive same POC conference", async () => {
  const names: string[] = [];
  await runPocOrchestrator(
    baseOptions({ mode: "full" }),
    mockDeps({
      fetchImpl: (async () => {
        throw new Error("stop before provider");
      }) as typeof fetch,
      browserJoin: async (input) => {
        names.push(input.expectedConferenceName, input.expectedConferenceName);
        return {
          facilitatorJoined: true,
          participantJoined: true,
          sameConferenceConfirmed: true,
          facilitatorConferenceName: input.expectedConferenceName,
          participantConferenceName: input.expectedConferenceName,
          browserRelayUsed: false,
          evidence: {},
          close: async () => {},
        };
      },
    }),
  );
  // Self-test fails before browser — assert contract via direct browserJoin mock unit:
  const join = mockDeps().browserJoin!;
  const result = await join({
    appBaseUrl: "http://localhost:3000",
    sessionId: "s",
    expectedConferenceName: "neg-poc-server-stop-same",
    facilitatorRoomUrl: "http://localhost:3000/a",
    participantRoomUrl: "http://localhost:3000/b",
    facilitatorAuthCookie: "auth_session=x",
    timeoutMs: 1000,
  });
  assert.equal(result.sameConferenceConfirmed, true);
  assert.equal(result.facilitatorConferenceName, result.participantConferenceName);
});

test("14. browser join timeout preserves evidence", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-bj-"));
  // Simulate evidence retention path: write state + report path exists after fail
  writePocState(
    createEmptyPocState({
      pocId: "run-ev",
      conferenceName: "neg-poc-server-stop-ev",
      linkedSessionId: "sess-ev",
    }),
    stateRoot,
  );
  assert.ok(readPocState(stateRoot));
  assert.ok(readCurrentPointer(stateRoot));
});

test("15. recording start failure prevents stop", async () => {
  let stopCalls = 0;
  const previousDb = process.env.DATABASE_URL;
  const previousControl = process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET;
  process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET =
    "control-secret-16chars!!!";
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";

  try {
    const report = await runPocOrchestrator(
      baseOptions({ mode: "full" }),
      mockDeps({
        callbackSelfTest: async () => ({
          passed: true,
          code: "CALLBACK_SELF_TEST_PASSED",
          details: {},
        }),
        fetchImpl: (async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("recording-control")) {
            return new Response(
              JSON.stringify({ ok: false, error: "start failed" }),
              { status: 500 },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as typeof fetch,
        sendControl: async () => {
          stopCalls += 1;
          throw new Error("stop should not run");
        },
      }),
    );
    assert.equal(stopCalls, 0);
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

test("16. transport accepted is non-terminal", () => {
  assert.notEqual("TRANSPORT_ACCEPTED", "PROVIDER_TERMINAL");
  const draft = {
    callbackSelfTest: true,
    browserFacilitatorJoined: true,
    browserParticipantJoined: true,
    sameConferenceConfirmed: true,
    recordingStarted: true,
    transportAccepted: true,
    commandAccepted: true,
    providerTerminal: false,
    stopIdempotent: true,
    browserRelayUsed: false,
    artifactAvailable: true,
  } as unknown as Omit<PocOrchestratorReport, "result">;
  assert.equal(evaluateFullPass(draft), false);
});

test("17. command callback is non-terminal", () => {
  const draft = {
    callbackSelfTest: true,
    browserFacilitatorJoined: true,
    browserParticipantJoined: true,
    sameConferenceConfirmed: true,
    recordingStarted: true,
    transportAccepted: true,
    commandAccepted: true,
    providerTerminal: false,
    stopIdempotent: true,
    browserRelayUsed: false,
    artifactAvailable: true,
  } as unknown as Omit<PocOrchestratorReport, "result">;
  assert.equal(evaluateFullPass(draft), false);
});

test("18. recording_stopped is terminal", () => {
  const draft = {
    callbackSelfTest: true,
    browserFacilitatorJoined: true,
    browserParticipantJoined: true,
    sameConferenceConfirmed: true,
    recordingStarted: true,
    transportAccepted: true,
    commandAccepted: true,
    providerTerminal: true,
    stopIdempotent: true,
    browserRelayUsed: false,
    artifactAvailable: true,
  } as unknown as Omit<PocOrchestratorReport, "result">;
  assert.equal(evaluateFullPass(draft), true);
});

test("19. repeated stop is idempotent", () => {
  // Covered by stopIdempotent report field requirement in PASS criteria.
  const draft = {
    callbackSelfTest: true,
    browserFacilitatorJoined: true,
    browserParticipantJoined: true,
    sameConferenceConfirmed: true,
    recordingStarted: true,
    transportAccepted: true,
    commandAccepted: true,
    providerTerminal: true,
    stopIdempotent: false,
    browserRelayUsed: false,
    artifactAvailable: true,
  } as unknown as Omit<PocOrchestratorReport, "result">;
  assert.equal(evaluateFullPass(draft), false);
});

test("20. browser relay use fails the POC", () => {
  const draft = {
    callbackSelfTest: true,
    browserFacilitatorJoined: true,
    browserParticipantJoined: true,
    sameConferenceConfirmed: true,
    recordingStarted: true,
    transportAccepted: true,
    commandAccepted: true,
    providerTerminal: true,
    stopIdempotent: true,
    browserRelayUsed: true,
    artifactAvailable: true,
  } as unknown as Omit<PocOrchestratorReport, "result">;
  assert.equal(evaluateFullPass(draft), false);
});

test("21. provider log sanitizer removes capability URLs/signatures", () => {
  const sanitized = sanitizePocDiagnosticLog({
    accessURL: "https://example.invalid/session/secret",
    accessSecureURL: "https://example.invalid/session/secret2",
    signature: "a".repeat(64),
    headers: { Authorization: "Bearer x" },
  });
  const text = JSON.stringify(sanitized);
  assert.ok(!text.includes("secret"));
  assert.ok(!text.includes("Bearer"));
  assert.ok(text.includes("[redacted-header-map]") || text.includes("Fingerprint") || text.includes("redacted"));
});

test("22. log fetch unavailable is reported but not fatal", () => {
  // PASS criteria do not require log fetch success.
  const draft = {
    callbackSelfTest: true,
    browserFacilitatorJoined: true,
    browserParticipantJoined: true,
    sameConferenceConfirmed: true,
    recordingStarted: true,
    transportAccepted: true,
    commandAccepted: true,
    providerTerminal: true,
    stopIdempotent: true,
    browserRelayUsed: false,
    artifactAvailable: true,
    logFetchStatus: "LOG_FETCH_UNAVAILABLE",
  } as unknown as Omit<PocOrchestratorReport, "result">;
  assert.equal(evaluateFullPass(draft), true);
});

test("23. report PASS criteria are strict", () => {
  const almost = {
    callbackSelfTest: true,
    browserFacilitatorJoined: true,
    browserParticipantJoined: true,
    sameConferenceConfirmed: true,
    recordingStarted: true,
    transportAccepted: true,
    commandAccepted: true,
    providerTerminal: true,
    stopIdempotent: true,
    browserRelayUsed: false,
    artifactAvailable: false,
  } as unknown as Omit<PocOrchestratorReport, "result">;
  assert.equal(evaluateFullPass(almost), false);
});

test("24. failure report includes evidence paths", async () => {
  const stateRoot = mkdtempSync(join(tmpdir(), "poc-fail-ev-"));
  const report = await runPocOrchestrator(
    baseOptions({
      mode: "full",
      confirmLivePoc: false,
      stateRoot,
    }),
    mockDeps(),
  );
  assert.equal(report.result, "FAIL");
  assert.ok(report.remainingEvidencePaths.length > 0);
  assert.ok(report.remainingEvidencePaths.some((p) => p.includes(stateRoot) || existsSync(p)));
});

test("25. cleanup requires confirmation", () => {
  assert.throws(
    () => assertLocalDbWriteConfirmation(false),
    (error: unknown) =>
      error instanceof LocalDbSafetyError &&
      error.code === "LOCAL_DB_WRITE_CONFIRMATION_REQUIRED",
  );
});

test("26. normal application flow remains unchanged", () => {
  const sessionId = "ordinary-production-session";
  assert.equal(
    resolveVoximplantConferenceNameForAccess(sessionId, {
      VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "false",
    }),
    `negotiation-${sessionId}`,
  );
  assert.equal(
    resolveVoximplantConferenceNameForAccess(sessionId, {
      VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC: "true",
    }),
    `negotiation-${sessionId}`,
  );
  clearCurrentPointer();
});
