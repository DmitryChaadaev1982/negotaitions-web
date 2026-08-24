import {
  NegotiationState,
  RecordingStatus,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import { getSessionLifecycleDurations } from "@/lib/config/session-lifecycle-settings";
import { stopRecording } from "@/lib/livekit-egress";
import { prisma } from "@/lib/prisma";
import { selectSessionLifecycleReconcileCandidateIds } from "@/lib/session-lifecycle-candidate-selection";
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
import { reconcileSessionAfterOccupancyChange } from "@/lib/session-empty-room-reconciliation";
import {
  deriveBackfillLifecycle,
  deriveRoomLifecycleBackfillUpdate,
  isRelayDeliveringTimeoutCandidate,
  RELAY_DELIVERING_TRANSPORTS,
} from "@/lib/stage-3-10-maintenance-utils";
import { buildVoximplantConferenceName } from "@/lib/voximplant/conference-name";
import { sendVoximplantServerStopCommand } from "@/lib/voximplant/server-stop-client";
import { getVoximplantServerStopConfig } from "@/lib/voximplant/server-stop-settings";
import { cleanupExpiredVoximplantCallbackNonces } from "@/lib/voximplant/server-stop-replay-store";

type JsonLogLevel = "info" | "warn" | "error";

function logMaintenance(
  level: JsonLogLevel,
  event: string,
  data: Record<string, unknown>,
) {
  const payload = {
    area: "stage_3_10_maintenance",
    event,
    level,
    ...data,
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export { deriveBackfillLifecycle };

export type ExpirySweepResult = {
  scanned: number;
  expired: number;
  sessionsChecked: number;
  roomsClosed: number;
  skipped: number;
  failures: number;
  evaluated: number;
  due: number;
  lostRace: number;
};

export async function runSessionConnectionExpirySweep(params?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<ExpirySweepResult> {
  const dryRun = Boolean(params?.dryRun);
  const limit = Math.max(1, Math.min(params?.limit ?? 500, 5000));
  const now = new Date();
  const candidates = await prisma.sessionRoomConnection.findMany({
    where: {
      disconnectedAt: null,
      supersededAt: null,
      revokedAt: null,
      expiresAt: { lte: now },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      sessionId: true,
      connectionId: true,
    },
  });

  const sessionIds = await selectSessionLifecycleReconcileCandidateIds({
    now,
    limit,
    durations: getSessionLifecycleDurations(),
    extraSessionIds: candidates.map((item) => item.sessionId),
  });
  if (dryRun) {
    return {
      scanned: candidates.length,
      expired: 0,
      sessionsChecked: sessionIds.length,
      roomsClosed: 0,
      skipped: candidates.length,
      failures: 0,
      evaluated: 0,
      due: 0,
      lostRace: 0,
    };
  }

  let expired = 0;
  let failures = 0;
  if (candidates.length > 0) {
    const update = await prisma.sessionRoomConnection.updateMany({
      where: {
        id: { in: candidates.map((item) => item.id) },
        disconnectedAt: null,
        supersededAt: null,
        revokedAt: null,
        expiresAt: { lte: now },
      },
      data: {
        disconnectedAt: now,
        disconnectedReason: "EXPIRED",
      },
    });
    expired = update.count;
  }

  let roomsClosed = 0;
  let evaluated = 0;
  let due = 0;
  let lostRace = 0;
  for (const sessionId of sessionIds) {
    try {
      const reconciliation = await reconcileSessionAfterOccupancyChange({
        sessionId,
        now,
        invocation: "periodic",
      });
      evaluated += 1;
      if (
        reconciliation.decision === "due" ||
        reconciliation.decision === "closed" ||
        reconciliation.decision === "lost_race"
      ) {
        due += 1;
      }
      if (reconciliation.decision === "lost_race") {
        lostRace += 1;
      }
      if (reconciliation.roomClosed) {
        roomsClosed += 1;
        logMaintenance("info", "room_closed_after_expiry", {
          sessionId,
          reason: reconciliation.roomClosureReason,
          completionReason: reconciliation.completionReason,
        });
      }
    } catch {
      failures += 1;
      logMaintenance("error", "reconciliation_failed_after_expiry", { sessionId });
    }
  }

  logMaintenance("info", "session_lifecycle_sweep_summary", {
    scanned: candidates.length,
    evaluated,
    due,
    closed: roomsClosed,
    lostRace,
    failures,
  });

  return {
    scanned: candidates.length,
    expired,
    sessionsChecked: sessionIds.length,
    roomsClosed,
    skipped: Math.max(0, candidates.length - expired),
    failures,
    evaluated,
    due,
    lostRace,
  };
}

export type RecordingStopSweepResult = {
  scanned: number;
  claimed: number;
  delivered: number;
  failed: number;
  pendingProviderTerminal: number;
  skipped: number;
  failures: number;
};

export async function runRecordingStopDeliverySweep(params?: {
  dryRun?: boolean;
  limit?: number;
}): Promise<RecordingStopSweepResult> {
  const dryRun = Boolean(params?.dryRun);
  const limit = Math.max(1, Math.min(params?.limit ?? 200, 2000));
  const now = new Date();
  const serverStopConfig = getVoximplantServerStopConfig();
  const terminalTimeoutCutoff = new Date(
    now.getTime() - serverStopConfig.terminalTimeoutSeconds * 1000,
  );
  const candidates = await prisma.sessionRecordingStopOperation.findMany({
    where: {
      OR: [
        {
          state: "PENDING",
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        {
          state: "FAILED",
          lastErrorClass: {
            notIn: TERMINAL_STOP_RETRY_ERROR_CLASSES as unknown as string[],
          },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        {
          state: "DELIVERING",
          transportAcceptedAt: { lte: terminalTimeoutCutoff },
          providerTerminalAt: null,
        },
        {
          state: "DELIVERING",
          transportAcceptedAt: null,
          commandAcceptedAt: null,
          providerTerminalAt: null,
          lastAttemptAt: { lte: terminalTimeoutCutoff },
          lastDeliveryTransport: {
            in: RELAY_DELIVERING_TRANSPORTS as unknown as string[],
          },
        },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
      state: true,
      lastDeliveryTransport: true,
      transportAcceptedAt: true,
      commandAcceptedAt: true,
      providerTerminalAt: true,
      lastAttemptAt: true,
    },
  });

  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let pendingProviderTerminal = 0;
  let skipped = 0;
  let failures = 0;

  async function buildBrowserRelayFallback(
    sessionId: string,
    recordingAttemptId?: string,
  ) {
    const facilitator = await prisma.sessionParticipant.findFirst({
      where: {
        sessionId,
        type: "FACILITATOR",
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, userId: true },
    });
    const { buildVoximplantRecordingDispatch } = await import(
      "@/lib/voximplant/recording-dispatch"
    );
    return buildVoximplantRecordingDispatch("stop", {
      sessionId,
      participantId: facilitator?.id ?? "maintenance_worker",
      controllerUserId:
        facilitator?.userId ?? `session_participant:${facilitator?.id ?? "maintenance_worker"}`,
      controllerRole: "facilitator",
      canControlRecording: true,
      recordingAttemptId,
    });
  }

  for (const candidate of candidates) {
    try {
      if (dryRun) {
        skipped += 1;
        continue;
      }

      const isRelayTimeoutCandidate = isRelayDeliveringTimeoutCandidate(
        candidate,
        terminalTimeoutCutoff,
      );
      const claim = isRelayTimeoutCandidate
        ? await prisma.sessionRecordingStopOperation.updateMany({
            where: {
              id: candidate.id,
              state: "DELIVERING",
              transportAcceptedAt: null,
              commandAcceptedAt: null,
              providerTerminalAt: null,
              lastAttemptAt: { lte: terminalTimeoutCutoff },
              lastDeliveryTransport: {
                in: RELAY_DELIVERING_TRANSPORTS as unknown as string[],
              },
            },
            data: {
              attemptCount: { increment: 1 },
              lastAttemptAt: now,
              lastDeliveryTransport: "maintenance_worker_relay_claim_timeout_probe",
            },
          })
        : candidate.state === "DELIVERING"
          ? await prisma.sessionRecordingStopOperation.updateMany({
              where: {
                id: candidate.id,
                state: "DELIVERING",
                transportAcceptedAt: { lte: terminalTimeoutCutoff },
                providerTerminalAt: null,
              },
              data: {
                attemptCount: { increment: 1 },
                lastAttemptAt: now,
                lastDeliveryTransport: "maintenance_worker",
              },
            })
          : await prisma.sessionRecordingStopOperation.updateMany({
              where: {
                id: candidate.id,
                OR: [
                  {
                    state: "PENDING",
                    OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
                  },
                  {
                    state: "FAILED",
                    lastErrorClass: {
                      notIn: TERMINAL_STOP_RETRY_ERROR_CLASSES as unknown as string[],
                    },
                    OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
                  },
                ],
              },
              data: {
                state: "DELIVERING",
                attemptCount: { increment: 1 },
                lastAttemptAt: now,
                lastError: null,
                lastErrorClass: null,
                nextRetryAt: null,
                lastDeliveryTransport: "maintenance_worker",
              },
            });
      if (claim.count === 0) {
        skipped += 1;
        continue;
      }

      claimed += 1;
      const operation = await prisma.sessionRecordingStopOperation.findUnique({
        where: { id: candidate.id },
        include: { recording: true },
      });
      if (!operation) {
        skipped += 1;
        continue;
      }
      const provider = resolveEffectiveRecordingProvider(
        operation.recording.provider,
      );

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
        delivered += 1;
        continue;
      }

      if (
        shouldDeferStartingStopForMissingProviderId({
          provider,
          recordingStatus: operation.recording.status,
          egressId: operation.recording.egressId,
        })
      ) {
        const retry = resolveStartingNotReadyFailure(operation.attemptCount);
        await prisma.$transaction(async (tx) => {
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
                recordingAttemptId:
                  operation.recording.recordingAttemptId,
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
        failed += 1;
        continue;
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
          delivered += 1;
        } else {
          await prisma.sessionRecordingStopOperation.update({
            where: { id: operation.id },
            data: {
              state: "FAILED",
              failedAt: new Date(),
              lastErrorClass: "LIVEKIT_STOP_DELIVERY_FAILED",
              lastError: result.warning ?? "livekitStopDeliveryFailed",
              nextRetryAt: scheduleStopRetry(operation.attemptCount),
              lastDeliveryTransport: "livekit_api",
            },
          });
          failed += 1;
        }
        continue;
      }

      if (serverStopConfig.mode !== "disabled") {
        const expectedConferenceName = buildVoximplantConferenceName(
          operation.sessionId,
        );
        const controlChannel = await prisma.sessionVoximplantControlChannel.findUnique(
          {
            where: { sessionId: operation.sessionId },
            select: {
              conferenceName: true,
              providerSessionId: true,
              controlUrl: true,
              controlUrlFingerprint: true,
            },
          },
        );
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
            const dispatch = await buildBrowserRelayFallback(
              operation.sessionId,
              operation.recording.recordingAttemptId ?? undefined,
            );
            await prisma.sessionRecordingStopOperation.update({
              where: { id: operation.id },
              data: {
                state: "FAILED",
                failedAt: new Date(),
                lastErrorClass: retry.lastErrorClass,
                lastError: retry.lastError,
                nextRetryAt: retry.nextRetryAt,
                lastDeliveryTransport: "voximplant_browser_relay",
                fallbackPayload: dispatch.scenarioMessage,
              },
            });
          } else {
            await prisma.sessionRecordingStopOperation.update({
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
          }
          failed += 1;
          continue;
        }
        const activeControlChannel = controlChannel!;

        const transport = await sendVoximplantServerStopCommand({
          controlUrl: activeControlChannel.controlUrl,
          controlUrlFingerprint: activeControlChannel.controlUrlFingerprint,
          controlSecret: serverStopConfig.controlSecret!,
          timeoutMs: serverStopConfig.controlTimeoutMs,
          operationId: operation.operationId,
          sessionId: operation.sessionId,
          conferenceName: activeControlChannel.conferenceName,
          providerSessionId: activeControlChannel.providerSessionId,
          recordingAttemptId:
            operation.recording.recordingAttemptId ?? undefined,
        });

        if (transport.code === "TRANSPORT_ACCEPTED") {
          await prisma.sessionRecordingStopOperation.update({
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
          pendingProviderTerminal += 1;
          continue;
        }

        const retry = resolveServerControlTransportFailure(
          operation.attemptCount,
          transport.code,
        );
        if (relayFallbackAllowed) {
          const dispatch = await buildBrowserRelayFallback(
            operation.sessionId,
            operation.recording.recordingAttemptId ?? undefined,
          );
          await prisma.sessionRecordingStopOperation.update({
            where: { id: operation.id },
            data: {
              state: "FAILED",
              failedAt: new Date(),
              lastErrorClass: retry.lastErrorClass,
              lastError: transport.warning ?? retry.lastError,
              nextRetryAt: retry.nextRetryAt,
              lastDeliveryTransport: "voximplant_browser_relay",
              fallbackPayload: dispatch.scenarioMessage,
            },
          });
        } else {
          await prisma.sessionRecordingStopOperation.update({
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
        }
        failed += 1;
        continue;
      }

      const dispatch = await buildBrowserRelayFallback(
        operation.sessionId,
        operation.recording.recordingAttemptId ?? undefined,
      );
      const retry = resolveVoxRelayFailure(operation.attemptCount);
      await prisma.sessionRecordingStopOperation.update({
        where: { id: operation.id },
        data: {
          state: "FAILED",
          failedAt: new Date(),
          lastErrorClass: retry.lastErrorClass,
          lastError: retry.lastError,
          nextRetryAt: retry.nextRetryAt,
          lastDeliveryTransport: "voximplant_browser_relay",
          fallbackPayload: dispatch.scenarioMessage,
        },
      });
      if (retry.terminal) {
        logMaintenance("warn", "voximplant_browser_relay_terminal", {
          operationId: operation.id,
          sessionId: operation.sessionId,
        });
      }
      failed += 1;
    } catch {
      failures += 1;
      logMaintenance("error", "recording_stop_delivery_failed", {
        operationId: candidate.id,
      });
    }
  }

  return {
    scanned: candidates.length,
    claimed,
    delivered,
    failed,
    pendingProviderTerminal,
    skipped,
    failures,
  };
}

export type CallbackNonceCleanupResult = {
  scanned: number;
  deleted: number;
};

export async function runVoximplantCallbackNonceCleanup(params?: {
  dryRun?: boolean;
}): Promise<CallbackNonceCleanupResult> {
  const now = new Date();
  const scanned = await prisma.voximplantCallbackNonce.count({
    where: {
      expiresAt: { lt: now },
    },
  });
  if (params?.dryRun) {
    return { scanned, deleted: 0 };
  }
  const deleted = await cleanupExpiredVoximplantCallbackNonces(now);
  return { scanned, deleted };
}

export type BackfillResult = {
  scanned: number;
  updated: number;
  skipped: number;
  openDerived: number;
  closedDerived: number;
  ambiguous: number;
  nextCursor: string | null;
};

export async function runRoomLifecycleBackfill(params?: {
  dryRun?: boolean;
  batchSize?: number;
  cursorAfterId?: string | null;
}): Promise<BackfillResult> {
  const dryRun = Boolean(params?.dryRun);
  const batchSize = Math.max(1, Math.min(params?.batchSize ?? 500, 5000));
  const sessions = await prisma.session.findMany({
    where: {
      roomLifecycle: null,
      ...(params?.cursorAfterId
        ? { id: { gt: params.cursorAfterId } }
        : {}),
    },
    orderBy: { id: "asc" },
    take: batchSize,
    select: {
      id: true,
      roomLifecycle: true,
      deletedAt: true,
      closedByEventAt: true,
      negotiationState: true,
      event: { select: { status: true } },
    },
  });

  let updated = 0;
  let openDerived = 0;
  let closedDerived = 0;
  let ambiguous = 0;

  for (const session of sessions) {
    const updateData = deriveRoomLifecycleBackfillUpdate({
      roomLifecycle: session.roomLifecycle,
      deletedAt: session.deletedAt,
      closedByEventAt: session.closedByEventAt,
      negotiationState: session.negotiationState,
      eventStatus: session.event?.status ?? null,
    });
    if (!updateData) {
      ambiguous += 1;
      continue;
    }
    const next = updateData.roomLifecycle;
    if (next === RoomLifecycle.OPEN) openDerived += 1;
    if (next === RoomLifecycle.CLOSED) closedDerived += 1;

    if (dryRun) {
      continue;
    }

    const result = await prisma.session.updateMany({
      where: { id: session.id, roomLifecycle: null },
      data: updateData,
    });
    updated += result.count;
    if (result.count === 0) {
      ambiguous += 1;
    }
  }

  return {
    scanned: sessions.length,
    updated,
    skipped: Math.max(0, sessions.length - updated),
    openDerived,
    closedDerived,
    ambiguous,
    nextCursor: sessions.at(-1)?.id ?? null,
  };
}

export type BackfillVerification = {
  remainingNull: number;
  byLifecycle: Array<{ lifecycle: string; count: number }>;
  finishedOpen: number;
  closedWithActiveConnection: number;
  completedEventNonClosed: number;
};

export async function verifyRoomLifecycleBackfill(): Promise<BackfillVerification> {
  const [remainingNull, byLifecycleRows, finishedOpen, closedWithActiveConnection, completedEventNonClosed] =
    await Promise.all([
      prisma.session.count({ where: { roomLifecycle: null } }),
      prisma.$queryRaw<Array<{ lifecycle: string; count: bigint }>>`
        SELECT COALESCE("roomLifecycle"::text, 'NULL') AS lifecycle,
               COUNT(*)::bigint AS count
        FROM "Session"
        GROUP BY 1
        ORDER BY 1
      `,
      prisma.session.count({
        where: {
          negotiationState: NegotiationState.FINISHED,
          roomLifecycle: RoomLifecycle.OPEN,
        },
      }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "Session" s
        WHERE s."roomLifecycle" = 'CLOSED'
          AND EXISTS (
            SELECT 1
            FROM "SessionRoomConnection" src
            WHERE src."sessionId" = s.id
              AND src."disconnectedAt" IS NULL
              AND src."supersededAt" IS NULL
              AND src."revokedAt" IS NULL
              AND src."expiresAt" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
          )
      `,
      prisma.session.count({
        where: {
          event: { status: TrainingEventStatus.COMPLETED },
          roomLifecycle: { not: RoomLifecycle.CLOSED },
        },
      }),
    ]);

  return {
    remainingNull,
    byLifecycle: byLifecycleRows.map((row) => ({
      lifecycle: row.lifecycle,
      count: Number(row.count),
    })),
    finishedOpen,
    closedWithActiveConnection: Number(closedWithActiveConnection[0]?.count ?? 0),
    completedEventNonClosed,
  };
}

