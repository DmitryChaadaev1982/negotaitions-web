/**
 * Runtime-neutral canonical Session finish implementation.
 *
 * Safe for the operational Stage 3.10 CLI (raw tsx / Node). Next.js
 * application consumers must import `@/lib/session-completion`, which
 * retains `import "server-only"`.
 */
import {
  NegotiationState,
  ParticipantType,
  Prisma,
  RecordingStatus,
  RoomLifecycle,
} from "@/app/generated/prisma/client";
import { getSessionLifecycleDurations, type SessionLifecycleDurations } from "@/lib/config/session-lifecycle-settings";
import { stopRecording } from "@/lib/livekit-egress";
import { getControlUpdateData, SESSION_CONTROL_SELECT } from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import {
  evaluateSessionLifecyclePolicy,
  SESSION_AUTO_CLOSE_REASONS,
} from "@/lib/session-lifecycle-policy";
import {
  countActiveSessionRoomConnections,
  decideFinishRoomLifecycle,
  finalizeSessionCanonicalClose,
  getLastCurrentGenerationDepartureAt,
  lockSessionRowForLifecycleWrite,
} from "@/lib/session-room-occupancy";
import { deriveEffectiveRoomLifecycle } from "@/lib/session-room-lifecycle";
import { closeAllOpenPauseIntervals } from "@/lib/session-pause-intervals";
import {
  TERMINAL_STOP_RETRY_ERROR_CLASSES,
  resolveStartingNotReadyFailure,
  resolveServerControlMissingRegistrationFailure,
  resolveServerControlTransportFailure,
  resolveVoxRelayFailure,
  scheduleStopRetry,
  shouldDeferStartingStopForMissingProviderId,
} from "@/lib/recording-stop-delivery-policy";
import { resolveEffectiveRecordingProvider } from "@/lib/recording/provider";
import { buildVoximplantRecordingDispatch } from "@/lib/voximplant/recording-dispatch";
import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import { RECORDING_STARTING_TIMEOUT_RECONCILED } from "@/lib/voximplant/recording-status-fencing";
import {
  getVoximplantServerStopConfig,
  type VoximplantServerStopConfig,
} from "@/lib/voximplant/server-stop-settings";
import { sendVoximplantServerStopCommand } from "@/lib/voximplant/server-stop-client";

export type SessionFinishMode =
  | "ROOM_FACILITATOR_FINISH"
  | "ADMINISTRATIVE_SESSION_FINISH"
  | "EVENT_COMPLETION"
  | "SESSION_ABANDONED_TIMEOUT";

type CompletionClient = Pick<
  typeof prisma,
  | "$transaction"
  | "$queryRaw"
  | "session"
  | "recording"
  | "sessionRecordingStopOperation"
  | "sessionParticipant"
  | "sessionVoximplantControlChannel"
>;

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
  recordingAttemptId: string | null;
  shouldDeliver: boolean;
};

export type CanonicalSessionFinishResult = {
  sessionId: string;
  alreadyFinished: boolean;
  sessionCloseApplied: boolean;
  sessionAlreadyClosed: boolean;
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

function getCanonicalFinishUpdateData(params: {
  session: Prisma.SessionGetPayload<{ select: typeof SESSION_CONTROL_SELECT }>;
  mode: SessionFinishMode;
  now: Date;
}) {
  const { session, mode, now } = params;

  if (mode === "ROOM_FACILITATOR_FINISH") {
    return getControlUpdateData(session, "FINISH", now);
  }

  if (
    session.negotiationState === NegotiationState.RUNNING ||
    session.negotiationState === NegotiationState.PAUSED
  ) {
    return getControlUpdateData(session, "FINISH", now);
  }

  let totalPausedSeconds = session.totalPausedSeconds;
  if (session.pausedAt) {
    totalPausedSeconds += Math.floor(
      (now.getTime() - session.pausedAt.getTime()) / 1000,
    );
  }

  let preparationTotalPausedSeconds = session.preparationTotalPausedSeconds;
  if (session.preparationPausedAt) {
    preparationTotalPausedSeconds += Math.floor(
      (now.getTime() - session.preparationPausedAt.getTime()) / 1000,
    );
  }

  return {
    negotiationState: NegotiationState.FINISHED,
    negotiationEndedAt: now,
    preparationEndedAt: session.preparationEndedAt ?? now,
    totalPausedSeconds,
    preparationTotalPausedSeconds,
    pausedAt: null,
    preparationPausedAt: null,
  };
}

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

function generateStopOperationId(
  recordingId: string,
  recordingAttemptId: string | null,
  mode: SessionFinishMode,
) {
  return `stop:${recordingId}:${recordingAttemptId ?? "legacy"}:${mode}`.toLowerCase();
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
      recordingAttemptId: true,
      errorMessage: true,
    },
  });

  if (!recording) {
    return {
      recordingStatus: null,
      stopIntent: null as StopIntent | null,
    };
  }

  const provider = resolveEffectiveRecordingProvider(recording.provider);
  const isRecoverableVoxFailure =
    provider === "voximplant" &&
    recording.status === RecordingStatus.FAILED &&
    recording.errorMessage === RECORDING_STARTING_TIMEOUT_RECONCILED &&
    Boolean(recording.recordingAttemptId) &&
    Boolean(
      await params.tx.sessionVoximplantControlChannel.findUnique({
        where: { sessionId: params.sessionId },
        select: { id: true },
      }),
    );
  if (
    !shouldRequestRecordingStop(recording.status) &&
    !isRecoverableVoxFailure
  ) {
    return {
      recordingStatus: recording.status,
      stopIntent: null as StopIntent | null,
    };
  }

  const operationId = generateStopOperationId(
    recording.id,
    recording.recordingAttemptId,
    params.mode,
  );
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
        recordingAttemptId: recording.recordingAttemptId,
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
      recordingAttemptId: recording.recordingAttemptId,
      shouldDeliver: true,
    },
  };
}

