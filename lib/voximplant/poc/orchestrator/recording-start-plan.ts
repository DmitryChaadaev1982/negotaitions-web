/**
 * Pure recording-start plan helpers + HTTP request (no Prisma import).
 * Provider-free DB fixture exercise lives in recording-start-fixture.ts.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { RecordingControlMessage } from "@/lib/voximplant/scenario-messages";
import { getPocRunPaths } from "@/lib/voximplant/poc/poc-run-store";

export type RecordingStartFailureCode =
  | "RECORDING_START_REQUEST_NOT_SENT"
  | "RECORDING_START_HTTP_ERROR"
  | "RECORDING_START_UNAUTHORIZED"
  | "RECORDING_START_STALE_CONNECTION"
  | "RECORDING_START_INVALID_SESSION_STATE"
  | "RECORDING_START_OPERATION_ID_MISSING"
  | "RECORDING_START_OPERATION_MISMATCH"
  | "RECORDING_START_RELAY_NOT_CREATED"
  | "RECORDING_START_BROWSER_COMMAND_NOT_CLAIMED"
  | "RECORDING_START_BROWSER_CONTEXT_MISMATCH"
  | "RECORDING_START_BROWSER_CALL_NOT_FOUND"
  | "RECORDING_START_BROWSER_CALL_NOT_CONNECTED"
  | "RECORDING_START_BROWSER_SEND_NOT_INVOKED"
  | "RECORDING_START_BROWSER_SEND_FAILED"
  | "RECORDING_START_SCENARIO_REJECTED"
  | "RECORDING_START_PROVIDER_MESSAGE_NOT_RECEIVED"
  | "RECORDING_START_APP_STATE_TIMEOUT"
  | "RECORDING_START_BOTH_JOINS_REQUIRED"
  | "RECORDING_START_FAILED";

export type RecordingStartEvidence = {
  operationId: string | null;
  operationIdFingerprint: string | null;
  recordingStartRequestedAt: string | null;
  recordingStartResponseAt: string | null;
  recordingStartHttpStatus: number | null;
  recordingStartApplicationCode: string | null;
  recordingStartAuthorized: boolean;
  recordingRelayCreatedAt: string | null;
  recordingBrowserCommandClaimedAt: string | null;
  recordingBrowserCommandReceivedAt: string | null;
  recordingBrowserContextRole: string | null;
  recordingBrowserContextId: string | null;
  recordingBrowserCallReferenceFound: boolean;
  recordingBrowserCallId: string | null;
  recordingBrowserCallState: string | null;
  recordingBrowserSendMessageInvokedAt: string | null;
  recordingBrowserSendMessageCompletedAt: string | null;
  recordingBrowserSendMessageErrorCode: string | null;
  /**
   * @deprecated Use recordingBrowserSendMessageCompletedAt.
   * Retained for backward compatibility with legacy tooling.
   */
  recordingBrowserCommandSentAt: string | null;
  recordingProviderCommandReceivedAt: string | null;
  recorderCreatedAt: string | null;
  recordingProviderStartedAt: string | null;
  recordingAppActiveAt: string | null;
  relayOwnerRole: string | null;
  relayOwnerParticipantId: string | null;
  relayOwnerConnectionId: string | null;
  relayClaimedAt: string | null;
  relayConsumedAt: string | null;
  recordingStartFailureReason: RecordingStartFailureCode | string | null;
  conferenceName: string | null;
  scenarioMessageAction: string | null;
  scenarioMessageType: string | null;
  /**
   * @deprecated Use operationIdFingerprint.
   * requestId is the operationId for recording start.
   */
  requestIdFingerprint: string | null;
};

