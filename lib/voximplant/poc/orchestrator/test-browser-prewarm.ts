/**
 * Prewarm-only local validation against an existing failed/retained POC run.
 * - No StartConference / provider calls
 * - No createVoxServerStopPocSession / POC fixture DB writes
 * - Uses local prewarm fixture cookie when present; otherwise UI login recovery
 */

import { existsSync, readFileSync } from "node:fs";

import { Pool } from "pg";

import {
  POC_FACILITATOR_PASSWORD,
  type PocCleanupManifest,
} from "@/lib/voximplant/poc/create-poc-session";
import { assertSafeLocalDatabaseTarget } from "@/lib/voximplant/poc/local-db-safety";
import { getPocRunPaths } from "@/lib/voximplant/poc/poc-run-store";

import { playwrightBrowserPrewarm } from "./browser-join";
import {
  buildFacilitatorEmailForRun,
  readPrewarmFixture,
  writePrewarmFixture,
  type PocPrewarmFixture,
} from "./prewarm-fixture";

export type TestBrowserPrewarmResult = {
  ok: boolean;
  runId: string;
  sessionId: string;
  providerCalls: false;
  dbWrites: false;
  facilitator: {
    result: "FACILITATOR_AUTH_ACCEPTED" | "FACILITATOR_AUTH_FAILED";
    reachedStage: string;
    failureCode: string | null;
    authNestedFailureCode: string | null;
    authenticationStrategy: string | null;
    finalPagePath: string | null;
    finalHost: string | null;
    redirectToLogin: boolean;
    authenticatedUserMatch: boolean;
    sessionAccess: boolean;
  };
  participant: {
    result: "PARTICIPANT_CONTEXT_READY" | "PARTICIPANT_CONTEXT_FAILED";
    reachedStage: string;
    failureCode: string | null;
    inheritedFacilitatorAuth: boolean;
  };
  summary:
    | "BROWSER_PREWARM_PASS"
    | "BROWSER_PREWARM_FAIL";
};

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function loadJoinTokensReadOnly(params: {
  sessionId: string;
  databaseUrl: string;
}): Promise<{ facilitatorJoinToken: string; participantJoinToken: string }> {
  assertSafeLocalDatabaseTarget(params.databaseUrl);
  const pool = new Pool({ connectionString: params.databaseUrl });
  try {
    const result = await pool.query<{
      type: string;
      joinToken: string;
    }>(
      `SELECT type, "joinToken" AS "joinToken"
       FROM "SessionParticipant"
       WHERE "sessionId" = $1`,
      [params.sessionId],
    );
    const fac = result.rows.find((r) => r.type === "FACILITATOR");
    const part = result.rows.find((r) => r.type === "PARTICIPANT");
    if (!fac?.joinToken || !part?.joinToken) {
      throw new Error("JOIN_TOKENS_NOT_FOUND");
    }
    return {
      facilitatorJoinToken: fac.joinToken,
      participantJoinToken: part.joinToken,
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

export async function runTestBrowserPrewarm(params: {
  runId: string;
  appBaseUrl?: string;
  stateRoot?: string;
  timeoutMs?: number;
  databaseUrl?: string;
}): Promise<TestBrowserPrewarmResult> {
  const appBaseUrl = (params.appBaseUrl ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const paths = getPocRunPaths(params.runId, params.stateRoot);
  const report = readJsonFile<{
    sessionId?: string;
    cleanupManifest?: PocCleanupManifest;
  }>(paths.reportPath);
  const cleanup =
    report?.cleanupManifest ??
    readJsonFile<PocCleanupManifest>(paths.cleanupManifestPath);

  const sessionId =
    report?.sessionId ??
    cleanup?.entities.find((e) => e.kind === "Session")?.id;
  const facilitatorUserId = cleanup?.entities.find(
    (e) => e.kind === "User",
  )?.id;

  if (!sessionId || !facilitatorUserId) {
    throw new Error("PREWARM_RUN_FIXTURE_INCOMPLETE");
  }

  let fixture = readPrewarmFixture(params.runId, params.stateRoot);
  const databaseUrl = params.databaseUrl ?? process.env.DATABASE_URL ?? "";

  if (!fixture) {
    const tokens = await loadJoinTokensReadOnly({ sessionId, databaseUrl });
    const email = buildFacilitatorEmailForRun(params.runId);
    fixture = {
      runId: params.runId,
      sessionId,
      facilitatorUserId,
      facilitatorEmail: email,
      facilitatorPassword: POC_FACILITATOR_PASSWORD,
      // Empty cookie → UI_LOGIN recovery (no POC fixture writes).
      facilitatorAuthCookie: "",
      facilitatorJoinToken: tokens.facilitatorJoinToken,
      participantJoinToken: tokens.participantJoinToken,
      facilitatorRoomUrl: `${appBaseUrl}/room/${sessionId}?joinToken=${encodeURIComponent(tokens.facilitatorJoinToken)}`,
      participantRoomUrl: `${appBaseUrl}/room/${sessionId}?joinToken=${encodeURIComponent(tokens.participantJoinToken)}`,
      createdAt: new Date().toISOString(),
    };
  }

  const hasCookie = Boolean(fixture.facilitatorAuthCookie?.includes("auth_session="));
  const hasParticipantCookie = Boolean(
    fixture.participantAuthCookie?.includes("auth_session="),
  );
  const prewarm = await playwrightBrowserPrewarm({
    appBaseUrl,
    sessionId: fixture.sessionId,
    facilitatorRoomUrl: fixture.facilitatorRoomUrl,
    participantRoomUrl: fixture.participantRoomUrl,
    facilitatorAuthCookie: hasCookie ? fixture.facilitatorAuthCookie : null,
    facilitatorUserId: fixture.facilitatorUserId,
    facilitatorEmail: fixture.facilitatorEmail,
    facilitatorPassword: fixture.facilitatorPassword,
    facilitatorAuthStrategy: hasCookie ? "CANONICAL_COOKIE" : "UI_LOGIN",
    participantAuthCookie: hasParticipantCookie
      ? fixture.participantAuthCookie
      : null,
    participantUserId: fixture.participantUserId,
    participantEmail: fixture.participantEmail,
    timeoutMs: params.timeoutMs ?? 45_000,
    runId: params.runId,
    stateRoot: params.stateRoot,
    prewarmOnly: true,
    sessionExists: true,
  });

  // Persist local cookie fixture after successful UI login for later CANONICAL_COOKIE replays.
  if (prewarm.ok && prewarm.facilitatorAuthCookieHeader) {
    const toStore: PocPrewarmFixture = {
      ...fixture,
      facilitatorAuthCookie: prewarm.facilitatorAuthCookieHeader,
    };
    writePrewarmFixture(toStore, params.stateRoot);
  }

  await prewarm.close();

  const nested =
    typeof prewarm.evidence.authNestedFailureCode === "string"
      ? prewarm.evidence.authNestedFailureCode
      : null;
  const strategy =
    typeof prewarm.evidence.facilitatorAuthStrategy === "string"
      ? prewarm.evidence.facilitatorAuthStrategy
      : null;
  const inherited = Boolean(prewarm.evidence.participantInheritedFacilitatorAuth);

  const facilitatorOk = prewarm.ok && prewarm.facilitator.authAccepted;
  const participantOk =
    prewarm.participant.failureCode === null &&
    prewarm.participant.reachedStage !== "BROWSER_NOT_LAUNCHED" &&
    !inherited;

  const result: TestBrowserPrewarmResult = {
    ok: facilitatorOk && participantOk,
    runId: params.runId,
    sessionId,
    providerCalls: false,
    dbWrites: false,
    facilitator: {
      result: facilitatorOk
        ? "FACILITATOR_AUTH_ACCEPTED"
        : "FACILITATOR_AUTH_FAILED",
      reachedStage: prewarm.facilitator.reachedStage,
      failureCode: prewarm.facilitator.failureCode,
      authNestedFailureCode: nested,
      authenticationStrategy: strategy,
      finalPagePath:
        typeof prewarm.evidence.finalPagePath === "string"
          ? prewarm.evidence.finalPagePath
          : prewarm.facilitator.pageUrlPath,
      finalHost:
        typeof prewarm.evidence.finalHost === "string"
          ? prewarm.evidence.finalHost
          : null,
      redirectToLogin: Boolean(prewarm.evidence.redirectToLogin),
      authenticatedUserMatch: Boolean(
        prewarm.evidence.authenticatedUserMatch,
      ),
      sessionAccess: Boolean(prewarm.evidence.sessionAccess),
    },
    participant: {
      result: participantOk
        ? "PARTICIPANT_CONTEXT_READY"
        : "PARTICIPANT_CONTEXT_FAILED",
      reachedStage: prewarm.participant.reachedStage,
      failureCode: prewarm.participant.failureCode,
      inheritedFacilitatorAuth: inherited,
    },
    summary:
      facilitatorOk && participantOk
        ? "BROWSER_PREWARM_PASS"
        : "BROWSER_PREWARM_FAIL",
  };

  return result;
}

export function printTestBrowserPrewarmResult(
  result: TestBrowserPrewarmResult,
): void {
  console.log(result.facilitator.result);
  console.log(result.participant.result);
  console.log(result.summary);
  console.log(
    JSON.stringify(
      {
        runId: result.runId,
        sessionId: result.sessionId,
        providerCalls: result.providerCalls,
        dbWrites: result.dbWrites,
        facilitator: {
          reachedStage: result.facilitator.reachedStage,
          failureCode: result.facilitator.failureCode,
          authNestedFailureCode: result.facilitator.authNestedFailureCode,
          authenticationStrategy: result.facilitator.authenticationStrategy,
          finalPagePath: result.facilitator.finalPagePath,
          finalHost: result.facilitator.finalHost,
          redirectToLogin: result.facilitator.redirectToLogin,
          authenticatedUserMatch: result.facilitator.authenticatedUserMatch,
          sessionAccess: result.facilitator.sessionAccess,
        },
        participant: {
          reachedStage: result.participant.reachedStage,
          failureCode: result.participant.failureCode,
          inheritedFacilitatorAuth:
            result.participant.inheritedFacilitatorAuth,
        },
      },
      null,
      2,
    ),
  );
}
