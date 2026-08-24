import type { ParticipantPresenceSnapshot } from "@/lib/presence";
import { prisma } from "@/lib/prisma";
import {
  deriveSessionCurrentPresenceSnapshots,
  liveSessionRoomConnectionWhere,
} from "@/lib/session-current-presence";

export async function loadSessionCurrentPresenceSnapshots(
  sessionId: string,
  now: Date = new Date(),
): Promise<ParticipantPresenceSnapshot[] | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId },
    select: {
      status: true,
      negotiationState: true,
      roomLifecycle: true,
      closedByEventAt: true,
      deletedAt: true,
      event: {
        select: {
          status: true,
          completedAt: true,
        },
      },
      participants: {
        select: {
          id: true,
          userId: true,
          joinedAt: true,
          lastSeenAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
      roomConnections: {
        where: liveSessionRoomConnectionWhere(now),
        select: {
          userId: true,
          sessionId: true,
          disconnectedAt: true,
          revokedAt: true,
          supersededAt: true,
          expiresAt: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  return deriveSessionCurrentPresenceSnapshots({
    session,
    participants: session.participants,
    connections: session.roomConnections,
    now,
  });
}