export function emptyRecordingStartEvidence(
  conferenceName: string | null = null,
): RecordingStartEvidence {
  return {
    operationId: null,
    operationIdFingerprint: null,
    recordingStartRequestedAt: null,
    recordingStartResponseAt: null,
    recordingStartHttpStatus: null,
    recordingStartApplicationCode: null,
    recordingStartAuthorized: false,
    recordingRelayCreatedAt: null,
    recordingBrowserCommandClaimedAt: null,
    recordingBrowserCommandReceivedAt: null,
    recordingBrowserContextRole: null,
    recordingBrowserContextId: null,
    recordingBrowserCallReferenceFound: false,
    recordingBrowserCallId: null,
    recordingBrowserCallState: null,
    recordingBrowserSendMessageInvokedAt: null,
    recordingBrowserSendMessageCompletedAt: null,
    recordingBrowserSendMessageErrorCode: null,
    recordingBrowserCommandSentAt: null,
    recordingProviderCommandReceivedAt: null,
    recorderCreatedAt: null,
    recordingProviderStartedAt: null,
    recordingAppActiveAt: null,
    relayOwnerRole: null,
    relayOwnerParticipantId: null,
    relayOwnerConnectionId: null,
    relayClaimedAt: null,
    relayConsumedAt: null,
    recordingStartFailureReason: null,
    conferenceName,
    scenarioMessageAction: null,
    scenarioMessageType: null,
    requestIdFingerprint: null,
  };
}

export function fingerprintRequestId(
  requestId: string | null | undefined,
): string | null {
  if (!requestId || typeof requestId !== "string") return null;
  return `sha256:${createHash("sha256").update(requestId).digest("hex").slice(0, 12)}`;
}

export function isValidBrowserStartCommand(
  message: RecordingControlMessage | null | undefined,
  expected: { sessionId: string; conferenceName?: string | null },
): boolean {
  if (!message || typeof message !== "object") return false;
  if (message.type !== "recording_control") return false;
  if (message.action !== "start") return false;
  if (!message.requestId || typeof message.requestId !== "string") return false;
  if (message.sessionId !== expected.sessionId) return false;
  if (
    expected.conferenceName &&
    message.conferenceName &&
    message.conferenceName !== expected.conferenceName
  ) {
    return false;
  }
  return true;
}

export function classifyRecordingStartFailure(params: {
  requestSent: boolean;
  httpStatus: number | null;
  applicationCode?: string | null;
  errorText?: string | null;
  authorized?: boolean;
  scenarioMessagePresent?: boolean;
  browserCommandClaimed?: boolean;
  browserContextMatch?: boolean;
  browserCallFound?: boolean;
  browserCallConnected?: boolean;
  browserSendInvoked?: boolean;
  browserSendCompleted?: boolean;
  browserSendErrorCode?: string | null;
  providerMessageReceived?: boolean;
  providerStarted?: boolean;
  appActive?: boolean;
  bothJoined?: boolean;
  operationIdPresent?: boolean;
  operationIdMatched?: boolean;
}): RecordingStartFailureCode {
  if (params.bothJoined === false) {
    return "RECORDING_START_BOTH_JOINS_REQUIRED";
  }
  if (params.operationIdPresent === false) {
    return "RECORDING_START_OPERATION_ID_MISSING";
  }
  if (params.operationIdMatched === false) {
    return "RECORDING_START_OPERATION_MISMATCH";
  }
  if (!params.requestSent) {
    return "RECORDING_START_REQUEST_NOT_SENT";
  }
  if (params.httpStatus === 403 || params.authorized === false) {
    return "RECORDING_START_UNAUTHORIZED";
  }
  if (
    params.httpStatus === 409 &&
    (params.applicationCode === "STALE_CONNECTION" ||
      /stale/i.test(params.errorText ?? ""))
  ) {
    return "RECORDING_START_STALE_CONNECTION";
  }
  if (
    params.httpStatus === 409 ||
    params.applicationCode === "ROOM_CLOSED" ||
    params.applicationCode === "EVENT_CLOSED" ||
    params.applicationCode === "DEBRIEF_RECORDING_CONTROL_DENIED"
  ) {
    return "RECORDING_START_INVALID_SESSION_STATE";
  }
  if (params.httpStatus != null && params.httpStatus >= 400) {
    return "RECORDING_START_HTTP_ERROR";
  }
  if (!params.scenarioMessagePresent) {
    return "RECORDING_START_RELAY_NOT_CREATED";
  }
  if (params.browserCommandClaimed === false) {
    return "RECORDING_START_BROWSER_COMMAND_NOT_CLAIMED";
  }
  if (params.browserContextMatch === false) {
    return "RECORDING_START_BROWSER_CONTEXT_MISMATCH";
  }
  if (params.browserCallFound === false) {
    return "RECORDING_START_BROWSER_CALL_NOT_FOUND";
  }
  if (params.browserCallConnected === false) {
    return "RECORDING_START_BROWSER_CALL_NOT_CONNECTED";
  }
  if (params.browserSendInvoked === false) {
    return "RECORDING_START_BROWSER_SEND_NOT_INVOKED";
  }
  if (
    params.browserSendCompleted === false ||
    (params.browserSendErrorCode != null && params.browserSendErrorCode !== "")
  ) {
    return "RECORDING_START_BROWSER_SEND_FAILED";
  }
  if (params.providerMessageReceived === false) {
    return "RECORDING_START_PROVIDER_MESSAGE_NOT_RECEIVED";
  }
  if (params.providerStarted === false) {
    return "RECORDING_START_PROVIDER_MESSAGE_NOT_RECEIVED";
  }
  if (params.appActive === false) {
    return "RECORDING_START_APP_STATE_TIMEOUT";
  }
  return "RECORDING_START_FAILED";
}

