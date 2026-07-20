/**
 * Provider-free recording-start fixture exercise.
 * Creates a local fixture, claims a lease via SQL, exercises the real
 * /recording-control HTTP route with facilitator cookie + joinToken, validates
 * relay/command payload, then stops before any WebSDK/provider send.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";

import { Pool } from "pg";

import {
  cleanupPocSessionEntities,
  createVoxServerStopPocSession,
  type CreateVoxServerStopPocSessionResult,
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
  writeJsonArtifact,
} from "@/lib/voximplant/poc/poc-run-store";
import { POC_CONFERENCE_NAME_PREFIX } from "@/lib/voximplant/poc/poc-safety";
import {
  createEmptyPocState,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";
import { fingerprintControlUrl } from "@/lib/voximplant/poc/url-fingerprint";

import {
  emptyRecordingStartEvidence,
  isValidBrowserStartCommand,
  requestRecordingStartViaHttp,
  writeRecordingStartArtifact,
  type RecordingStartEvidence,
} from "./recording-start-plan";

export * from "./recording-start-plan";

export type ProviderFreeRecordingStartResult = {
  ok: boolean;
  runId: string;
  sessionId: string;
  providerCalls: false;
  dbWrites: boolean;
  lines: string[];
  failureCode: string | null;
  evidence: RecordingStartEvidence;
  details: Record<string, unknown>;
};

function newFixtureRunId(): string {
  return `run-${Date.now()}-${randomBytes(3).toString("hex")}`;
}

async function claimFacilitatorLeaseViaSql(params: {
  sessionId: string;
  userId: string;
  connectionId: string;
  databaseUrl: string;
}): Promise<boolean> {
  const pool = new Pool({ connectionString: params.databaseUrl });
  const client = await pool.connect();
  try {
    const id = `src_${randomBytes(8).toString("hex")}`;
    await client.query(
      `INSERT INTO "SessionRoomConnection"
         ("id", "sessionId", "userId", "connectionId", "role", "leaseVersion",
          "expiresAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'FACILITATOR', 1, NOW() + INTERVAL '1 hour', NOW())`,
      [id, params.sessionId, params.userId, params.connectionId],
    );
    return true;
  } catch {
    return false;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

async function cleanupRecordingRows(params: {
  sessionId: string;
  databaseUrl: string;
}): Promise<void> {
  const pool = new Pool({ connectionString: params.databaseUrl });
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM "Recording" WHERE "sessionId" = $1`, [
      params.sessionId,
    ]);
    await client.query(
      `DELETE FROM "SessionRoomConnection" WHERE "sessionId" = $1`,
      [params.sessionId],
    );
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

/**
 * Provider-free recording-start plan test.
 * Exercises real recording-control HTTP authorization + dispatch response.
 */
