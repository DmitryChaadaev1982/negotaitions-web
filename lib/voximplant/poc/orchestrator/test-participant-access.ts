/**
 * Provider-free participant access validation.
 *
 * Modes:
 * 1) --run-id <id> — replay against an existing run (no fixture DB writes)
 * 2) --create-fixture --confirm-local-db-write — create a temporary namespaced
 *    fixture, validate participant auth + POC_STATE access, then cleanup
 *
 * Never calls StartConference / provider APIs.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  cleanupPocSessionEntities,
  createVoxServerStopPocSession,
  type CreateVoxServerStopPocSessionResult,
  type PocCleanupManifest,
} from "@/lib/voximplant/poc/create-poc-session";
import {
  assertLocalDbWriteConfirmation,
  assertSafeLocalDatabaseTarget,
  LocalDbSafetyError,
} from "@/lib/voximplant/poc/local-db-safety";
import {
  activatePocRun,
  clearCurrentPointer,
  getPocRunPaths,
  readCurrentPointer,
  type PocCurrentPointer,
} from "@/lib/voximplant/poc/poc-run-store";
import { POC_CONFERENCE_NAME_PREFIX } from "@/lib/voximplant/poc/poc-safety";
import {
  createEmptyPocState,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";

import {
  buildUrlBoundAuthCookie,
  parseCookieHeader,
  prepareParticipantJoinContext,
} from "./browser-auth-cookie";
import { sanitizePageUrl } from "./browser-stages";
import {
  buildParticipantAccountRoomUrl,
  classifyParticipantFixtureAuthCompleteness,
  classifyParticipantNavigation,
  extractJoinTokenFromRoomUrl,
  verifyParticipantAuthInContext,
} from "./participant-prewarm";
import {
  readPrewarmFixture,
  writePrewarmFixture,
  type PocPrewarmFixture,
} from "./prewarm-fixture";

export type TestParticipantAccessResult = {
  ok: boolean;
  runId: string;
  sessionId: string;
  providerCalls: false;
  dbWrites: boolean;
  pointerRestored: boolean;
  lines: string[];
  failureCode: string | null;
  details: Record<string, unknown>;
  cleanupManifestPath?: string | null;
};

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonArtifact(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function newFixtureRunId(): string {
  return `run-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

async function runParticipantAccessAgainstFixture(params: {
  runId: string;
  sessionId: string;
  fixture: PocPrewarmFixture;
  appBaseUrl: string;
  stateRoot?: string;
  timeoutMs?: number;
  dbWrites: boolean;
  expectedParticipantUserId: string;
  expectedParticipantEmail?: string;
  facilitatorUserId?: string;
  facilitatorAuthCookie?: string | null;
}): Promise<TestParticipantAccessResult> {
  const lines: string[] = [];
  const details: Record<string, unknown> = {
    runId: params.runId,
    sessionId: params.sessionId,
  };

  const participantAuthCookie = params.fixture.participantAuthCookie ?? null;
  const participantRoomUrl =
    params.fixture.participantRoomUrl ??
    `${params.appBaseUrl}/room/${params.sessionId}?joinToken=missing`;
  const joinToken = extractJoinTokenFromRoomUrl(participantRoomUrl);

  const completeness = classifyParticipantFixtureAuthCompleteness({
    fixture: params.fixture,
    joinTokenPresent: Boolean(joinToken && joinToken !== "missing"),
  });
  if (!completeness.ok) {
    return {
      ok: false,
      runId: params.runId,
      sessionId: params.sessionId,
      providerCalls: false,
      dbWrites: params.dbWrites,
      pointerRestored: true,
      lines: [completeness.failureCode!],
      failureCode: completeness.failureCode,
      details: {
        ...details,
        reason: completeness.reason,
        joinTokenPresent: Boolean(joinToken && joinToken !== "missing"),
      },
    };
  }

  if (!joinToken || joinToken === "missing") {
    return {
      ok: false,
      runId: params.runId,
      sessionId: params.sessionId,
      providerCalls: false,
      dbWrites: params.dbWrites,
      pointerRestored: true,
      lines: ["PARTICIPANT_TOKEN_MISSING"],
      failureCode: "PARTICIPANT_TOKEN_MISSING",
      details: { ...details, reason: "participant joinToken missing from fixture" },
    };
  }

  prepareParticipantJoinContext({ participantRoomUrl });
  lines.push("PARTICIPANT_AUTH_CONTEXT_CREATED");

  const previousPointer = readCurrentPointer(params.stateRoot);
  const fakeConferenceName = `${POC_CONFERENCE_NAME_PREFIX}test-${params.runId.replace(/[^a-z0-9-]/gi, "").slice(0, 40)}`;
  let pointerRestored = false;
  let result: TestParticipantAccessResult | null = null;

  const restorePointer = () => {
    if (pointerRestored) return;
    if (previousPointer) {
      activatePocRun({
        runId: previousPointer.runId,
        linkedSessionId: previousPointer.linkedSessionId,
        stateRoot: params.stateRoot,
        activatedAt: previousPointer.activatedAt,
      });
    } else {
      clearCurrentPointer(params.stateRoot);
    }
    pointerRestored = true;
    if (result) result.pointerRestored = true;
  };

  try {
    const tempState = createEmptyPocState({
      pocId: params.runId,
      conferenceName: fakeConferenceName,
      linkedSessionId: params.sessionId,
    });
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60_000).toISOString();
    writePocState(
      {
        ...tempState,
        runtimeStatus: "ACTIVE",
        expiresAt,
        callSessionHistoryId: "test-access-no-provider",
        mediaSessionAccessUrl: "https://example.invalid/request/test",
        mediaSessionAccessSecureUrl: "https://example.invalid/request/test",
      },
      params.stateRoot,
    );
    activatePocRun({
      runId: params.runId,
      linkedSessionId: params.sessionId,
      stateRoot: params.stateRoot,
    });

    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({
      headless: true,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    const context = await browser.newContext({
      permissions: ["microphone", "camera"],
      ignoreHTTPSErrors: true,
    });
    try {
      const built = buildUrlBoundAuthCookie({
        cookieHeader: participantAuthCookie!,
        appBaseUrl: params.appBaseUrl,
      });
      await context.addCookies([built.cookie]);

      if (
        hasFacilitatorCookieLeak({
          participantCookie: participantAuthCookie!,
          facilitatorCookie: params.facilitatorAuthCookie,
        })
      ) {
        lines.push("PARTICIPANT_AUTH_USER_MISMATCH");
        result = {
          ok: false,
          runId: params.runId,
          sessionId: params.sessionId,
          providerCalls: false,
          dbWrites: params.dbWrites,
          pointerRestored: false,
          lines,
          failureCode: "PARTICIPANT_AUTH_USER_MISMATCH",
          details: {
            ...details,
            reason: "participant cookie equals facilitator cookie",
          },
        };
        return result;
      }

      const authVerify = await verifyParticipantAuthInContext({
        context,
        appBaseUrl: params.appBaseUrl,
        sessionId: params.sessionId,
        expectedParticipantUserId: params.expectedParticipantUserId,
        expectedParticipantEmail: params.expectedParticipantEmail,
        facilitatorUserId: params.facilitatorUserId,
        facilitatorAuthCookie: params.facilitatorAuthCookie,
        timeoutMs: params.timeoutMs ?? 45_000,
      });
      details.authVerify = {
        ok: authVerify.ok,
        failureCode: authVerify.failureCode,
        finalPagePath: authVerify.diagnostics.finalPagePath,
        redirectToLogin: authVerify.diagnostics.redirectToLogin,
        sessionAccess: authVerify.diagnostics.sessionAccess,
        isFacilitatorIdentity: authVerify.diagnostics.isFacilitatorIdentity,
        // Never include cookie/token values.
      };
      if (!authVerify.ok) {
        lines.push(authVerify.failureCode ?? "PARTICIPANT_AUTH_FAILED");
        result = {
          ok: false,
          runId: params.runId,
          sessionId: params.sessionId,
          providerCalls: false,
          dbWrites: params.dbWrites,
          pointerRestored: false,
          lines,
          failureCode: authVerify.failureCode,
          details,
        };
        return result;
      }

      const page = await context.newPage();
      await page.goto(participantRoomUrl, {
        waitUntil: "domcontentloaded",
        timeout: params.timeoutMs ?? 45_000,
      });
      const nav = classifyParticipantNavigation({
        finalUrl: page.url(),
        appBaseUrl: params.appBaseUrl,
        sessionId: params.sessionId,
        joinTokenPresentInStartUrl: true,
      });
      details.finalPagePath = nav.finalPagePath;
      details.finalHost = nav.finalHost;
      details.redirectToLogin = nav.redirectToLogin;

      if (!nav.ok) {
        lines.push(
          nav.failureCode === "PARTICIPANT_REDIRECTED_TO_LOGIN"
            ? "PARTICIPANT_REDIRECTED_TO_LOGIN"
            : (nav.failureCode ?? "PARTICIPANT_CONTEXT_NOT_ESTABLISHED"),
        );
        result = {
          ok: false,
          runId: params.runId,
          sessionId: params.sessionId,
          providerCalls: false,
          dbWrites: params.dbWrites,
          pointerRestored: false,
          lines,
          failureCode: nav.failureCode,
          details,
        };
        return result;
      }

      lines.push("PARTICIPANT_CONTEXT_READY");

      const durableUrl =
        params.fixture.participantAccountRoomUrl ??
        buildParticipantAccountRoomUrl({
          appBaseUrl: params.appBaseUrl,
          sessionId: params.sessionId,
        });
      if (!page.url().includes(`/room/${params.sessionId}`)) {
        await page.goto(durableUrl, {
          waitUntil: "domcontentloaded",
          timeout: params.timeoutMs ?? 45_000,
        });
      }
      if (/\/login/i.test(sanitizePageUrl(page.url()))) {
        lines.push("PARTICIPANT_REDIRECTED_TO_LOGIN");
        result = {
          ok: false,
          runId: params.runId,
          sessionId: params.sessionId,
          providerCalls: false,
          dbWrites: params.dbWrites,
          pointerRestored: false,
          lines,
          failureCode: "PARTICIPANT_REDIRECTED_TO_LOGIN",
          details,
        };
        return result;
      }
      lines.push("PARTICIPANT_ROOM_LOADED");

      let requestObserved = false;
      page.on("request", (req) => {
        if (
          req.url().includes(`/api/sessions/${params.sessionId}/voximplant/access`)
        ) {
          requestObserved = true;
        }
      });

      const accessResp = await page.request.post(
        `${params.appBaseUrl}/api/sessions/${params.sessionId}/voximplant/access`,
        {
          data: {},
          timeout: params.timeoutMs ?? 45_000,
        },
      );
      requestObserved = true;
      const status = accessResp.status();
      const body = (await accessResp.json().catch(() => null)) as {
        roomNameOrConferenceName?: string;
        error?: string;
        errorCode?: string;
      } | null;
      details.accessHttpStatus = status;
      details.selectedConferenceName = body?.roomNameOrConferenceName ?? null;
      details.requestObserved = requestObserved;

      if (status !== 200) {
        lines.push("PARTICIPANT_ACCESS_DENIED");
        result = {
          ok: false,
          runId: params.runId,
          sessionId: params.sessionId,
          providerCalls: false,
          dbWrites: params.dbWrites,
          pointerRestored: false,
          lines,
          failureCode: "PARTICIPANT_ACCESS_DENIED",
          details,
        };
        return result;
      }
      lines.push("PARTICIPANT_ACCESS_200");

      const selected = body?.roomNameOrConferenceName ?? null;
      const selectionSource =
        selected === fakeConferenceName ? "POC_STATE" : "OTHER";
      details.selectionSource = selectionSource;
      details.expectedConferenceName = fakeConferenceName;

      if (selectionSource !== "POC_STATE") {
        lines.push("PARTICIPANT_ACCESS_DENIED");
        result = {
          ok: false,
          runId: params.runId,
          sessionId: params.sessionId,
          providerCalls: false,
          dbWrites: params.dbWrites,
          pointerRestored: false,
          lines,
          failureCode: "ACCESS_SELECTED_DEFAULT_CONFERENCE",
          details,
        };
        return result;
      }
      lines.push("PARTICIPANT_POC_CONFERENCE_SELECTED");
      lines.push("PARTICIPANT_ACCESS_TEST_PASS");

      result = {
        ok: true,
        runId: params.runId,
        sessionId: params.sessionId,
        providerCalls: false,
        dbWrites: params.dbWrites,
        pointerRestored: false,
        lines,
        failureCode: null,
        details,
      };
      return result;
    } finally {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  } finally {
    restorePointer();
  }
}

function hasFacilitatorCookieLeak(params: {
  participantCookie: string;
  facilitatorCookie?: string | null;
}): boolean {
  if (!params.facilitatorCookie?.includes("auth_session=")) return false;
  return (
    parseCookieHeader(params.participantCookie).value ===
    parseCookieHeader(params.facilitatorCookie).value
  );
}

/**
 * Read-only replay against an existing run. No createVoxServerStopPocSession.
 */
