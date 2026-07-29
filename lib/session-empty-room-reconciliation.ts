import { NegotiationState } from "@/app/generated/prisma/client";
import { getDebriefAutoCloseGraceMs } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  closeDebriefRoomIfEmpty,
  countActiveSessionRoomConnections,
  evaluateDebriefAutoCloseEligibility,
  getLastInvalidatedSessionRoomConnectionAt,
} from "@/lib/session-room-occupancy";

export type EmptyRoomReconciliationResult = {
  roomClosed: boolean;
  roomClosureReason: string;
  roomClosureActiveConnectionCount: number;
  sessionCompleted: boolean;
  alreadyCompleted: boolean;
  completionReason: string;
  activeConnectionCount: number;
  graceRemainingMs: number;
};

export async function reconcileSessionAfterOccupancyChange(params: {
  sessionId: string;
  now?: Date;
  graceMs?: number;
}): Promise<EmptyRoomReconciliationResult> {
  const now = params.now ?? new Date();
  const graceMs = params.graceMs ?? getDebriefAutoCloseGraceMs();

  const roomClosure = await closeDebriefRoomIfEmpty(params.sessionId, prisma, {
    now,
    graceMs,
  });
  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
    select: {
      id: true,
      deletedAt: true,
      negotiationState: true,
      roomLifecycle: true,
    },
  });

  if (!session || session.deletedAt) {
    return {
      roomClosed: roomClosure.closed,
      roomClosureReason: roomClosure.reason,
      roomClosureActiveConnectionCount: roomClosure.activeConnectionCount,
      sessionCompleted: false,
      alreadyCompleted: false,
      completionReason: "session_not_found",
      activeConnectionCount: roomClosure.activeConnectionCount,
      graceRemainingMs: 0,
    };
  }

  const activeConnectionCount = await countActiveSessionRoomConnections(session.id);
  const lastInvalidatedAt = await getLastInvalidatedSessionRoomConnectionAt(session.id);
  const debriefEligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: session.roomLifecycle,
    activeConnectionCount,
    lastInvalidatedAt,
    now,
    graceMs,
  });

  const completionReason =
    debriefEligibility.reason === "room_not_debrief_open" &&
    session.negotiationState === NegotiationState.FINISHED
      ? "already_finished"
      : debriefEligibility.reason;

  return {
    roomClosed: roomClosure.closed,
    roomClosureReason: roomClosure.reason,
    roomClosureActiveConnectionCount: roomClosure.activeConnectionCount,
    sessionCompleted: false,
    alreadyCompleted: session.negotiationState === NegotiationState.FINISHED,
    completionReason,
    activeConnectionCount,
    graceRemainingMs: debriefEligibility.graceRemainingMs,
  };
}
