import { NegotiationState } from "@/app/generated/prisma/client";
import { getSessionLifecycleDurations } from "@/lib/config/session-lifecycle-settings";
import { prisma } from "@/lib/prisma";
import {
  countActiveSessionRoomConnections,
  getLastCurrentGenerationDepartureAt,
  reconcileSessionAutomaticClose,
  type SessionAutomaticCloseDecision,
} from "@/lib/session-room-occupancy";
import { evaluateSessionLifecyclePolicy } from "@/lib/session-lifecycle-policy";

export type EmptyRoomReconciliationResult = {
  roomClosed: boolean;
  roomClosureReason: string;
  roomClosureActiveConnectionCount: number;
  sessionCompleted: boolean;
  alreadyCompleted: boolean;
  completionReason: string;
  activeConnectionCount: number;
  graceRemainingMs: number;
  decision: SessionAutomaticCloseDecision;
};

export async function reconcileSessionAfterOccupancyChange(params: {
  sessionId: string;
  now?: Date;
  graceMs?: number;
  invocation?: "periodic" | "transition";
}): Promise<EmptyRoomReconciliationResult> {
  const now = params.now ?? new Date();
  const durations = getSessionLifecycleDurations();
  if (params.graceMs != null) {
    durations.debriefEmptyCloseMs = params.graceMs;
  }

  const roomClosure = await reconcileSessionAutomaticClose(
    params.sessionId,
    prisma,
    { now, durations, invocation: params.invocation ?? "transition" },
  );
  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
    select: {
      id: true,
      deletedAt: true,
      createdAt: true,
      negotiationState: true,
      negotiationEndedAt: true,
      roomLifecycle: true,
      closedByEventAt: true,
      event: {
        select: {
          scheduledAt: true,
          status: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!session || session.deletedAt) {
    return {
      roomClosed: roomClosure.closed,
      roomClosureReason: roomClosure.reason,
      roomClosureActiveConnectionCount: roomClosure.activeConnectionCount,
      sessionCompleted: roomClosure.closed,
      alreadyCompleted: false,
      completionReason: "session_not_found",
      activeConnectionCount: roomClosure.activeConnectionCount,
      graceRemainingMs: 0,
      decision: roomClosure.decision,
    };
  }

  const activeConnectionCount = await countActiveSessionRoomConnections(
    session.id,
    prisma,
    now,
  );
  const lastCurrentGenerationDepartureAt =
    await getLastCurrentGenerationDepartureAt(session.id, prisma, now);
  const policy =
    roomClosure.policy ??
    evaluateSessionLifecyclePolicy({
      now,
      roomLifecycle: session.roomLifecycle,
      deletedAt: session.deletedAt,
      createdAt: session.createdAt,
      negotiationEndedAt: session.negotiationEndedAt,
      negotiationState: session.negotiationState,
      closedByEventAt: session.closedByEventAt,
      occupancyCount: activeConnectionCount,
      lastCurrentGenerationDepartureAt,
      parentEvent: session.event,
      durations,
    });

  const completionReason =
    roomClosure.closed
      ? policy.reason ?? "room_closed"
      : policy.decision === "already_terminal" &&
          session.negotiationState === NegotiationState.FINISHED
        ? "already_finished"
        : policy.whyNotDue ?? policy.decision;

  return {
    roomClosed: roomClosure.closed,
    roomClosureReason: roomClosure.reason,
    roomClosureActiveConnectionCount: roomClosure.activeConnectionCount,
    sessionCompleted: roomClosure.closed,
    alreadyCompleted:
      !roomClosure.closed &&
      session.negotiationState === NegotiationState.FINISHED &&
      session.roomLifecycle !== "DEBRIEF_OPEN",
    completionReason,
    activeConnectionCount,
    graceRemainingMs: policy.remainingMs,
    decision: roomClosure.decision,
  };
}