export function writeRecordingStartArtifact(
  runId: string,
  evidence: RecordingStartEvidence,
  stateRoot?: string,
): string {
  const paths = getPocRunPaths(runId, stateRoot);
  const path = join(paths.runDir, "recording-start.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}

export type RecordingStartHttpResult = {
  ok: boolean;
  failureCode: RecordingStartFailureCode | null;
  evidence: RecordingStartEvidence;
  scenarioMessage: RecordingControlMessage | null;
  recordingStatus: string | null;
  httpStatus: number;
  applicationCode: string | null;
};

export async function requestRecordingStartViaHttp(params: {
  appBaseUrl: string;
  sessionId: string;
  facilitatorAuthCookie: string;
  facilitatorJoinToken: string;
  connectionId?: string | null;
  conferenceName?: string | null;
  operationId?: string | null;
  requireOperationId?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<RecordingStartHttpResult> {
  const evidence = emptyRecordingStartEvidence(params.conferenceName ?? null);
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = `${params.appBaseUrl.replace(/\/$/, "")}/api/sessions/${params.sessionId}/recording-control`;

  evidence.recordingStartRequestedAt = new Date().toISOString();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: params.facilitatorAuthCookie,
      },
      body: JSON.stringify({
        action: "start",
        recordingConsentConfirmed: true,
        joinToken: params.facilitatorJoinToken,
        ...(params.operationId?.trim()
          ? { operationId: params.operationId.trim() }
          : {}),
        ...(params.connectionId
          ? { connectionId: params.connectionId }
          : {}),
      }),
    });
  } catch {
    evidence.recordingStartResponseAt = new Date().toISOString();
    evidence.recordingStartFailureReason = "RECORDING_START_REQUEST_NOT_SENT";
    return {
      ok: false,
      failureCode: "RECORDING_START_REQUEST_NOT_SENT",
      evidence,
      scenarioMessage: null,
      recordingStatus: null,
      httpStatus: 0,
      applicationCode: null,
    };
  }

  evidence.recordingStartResponseAt = new Date().toISOString();
  evidence.recordingStartHttpStatus = response.status;

  const json = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    code?: string;
    scenarioMessage?: RecordingControlMessage;
    recording?: { status?: string } | null;
  } | null;

  evidence.recordingStartApplicationCode = json?.code ?? null;
  const scenarioMessage = json?.scenarioMessage ?? null;
  const recordingStatus = json?.recording?.status ?? null;
  const expectedOperationId = params.operationId?.trim() || null;

  if (params.requireOperationId && !expectedOperationId) {
    evidence.recordingStartFailureReason = "RECORDING_START_OPERATION_ID_MISSING";
    return {
      ok: false,
      failureCode: "RECORDING_START_OPERATION_ID_MISSING",
      evidence,
      scenarioMessage,
      recordingStatus,
      httpStatus: response.status,
      applicationCode: json?.code ?? null,
    };
  }

  if (response.status === 403) {
    evidence.recordingStartAuthorized = false;
    evidence.recordingStartFailureReason = "RECORDING_START_UNAUTHORIZED";
    return {
      ok: false,
      failureCode: "RECORDING_START_UNAUTHORIZED",
      evidence,
      scenarioMessage,
      recordingStatus,
      httpStatus: response.status,
      applicationCode: json?.code ?? null,
    };
  }

  if (response.status === 409 && json?.code === "STALE_CONNECTION") {
    evidence.recordingStartAuthorized = true;
    evidence.recordingStartFailureReason = "RECORDING_START_STALE_CONNECTION";
    return {
      ok: false,
      failureCode: "RECORDING_START_STALE_CONNECTION",
      evidence,
      scenarioMessage,
      recordingStatus,
      httpStatus: response.status,
      applicationCode: json.code,
    };
  }

  if (!response.ok) {
    const failureCode = classifyRecordingStartFailure({
      requestSent: true,
      httpStatus: response.status,
      applicationCode: json?.code,
      errorText: json?.error,
    });
    evidence.recordingStartFailureReason = failureCode;
    return {
      ok: false,
      failureCode,
      evidence,
      scenarioMessage,
      recordingStatus,
      httpStatus: response.status,
      applicationCode: json?.code ?? null,
    };
  }

  evidence.recordingStartAuthorized = true;

  if (!scenarioMessage) {
    evidence.recordingStartFailureReason = "RECORDING_START_RELAY_NOT_CREATED";
    return {
      ok: false,
      failureCode: "RECORDING_START_RELAY_NOT_CREATED",
      evidence,
      scenarioMessage: null,
      recordingStatus,
      httpStatus: response.status,
      applicationCode: json?.code ?? null,
    };
  }

  evidence.recordingRelayCreatedAt = evidence.recordingStartResponseAt;
  evidence.scenarioMessageAction = scenarioMessage.action;
  evidence.scenarioMessageType = scenarioMessage.type;
  evidence.operationId = scenarioMessage.requestId?.trim() || null;
  evidence.operationIdFingerprint = fingerprintRequestId(evidence.operationId);
  evidence.requestIdFingerprint = evidence.operationIdFingerprint;

  if (!evidence.operationId) {
    evidence.recordingStartFailureReason = "RECORDING_START_OPERATION_ID_MISSING";
    return {
      ok: false,
      failureCode: "RECORDING_START_OPERATION_ID_MISSING",
      evidence,
      scenarioMessage,
      recordingStatus,
      httpStatus: response.status,
      applicationCode: json?.code ?? null,
    };
  }
  if (expectedOperationId && evidence.operationId !== expectedOperationId) {
    evidence.recordingStartFailureReason = "RECORDING_START_OPERATION_MISMATCH";
    return {
      ok: false,
      failureCode: "RECORDING_START_OPERATION_MISMATCH",
      evidence,
      scenarioMessage,
      recordingStatus,
      httpStatus: response.status,
      applicationCode: json?.code ?? null,
    };
  }

  const commandValid = isValidBrowserStartCommand(scenarioMessage, {
    sessionId: params.sessionId,
    conferenceName: params.conferenceName,
  });
  if (!commandValid) {
    evidence.recordingStartFailureReason = "RECORDING_START_SCENARIO_REJECTED";
    return {
      ok: false,
      failureCode: "RECORDING_START_SCENARIO_REJECTED",
      evidence,
      scenarioMessage,
      recordingStatus,
      httpStatus: response.status,
      applicationCode: json?.code ?? null,
    };
  }

  return {
    ok: true,
    failureCode: null,
    evidence,
    scenarioMessage,
    recordingStatus,
    httpStatus: response.status,
    applicationCode: json?.code ?? null,
  };
}

export function recordingStartArtifactExists(
  runId: string,
  stateRoot?: string,
): boolean {
  const paths = getPocRunPaths(runId, stateRoot);
  return existsSync(join(paths.runDir, "recording-start.json"));
}
