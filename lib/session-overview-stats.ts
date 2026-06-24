import { getDemoFacilitator } from "@/lib/demo-user";
import { getEventLobbyUrl } from "@/lib/config";
import { secondsToDisplayMinutes } from "@/lib/negotiation-duration";
import { PRESENCE_ONLINE_THRESHOLD_MS } from "@/lib/presence";
import { prisma } from "@/lib/prisma";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";
import {
  isSessionActiveForPresence,
  type SessionListItem,
  type SessionOverviewStats,
} from "@/lib/session-overview-shared";
import { activeSessionWhere } from "@/lib/soft-delete";

export type { SessionListItem, SessionOverviewStats } from "@/lib/session-overview-shared";
export {
  applySessionOverviewStats,
  isSessionActiveForPresence,
} from "@/lib/session-overview-shared";

function isOnline(lastSeenAt: Date | null, onlineThreshold: Date) {
  return lastSeenAt != null && lastSeenAt >= onlineThreshold;
}

export async function getSessionsForList(): Promise<SessionListItem[]> {
  const facilitator = await getDemoFacilitator();
  const onlineThreshold = new Date(Date.now() - PRESENCE_ONLINE_THRESHOLD_MS);

  const sessions = await prisma.session.findMany({
    where: { facilitatorId: facilitator.id, ...activeSessionWhere },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      snapshotCaseTitle: true,
      status: true,
      negotiationState: true,
      closedByEventAt: true,
      durationSeconds: true,
      createdAt: true,
      event: {
        select: {
          id: true,
          title: true,
          status: true,
          hostToken: true,
          participants: {
            where: { isHost: true },
            select: { participantToken: true },
            take: 1,
          },
        },
      },
      participants: {
        select: {
          type: true,
          joinedAt: true,
          lastSeenAt: true,
          joinToken: true,
        },
      },
      _count: {
        select: { participants: true },
      },
    },
  });

  return sessions.map((session) => {
    const presenceActive = isSessionActiveForPresence(session);
    const facilitatorJoinToken =
      session.participants.find((participant) => participant.type === "FACILITATOR")
        ?.joinToken ?? null;

    return {
      id: session.id,
      title: session.title,
      caseTitle: session.snapshotCaseTitle,
      eventId: session.event?.id ?? null,
      eventTitle: session.event?.title ?? null,
      eventStatus: session.event?.status ?? null,
      eventLobbyUrl: session.event
        ? getEventLobbyUrl(session.event.id, {
            hostToken: session.event.hostToken,
            participantToken: session.event.participants[0]?.participantToken,
          })
        : null,
      status: resolveSessionDisplayStatus(session, session.participants),
      negotiationState: session.negotiationState,
      closedByEventAt: session.closedByEventAt?.toISOString() ?? null,
      facilitatorJoinToken,
      participantCount: session._count.participants,
      onlineParticipantCount: presenceActive
        ? session.participants.filter((participant) =>
            isOnline(participant.lastSeenAt, onlineThreshold),
          ).length
        : 0,
      durationMinutes: secondsToDisplayMinutes(session.durationSeconds),
      createdAt: session.createdAt.toISOString(),
    };
  });
}

export async function getSessionOverviewStats(): Promise<SessionOverviewStats[]> {
  const sessions = await getSessionsForList();

  return sessions.map((session) => ({
    id: session.id,
    onlineParticipantCount: session.onlineParticipantCount,
  }));
}
