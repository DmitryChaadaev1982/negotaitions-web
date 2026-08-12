import {
  NegotiationState,
  ParticipantType,
  RecordingStatus,
  TrainingEventStatus,
  type SessionParticipant,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  isTerminalStopRetryErrorClass,
  resolveVoxRelayFailure,
} from "@/lib/recording-stop-delivery-policy";
import { buildVoximplantRecordingDispatch } from "@/lib/voximplant/recording-dispatch";
import type { RecordingControlMessage } from "@/lib/voximplant/scenario-messages";
import { getVoximplantServerStopConfig } from "@/lib/voximplant/server-stop-config";
import {
  buildAttemptFencedStopRelayDispatchContext,
  isBrowserStopRelayEnabledForMode,
  isRelayEligibleParticipantType,
  isRelayStoppableRecordingStatus,
  isRelayTerminalRecordingStatus,
  isRelayWindowOpenForSessionState,
} from "@/lib/session-recording-stop-relay-policy";

type StopOperationState = "PENDING" | "DELIVERING" | "DELIVERED" | "FAILED";
type RelayOutcome = "ACKNOWLEDGED" | "SEND_FAILED" | "TIMEOUT" | "UNAVAILABLE";

function isRelayFallbackErrorClass(value: string | null) {
  if (!value) return false;
  if (isTerminalStopRetryErrorClass(value)) return false;
  return (
    value.startsWith("VOXIMPLANT_SERVER_CONTROL_") ||
    value === "VOXIMPLANT_BROWSER_RELAY_REQUIRED"
  );
}

function isRelayWindowOpen(session: {
  negotiationState: NegotiationState;
  closedByEventAt: Date | null;
  closeReason: string | null;
  event: { status: TrainingEventStatus } | null;
}) {
  return isRelayWindowOpenForSessionState({
    negotiationState: session.negotiationState,
    closedByEventAt: session.closedByEventAt,
    closeReason: session.closeReason,
    eventStatus: session.event?.status ?? null,
  });
}

type RelayCandidate = {
  operationRowId: string;
  operationId: string;
  state: StopOperationState;
  lastErrorClass: string | null;
  recordingId: string;
  recordingStatus: RecordingStatus;
};

export type StopRelayHint = {
  operationId: string;
  operationState: StopOperationState;
  requestId: string;
  recordingId: string;
};

export type ClaimedStopRelay = {
  operationId: string;
  requestId: string;
  scenarioMessage: RecordingControlMessage;
  scenarioMessageText: string;
};

async function readRelayCandidate(sessionId: string): Promise<RelayCandidate | null> {
  const operation = await prisma.sessionRecordingStopOperation.findFirst({
    where: {
      sessionId,
      recording: {
        provider: "VOXIMPLANT",
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      operationId: true,
      state: true,
      lastErrorClass: true,
      recordingId: true,
      recording: {
        select: {
          status: true,
        },
      },
    },
  });

  if (!operation) return null;

  const recordingStatus = operation.recording.status;
  if (isRelayTerminalRecordingStatus(recordingStatus)) {
    return null;
  }
  if (!isRelayStoppableRecordingStatus(recordingStatus)) {
    return null;
  }
  if (operation.state === "DELIVERED") {
    return null;
  }
  if (operation.state !== "FAILED") {
    return null;
  }
  if (!isRelayFallbackErrorClass(operation.lastErrorClass)) {
    return null;
  }

  return {
    operationRowId: operation.id,
    operationId: operation.operationId,
    state: operation.state as StopOperationState,
    lastErrorClass: operation.lastErrorClass,
    recordingId: operation.recordingId,
    recordingStatus,
  };
}

export async function getStopRelayHintForSession(params: {
  sessionId: string;
  participantType: ParticipantType;
}): Promise<StopRelayHint | null> {
  if (!isRelayEligibleParticipantType(params.participantType)) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
    select: {
      negotiationState: true,
      closeReason: true,
      closedByEventAt: true,
      event: { select: { status: true } },
    },
  });
  if (!session || !isRelayWindowOpen(session)) {
    return null;
  }
  const serverStopConfig = getVoximplantServerStopConfig();
  if (!isBrowserStopRelayEnabledForMode(serverStopConfig.mode)) {
    return null;
  }

  const candidate = await readRelayCandidate(params.sessionId);
  if (!candidate) {
    return null;
  }

  return {
    operationId: candidate.operationId,
    operationState: candidate.state,
    requestId: candidate.operationId,
    recordingId: candidate.recordingId,
  };
}

