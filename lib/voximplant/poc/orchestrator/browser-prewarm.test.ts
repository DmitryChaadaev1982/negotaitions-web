import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CreateVoxServerStopPocSessionResult } from "@/lib/voximplant/poc/create-poc-session";
import { emptyBrowserContextEvidence } from "@/lib/voximplant/poc/orchestrator/browser-stages";
import {
  runPocOrchestrator,
  type OrchestratorDeps,
} from "@/lib/voximplant/poc/orchestrator/run-orchestrator";
import type { PocOrchestratorOptions } from "@/lib/voximplant/poc/orchestrator/types";

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
    healthUrl: "http://localhost:3000/api/poc/voximplant/server-stop/health",
    stateRoot: mkdtempSync(join(tmpdir(), "poc-prewarm-")),
    ...overrides,
  };
}

function sessionFixture(runId: string): CreateVoxServerStopPocSessionResult {
  return {
    runId,
    namespace: `poc-vox-server-stop-${runId}`,
    sessionId: `session-${runId}`,
    caseId: `case-${runId}`,
    facilitatorAuth: {
      userId: `user-${runId}`,
      email: `f-${runId}@test.negotaitions.local`,
      password: "x",
      authCookie: "auth_session=token",
      userSessionId: `usess-f-${runId}`,
      role: "FACILITATOR",
    },
    participantAuth: {
      userId: `puser-${runId}`,
      email: `p-${runId}@test.negotaitions.local`,
      password: "x",
      authCookie: "auth_session=participant-token",
      userSessionId: `usess-p-${runId}`,
      role: "PARTICIPANT",
    },
    facilitatorUserId: `user-${runId}`,
    facilitatorEmail: `f-${runId}@test.negotaitions.local`,
    facilitatorPassword: "x",
    facilitatorAuthCookie: "auth_session=token",
    participantUserId: `puser-${runId}`,
    participantEmail: `p-${runId}@test.negotaitions.local`,
    participantPassword: "x",
    participantAuthCookie: "auth_session=participant-token",
    facilitatorJoinToken: `fac-${runId}`,
    participantJoinToken: `part-${runId}`,
    facilitatorRoomUrl: `http://localhost:3000/room/session-${runId}?joinToken=fac`,
    participantRoomUrl: `http://localhost:3000/room/session-${runId}?joinToken=part`,
    participantAccountRoomUrl: `http://localhost:3000/room/session-${runId}`,
    roomUrl: `http://localhost:3000/room/session-${runId}?joinToken=fac`,
    localDatabaseTargetSanitized: "postgres://localhost:5432/negotiations",
    cleanupManifest: {
      runId,
      namespace: `poc-vox-server-stop-${runId}`,
      createdAt: new Date().toISOString(),
      databaseTargetSanitized: "postgres://localhost:5432/negotiations",
      entities: [
        { kind: "UserSession", id: `usess-f-${runId}` },
        { kind: "UserSession", id: `usess-p-${runId}` },
        { kind: "Session", id: `session-${runId}` },
      ],
    },
  };
}

