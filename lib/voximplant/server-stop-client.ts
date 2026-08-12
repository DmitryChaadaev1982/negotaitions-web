import { randomUUID } from "crypto";

import {
  buildServerStopSignedHeaders,
  VOX_SERVER_STOP_PROTOCOL_VERSION,
} from "@/lib/voximplant/server-stop-callback-signature";
import { VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION } from "@/lib/voximplant/recording-control-signature";

export type VoximplantServerStopTransportResultCode =
  | "TRANSPORT_ACCEPTED"
  | "TRANSPORT_TIMEOUT"
  | "TRANSPORT_NETWORK_FAILED"
  | "TRANSPORT_APPLICATION_REJECTED"
  | "TRANSPORT_RESPONSE_INVALID";

export type VoximplantServerStopScenarioResponse = {
  accepted: boolean;
  reason?: string;
  code?: string;
};

export type VoximplantServerStopTransportResult = {
  code: VoximplantServerStopTransportResultCode;
  httpStatus: number | null;
  scenarioResponse?: VoximplantServerStopScenarioResponse;
  warning?: string;
};

export type VoximplantRecordingAttemptStatus = {
  protocolVersion: string;
  recordingAttemptId: string;
  status:
    | "idle"
    | "starting"
    | "recording"
    | "paused"
    | "resuming"
    | "stopping"
    | "stopped"
    | "error";
  recordingUrl: string | null;
  recordingId: string | null;
  objectKey: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  errorCode: string | null;
  message: string | null;
  terminalConfirmed: boolean;
};

export type VoximplantRecordingStatusQueryResult =
  | {
      code: "STATUS_FOUND";
      httpStatus: number;
      attempt: VoximplantRecordingAttemptStatus;
    }
  | {
      code:
        | "TRANSPORT_TIMEOUT"
        | "TRANSPORT_NETWORK_FAILED"
        | "TRANSPORT_APPLICATION_REJECTED"
        | "TRANSPORT_RESPONSE_INVALID";
      httpStatus: number | null;
      scenarioCode?: string;
      warning?: string;
    };

function parseScenarioResponse(raw: string): VoximplantServerStopScenarioResponse | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.accepted !== "boolean") {
      return null;
    }
    return {
      accepted: candidate.accepted,
      reason:
        typeof candidate.reason === "string" ? candidate.reason : undefined,
      code: typeof candidate.code === "string" ? candidate.code : undefined,
    };
  } catch {
    return null;
  }
}

export async function sendVoximplantServerStopCommand(input: {
  controlUrl: string;
  controlUrlFingerprint: string;
  controlSecret: string;
  timeoutMs: number;
  operationId: string;
  sessionId: string;
  conferenceName: string;
  providerSessionId: string;
  recordingAttemptId?: string;
}): Promise<VoximplantServerStopTransportResult> {
  const nonce = randomUUID();
  const timestampSeconds = Math.floor(Date.now() / 1000);

  const payload = {
    action: "stop_recording",
    protocolVersion: VOX_SERVER_STOP_PROTOCOL_VERSION,
    operationId: input.operationId,
    recordingAttemptId: input.recordingAttemptId ?? null,
    sessionId: input.sessionId,
    conferenceName: input.conferenceName,
    providerSessionId: input.providerSessionId,
    timestamp: new Date(timestampSeconds * 1000).toISOString(),
    nonce,
  };
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signatureHeaders = buildServerStopSignedHeaders({
    rawBody,
    secret: input.controlSecret,
    nonce,
    timestampSeconds,
  });
  const controlUrlWithSignature = new URL(input.controlUrl);
  for (const [key, value] of Object.entries(signatureHeaders)) {
    controlUrlWithSignature.searchParams.set(key, value);
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => {
    abortController.abort();
  }, input.timeoutMs);

  try {
    const response = await fetch(controlUrlWithSignature, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signatureHeaders,
      },
      body: rawBody,
      signal: abortController.signal,
    });

    const responseText = await response.text();
    if (response.status < 200 || response.status >= 300) {
      console.warn(
        JSON.stringify({
          area: "voximplant_server_stop_client",
          event: "transport_application_rejected",
          controlUrlFingerprint: input.controlUrlFingerprint,
          operationId: input.operationId,
          status: response.status,
        }),
      );
      return {
        code: "TRANSPORT_APPLICATION_REJECTED",
        httpStatus: response.status,
        warning: responseText.slice(0, 256) || "Transport application rejected.",
      };
    }

    const parsedScenarioResponse = parseScenarioResponse(responseText);
    if (!parsedScenarioResponse) {
      console.warn(
        JSON.stringify({
          area: "voximplant_server_stop_client",
          event: "transport_response_invalid",
          controlUrlFingerprint: input.controlUrlFingerprint,
          operationId: input.operationId,
          status: response.status,
        }),
      );
      return {
        code: "TRANSPORT_RESPONSE_INVALID",
        httpStatus: response.status,
        warning: "Transport response payload is invalid.",
      };
    }

    console.log(
      JSON.stringify({
        area: "voximplant_server_stop_client",
        event: "transport_accepted",
        controlUrlFingerprint: input.controlUrlFingerprint,
        operationId: input.operationId,
        status: response.status,
      }),
    );
    return {
      code: "TRANSPORT_ACCEPTED",
      httpStatus: response.status,
      scenarioResponse: parsedScenarioResponse,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        code: "TRANSPORT_TIMEOUT",
        httpStatus: null,
        warning: "Transport request timed out.",
      };
    }
    return {
      code: "TRANSPORT_NETWORK_FAILED",
      httpStatus: null,
      warning: error instanceof Error ? error.message : "Transport network failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseRecordingStatusResponse(
  raw: string,
  expectedAttemptId: string,
): VoximplantRecordingAttemptStatus | null {
  try {
    const parsed = JSON.parse(raw) as {
      accepted?: unknown;
      attempt?: Record<string, unknown>;
    };
    const attempt = parsed.attempt;
    if (
      parsed.accepted !== true ||
      !attempt ||
      attempt.recordingAttemptId !== expectedAttemptId ||
      attempt.protocolVersion !==
        VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION ||
      typeof attempt.status !== "string"
    ) {
      return null;
    }
    const allowedStatuses = new Set([
      "idle",
      "starting",
      "recording",
      "paused",
      "resuming",
      "stopping",
      "stopped",
      "error",
    ]);
    if (!allowedStatuses.has(attempt.status)) {
      return null;
    }
    const nullableString = (value: unknown) =>
      typeof value === "string" ? value : null;
    return {
      protocolVersion: attempt.protocolVersion,
      recordingAttemptId: expectedAttemptId,
      status: attempt.status as VoximplantRecordingAttemptStatus["status"],
      recordingUrl: nullableString(attempt.recordingUrl),
      recordingId: nullableString(attempt.recordingId),
      objectKey: nullableString(attempt.objectKey),
      startedAt: nullableString(attempt.startedAt),
      stoppedAt: nullableString(attempt.stoppedAt),
      errorCode: nullableString(attempt.errorCode),
      message: nullableString(attempt.message),
      terminalConfirmed: attempt.terminalConfirmed === true,
    };
  } catch {
    return null;
  }
}

