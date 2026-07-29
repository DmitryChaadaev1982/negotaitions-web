import "server-only";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { scheduleStopRetry } from "@/lib/recording-stop-delivery-policy";
import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import {
  registerSessionVoximplantControlChannel,
  ServerStopRegistrationError,
} from "@/lib/voximplant/server-stop-registration";

type ProviderSessionRegisteredEvent = {
  eventType: "provider_session_registered";
  sessionId: string;
  conferenceName: string;
  providerSessionId: string;
  accessSecureUrl?: string | null;
  controlUrl?: string | null;
  scenarioBuild?: string | null;
  scenarioSource?: string | null;
  ruleIdentity?: string | null;
};

type RecordingStopCommandAcceptedEvent = {
  eventType: "recording_stop_command_accepted";
  sessionId: string;
  conferenceName: string;
  providerSessionId: string;
  operationId: string;
};

type RecordingStoppedEvent = {
  eventType: "recording_stopped";
  sessionId: string;
  conferenceName: string;
  providerSessionId: string;
  operationId: string;
  terminalStatus?: string | null;
};

type RecordingStopFailedEvent = {
  eventType: "recording_stop_failed";
  sessionId: string;
  conferenceName: string;
  providerSessionId: string;
  operationId: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  terminal?: boolean | null;
};

export type ServerStopCallbackEvent =
  | ProviderSessionRegisteredEvent
  | RecordingStopCommandAcceptedEvent
  | RecordingStoppedEvent
  | RecordingStopFailedEvent;

export type ServerStopCallbackHandlerResult = {
  status: number;
  body: {
    ok: boolean;
    eventType: ServerStopCallbackEvent["eventType"];
    accepted?: boolean;
    persisted?: boolean;
    stateScope?: "SESSION_SCOPED";
    duplicate?: boolean;
    retryable?: boolean;
    terminal?: boolean;
    message?: string;
  };
};

export class ServerStopCallbackHandlerError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function assertSessionCorrelation(
  routeSessionId: string,
  payload: ServerStopCallbackEvent,
) {
  if (payload.sessionId !== routeSessionId) {
    throw new ServerStopCallbackHandlerError(
      409,
      "Session correlation mismatch.",
    );
  }
  const expectedConferenceName = buildVoximplantConferenceName(routeSessionId);
  if (payload.conferenceName !== expectedConferenceName) {
    throw new ServerStopCallbackHandlerError(
      409,
      "Conference correlation mismatch.",
    );
  }
}

function normalizeTerminalStatus(input: string | null | undefined) {
  const value = input?.trim();
  return value ? value : "recording_stopped";
}

function resolveStoppedRecordingStatus(current: RecordingStatus): RecordingStatus {
  if (
    current === RecordingStatus.COMPLETED ||
    current === RecordingStatus.PROCESSING
  ) {
    return current;
  }
  return RecordingStatus.STOPPED;
}

function isTerminalProviderFailure(input: RecordingStopFailedEvent) {
  if (input.terminal === true) {
    return true;
  }
  const code = input.failureCode?.trim().toUpperCase() ?? "";
  return (
    code.includes("TERMINAL") ||
    code.includes("NOT_FOUND") ||
    code.includes("MISMATCH")
  );
}

async function getOperationForEvent(input: {
  sessionId: string;
  operationId: string;
  providerSessionId: string;
  conferenceName: string;
}) {
  const operation = await prisma.sessionRecordingStopOperation.findUnique({
    where: { operationId: input.operationId },
    include: {
      recording: {
        select: { id: true, status: true },
      },
    },
  });
  if (!operation || operation.sessionId !== input.sessionId) {
    throw new ServerStopCallbackHandlerError(404, "Operation not found.");
  }

  if (
    operation.providerSessionIdAtCommand &&
    operation.providerSessionIdAtCommand !== input.providerSessionId
  ) {
    throw new ServerStopCallbackHandlerError(
      409,
      "Provider session mismatch for operation correlation.",
    );
  }
  if (
    operation.providerConferenceNameAtCommand &&
    operation.providerConferenceNameAtCommand !== input.conferenceName
  ) {
    throw new ServerStopCallbackHandlerError(
      409,
      "Provider conference mismatch for operation correlation.",
    );
  }
  return operation;
}