export async function runTestParticipantAccess(params: {
  runId: string;
  appBaseUrl?: string;
  stateRoot?: string;
  timeoutMs?: number;
}): Promise<TestParticipantAccessResult> {
  const appBaseUrl = (params.appBaseUrl ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const paths = getPocRunPaths(params.runId, params.stateRoot);
  const report = readJsonFile<{ sessionId?: string }>(paths.reportPath);
  const fixture = readPrewarmFixture(params.runId, params.stateRoot);
  const sessionId = fixture?.sessionId ?? report?.sessionId;

  if (!sessionId) {
    return {
      ok: false,
      runId: params.runId,
      sessionId: "unknown",
      providerCalls: false,
      dbWrites: false,
      pointerRestored: true,
      lines: ["PARTICIPANT_AUTH_ARTIFACT_MISSING"],
      failureCode: "PARTICIPANT_AUTH_ARTIFACT_MISSING",
      details: { reason: "sessionId missing from run artifacts" },
    };
  }

  if (!fixture) {
    return {
      ok: false,
      runId: params.runId,
      sessionId,
      providerCalls: false,
      dbWrites: false,
      pointerRestored: true,
      lines: ["LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE"],
      failureCode: "LEGACY_RUN_PARTICIPANT_FIXTURE_INCOMPLETE",
      details: {
        reason: "prewarm fixture missing; cannot reconstruct participant auth",
      },
    };
  }

  const joinToken = extractJoinTokenFromRoomUrl(
    fixture.participantRoomUrl ?? "",
  );
  const completeness = classifyParticipantFixtureAuthCompleteness({
    fixture,
    joinTokenPresent: Boolean(joinToken),
  });
  if (!completeness.ok) {
    return {
      ok: false,
      runId: params.runId,
      sessionId,
      providerCalls: false,
      dbWrites: false,
      pointerRestored: true,
      lines: [completeness.failureCode!],
      failureCode: completeness.failureCode,
      details: {
        reason: completeness.reason,
        joinTokenPresent: Boolean(joinToken),
      },
    };
  }

  return runParticipantAccessAgainstFixture({
    runId: params.runId,
    sessionId,
    fixture,
    appBaseUrl,
    stateRoot: params.stateRoot,
    timeoutMs: params.timeoutMs,
    dbWrites: false,
    expectedParticipantUserId: fixture.participantUserId!,
    expectedParticipantEmail: fixture.participantEmail,
    facilitatorUserId: fixture.facilitatorUserId,
    facilitatorAuthCookie: fixture.facilitatorAuthCookie,
  });
}

/**
 * Create a temporary namespaced fixture, validate participant access, cleanup.
 * Requires safe local DATABASE_URL + --confirm-local-db-write.
 */
export async function runCreateFixtureParticipantAccess(params: {
  confirmLocalDbWrite: boolean;
  appBaseUrl?: string;
  stateRoot?: string;
  databaseUrl?: string;
  timeoutMs?: number;
}): Promise<TestParticipantAccessResult> {
  const appBaseUrl = (params.appBaseUrl ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const lines: string[] = [];

  try {
    assertLocalDbWriteConfirmation(params.confirmLocalDbWrite);
    assertSafeLocalDatabaseTarget(
      params.databaseUrl ?? process.env.DATABASE_URL,
    );
  } catch (error) {
    const code =
      error instanceof LocalDbSafetyError
        ? error.code
        : "UNSAFE_DATABASE_TARGET";
    return {
      ok: false,
      runId: "none",
      sessionId: "none",
      providerCalls: false,
      dbWrites: false,
      pointerRestored: true,
      lines: [code],
      failureCode: code,
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }

  const runId = newFixtureRunId();
  const paths = getPocRunPaths(runId, params.stateRoot);
  mkdirSync(paths.runDir, { recursive: true });

  let sessionFixture: CreateVoxServerStopPocSessionResult | null = null;
  let cleanupManifest: PocCleanupManifest | null = null;
  let cleaned = false;

  try {
    sessionFixture = await createVoxServerStopPocSession({
      runId,
      confirmLocalDbWrite: true,
      appBaseUrl,
      databaseUrl: params.databaseUrl,
    });
    cleanupManifest = sessionFixture.cleanupManifest;
    writeJsonArtifact(paths.cleanupManifestPath, cleanupManifest);
    writePrewarmFixture(
      {
        runId,
        sessionId: sessionFixture.sessionId,
        facilitatorUserId: sessionFixture.facilitatorUserId,
        facilitatorEmail: sessionFixture.facilitatorEmail,
        facilitatorPassword: sessionFixture.facilitatorPassword,
        facilitatorAuthCookie: sessionFixture.facilitatorAuthCookie,
        participantUserId: sessionFixture.participantUserId,
        participantEmail: sessionFixture.participantEmail,
        participantPassword: sessionFixture.participantPassword,
        participantAuthCookie: sessionFixture.participantAuthCookie,
        facilitatorJoinToken: sessionFixture.facilitatorJoinToken,
        participantJoinToken: sessionFixture.participantJoinToken,
        facilitatorRoomUrl: sessionFixture.facilitatorRoomUrl,
        participantRoomUrl: sessionFixture.participantRoomUrl,
        participantAccountRoomUrl: sessionFixture.participantAccountRoomUrl,
        createdAt: new Date().toISOString(),
      },
      params.stateRoot,
    );

    const fixture = readPrewarmFixture(runId, params.stateRoot)!;
    const access = await runParticipantAccessAgainstFixture({
      runId,
      sessionId: sessionFixture.sessionId,
      fixture,
      appBaseUrl,
      stateRoot: params.stateRoot,
      timeoutMs: params.timeoutMs,
      dbWrites: true,
      expectedParticipantUserId: sessionFixture.participantUserId,
      expectedParticipantEmail: sessionFixture.participantEmail,
      facilitatorUserId: sessionFixture.facilitatorUserId,
      facilitatorAuthCookie: sessionFixture.facilitatorAuthCookie,
    });

    lines.push(...access.lines);

    if (!access.ok) {
      return {
        ...access,
        lines,
        dbWrites: true,
        cleanupManifestPath: paths.cleanupManifestPath,
        details: {
          ...access.details,
          cleanupRetained: true,
          localDatabaseTargetSanitized:
            sessionFixture.localDatabaseTargetSanitized,
          facilitatorAuthUserId: sessionFixture.facilitatorAuth.userId,
          participantAuthUserId: sessionFixture.participantAuth.userId,
          authIdentitiesDiffer:
            sessionFixture.facilitatorAuth.userId !==
            sessionFixture.participantAuth.userId,
        },
      };
    }

    await cleanupPocSessionEntities({
      manifest: cleanupManifest,
      confirmLocalDbWrite: true,
      databaseUrl: params.databaseUrl,
    });
    cleaned = true;
    lines.push("LOCAL_FIXTURE_CLEANED");

    return {
      ok: true,
      runId,
      sessionId: sessionFixture.sessionId,
      providerCalls: false,
      dbWrites: true,
      pointerRestored: access.pointerRestored,
      lines,
      failureCode: null,
      cleanupManifestPath: paths.cleanupManifestPath,
      details: {
        ...access.details,
        cleaned: true,
        localDatabaseTargetSanitized:
          sessionFixture.localDatabaseTargetSanitized,
        facilitatorAuthUserId: sessionFixture.facilitatorAuth.userId,
        participantAuthUserId: sessionFixture.participantAuth.userId,
        authIdentitiesDiffer:
          sessionFixture.facilitatorAuth.userId !==
          sessionFixture.participantAuth.userId,
        participantRole: sessionFixture.participantAuth.role,
        selectionSource: "POC_STATE",
      },
    };
  } catch (error) {
    if (cleanupManifest && !cleaned) {
      writeJsonArtifact(paths.cleanupManifestPath, cleanupManifest);
    }
    const message = error instanceof Error ? error.message : String(error);
    lines.push("PARTICIPANT_ACCESS_DENIED");
    return {
      ok: false,
      runId,
      sessionId: sessionFixture?.sessionId ?? "unknown",
      providerCalls: false,
      dbWrites: Boolean(sessionFixture),
      pointerRestored: true,
      lines,
      failureCode: "PARTICIPANT_ACCESS_DENIED",
      cleanupManifestPath: cleanupManifest
        ? paths.cleanupManifestPath
        : null,
      details: {
        reason: message.slice(0, 240),
        cleanupRetained: Boolean(cleanupManifest && !cleaned),
      },
    };
  }
}

export function printTestParticipantAccessResult(
  result: TestParticipantAccessResult,
): void {
  for (const line of result.lines) console.log(line);
  if (!result.ok && result.failureCode) {
    const already = result.lines.includes(result.failureCode);
    if (!already) console.log(result.failureCode);
  }
  console.log(
    JSON.stringify(
      {
        runId: result.runId,
        sessionId: result.sessionId,
        providerCalls: result.providerCalls,
        dbWrites: result.dbWrites,
        pointerRestored: result.pointerRestored,
        failureCode: result.failureCode,
        cleanupManifestPath: result.cleanupManifestPath ?? null,
        details: result.details,
      },
      null,
      2,
    ),
  );
}

/** Test helper: restore semantics for pointer swap. */
export function restorePointerAfterTest(params: {
  previous: PocCurrentPointer | null;
  stateRoot?: string;
}): void {
  if (params.previous) {
    activatePocRun({
      runId: params.previous.runId,
      linkedSessionId: params.previous.linkedSessionId,
      stateRoot: params.stateRoot,
      activatedAt: params.previous.activatedAt,
    });
  } else {
    clearCurrentPointer(params.stateRoot);
  }
}
