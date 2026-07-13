import "server-only";

import {
  NegotiationState,
  ParticipantType,
  Prisma,
  RecordingStatus,
  RoomLifecycle,
} from "@/app/generated/prisma/client";
import { stopRecording } from "@/lib/livekit-egress";
import { getControlUpdateData, SESSION_CONTROL_SELECT } from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import {
  countActiveSessionRoomConnections,
} from "@/lib/session-room-occupancy";
import { deriveEffectiveRoomLifecycle } from "@/lib/session-room-lifecycle";
import { closeAllOpenPauseIntervals } from "@/lib/session-pause-intervals";
import {
  resolveStartingNotReadyFailure,
  resolveVoxRelayFailure,
  scheduleStopRetry,
} from "@/lib/recording-stop-delivery-policy";
import { resolveEffectiveRecordingProvider } from "@/lib/recording/provider";
import { buildVoximplantRecordingDispatch } from "@/lib/voximplant/recording-dispatch";

export type SessionFinishMode =
  | "ROOM_FACILITATOR_FINISH"
  | "ADMINISTRATIVE_SESSION_FINISH"
  | "EVENT_COMPLETION";

type RecordingStopOperationState =
  | "PENDING"
  | "DELIVERING"
  | "DELIVERED"
  | "FAILED";

type StopIntent = {
  operationId: string;
  state: RecordingStopOperationState;
  recordingId: string;
  provider: "livekit" | "voximplant";
  recordingStatus: RecordingStatus;
  shouldDeliver: boolean;
};

export type CanonicalSessionFinishResult = {
  sessionId: string;
  alreadyFinished: boolean;
  operationId: string;
  negotiationState: NegotiationState;
  roomLifecycle: RoomLifecycle | null;
  closeReason: string | null;
  closedByEventAt: string | null;
  recording: {
    recordingId: string | null;
    status: RecordingStatus | null;
    stopOperationId: string | null;
    stopOperationState: string | null;
    warning: string | null;
    fallbackScenarioMessage: unknown | null;
  };
};

function shouldRequestRecordingStop(status: RecordingStatus) {
  return (
    status === RecordingStatus.RECORDING ||
    status === RecordingStatus.PAUSED ||
    status === RecordingStatus.STARTING
  );
}

function generateFinishOperationId(sessionId: string, mode: SessionFinishMode) {
  return `finish:${sessionId}:${mode}`.toLowerCase();
}

function generateStopOperationId(recordingId: string, mode: SessionFinishMode) {
  return `stop:${recordingId}:${mode}`.toLowerCase();
}

async function claimRecordingStopIntent(params: {
  tx: Prisma.TransactionClient;
  sessionId: string;
  mode: SessionFinishMode;
  reason: string | null;
}) {
  const recording = await params.tx.recording.findUnique({
    where: { sessionId: params.sessionId },
    select: {
      id: true,
      status: true,
      provider: true,
    },
  });

  if (!recording || !shouldRequestRecordingStop(recording.status)) {
    return {
      recordingStatus: recording?.status ?? null,
      stopIntent: null as StopIntent | null,
    };
  }

  const provider = resolveEffectiveRecordingProvider(recording.provider);
  const operationId = generateStopOperationId(recording.id, params.mode);
  const existing = await params.tx.sessionRecordingStopOperation.findUnique({
    where: { recordingId: recording.id },
    select: {
      id: true,
      state: true,
      operationId: true,
    },
  });

  if (existing) {
    const shouldDeliver =
      existing.state !== "DELIVERED" && existing.state !== "DELIVERING";

    if (shouldDeliver && existing.state === "FAILED") {
      await params.tx.sessionRecordingStopOperation.update({
        where: { id: existing.id },
        data: {
          state: "PENDING",
          failedAt: null,
          lastError: null,
          lastErrorClass: null,
          nextRetryAt: null,
        },
      });
    }

    return {
      recordingStatus: recording.status,
      stopIntent: {
        operationId: existing.id,
        state: shouldDeliver && existing.state === "FAILED" ? "PENDING" : (existing.state as RecordingStopOperationState),
        recordingId: recording.id,
        provider,
        recordingStatus: recording.status,
        shouldDeliver,
      },
    };
  }

  const created = await params.tx.sessionRecordingStopOperation.create({
    data: {
      sessionId: params.sessionId,
      recordingId: recording.id,
      provider: recording.provider ?? provider.toUpperCase(),
      requestedByMode: params.mode,
      requestReason: params.reason,
      operationId,
      state: "PENDING",
    },
    select: {
      id: true,
      state: true,
    },
  });

  return {
    recordingStatus: recording.status,
    stopIntent: {
      operationId: created.id,
      state: created.state as RecordingStopOperationState,
      recordingId: recording.id,
      provider,
      recordingStatus: recording.status,
      shouldDeliver: true,
    },
  };
}