async function handleProviderSessionRegistered(
  payload: ProviderSessionRegisteredEvent,
  callbackTimestamp: Date,
): Promise<ServerStopCallbackHandlerResult> {
  try {
    await registerSessionVoximplantControlChannel({
      sessionId: payload.sessionId,
      providerSessionId: payload.providerSessionId,
      conferenceName: payload.conferenceName,
      accessSecureUrl: payload.accessSecureUrl,
      controlUrl: payload.controlUrl,
      scenarioBuild: payload.scenarioBuild,
      scenarioSource: payload.scenarioSource,
      ruleIdentity: payload.ruleIdentity,
      callbackTimestamp,
    });
    return {
      status: 200,
      body: {
        ok: true,
        eventType: payload.eventType,
        accepted: true,
        persisted: true,
        stateScope: "SESSION_SCOPED",
      },
    };
  } catch (error) {
    if (error instanceof ServerStopRegistrationError) {
      if (error.code === "SESSION_NOT_FOUND") {
        throw new ServerStopCallbackHandlerError(404, error.message);
      }
      if (error.code === "SESSION_DELETED") {
        throw new ServerStopCallbackHandlerError(404, error.message);
      }
      throw new ServerStopCallbackHandlerError(409, error.message);
    }
    throw error;
  }
}

async function handleCommandAccepted(
  payload: RecordingStopCommandAcceptedEvent,
  callbackTimestamp: Date,
): Promise<ServerStopCallbackHandlerResult> {
  const operation = await getOperationForEvent({
    sessionId: payload.sessionId,
    operationId: payload.operationId,
    providerSessionId: payload.providerSessionId,
    conferenceName: payload.conferenceName,
  });

  if (operation.commandAcceptedAt) {
    return {
      status: 200,
      body: {
        ok: true,
        eventType: payload.eventType,
        duplicate: true,
      },
    };
  }

  await prisma.sessionRecordingStopOperation.update({
    where: { id: operation.id },
    data: {
      state: "DELIVERING",
      commandAcceptedAt: callbackTimestamp,
      failedAt: null,
      lastError: null,
      lastErrorClass: null,
      nextRetryAt: null,
    },
  });
  const reread = await prisma.sessionRecordingStopOperation.findUnique({
    where: { id: operation.id },
    select: { commandAcceptedAt: true, state: true },
  });
  if (!reread || !reread.commandAcceptedAt || reread.state !== "DELIVERING") {
    throw new ServerStopCallbackHandlerError(
      500,
      "Command acceptance persistence verification failed.",
    );
  }

  return {
    status: 200,
    body: {
      ok: true,
      eventType: payload.eventType,
    },
  };
}

async function handleRecordingStopped(
  payload: RecordingStoppedEvent,
  callbackTimestamp: Date,
): Promise<ServerStopCallbackHandlerResult> {
  const operation = await getOperationForEvent({
    sessionId: payload.sessionId,
    operationId: payload.operationId,
    providerSessionId: payload.providerSessionId,
    conferenceName: payload.conferenceName,
  });

  if (operation.state === "FAILED" && operation.providerTerminalAt) {
    throw new ServerStopCallbackHandlerError(
      409,
      "Operation already finalized as failure.",
    );
  }
  if (operation.state === "DELIVERED" && operation.providerTerminalAt) {
    return {
      status: 200,
      body: {
        ok: true,
        eventType: payload.eventType,
        duplicate: true,
      },
    };
  }

  const providerTerminalStatus = normalizeTerminalStatus(payload.terminalStatus);
  await prisma.$transaction(async (tx) => {
    await tx.sessionRecordingStopOperation.update({
      where: { id: operation.id },
      data: {
        state: "DELIVERED",
        deliveredAt: callbackTimestamp,
        providerTerminalAt: callbackTimestamp,
        providerTerminalStatus,
        providerFailureCode: null,
        providerFailureMessage: null,
        failedAt: null,
        lastError: null,
        lastErrorClass: null,
        nextRetryAt: null,
        lastDeliveryTransport: "voximplant_server_control",
      },
    });

    const nextRecordingStatus = resolveStoppedRecordingStatus(
      operation.recording.status,
    );
    await tx.recording.update({
      where: { id: operation.recordingId },
      data: {
        status: nextRecordingStatus,
        endedAt:
          nextRecordingStatus === RecordingStatus.STOPPED
            ? callbackTimestamp
            : undefined,
      },
    });
  });

  const reread = await prisma.sessionRecordingStopOperation.findUnique({
    where: { id: operation.id },
    select: { state: true, providerTerminalAt: true, providerTerminalStatus: true },
  });
  if (
    !reread ||
    reread.state !== "DELIVERED" ||
    !reread.providerTerminalAt
  ) {
    throw new ServerStopCallbackHandlerError(
      500,
      "Provider terminal stop persistence verification failed.",
    );
  }

  return {
    status: 200,
    body: {
      ok: true,
      eventType: payload.eventType,
    },
  };
}

