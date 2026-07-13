import {
  NegotiationState,
  RecordingStatus,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import { stopRecording } from "@/lib/livekit-egress";
import { prisma } from "@/lib/prisma";
import {
  resolveStartingNotReadyFailure,
  resolveVoxRelayFailure,
  scheduleStopRetry,
} from "@/lib/recording-stop-delivery-policy";
import { resolveEffectiveRecordingProvider } from "@/lib/recording/provider";
import { closeDebriefRoomIfEmpty } from "@/lib/session-room-occupancy";
import {
  deriveBackfillLifecycle,
} from "@/lib/stage-3-10-maintenance-utils";
import { buildVoximplantRecordingDispatch } from "@/lib/voximplant/recording-dispatch";

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

  const sessionIds = new Set(candidates.map((item) => item.sessionId));
  if (dryRun) {
    return {
      scanned: candidates.length,
      expired: 0,
      sessionsChecked: sessionIds.size,
      roomsClosed: 0,
      skipped: candidates.length,
      failures: 0,
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
  for (const sessionId of sessionIds) {
    try {
      const closure = await closeDebriefRoomIfEmpty(sessionId);
      if (closure.closed) {
        roomsClosed += 1;
        logMaintenance("info", "room_closed_after_expiry", {
          sessionId,
          reason: closure.reason,
        });
      } else {
        logMaintenance("info", "room_closure_skipped_after_expiry", {
          sessionId,
          reason: closure.reason,
          activeConnectionCount: closure.activeConnectionCount,
        });
      }
    } catch {
      failures += 1;
      logMaintenance("error", "room_closure_failed_after_expiry", { sessionId });
    }
  }

  return {
    scanned: candidates.length,
    expired,
    sessionsChecked: sessionIds.size,
    roomsClosed,
    skipped: Math.max(0, candidates.length - expired),
    failures,
  };
}

export type RecordingStopSweepResult = {
  scanned: number;
  claimed: number;
  delivered: number;
  failed: number;
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
  const candidates = await prisma.sessionRecordingStopOperation.findMany({
    where: {
      state: { in: ["PENDING", "FAILED"] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit,
    select: {
      id: true,
    },
  });

  let claimed = 0;
  let delivered = 0;
  let failed = 0;
  let skipped = 0;
  let failures = 0;

  for (const candidate of candidates) {
    try {
      if (dryRun) {
        skipped += 1;
        continue;
      }

      const claim = await prisma.sessionRecordingStopOperation.updateMany({
        where: {
          id: candidate.id,
          state: { in: ["PENDING", "FAILED"] },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
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
        failed += 1;
        continue;
      }

      const provider = resolveEffectiveRecordingProvider(operation.recording.provider);
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

      const facilitator = await prisma.sessionParticipant.findFirst({
        where: {
          sessionId: operation.sessionId,
          type: "FACILITATOR",
        },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      const dispatch = await buildVoximplantRecordingDispatch("stop", {
        sessionId: operation.sessionId,
        participantId: facilitator?.id,
        role: "facilitator",
      });
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
    skipped,
    failures,
  };
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
    const next = deriveBackfillLifecycle({
      deletedAt: session.deletedAt,
      closedByEventAt: session.closedByEventAt,
      negotiationState: session.negotiationState,
      eventStatus: session.event?.status ?? null,
    });
    if (next === RoomLifecycle.OPEN) openDerived += 1;
    if (next === RoomLifecycle.CLOSED) closedDerived += 1;

    if (dryRun) {
      continue;
    }

    const result = await prisma.session.updateMany({
      where: { id: session.id, roomLifecycle: null },
      data: { roomLifecycle: next },
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
              AND src."expiresAt" > NOW()
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