export async function runProviderFreeRecordingStartTest(params: {
  confirmLocalDbWrite: boolean;
  appBaseUrl?: string;
  stateRoot?: string;
  retainFixtureOnFailure?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ProviderFreeRecordingStartResult> {
  const lines: string[] = [];
  const runId = newFixtureRunId();
  const details: Record<string, unknown> = { runId };
  let sessionFixture: CreateVoxServerStopPocSessionResult | null = null;
  let evidence = emptyRecordingStartEvidence();
  const previousPointer = readCurrentPointer(params.stateRoot);
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";

  const restorePointer = () => {
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
  };

  try {
    assertLocalDbWriteConfirmation(params.confirmLocalDbWrite);
    assertSafeLocalDatabaseTarget(databaseUrl);

    sessionFixture = await createVoxServerStopPocSession({
      runId,
      confirmLocalDbWrite: params.confirmLocalDbWrite,
      appBaseUrl: params.appBaseUrl ?? "http://localhost:3000",
    });
    details.sessionId = sessionFixture.sessionId;
    details.dbWrites = true;

    const paths = getPocRunPaths(runId, params.stateRoot);
    mkdirSync(paths.runDir, { recursive: true });
    writeJsonArtifact(paths.cleanupManifestPath, sessionFixture.cleanupManifest);

    const conferenceName = `${POC_CONFERENCE_NAME_PREFIX}${runId}`;
    evidence = emptyRecordingStartEvidence(conferenceName);

    const tempState = createEmptyPocState({
      pocId: runId,
      conferenceName,
      linkedSessionId: sessionFixture.sessionId,
    });
    writePocState(
      {
        ...tempState,
        runtimeStatus: "ACTIVE",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        callSessionHistoryId: "test-recording-start-no-provider",
        controlUrlFingerprint: fingerprintControlUrl(
          "https://example.invalid/request/test",
        ),
        hasControlUrl: true,
      },
      params.stateRoot,
    );
    activatePocRun({
      runId,
      linkedSessionId: sessionFixture.sessionId,
      stateRoot: params.stateRoot,
    });

    const connectionId = `poc-rec-start-${randomBytes(8).toString("hex")}`;
    const leased = await claimFacilitatorLeaseViaSql({
      sessionId: sessionFixture.sessionId,
      userId: sessionFixture.facilitatorUserId,
      connectionId,
      databaseUrl,
    });
    if (!leased) {
      evidence.recordingStartFailureReason = "RECORDING_START_STALE_CONNECTION";
      lines.push("RECORDING_START_STALE_CONNECTION");
      writeRecordingStartArtifact(runId, evidence, params.stateRoot);
      return {
        ok: false,
        runId,
        sessionId: sessionFixture.sessionId,
        providerCalls: false,
        dbWrites: true,
        lines,
        failureCode: "RECORDING_START_STALE_CONNECTION",
        evidence,
        details: { ...details, connectionLeaseActive: false },
      };
    }

    // Real recording-control route (application service) — no WebSDK/provider.
    const httpStart = await requestRecordingStartViaHttp({
      appBaseUrl: params.appBaseUrl ?? "http://localhost:3000",
      sessionId: sessionFixture.sessionId,
      facilitatorAuthCookie: sessionFixture.facilitatorAuthCookie,
      facilitatorJoinToken: sessionFixture.facilitatorJoinToken,
      connectionId,
      conferenceName,
      fetchImpl: params.fetchImpl,
    });
    evidence = { ...httpStart.evidence, conferenceName };

    if (httpStart.failureCode === "RECORDING_START_UNAUTHORIZED") {
      lines.push("RECORDING_START_UNAUTHORIZED");
    } else if (httpStart.evidence.recordingStartAuthorized) {
      lines.push("RECORDING_START_AUTHORIZED");
    }

    if (!httpStart.ok) {
      lines.push(httpStart.failureCode ?? "RECORDING_START_FAILED");
      writeRecordingStartArtifact(runId, evidence, params.stateRoot);
      await cleanupPocSessionEntities({
        manifest: sessionFixture.cleanupManifest,
        confirmLocalDbWrite: params.confirmLocalDbWrite,
      });
      await cleanupRecordingRows({
        sessionId: sessionFixture.sessionId,
        databaseUrl,
      });
      restorePointer();
      lines.push("LOCAL_FIXTURE_CLEANED");
      return {
        ok: false,
        runId,
        sessionId: sessionFixture.sessionId,
        providerCalls: false,
        dbWrites: true,
        lines,
        failureCode: httpStart.failureCode,
        evidence,
        details: {
          ...details,
          httpStatus: httpStart.httpStatus,
          hint:
            httpStart.failureCode === "RECORDING_START_REQUEST_NOT_SENT"
              ? "Ensure Next.js app is running at appBaseUrl"
              : undefined,
        },
      };
    }

    lines.push("RECORDING_START_REQUEST_ACCEPTED");
    lines.push("RECORDING_START_RELAY_CREATED");

    const claimable = isValidBrowserStartCommand(httpStart.scenarioMessage, {
      sessionId: sessionFixture.sessionId,
      conferenceName,
    });
    if (!claimable) {
      evidence.recordingStartFailureReason = "RECORDING_START_RELAY_NOT_CLAIMED";
      lines.push("RECORDING_START_RELAY_NOT_CLAIMED");
      writeRecordingStartArtifact(runId, evidence, params.stateRoot);
      await cleanupPocSessionEntities({
        manifest: sessionFixture.cleanupManifest,
        confirmLocalDbWrite: params.confirmLocalDbWrite,
      });
      await cleanupRecordingRows({
        sessionId: sessionFixture.sessionId,
        databaseUrl,
      });
      restorePointer();
      lines.push("LOCAL_FIXTURE_CLEANED");
      return {
        ok: false,
        runId,
        sessionId: sessionFixture.sessionId,
        providerCalls: false,
        dbWrites: true,
        lines,
        failureCode: "RECORDING_START_RELAY_NOT_CLAIMED",
        evidence,
        details: {
          ...details,
          scenarioConferenceName: httpStart.scenarioMessage?.conferenceName,
          expectedConferenceName: conferenceName,
        },
      };
    }

    evidence.recordingRelayClaimedAt = new Date().toISOString();
    lines.push("RECORDING_START_RELAY_CLAIMABLE");
    lines.push("RECORDING_START_BROWSER_COMMAND_VALID");
    lines.push("RECORDING_START_PLAN_TEST_PASS");

    details.recordingStatus = httpStart.recordingStatus;
    details.providerCalls = false;
    details.scenarioMessagePresent = true;
    details.connectionLeaseActive = true;
    // Intentionally do NOT set recordingBrowserCommandSentAt — stop before send.

    writeRecordingStartArtifact(runId, evidence, params.stateRoot);

    await cleanupPocSessionEntities({
      manifest: sessionFixture.cleanupManifest,
      confirmLocalDbWrite: params.confirmLocalDbWrite,
    });
    await cleanupRecordingRows({
      sessionId: sessionFixture.sessionId,
      databaseUrl,
    });

    restorePointer();
    lines.push("LOCAL_FIXTURE_CLEANED");

    return {
      ok: true,
      runId,
      sessionId: sessionFixture.sessionId,
      providerCalls: false,
      dbWrites: true,
      lines,
      failureCode: null,
      evidence,
      details,
    };
  } catch (error) {
    const code =
      error instanceof LocalDbSafetyError
        ? error.code
        : error instanceof Error
          ? error.message
          : String(error);
    evidence.recordingStartFailureReason = code;
    lines.push(code);
    if (sessionFixture) {
      writeRecordingStartArtifact(runId, evidence, params.stateRoot);
      if (!params.retainFixtureOnFailure) {
        await cleanupPocSessionEntities({
          manifest: sessionFixture.cleanupManifest,
          confirmLocalDbWrite: params.confirmLocalDbWrite,
        }).catch(() => null);
        await cleanupRecordingRows({
          sessionId: sessionFixture.sessionId,
          databaseUrl,
        }).catch(() => null);
        lines.push("LOCAL_FIXTURE_CLEANED");
      }
    }
    restorePointer();
    return {
      ok: false,
      runId,
      sessionId: sessionFixture?.sessionId ?? "",
      providerCalls: false,
      dbWrites: Boolean(sessionFixture),
      lines,
      failureCode: code,
      evidence,
      details: {
        ...details,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function printProviderFreeRecordingStartResult(
  result: ProviderFreeRecordingStartResult,
): void {
  for (const line of result.lines) {
    console.log(line);
  }
  if (!result.ok) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          failureCode: result.failureCode,
          runId: result.runId,
          providerCalls: result.providerCalls,
          dbWrites: result.dbWrites,
        },
        null,
        2,
      ),
    );
  }
}