async function handleRecordingStopFailed(
  payload: RecordingStopFailedEvent,
  callbackTimestamp: Date,
): Promise<ServerStopCallbackHandlerResult> {
  const operation = await getOperationForEvent({
    sessionId: payload.sessionId,
    operationId: payload.operationId,
    providerSessionId: payload.providerSessionId,
    conferenceName: payload.conferenceName,
  });

  if (operation.state === "DELIVERED" && operation.providerTerminalAt) {
    throw new ServerStopCallbackHandlerError(
      409,
      "Operation already finalized as delivered.",
    );
  }

  const failureCode = payload.failureCode?.trim() || "VOXIMPLANT_PROVIDER_FAILED";
  const failureMessage =
    payload.failureMessage?.trim() || "Voximplant provider reported stop failure.";

  const terminal = isTerminalProviderFailure(payload);
  const nextRetryAt = terminal ? null : scheduleStopRetry(operation.attemptCount);

  const existingFailureDuplicate =
    operation.state === "FAILED" &&
    operation.providerFailureCode === failureCode &&
    operation.providerFailureMessage === failureMessage;
  if (existingFailureDuplicate) {
    return {
      status: 200,
      body: {
        ok: true,
        eventType: payload.eventType,
        duplicate: true,
      },
    };
  }

  await prisma.sessionRecordingStopOperation.update({
    where: { id: operation.id },
    data: {
      state: "FAILED",
      failedAt: callbackTimestamp,
      deliveredAt: null,
      providerTerminalAt: callbackTimestamp,
      providerTerminalStatus: "recording_stop_failed",
      providerFailureCode: failureCode,
      providerFailureMessage: failureMessage,
      lastErrorClass: "VOXIMPLANT_PROVIDER_STOP_FAILED",
      lastError: failureMessage,
      nextRetryAt,
      lastDeliveryTransport: "voximplant_server_control",
    },
  });
  const reread = await prisma.sessionRecordingStopOperation.findUnique({
    where: { id: operation.id },
    select: {
      state: true,
      failedAt: true,
      providerFailureCode: true,
      providerFailureMessage: true,
    },
  });
  if (
    !reread ||
    reread.state !== "FAILED" ||
    !reread.failedAt
  ) {
    throw new ServerStopCallbackHandlerError(
      500,
      "Provider failure persistence verification failed.",
    );
  }

  return {
    status: 200,
    body: {
      ok: true,
      eventType: payload.eventType,
    },
  };
}

export async function handleServerStopCallbackEvent(input: {
  routeSessionId: string;
  payload: ServerStopCallbackEvent;
  callbackTimestamp: Date;
}): Promise<ServerStopCallbackHandlerResult> {
  assertSessionCorrelation(input.routeSessionId, input.payload);

  const session = await prisma.session.findUnique({
    where: { id: input.routeSessionId },
    select: { id: true, deletedAt: true },
  });
  if (!session || session.deletedAt) {
    throw new ServerStopCallbackHandlerError(404, "Session not found.");
  }

  if (input.payload.eventType === "provider_session_registered") {
    return handleProviderSessionRegistered(input.payload, input.callbackTimestamp);
  }
  if (input.payload.eventType === "recording_stop_command_accepted") {
    return handleCommandAccepted(input.payload, input.callbackTimestamp);
  }
  if (input.payload.eventType === "recording_stopped") {
    return handleRecordingStopped(input.payload, input.callbackTimestamp);
  }
  return handleRecordingStopFailed(input.payload, input.callbackTimestamp);
}