function baseDeps(overrides: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  let startCalls = 0;
  let prewarmCalls = 0;
  let liveJoinCalls = 0;
  const order: string[] = [];

  const deps: OrchestratorDeps & {
    startCalls: number;
    prewarmCalls: number;
    liveJoinCalls: number;
    order: string[];
  } = {
    startCalls: 0,
    prewarmCalls: 0,
    liveJoinCalls: 0,
    order,
    resolveConfig: () => ({
      accountId: "1",
      applicationId: "2",
      applicationName: "app",
      ruleId: "9175667",
      ruleName: "poc-rule",
      auth: { type: "api_key", apiKey: "test-key" },
    }),
    createSession: async ({ runId }) => sessionFixture(runId),
    callbackSelfTest: async () => ({
      passed: true,
      code: "CALLBACK_SELF_TEST_PASSED",
      details: {},
    }),
    browserPrewarm: async () => {
      prewarmCalls += 1;
      deps.prewarmCalls = prewarmCalls;
      order.push("prewarm");
      return {
        ok: true,
        failureCode: null,
        browserPrewarmStartedAt: new Date().toISOString(),
        browserPrewarmCompletedAt: new Date().toISOString(),
        facilitator: {
          ...emptyBrowserContextEvidence("facilitator", "s"),
          reachedStage: "ROOM_PAGE_LOADED",
          authAccepted: true,
          roomPageLoaded: true,
        },
        participant: {
          ...emptyBrowserContextEvidence("participant", "s"),
          reachedStage: "ROOM_PAGE_LOADED",
          authAccepted: true,
          roomPageLoaded: true,
        },
        evidence: {},
        liveJoin: async (params) => {
          liveJoinCalls += 1;
          deps.liveJoinCalls = liveJoinCalls;
          order.push("liveJoin");
          const fac = emptyBrowserContextEvidence(
            "facilitator",
            "session",
          );
          const part = emptyBrowserContextEvidence("participant", "session");
          return {
            facilitatorJoined: true,
            participantJoined: true,
            sameConferenceConfirmed: true,
            facilitatorConferenceName: params.expectedConferenceName,
            participantConferenceName: params.expectedConferenceName,
            browserRelayUsed: false,
            failureCode: null,
            facilitator: {
              ...fac,
              reachedStage: "JOIN_CONFIRMED",
              joined: true,
              accessRequested: true,
              accessRequestedAt: new Date().toISOString(),
              access: {
                requestPath: "/api/sessions/session/voximplant/access",
                httpStatus: 200,
                applicationErrorCode: null,
                requestedSessionId: "session",
                linkedSessionIdMatch: true,
                activeRunId: "run",
                selectedConferenceName: params.expectedConferenceName,
                selectionSource: "POC_STATE",
                runtimeStatus: "ACTIVE",
                expiryDecision: "ACTIVE",
              },
            },
            participant: {
              ...part,
              reachedStage: "JOIN_CONFIRMED",
              joined: true,
              accessRequested: true,
              accessRequestedAt: new Date().toISOString(),
              access: {
                requestPath: "/api/sessions/session/voximplant/access",
                httpStatus: 200,
                applicationErrorCode: null,
                requestedSessionId: "session",
                linkedSessionIdMatch: true,
                activeRunId: "run",
                selectedConferenceName: params.expectedConferenceName,
                selectionSource: "POC_STATE",
                runtimeStatus: "ACTIVE",
                expiryDecision: "ACTIVE",
              },
            },
            timing: {
              browserPrewarmStartedAt: new Date().toISOString(),
              browserPrewarmCompletedAt: new Date().toISOString(),
              startConferenceStartedAt: params.startConferenceStartedAt,
              startConferenceCompletedAt: params.startConferenceCompletedAt,
              activeRunPublishedAt: params.activeRunPublishedAt,
              facilitatorAccessRequestedAt: new Date().toISOString(),
              participantAccessRequestedAt: new Date().toISOString(),
              facilitatorCallConnectedAt: new Date().toISOString(),
              participantCallConnectedAt: new Date().toISOString(),
              startConferenceToFirstAccessMs: 50,
              startConferenceToFirstJoinMs: 100,
              startConferenceToBothJoinedMs: 120,
            },
            evidence: {},
            close: async () => {},
          };
        },
        close: async () => {},
      };
    },
    startConference: async ({ conferenceName }) => {
      startCalls += 1;
      deps.startCalls = startCalls;
      order.push("startConference");
      return {
        dryRun: false,
        missingPocRule: false,
        request: { conference_name: conferenceName, rule_id: "9175667" },
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
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          recording: { status: "ACTIVE" },
        }),
        { status: 200 },
      )) as typeof fetch,
    sleep: async () => {},
    ...overrides,
  };
  return deps;
}