async function deliverRecordingStopOperation(params: {
  operationRowId: string;
  sessionId: string;
}): Promise<{
  state: RecordingStopOperationState | null;
  warning: string | null;
  fallbackScenarioMessage: unknown | null;
}> {
  const claim = await prisma.sessionRecordingStopOperation.updateMany({
    where: {
      id: params.operationRowId,
      state: {
        in: ["PENDING", "FAILED"],
      },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    data: {
      state: "DELIVERING",
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      lastError: null,
      lastErrorClass: null,
      nextRetryAt: null,
    },
  });

  if (claim.count === 0) {
    const existing = await prisma.sessionRecordingStopOperation.findUnique({
      where: { id: params.operationRowId },
      select: { state: true, fallbackPayload: true, lastError: true },
    });
    return {
      state: (existing?.state as RecordingStopOperationState) ?? null,
      warning: existing?.lastError ?? null,
      fallbackScenarioMessage: existing?.fallbackPayload ?? null,
    };
  }

  const operation = await prisma.sessionRecordingStopOperation.findUniqueOrThrow({
    where: { id: params.operationRowId },
    include: {
      recording: true,
    },
  });

  const provider = resolveEffectiveRecordingProvider(operation.recording.provider);

  if (
    operation.recording.status === RecordingStatus.PROCESSING ||
    operation.recording.status === RecordingStatus.STOPPED ||
    operation.recording.status === RecordingStatus.COMPLETED
  ) {
    await prisma.sessionRecordingStopOperation.update({
      where: { id: operation.id },
      data: {
        state: "DELIVERED",
        deliveredAt: new Date(),
        failedAt: null,
        lastError: null,
        lastErrorClass: null,
        nextRetryAt: null,
      },
    });
    return {
      state: "DELIVERED",
      warning: null,
      fallbackScenarioMessage: operation.fallbackPayload,
    };
  }

  if (
    operation.recording.status === RecordingStatus.STARTING &&
    !operation.recording.egressId
  ) {
    const retry = resolveStartingNotReadyFailure(operation.attemptCount);
    await prisma.sessionRecordingStopOperation.update({
      where: { id: operation.id },
      data: {
        state: "FAILED",
        failedAt: new Date(),
        lastErrorClass: retry.lastErrorClass,
        lastError: retry.lastError,
        nextRetryAt: retry.nextRetryAt,
      },
    });
    return {
      state: "FAILED",
      warning: retry.lastError,
      fallbackScenarioMessage: operation.fallbackPayload,
    };
  }

  if (provider === "livekit") {
    const result = await stopRecording(operation.recording);
    if (result.ok) {
      await prisma.sessionRecordingStopOperation.update({
        where: { id: operation.id },
        data: {
          state: "DELIVERED",
          deliveredAt: new Date(),
          failedAt: null,
          lastError: null,
          lastErrorClass: null,
          nextRetryAt: null,
          lastDeliveryTransport: "livekit_api",
        },
      });
      return { state: "DELIVERED", warning: result.warning ?? null, fallbackScenarioMessage: null };
    }

    const nextRetryAt = scheduleStopRetry(operation.attemptCount);
    await prisma.sessionRecordingStopOperation.update({
      where: { id: operation.id },
      data: {
        state: "FAILED",
        failedAt: new Date(),
        lastErrorClass: "LIVEKIT_STOP_DELIVERY_FAILED",
        lastError: result.warning ?? "livekitStopDeliveryFailed",
        nextRetryAt,
        lastDeliveryTransport: "livekit_api",
      },
    });
    return {
      state: "FAILED",
      warning: result.warning ?? "livekitStopDeliveryFailed",
      fallbackScenarioMessage: null,
    };
  }

  const facilitator = await prisma.sessionParticipant.findFirst({
    where: {
      sessionId: params.sessionId,
      type: ParticipantType.FACILITATOR,
    },
    select: {
      id: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const dispatch = await buildVoximplantRecordingDispatch("stop", {
    sessionId: params.sessionId,
    participantId: facilitator?.id,
    role: "facilitator",
  });
  const retry = resolveVoxRelayFailure(operation.attemptCount);

  await prisma.sessionRecordingStopOperation.update({
    where: { id: operation.id },
    data: {
      state: "FAILED",
      fallbackPayload: dispatch.scenarioMessage,
      failedAt: new Date(),
      lastErrorClass: retry.lastErrorClass,
      lastError: retry.lastError,
      nextRetryAt: retry.nextRetryAt,
      lastDeliveryTransport: "voximplant_browser_relay",
    },
  });

  if (retry.terminal) {
    console.warn(
      JSON.stringify({
        area: "recording_stop_delivery",
        event: "voximplant_browser_relay_terminal",
        sessionId: params.sessionId,
        operationId: operation.id,
      }),
    );
  }

  return {
    state: "FAILED",
    warning: retry.lastError,
    fallbackScenarioMessage: dispatch.scenarioMessage,
  };
}

export async function completeSessionCanonical(params: {
  sessionId: string;
  mode: SessionFinishMode;
  reason?: string | null;
  hardClose?: boolean;
  closedByEventId?: string | null;
}): Promise<CanonicalSessionFinishResult> {
  const now = new Date();
  const reason = params.reason?.trim() || null;
  const hardClose = Boolean(params.hardClose || params.mode === "EVENT_COMPLETION");

  const txResult = await prisma.$transaction(async (tx) => {
    const existingSession = await tx.session.findUniqueOrThrow({
      where: { id: params.sessionId },
      select: {
        deletedAt: true,
        roomLifecycle: true,
        closeReason: true,
        closedByEventAt: true,
        event: {
          select: {
            status: true,
          },
        },
        ...SESSION_CONTROL_SELECT,
      },
    });

    if (existingSession.deletedAt) {
      throw new Error("Session is deleted.");
    }

    const alreadyFinished =
      existingSession.negotiationState === NegotiationState.FINISHED;
    const effectiveLifecycle = deriveEffectiveRoomLifecycle({
      roomLifecycle: existingSession.roomLifecycle,
      deletedAt: existingSession.deletedAt,
      closedByEventAt: existingSession.closedByEventAt,
      closeReason: existingSession.closeReason,
      negotiationState: existingSession.negotiationState,
      eventStatus: existingSession.event?.status ?? null,
    });

    const desiredLifecycle: RoomLifecycle | null = (() => {
      if (effectiveLifecycle === RoomLifecycle.CLOSED || hardClose) {
        return RoomLifecycle.CLOSED;
      }
      return null;
    })();

    let nextLifecycle: RoomLifecycle;
    if (desiredLifecycle) {
      nextLifecycle = desiredLifecycle;
    } else {
      const activeCount = await countActiveSessionRoomConnections(
        params.sessionId,
        tx,
      );
      nextLifecycle =
        activeCount > 0 ? RoomLifecycle.DEBRIEF_OPEN : RoomLifecycle.CLOSED;
    }

    const finishUpdateData =
      alreadyFinished
        ? {}
        : getControlUpdateData(existingSession, "FINISH", now);

    const closeUpdateData = hardClose
      ? {
          closeReason: "EVENT_COMPLETED",
          closedByEventAt: existingSession.closedByEventAt ?? now,
          closedByEventId: params.closedByEventId ?? null,
        }
      : {};

    const session = await tx.session.update({
      where: { id: params.sessionId },
      data: {
        ...finishUpdateData,
        ...closeUpdateData,
        roomLifecycle: effectiveLifecycle === RoomLifecycle.CLOSED
          ? RoomLifecycle.CLOSED
          : nextLifecycle,
      },
      select: {
        id: true,
        negotiationState: true,
        roomLifecycle: true,
        closeReason: true,
        closedByEventAt: true,
      },
    });

    const stopIntentResult = await claimRecordingStopIntent({
      tx,
      sessionId: params.sessionId,
      mode: params.mode,
      reason,
    });

    return {
      session,
      alreadyFinished,
      stopIntent: stopIntentResult.stopIntent,
      recordingStatus: stopIntentResult.recordingStatus,
      operationId: generateFinishOperationId(params.sessionId, params.mode),
    };
  });

  if (!txResult.alreadyFinished) {
    await closeAllOpenPauseIntervals(params.sessionId, now);
  }

  let stopWarning: string | null = null;
  let stopState: RecordingStopOperationState | null =
    txResult.stopIntent?.state ?? null;
  let fallbackScenarioMessage: unknown | null = null;

  if (txResult.stopIntent?.shouldDeliver) {
    const delivered = await deliverRecordingStopOperation({
      operationRowId: txResult.stopIntent.operationId,
      sessionId: params.sessionId,
    });
    stopWarning = delivered.warning;
    stopState = delivered.state;
    fallbackScenarioMessage = delivered.fallbackScenarioMessage;
  }

  return {
    sessionId: txResult.session.id,
    alreadyFinished: txResult.alreadyFinished,
    operationId: txResult.operationId,
    negotiationState: txResult.session.negotiationState,
    roomLifecycle: txResult.session.roomLifecycle,
    closeReason: txResult.session.closeReason,
    closedByEventAt: txResult.session.closedByEventAt?.toISOString() ?? null,
    recording: {
      recordingId: txResult.stopIntent?.recordingId ?? null,
      status: txResult.recordingStatus,
      stopOperationId: txResult.stopIntent?.operationId ?? null,
      stopOperationState: stopState,
      warning: stopWarning,
      fallbackScenarioMessage,
    },
  };
}