export async function claimStopRelayDispatch(params: {
  sessionId: string;
  operationId: string;
  participant: Pick<SessionParticipant, "id" | "type" | "userId">;
}): Promise<ClaimedStopRelay | null> {
  if (!isRelayEligibleParticipantType(params.participant.type)) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
    select: {
      negotiationState: true,
      closeReason: true,
      closedByEventAt: true,
      event: { select: { status: true } },
    },
  });
  if (!session || !isRelayWindowOpen(session)) {
    return null;
  }
  const serverStopConfig = getVoximplantServerStopConfig();
  if (!isBrowserStopRelayEnabledForMode(serverStopConfig.mode)) {
    return null;
  }

  const candidate = await prisma.sessionRecordingStopOperation.findUnique({
    where: { operationId: params.operationId },
    select: {
      id: true,
      operationId: true,
      sessionId: true,
      state: true,
      lastErrorClass: true,
      attemptCount: true,
      recordingId: true,
      recording: {
        select: {
          status: true,
          provider: true,
          recordingAttemptId: true,
        },
      },
    },
  });

  if (!candidate || candidate.sessionId !== params.sessionId) {
    return null;
  }
  if (candidate.recording.provider !== "VOXIMPLANT") {
    return null;
  }
  if (isRelayTerminalRecordingStatus(candidate.recording.status)) {
    return null;
  }
  if (!isRelayStoppableRecordingStatus(candidate.recording.status)) {
    return null;
  }
  if (candidate.state === "DELIVERED") {
    return null;
  }
  if (candidate.state !== "FAILED") {
    return null;
  }
  if (!isRelayFallbackErrorClass(candidate.lastErrorClass)) {
    return null;
  }

  const claim = await prisma.sessionRecordingStopOperation.updateMany({
    where: {
      id: candidate.id,
      state: "FAILED",
      lastErrorClass: candidate.lastErrorClass,
    },
    data: {
      state: "DELIVERING",
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      lastError: null,
      lastErrorClass: null,
      failedAt: null,
      nextRetryAt: null,
      lastDeliveryTransport: "voximplant_browser_relay_claim",
    },
  });

  if (claim.count === 0) {
    return null;
  }

  const dispatch = await buildVoximplantRecordingDispatch(
    "stop",
    buildAttemptFencedStopRelayDispatchContext({
      sessionId: params.sessionId,
      operationId: candidate.operationId,
      recordingAttemptId: candidate.recording.recordingAttemptId,
      participant: params.participant,
    }),
  );

  await prisma.sessionRecordingStopOperation.update({
    where: { id: candidate.id },
    data: {
      fallbackPayload: dispatch.scenarioMessage,
    },
  });

  return {
    operationId: candidate.operationId,
    requestId: candidate.operationId,
    scenarioMessage: dispatch.scenarioMessage,
    scenarioMessageText: dispatch.scenarioMessageText,
  };
}

export async function reportStopRelayOutcome(params: {
  sessionId: string;
  operationId: string;
  outcome: RelayOutcome;
}) {
  const operation = await prisma.sessionRecordingStopOperation.findUnique({
    where: { operationId: params.operationId },
    select: {
      id: true,
      sessionId: true,
      state: true,
      attemptCount: true,
      recording: {
        select: {
          status: true,
          provider: true,
        },
      },
    },
  });
  if (!operation || operation.sessionId !== params.sessionId) {
    return;
  }
  if (operation.recording.provider !== "VOXIMPLANT") {
    return;
  }
  if (operation.state === "DELIVERED") {
    return;
  }
  if (isRelayTerminalRecordingStatus(operation.recording.status)) {
    await prisma.sessionRecordingStopOperation.update({
      where: { id: operation.id },
      data: {
        state: "DELIVERED",
        deliveredAt: new Date(),
        failedAt: null,
        lastError: null,
        lastErrorClass: null,
        nextRetryAt: null,
        lastDeliveryTransport: "voximplant_webhook_reconciliation",
      },
    });
    return;
  }

  if (params.outcome === "ACKNOWLEDGED") {
    await prisma.sessionRecordingStopOperation.update({
      where: { id: operation.id },
      data: {
        state: "DELIVERING",
        deliveredAt: null,
        failedAt: null,
        lastError: null,
        lastErrorClass: null,
        nextRetryAt: null,
        lastAttemptAt: new Date(),
        lastDeliveryTransport: "voximplant_browser_relay_ack",
      },
    });
    return;
  }

  const retry = resolveVoxRelayFailure(operation.attemptCount);
  await prisma.sessionRecordingStopOperation.update({
    where: { id: operation.id },
    data: {
      state: "FAILED",
      failedAt: new Date(),
      deliveredAt: null,
      lastErrorClass: retry.lastErrorClass,
      lastError: retry.lastError,
      nextRetryAt: retry.nextRetryAt,
      lastDeliveryTransport:
        params.outcome === "TIMEOUT"
          ? "voximplant_browser_relay_timeout"
          : "voximplant_browser_relay_send_failed",
    },
  });
}