export async function queryVoximplantRecordingAttemptStatus(input: {
  controlUrl: string;
  controlUrlFingerprint: string;
  controlSecret: string;
  timeoutMs: number;
  operationId: string;
  sessionId: string;
  conferenceName: string;
  providerSessionId: string;
  recordingAttemptId: string;
}): Promise<VoximplantRecordingStatusQueryResult> {
  const nonce = randomUUID();
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    action: "get_recording_status",
    protocolVersion: VOX_SERVER_STOP_PROTOCOL_VERSION,
    operationId: input.operationId,
    recordingAttemptId: input.recordingAttemptId,
    sessionId: input.sessionId,
    conferenceName: input.conferenceName,
    providerSessionId: input.providerSessionId,
    timestamp: new Date(timestampSeconds * 1000).toISOString(),
    nonce,
  };
  const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
  const signatureHeaders = buildServerStopSignedHeaders({
    rawBody,
    secret: input.controlSecret,
    nonce,
    timestampSeconds,
  });
  const controlUrlWithSignature = new URL(input.controlUrl);
  for (const [key, value] of Object.entries(signatureHeaders)) {
    controlUrlWithSignature.searchParams.set(key, value);
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), input.timeoutMs);
  try {
    const response = await fetch(controlUrlWithSignature, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signatureHeaders,
      },
      body: rawBody,
      signal: abortController.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      let scenarioCode: string | undefined;
      try {
        const parsed = JSON.parse(responseText) as { error?: unknown };
        scenarioCode =
          typeof parsed.error === "string" ? parsed.error : undefined;
      } catch {
        scenarioCode = undefined;
      }
      return {
        code: "TRANSPORT_APPLICATION_REJECTED",
        httpStatus: response.status,
        scenarioCode,
        warning: scenarioCode ?? "Recording status query was rejected.",
      };
    }

    const attempt = parseRecordingStatusResponse(
      responseText,
      input.recordingAttemptId,
    );
    if (!attempt) {
      return {
        code: "TRANSPORT_RESPONSE_INVALID",
        httpStatus: response.status,
        warning: "Recording status response payload is invalid.",
      };
    }
    console.log(
      JSON.stringify({
        area: "voximplant_recording_reconciliation",
        event: "status_transport_accepted",
        controlUrlFingerprint: input.controlUrlFingerprint,
        operationId: input.operationId,
        recordingAttemptId: input.recordingAttemptId,
      }),
    );
    return {
      code: "STATUS_FOUND",
      httpStatus: response.status,
      attempt,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        code: "TRANSPORT_TIMEOUT",
        httpStatus: null,
        warning: "Recording status query timed out.",
      };
    }
    return {
      code: "TRANSPORT_NETWORK_FAILED",
      httpStatus: null,
      warning:
        error instanceof Error
          ? error.message
          : "Recording status query network failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
