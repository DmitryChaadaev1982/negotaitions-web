/**
 * Provider-free recording-start fixture exercise.
 * Creates a local fixture, claims a lease via SQL, exercises the real
 * /recording-control HTTP route with facilitator cookie + joinToken, validates
 * relay/command payload, then simulates browser send + provider callbacks.
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
import {
  POC_CONFERENCE_NAME_PREFIX,
  POC_EXPECTED_SCENARIO_BUILD,
} from "@/lib/voximplant/poc/poc-safety";
import {
  appendPocCallbackEvent,
  createEmptyPocState,
  readPocState,
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
    const operationId = `recording-start-${runId}`;
    const httpStart = await requestRecordingStartViaHttp({
      appBaseUrl: params.appBaseUrl ?? "http://localhost:3000",
      sessionId: sessionFixture.sessionId,
      facilitatorAuthCookie: sessionFixture.facilitatorAuthCookie,
      facilitatorJoinToken: sessionFixture.facilitatorJoinToken,
      connectionId,
      conferenceName,
      operationId,
      requireOperationId: true,
      fetchImpl: params.fetchImpl,
    });
    evidence = {
      ...httpStart.evidence,
      conferenceName,
      operationId: httpStart.evidence.operationId ?? operationId,
      operationIdFingerprint:
        httpStart.evidence.operationIdFingerprint ??
        httpStart.evidence.requestIdFingerprint,
    };

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
    lines.push("RECORDING_RELAY_CREATED");

    const claimable = isValidBrowserStartCommand(httpStart.scenarioMessage, {
      sessionId: sessionFixture.sessionId,
      conferenceName,
    });
    if (!claimable) {
      evidence.recordingStartFailureReason =
        "RECORDING_START_BROWSER_COMMAND_NOT_CLAIMED";
      lines.push("RECORDING_START_BROWSER_COMMAND_NOT_CLAIMED");
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
        failureCode: "RECORDING_START_BROWSER_COMMAND_NOT_CLAIMED",
        evidence,
        details: {
          ...details,
          scenarioConferenceName: httpStart.scenarioMessage?.conferenceName,
          expectedConferenceName: conferenceName,
        },
      };
    }

    const now = new Date();
    const plus = (ms: number) => new Date(now.getTime() + ms).toISOString();
    evidence.recordingBrowserCommandClaimedAt = plus(0);
    evidence.recordingBrowserCommandReceivedAt = plus(0);
    evidence.recordingBrowserContextRole = "FACILITATOR";
    evidence.recordingBrowserContextId = connectionId.slice(0, 24);
    evidence.recordingBrowserCallReferenceFound = true;
    evidence.recordingBrowserCallReferenceSource = "EXPLICIT_ACTIVE_CALL_REF";
    evidence.recordingBrowserCallConnected = true;
    evidence.recordingBrowserCallIdSanitized = `[id:${connectionId.slice(0, 4)}]`;
    evidence.recordingBrowserCallId = `call-${connectionId.slice(0, 12)}`;
    evidence.recordingBrowserCallState = "connected";
    evidence.recordingBrowserConferenceName = conferenceName;
    evidence.recordingBrowserSendMessageInvokedAt = plus(5);
    evidence.recordingBrowserSendMessageCompletedAt = plus(8);
    evidence.recordingBrowserSendMessageErrorCode = null;
    evidence.recordingBrowserCommandSentAt =
      evidence.recordingBrowserSendMessageCompletedAt;
    evidence.relayOwnerRole = "FACILITATOR";
    evidence.relayOwnerParticipantId = sessionFixture.facilitatorUserId;
    evidence.relayOwnerConnectionId = connectionId.slice(0, 24);
    evidence.relayClaimedAt = plus(0);
    evidence.relayConsumedAt = plus(8);
    lines.push("RECORDING_RELAY_CLAIMED");
    lines.push("BROWSER_CONTEXT_SELECTED");
    lines.push("BROWSER_CALL_REFERENCE_CAPTURED");
    lines.push("BROWSER_CALL_CONNECTED");
    lines.push("BROWSER_SEND_INVOKED");
    lines.push("BROWSER_SEND_COMPLETED");

    const runState = readPocState(params.stateRoot);
    if (!runState || runState.pocId !== runId) {
      throw new Error("fixture_state_missing");
    }
    let nextState = runState;
    const callbackBase = {
      action: "start",
      operationId,
      conferenceName,
      callSessionHistoryId: runState.providerSessionId ?? runState.callSessionHistoryId,
      recorderState: "exists",
      errorCode: null,
      sourceBrowserCallId: evidence.recordingBrowserCallId,
      scenarioBuild: POC_EXPECTED_SCENARIO_BUILD,
      routingRuleIdentity: "neg-conf-server-stop-poc-rule",
      signatureVerified: true,
    };
    nextState = appendPocCallbackEvent(
      nextState,
      {
        ...callbackBase,
        eventType: "recording_command_received",
        receivedAt: plus(20),
      },
      `fixture-${operationId}-command`,
    );
    evidence.recordingProviderCommandReceivedAt = plus(20);
    lines.push("PROVIDER_COMMAND_RECEIVED");
    nextState = appendPocCallbackEvent(
      nextState,
      {
        ...callbackBase,
        eventType: "recorder_created",
        receivedAt: plus(30),
      },
      `fixture-${operationId}-recorder`,
    );
    evidence.recorderCreatedAt = plus(30);
    lines.push("RECORDER_CREATED");
    nextState = appendPocCallbackEvent(
      nextState,
      {
        ...callbackBase,
        eventType: "recording_started",
        recorderState: "recording_started",
        receivedAt: plus(40),
      },
      `fixture-${operationId}-started`,
    );
    evidence.recordingProviderStartedAt = plus(40);
    evidence.recordingAppActiveAt = plus(40);
    writePocState(nextState, params.stateRoot);
    lines.push("RECORDING_STARTED");
    lines.push("RECORDING_START_FIXTURE_PASS");

    details.recordingStatus = httpStart.recordingStatus;
    details.providerCalls = false;
    details.scenarioMessagePresent = true;
    details.connectionLeaseActive = true;
    details.operationId = operationId;

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