async function deliverRecordingStopOperation(params: {
  operationRowId: string;
  sessionId: string;
  client?: CompletionClient;
}): Promise<{
  state: RecordingStopOperationState | null;
  warning: string | null;
  fallbackScenarioMessage: unknown | null;
}> {
  const db = params.client ?? prisma;
  const claim = await db.sessionRecordingStopOperation.updateMany({
    where: {
      id: params.operationRowId,
      OR: [
        {
          state: "PENDING",
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
        },
        {
          state: "FAILED",
          lastErrorClass: {
            notIn: TERMINAL_STOP_RETRY_ERROR_CLASSES as unknown as string[],
          },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
        },
      ],
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
    const existing = await db.sessionRecordingStopOperation.findUnique({
      where: { id: params.operationRowId },
      select: { state: true, fallbackPayload: true, lastError: true },
    });
    return {
      state: (existing?.state as RecordingStopOperationState) ?? null,
      warning: existing?.lastError ?? null,
      fallbackScenarioMessage: existing?.fallbackPayload ?? null,
    };
  }

  const operation = await db.sessionRecordingStopOperation.findUniqueOrThrow({
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
    await db.sessionRecordingStopOperation.update({
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
    shouldDeferStartingStopForMissingProviderId({
      provider,
      recordingStatus: operation.recording.status,
      egressId: operation.recording.egressId,
    })
  ) {
    const retry = resolveStartingNotReadyFailure(operation.attemptCount);
    await db.$transaction(async (tx) => {
      await tx.sessionRecordingStopOperation.update({
        where: { id: operation.id },
        data: {
          state: "FAILED",
          failedAt: new Date(),
          lastErrorClass: retry.lastErrorClass,
          lastError: retry.lastError,
          nextRetryAt: retry.nextRetryAt,
        },
      });
      if (retry.terminal) {
        await tx.recording.updateMany({
          where: {
            id: operation.recording.id,
            recordingAttemptId: operation.recording.recordingAttemptId,
            status: RecordingStatus.STARTING,
            egressId: null,
          },
          data: {
            status: RecordingStatus.FAILED,
            endedAt: operation.recording.endedAt ?? new Date(),
            errorMessage: "recordingStartingNotReadyTerminal",
          },
        });
      }
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
      await db.sessionRecordingStopOperation.update({
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
    await db.sessionRecordingStopOperation.update({
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

  async function buildBrowserRelayFallback() {
    const facilitator = await db.sessionParticipant.findFirst({
      where: {
        sessionId: params.sessionId,
        type: ParticipantType.FACILITATOR,
      },
      select: {
        id: true,
        userId: true,
      },
      orderBy: { createdAt: "asc" },
    });
    const dispatch = await buildVoximplantRecordingDispatch("stop", {
      sessionId: params.sessionId,
      participantId: facilitator?.id ?? "server_stop_fallback",
      controllerUserId:
        facilitator?.userId ?? `session_participant:${facilitator?.id ?? "server_stop_fallback"}`,
      controllerRole: "facilitator",
      canControlRecording: true,
      recordingAttemptId:
        operation.recording.recordingAttemptId ?? undefined,
    });
    return dispatch;
  }

  let serverStopConfig: VoximplantServerStopConfig;
  try {
    serverStopConfig = getVoximplantServerStopConfig();
  } catch (error) {
    const nextRetryAt = scheduleStopRetry(operation.attemptCount);
    const warning =
      error instanceof Error
        ? error.message
        : "Voximplant server stop configuration is unavailable.";
    await db.sessionRecordingStopOperation.update({
      where: { id: operation.id },
      data: {
        state: "FAILED",
        failedAt: new Date(),
        lastErrorClass: "VOXIMPLANT_SERVER_CONTROL_CONFIG_UNAVAILABLE",
        lastError: warning,
        nextRetryAt,
        lastDeliveryTransport: "voximplant_server_control",
      },
    });
    return {
      state: "FAILED",
      warning,
      fallbackScenarioMessage: null,
    };
  }
  if (serverStopConfig.mode !== "disabled") {
    const expectedConferenceName = buildVoximplantConferenceName(params.sessionId);
    const controlChannel = await db.sessionVoximplantControlChannel.findUnique({
      where: { sessionId: params.sessionId },
      select: {
        conferenceName: true,
        providerSessionId: true,
        controlUrl: true,
        controlUrlFingerprint: true,
      },
    });
    const hasValidControlChannel = Boolean(
      controlChannel &&
        controlChannel.conferenceName === expectedConferenceName,
    );
    const relayFallbackAllowed =
      serverStopConfig.mode === "prefer_server_with_relay_fallback";

    if (!hasValidControlChannel) {
      const retry = resolveServerControlMissingRegistrationFailure(
        operation.attemptCount,
      );
      if (relayFallbackAllowed) {
        const dispatch = await buildBrowserRelayFallback();
        await db.sessionRecordingStopOperation.update({
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
        return {
          state: "FAILED",
          warning: retry.lastError,
          fallbackScenarioMessage: dispatch.scenarioMessage,
        };
      }

      await db.sessionRecordingStopOperation.update({
        where: { id: operation.id },
        data: {
          state: "FAILED",
          failedAt: new Date(),
          lastErrorClass: retry.lastErrorClass,
          lastError: retry.lastError,
          nextRetryAt: retry.nextRetryAt,
          lastDeliveryTransport: "voximplant_server_control",
        },
      });
      return {
        state: "FAILED",
        warning: retry.lastError,
        fallbackScenarioMessage: null,
      };
    }
    const activeControlChannel = controlChannel!;

    const transport = await sendVoximplantServerStopCommand({
      controlUrl: activeControlChannel.controlUrl,
      controlUrlFingerprint: activeControlChannel.controlUrlFingerprint,
      controlSecret: serverStopConfig.controlSecret!,
      timeoutMs: serverStopConfig.controlTimeoutMs,
      operationId: operation.operationId,
      sessionId: params.sessionId,
      conferenceName: activeControlChannel.conferenceName,
      providerSessionId: activeControlChannel.providerSessionId,
      recordingAttemptId:
        operation.recording.recordingAttemptId ?? undefined,
    });

    if (transport.code === "TRANSPORT_ACCEPTED") {
      await db.sessionRecordingStopOperation.update({
        where: { id: operation.id },
        data: {
          state: "DELIVERING",
          transportAcceptedAt: new Date(),
          providerSessionIdAtCommand: activeControlChannel.providerSessionId,
          providerConferenceNameAtCommand: activeControlChannel.conferenceName,
          failedAt: null,
          lastError: null,
          lastErrorClass: null,
          nextRetryAt: new Date(
            Date.now() + serverStopConfig.terminalTimeoutSeconds * 1000,
          ),
          lastDeliveryTransport: "voximplant_server_control",
        },
      });
      return {
        state: "DELIVERING",
        warning:
          transport.scenarioResponse && !transport.scenarioResponse.accepted
            ? transport.scenarioResponse.reason ??
              "Voximplant control transport accepted but command is pending provider confirmation."
            : null,
        fallbackScenarioMessage: null,
      };
    }

    const retry = resolveServerControlTransportFailure(
      operation.attemptCount,
      transport.code,
    );
    if (relayFallbackAllowed) {
      const dispatch = await buildBrowserRelayFallback();
      await db.sessionRecordingStopOperation.update({
        where: { id: operation.id },
        data: {
          state: "FAILED",
          fallbackPayload: dispatch.scenarioMessage,
          failedAt: new Date(),
          lastErrorClass: retry.lastErrorClass,
          lastError: transport.warning ?? retry.lastError,
          nextRetryAt: retry.nextRetryAt,
          lastDeliveryTransport: "voximplant_browser_relay",
        },
      });
      return {
        state: "FAILED",
        warning: transport.warning ?? retry.lastError,
        fallbackScenarioMessage: dispatch.scenarioMessage,
      };
    }

    await db.sessionRecordingStopOperation.update({
      where: { id: operation.id },
      data: {
        state: "FAILED",
        failedAt: new Date(),
        lastErrorClass: retry.lastErrorClass,
        lastError: transport.warning ?? retry.lastError,
        nextRetryAt: retry.nextRetryAt,
        lastDeliveryTransport: "voximplant_server_control",
      },
    });
    return {
      state: "FAILED",
      warning: transport.warning ?? retry.lastError,
      fallbackScenarioMessage: null,
    };
  }

  const facilitator = await db.sessionParticipant.findFirst({
    where: {
      sessionId: params.sessionId,
      type: ParticipantType.FACILITATOR,
    },
    select: {
      id: true,
      userId: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const dispatch = await buildVoximplantRecordingDispatch("stop", {
    sessionId: params.sessionId,
    participantId: facilitator?.id ?? "browser_relay_fallback",
    controllerUserId:
      facilitator?.userId ?? `session_participant:${facilitator?.id ?? "browser_relay_fallback"}`,
    controllerRole: "facilitator",
    canControlRecording: true,
    recordingAttemptId:
      operation.recording.recordingAttemptId ?? undefined,
  });
  const retry = resolveVoxRelayFailure(operation.attemptCount);

  await db.sessionRecordingStopOperation.update({
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

export async function retryRecordingStopAfterExactAttemptReconciliation(params: {
  sessionId: string;
  operationRowId: string;
  recordingAttemptId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  await prisma.sessionRecordingStopOperation.updateMany({
    where: {
      id: params.operationRowId,
      sessionId: params.sessionId,
      recording: {
        is: {
          recordingAttemptId: params.recordingAttemptId,
        },
      },
      OR: [
        {
          state: "FAILED",
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        {
          state: "DELIVERING",
          nextRetryAt: { lte: now },
        },
      ],
    },
    data: {
      state: "FAILED",
      failedAt: now,
      lastErrorClass: "EXACT_ATTEMPT_RECONCILIATION_STOP_RETRY",
      lastError: "exactAttemptReconciliationStopRetry",
      nextRetryAt: now,
    },
  });

  return deliverRecordingStopOperation({
    operationRowId: params.operationRowId,
    sessionId: params.sessionId,
  });
}

export async function completeSessionCanonical(params: {
  sessionId: string;
  mode: SessionFinishMode;
  reason?: string | null;
  hardClose?: boolean;
  closedByEventId?: string | null;
  now?: Date;
  durations?: Partial<SessionLifecycleDurations>;
  client?: CompletionClient;
}): Promise<CanonicalSessionFinishResult> {
  const db = params.client ?? prisma;
  const now = params.now ?? new Date();
  const reason = params.reason?.trim() || null;
  const hardClose = Boolean(params.hardClose || params.mode === "EVENT_COMPLETION");
  const durations = {
    ...getSessionLifecycleDurations(),
    ...params.durations,
  };

  const txResult = await db.$transaction(async (tx) => {
    await lockSessionRowForLifecycleWrite(params.sessionId, tx);

    const existingSession = await tx.session.findUniqueOrThrow({
      where: { id: params.sessionId },
      select: {
        deletedAt: true,
        createdAt: true,
        roomLifecycle: true,
        closeReason: true,
        closedByEventAt: true,
        event: {
          select: {
            scheduledAt: true,
            status: true,
            deletedAt: true,
          },
        },
        ...SESSION_CONTROL_SELECT,
      },
    });

    if (existingSession.deletedAt) {
      throw new Error("Session is deleted.");
    }

    if (params.mode === "SESSION_ABANDONED_TIMEOUT") {
      const occupancyCount = await countActiveSessionRoomConnections(
        params.sessionId,
        tx,
        now,
      );
      const lastCurrentGenerationDepartureAt =
        await getLastCurrentGenerationDepartureAt(params.sessionId, tx, now);
      const stillDue = evaluateSessionLifecyclePolicy({
        now,
        roomLifecycle: existingSession.roomLifecycle,
        deletedAt: existingSession.deletedAt,
        createdAt: existingSession.createdAt,
        negotiationEndedAt: existingSession.negotiationEndedAt,
        negotiationState: existingSession.negotiationState,
        closedByEventAt: existingSession.closedByEventAt,
        occupancyCount,
        lastCurrentGenerationDepartureAt,
        parentEvent: existingSession.event,
        durations,
      });
      if (
        !stillDue.currentlyDue ||
        stillDue.reason !== SESSION_AUTO_CLOSE_REASONS.SESSION_ABANDONED_TIMEOUT
      ) {
        return {
          session: {
            id: existingSession.id,
            negotiationState: existingSession.negotiationState,
            roomLifecycle: existingSession.roomLifecycle,
            closeReason: existingSession.closeReason,
            closedByEventAt: existingSession.closedByEventAt,
          },
          alreadyFinished:
            existingSession.negotiationState === NegotiationState.FINISHED,
          sessionCloseApplied: false,
          sessionAlreadyClosed:
            existingSession.roomLifecycle === RoomLifecycle.CLOSED,
          stopIntent: null,
          recordingStatus: null,
          operationId: generateFinishOperationId(params.sessionId, params.mode),
        };
      }
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

    const activeConnectionCount =
      effectiveLifecycle === RoomLifecycle.CLOSED || hardClose
        ? 0
        : await countActiveSessionRoomConnections(params.sessionId, tx, now);
    const nextLifecycle = decideFinishRoomLifecycle({
      effectiveLifecycle,
      hardClose,
      activeConnectionCount,
    });

    const finishUpdateData = alreadyFinished
      ? {}
      : getCanonicalFinishUpdateData({
          session: existingSession,
          mode: params.mode,
          now,
        });

    const intermediateSession = await tx.session.update({
      where: { id: params.sessionId },
      data: {
        ...finishUpdateData,
        ...(!hardClose
          ? {
              roomLifecycle:
                effectiveLifecycle === RoomLifecycle.CLOSED
                  ? RoomLifecycle.CLOSED
                  : nextLifecycle,
            }
          : {}),
      },
      select: {
        id: true,
        negotiationState: true,
        roomLifecycle: true,
        closeReason: true,
        closedByEventAt: true,
      },
    });
    const finalClose = hardClose
      ? await finalizeSessionCanonicalClose(
          {
            sessionId: params.sessionId,
            authority:
              params.mode === "EVENT_COMPLETION"
                ? "EVENT_COMPLETION"
                : params.mode === "SESSION_ABANDONED_TIMEOUT"
                  ? "SESSION_ABANDONED_TIMEOUT"
                  : "FACILITATOR_SESSION_COMPLETE",
            now,
            durations,
            closedByEventId: params.closedByEventId ?? null,
          },
          tx,
        )
      : null;
    const session = finalClose?.session ?? intermediateSession;

    console.info(
      JSON.stringify({
        area: "session_completion",
        event: "canonical_session_finish_decision",
        sessionId: params.sessionId,
        mode: params.mode,
        hardClose,
        alreadyFinished,
        originalNegotiationState: existingSession.negotiationState,
        originalRoomLifecycle: existingSession.roomLifecycle,
        effectiveLifecycle,
        activeConnectionCount,
        nextLifecycle,
        resultingNegotiationState: session.negotiationState,
        resultingRoomLifecycle: session.roomLifecycle,
        decisionClock: now.toISOString(),
      }),
    );

    const stopIntentResult = await claimRecordingStopIntent({
      tx,
      sessionId: params.sessionId,
      mode: params.mode,
      reason,
    });

    return {
      session,
      alreadyFinished,
      sessionCloseApplied: finalClose?.applied ?? false,
      sessionAlreadyClosed:
        hardClose &&
        finalClose?.applied === false &&
        session.roomLifecycle === RoomLifecycle.CLOSED,
      stopIntent: stopIntentResult.stopIntent,
      recordingStatus: stopIntentResult.recordingStatus,
      operationId: generateFinishOperationId(params.sessionId, params.mode),
    };
  });

  if (
    !txResult.alreadyFinished &&
    (params.mode !== "SESSION_ABANDONED_TIMEOUT" || txResult.sessionCloseApplied)
  ) {
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
      client: db,
    });
    stopWarning = delivered.warning;
    stopState = delivered.state;
    fallbackScenarioMessage = delivered.fallbackScenarioMessage;
  }

  return {
    sessionId: txResult.session.id,
    alreadyFinished: txResult.alreadyFinished,
    sessionCloseApplied: txResult.sessionCloseApplied,
    sessionAlreadyClosed: txResult.sessionAlreadyClosed,
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