test("1. browsers are prewarmed before StartConference", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET =
    process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET ||
    "control-secret-16chars!!!";
  try {
    const deps = baseDeps();
    await runPocOrchestrator(baseOptions({ mode: "full" }), deps);
    const order = (deps as { order: string[] }).order;
    assert.ok(order.indexOf("prewarm") < order.indexOf("startConference"));
    assert.ok(order.indexOf("startConference") < order.indexOf("liveJoin"));
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("2. no provider call if browser prewarm fails", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    let startCalls = 0;
    const report = await runPocOrchestrator(
      baseOptions({ mode: "full" }),
      baseDeps({
        browserPrewarm: async () => ({
          ok: false,
          failureCode: "FACILITATOR_AUTH_FAILED",
          browserPrewarmStartedAt: new Date().toISOString(),
          browserPrewarmCompletedAt: new Date().toISOString(),
          facilitator: markFacAuth(),
          participant: emptyBrowserContextEvidence("participant", "s"),
          evidence: {},
          liveJoin: async () => {
            throw new Error("should not live join");
          },
          close: async () => {},
        }),
        startConference: async () => {
          startCalls += 1;
          throw new Error("should not start");
        },
      }),
    );
    assert.equal(startCalls, 0);
    assert.equal(report.providerCalls, false);
    assert.equal(report.failureStage, "browser_prewarm");
    assert.equal(report.failureCode, "FACILITATOR_AUTH_FAILED");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("2b. AUTH_COOKIE_INSTALL_FAILED blocks StartConference", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    let startCalls = 0;
    const report = await runPocOrchestrator(
      baseOptions({ mode: "full" }),
      baseDeps({
        browserPrewarm: async () => ({
          ok: false,
          failureCode: "AUTH_COOKIE_INSTALL_FAILED",
          browserPrewarmStartedAt: new Date().toISOString(),
          browserPrewarmCompletedAt: new Date().toISOString(),
          facilitator: {
            ...emptyBrowserContextEvidence("facilitator", "s"),
            reachedStage: "BROWSER_LAUNCHED",
            firstFailedStage: "AUTH_CONTEXT_CREATED",
            failureCode: "AUTH_COOKIE_INSTALL_FAILED",
          },
          participant: {
            ...emptyBrowserContextEvidence("participant", "s"),
            reachedStage: "BROWSER_LAUNCHED",
          },
          evidence: {
            cookieBindingMode: "URL_BOUND",
            appBaseUrlHost: "localhost:3000",
            secure: false,
            failingOperation: "addCookies",
            role: "facilitator",
          },
          liveJoin: async () => {
            throw new Error("should not live join");
          },
          close: async () => {},
        }),
        startConference: async () => {
          startCalls += 1;
          throw new Error("should not start");
        },
      }),
    );
    assert.equal(startCalls, 0);
    assert.equal(report.providerCalls, false);
    assert.equal(report.failureStage, "browser_prewarm");
    assert.equal(report.failureCode, "AUTH_COOKIE_INSTALL_FAILED");
    assert.equal(report.facilitatorFirstFailedStage, "AUTH_CONTEXT_CREATED");
    assert.notEqual(report.failureCode, "BROWSER_LAUNCHED");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("11. successful prewarm reaches AUTH_ACCEPTED for facilitator", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    let capturedFacStage: string | null = null;
    const report = await runPocOrchestrator(
      baseOptions({ mode: "full" }),
      baseDeps({
        browserPrewarm: async () => {
          const handle = {
            ok: true as const,
            failureCode: null,
            browserPrewarmStartedAt: new Date().toISOString(),
            browserPrewarmCompletedAt: new Date().toISOString(),
            facilitator: {
              ...emptyBrowserContextEvidence("facilitator", "s"),
              reachedStage: "AUTH_ACCEPTED" as const,
              authAccepted: true,
            },
            participant: {
              ...emptyBrowserContextEvidence("participant", "s"),
              reachedStage: "AUTH_CONTEXT_CREATED" as const,
            },
            evidence: {
              facilitatorAuthStrategy: "CANONICAL_COOKIE",
              participantAuthStrategy: "JOIN_TOKEN",
              participantCookieInstalled: false,
              phase: "FACILITATOR_AUTH_ACCEPTED",
            },
            liveJoin: async () => {
              throw new Error("live join should not run in this test");
            },
            close: async () => {},
          };
          capturedFacStage = handle.facilitator.reachedStage;
          return handle;
        },
        startConference: async () => {
          return {
            dryRun: false,
            missingPocRule: false,
            request: { conference_name: "x", rule_id: "9175667" },
            parsed: null,
            publicResult: null,
          };
        },
      }),
    );
    assert.equal(capturedFacStage, "AUTH_ACCEPTED");
    assert.equal(report.facilitatorBrowserStage, "AUTH_ACCEPTED");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("12. successful participant preparation reaches AUTH_CONTEXT_CREATED", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    const report = await runPocOrchestrator(
      baseOptions({ mode: "full" }),
      baseDeps({
        browserPrewarm: async () => ({
          ok: true,
          failureCode: null,
          browserPrewarmStartedAt: new Date().toISOString(),
          browserPrewarmCompletedAt: new Date().toISOString(),
          facilitator: {
            ...emptyBrowserContextEvidence("facilitator", "s"),
            reachedStage: "AUTH_ACCEPTED",
            authAccepted: true,
          },
          participant: {
            ...emptyBrowserContextEvidence("participant", "s"),
            reachedStage: "AUTH_CONTEXT_CREATED",
            failureCode: null,
          },
          evidence: {
            participantPreparation: "PARTICIPANT_CONTEXT_READY",
            participantInheritedFacilitatorAuth: false,
            participantAuthStrategy: "JOIN_TOKEN",
          },
          liveJoin: async () => {
            throw new Error("no live");
          },
          close: async () => {},
        }),
        startConference: async () => ({
          dryRun: false,
          missingPocRule: false,
          request: { conference_name: "x", rule_id: "9175667" },
          parsed: null,
          publicResult: null,
        }),
      }),
    );
    assert.equal(report.participantBrowserStage, "AUTH_CONTEXT_CREATED");
    assert.equal(report.participantFirstFailedStage, null);
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("14. StartConference remains blocked unless prewarm passes", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    let startCalls = 0;
    const report = await runPocOrchestrator(
      baseOptions({ mode: "full" }),
      baseDeps({
        browserPrewarm: async () => ({
          ok: false,
          failureCode: "AUTH_REDIRECTED_TO_LOGIN",
          browserPrewarmStartedAt: new Date().toISOString(),
          browserPrewarmCompletedAt: new Date().toISOString(),
          facilitator: {
            ...emptyBrowserContextEvidence("facilitator", "s"),
            reachedStage: "AUTH_CONTEXT_CREATED",
            firstFailedStage: "AUTH_ACCEPTED",
            failureCode: "AUTH_REDIRECTED_TO_LOGIN",
          },
          participant: {
            ...emptyBrowserContextEvidence("participant", "s"),
            reachedStage: "AUTH_CONTEXT_CREATED",
            failureCode: null,
          },
          evidence: { authNestedFailureCode: "AUTH_REDIRECTED_TO_LOGIN" },
          liveJoin: async () => {
            throw new Error("should not live join");
          },
          close: async () => {},
        }),
        startConference: async () => {
          startCalls += 1;
          throw new Error("should not start");
        },
      }),
    );
    assert.equal(startCalls, 0);
    assert.equal(report.providerCalls, false);
    assert.equal(report.failureCode, "AUTH_REDIRECTED_TO_LOGIN");
    assert.equal(report.participantFirstFailedStage, null);
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("2c. successful prewarm reaches AUTH_CONTEXT_CREATED for both contexts", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    let capturedFacStage: string | null = null;
    let capturedPartStage: string | null = null;
    let participantCookieInstalled: unknown = null;
    let startCalls = 0;
    const report = await runPocOrchestrator(
      baseOptions({ mode: "full" }),
      baseDeps({
        browserPrewarm: async () => {
          const handle = {
            ok: true as const,
            failureCode: null,
            browserPrewarmStartedAt: new Date().toISOString(),
            browserPrewarmCompletedAt: new Date().toISOString(),
            facilitator: {
              ...emptyBrowserContextEvidence("facilitator", "s"),
              reachedStage: "AUTH_CONTEXT_CREATED" as const,
              authAccepted: true,
              roomPageLoaded: true,
            },
            participant: {
              ...emptyBrowserContextEvidence("participant", "s"),
              reachedStage: "AUTH_CONTEXT_CREATED" as const,
              authAccepted: true,
              roomPageLoaded: true,
            },
            evidence: {
              cookieBindingMode: "URL_BOUND",
              participantCookieInstalled: false,
              facilitatorAuthStrategy: "CANONICAL_COOKIE",
              participantAuthStrategy: "JOIN_TOKEN",
            },
            liveJoin: async () => {
              throw new Error("live join should not run in this test");
            },
            close: async () => {},
          };
          capturedFacStage = handle.facilitator.reachedStage;
          capturedPartStage = handle.participant.reachedStage;
          participantCookieInstalled =
            handle.evidence.participantCookieInstalled;
          return handle;
        },
        startConference: async () => {
          startCalls += 1;
          return {
            dryRun: false,
            missingPocRule: false,
            request: { conference_name: "x", rule_id: "9175667" },
            parsed: null,
            publicResult: null,
          };
        },
      }),
    );
    assert.equal(capturedFacStage, "AUTH_CONTEXT_CREATED");
    assert.equal(capturedPartStage, "AUTH_CONTEXT_CREATED");
    assert.equal(participantCookieInstalled, false);
    assert.equal(startCalls, 1);
    assert.equal(report.facilitatorBrowserStage, "AUTH_CONTEXT_CREATED");
    assert.equal(report.participantBrowserStage, "AUTH_CONTEXT_CREATED");
    assert.equal(report.failureStage, "start_conference");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

function markFacAuth() {
  return {
    ...emptyBrowserContextEvidence("facilitator", "s"),
    firstFailedStage: "AUTH_ACCEPTED" as const,
    failureCode: "FACILITATOR_AUTH_FAILED" as const,
  };
}

test("3. StartConference occurs only after both auth contexts are ready", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    let sawReady = false;
    const deps = baseDeps({
      browserPrewarm: async () => {
        sawReady = true;
        return {
          ok: true,
          failureCode: null,
          browserPrewarmStartedAt: new Date().toISOString(),
          browserPrewarmCompletedAt: new Date().toISOString(),
          facilitator: {
            ...emptyBrowserContextEvidence("facilitator", "s"),
            authAccepted: true,
            roomPageLoaded: true,
            reachedStage: "ROOM_PAGE_LOADED",
          },
          participant: {
            ...emptyBrowserContextEvidence("participant", "s"),
            authAccepted: true,
            roomPageLoaded: true,
            reachedStage: "ROOM_PAGE_LOADED",
          },
          evidence: {},
          liveJoin: async () => ({
            facilitatorJoined: false,
            participantJoined: false,
            sameConferenceConfirmed: false,
            facilitatorConferenceName: null,
            participantConferenceName: null,
            browserRelayUsed: false,
            failureCode: "CONFERENCE_JOIN_TIMEOUT",
            facilitator: markJoinTimeout("facilitator"),
            participant: markJoinTimeout("participant"),
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
          }),
          close: async () => {},
        };
      },
      startConference: async (params) => {
        assert.equal(sawReady, true);
        return baseDeps().startConference!(params);
      },
    });
    const report = await runPocOrchestrator(baseOptions(), deps);
    assert.equal(report.startConferenceCallCount, 1);
    assert.equal(report.failureStage, "browser_join");
    assert.equal(sawReady, true);
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("4/5. live join released once after StartConference with exact POC conference", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    const deps = baseDeps();
    const report = await runPocOrchestrator(baseOptions(), deps);
    assert.equal((deps as { liveJoinCalls: number }).liveJoinCalls, 1);
    assert.equal((deps as { startCalls: number }).startCalls, 1);
    assert.ok(report.conferenceName?.startsWith("neg-poc-server-stop-"));
    assert.equal(
      report.facilitatorSelectedConferenceName,
      report.conferenceName,
    );
    assert.equal(
      report.participantSelectedConferenceName,
      report.conferenceName,
    );
    assert.equal(report.facilitatorSelectionSource, "POC_STATE");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("15. startConferenceToFirstAccessMs is persisted", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    const report = await runPocOrchestrator(baseOptions(), baseDeps());
    assert.equal(typeof report.startConferenceToFirstAccessMs, "number");
    assert.ok((report.startConferenceToFirstAccessMs as number) >= 0);
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test("18. recording start not attempted unless both browsers joined", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    let recordingCalls = 0;
    const report = await runPocOrchestrator(
      baseOptions(),
      baseDeps({
        browserPrewarm: async () => ({
          ok: true,
          failureCode: null,
          browserPrewarmStartedAt: new Date().toISOString(),
          browserPrewarmCompletedAt: new Date().toISOString(),
          facilitator: {
            ...emptyBrowserContextEvidence("facilitator", "s"),
            authAccepted: true,
            roomPageLoaded: true,
            reachedStage: "ROOM_PAGE_LOADED",
          },
          participant: {
            ...emptyBrowserContextEvidence("participant", "s"),
            authAccepted: true,
            roomPageLoaded: true,
            reachedStage: "ROOM_PAGE_LOADED",
          },
          evidence: {},
          liveJoin: async () => ({
            facilitatorJoined: false,
            participantJoined: false,
            sameConferenceConfirmed: false,
            facilitatorConferenceName: null,
            participantConferenceName: null,
            browserRelayUsed: false,
            failureCode: "CONFERENCE_JOIN_TIMEOUT",
            facilitator: markJoinTimeout("facilitator"),
            participant: markJoinTimeout("participant"),
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
          }),
          close: async () => {},
        }),
        fetchImpl: (async (input) => {
          if (String(input).includes("recording-control")) {
            recordingCalls += 1;
          }
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }) as typeof fetch,
      }),
    );
    assert.equal(recordingCalls, 0);
    assert.equal(report.recordingStarted, false);
    assert.equal(report.failureCode, "CONFERENCE_JOIN_TIMEOUT");
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

function markJoinTimeout(role: "facilitator" | "participant") {
  return {
    ...emptyBrowserContextEvidence(role, "s"),
    firstFailedStage: "JOIN_CONFIRMED" as const,
    failureCode: "CONFERENCE_JOIN_TIMEOUT" as const,
  };
}

test("19. no browser relay during join diagnostics", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://localhost:5432/negotiations";
  try {
    const report = await runPocOrchestrator(baseOptions(), baseDeps());
    assert.equal(report.browserRelayUsed, false);
  } finally {
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});
