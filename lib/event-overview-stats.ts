import { NegotiationState } from "@/app/generated/prisma/client";
import {
  type EventOverviewStats,
  isEventActiveForPresence,
  type TrainingEventListItem,
} from "@/lib/event-overview-shared";
import { PRESENCE_ONLINE_THRESHOLD_MS } from "@/lib/presence";
import { prisma } from "@/lib/prisma";

export type { EventOverviewStats, TrainingEventListItem } from "@/lib/event-overview-shared";
export {
  applyEventOverviewStats,
  isEventActiveForPresence,
} from "@/lib/event-overview-shared";

function isOnline(lastSeenAt: Date | null, onlineThreshold: Date) {
  return lastSeenAt != null && lastSeenAt >= onlineThreshold;
}

function isActiveSession(session: {
  closedByEventAt: Date | null;
  negotiationState: NegotiationState;
}) {
  return (
    session.closedByEventAt == null &&
    session.negotiationState !== NegotiationState.FINISHED
  );
}

function countTotalSessionParticipants(
  sessions: Array<{
    participants: Array<{
      id: string;
      eventParticipantId: string | null;
      joinedAt: Date | null;
    }>;
  }>,
) {
  const participated = new Set<string>();

  for (const session of sessions) {
    for (const participant of session.participants) {
      if (participant.joinedAt != null) {
        participated.add(participant.eventParticipantId ?? participant.id);
      }
    }
  }

  return participated.size;
}

function countLobbyParticipants(
  participants: Array<{ lastSeenAt: Date | null }>,
  onlineThreshold: Date,
) {
  return participants.filter((participant) =>
    isOnline(participant.lastSeenAt, onlineThreshold),
  ).length;
}

function countActiveSessionParticipants(
  sessions: Array<{
    closedByEventAt: Date | null;
    negotiationState: NegotiationState;
    participants: Array<{ lastSeenAt: Date | null }>;
  }>,
  onlineThreshold: Date,
) {
  return sessions
    .filter(isActiveSession)
    .reduce(
      (total, session) =>
        total +
        session.participants.filter((participant) =>
          isOnline(participant.lastSeenAt, onlineThreshold),
        ).length,
      0,
    );
}

export async function getTrainingEventsForList(
  limit?: number,
): Promise<TrainingEventListItem[]> {
  const onlineThreshold = new Date(Date.now() - PRESENCE_ONLINE_THRESHOLD_MS);

  const events = await prisma.trainingEvent.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      title: true,
      status: true,
      scheduledAt: true,
      hostToken: true,
      publicJoinCode: true,
      createdAt: true,
      participants: {
        select: {
          participantToken: true,
          isHost: true,
          lastSeenAt: true,
        },
      },
      sessions: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          closedByEventAt: true,
          negotiationState: true,
          participants: {
            select: {
              id: true,
              eventParticipantId: true,
              joinedAt: true,
              lastSeenAt: true,
            },
          },
        },
      },
    },
  });

  return events.map((event) => {
    const hostParticipant = event.participants.find((participant) => participant.isHost);
    const presenceActive = isEventActiveForPresence(event.status);

    return {
      id: event.id,
      title: event.title,
      status: event.status,
      scheduledAt: event.scheduledAt?.toISOString() ?? null,
      hostToken: event.hostToken,
      hostParticipantToken: hostParticipant?.participantToken ?? null,
      publicJoinCode: event.publicJoinCode,
      primarySessionId: event.sessions[0]?.id ?? null,
      createdAt: event.createdAt.toISOString(),
      lobbyParticipantCount: presenceActive
        ? countLobbyParticipants(event.participants, onlineThreshold)
        : 0,
      sessionCount: event.sessions.length,
      activeSessionParticipantCount: presenceActive
        ? countActiveSessionParticipants(event.sessions, onlineThreshold)
        : 0,
      totalSessionParticipantCount: countTotalSessionParticipants(event.sessions),
    };
  });
}

export async function getEventOverviewStats(): Promise<EventOverviewStats[]> {
  const events = await getTrainingEventsForList();

  return events.map((event) => ({
    id: event.id,
    lobbyParticipantCount: event.lobbyParticipantCount,
    sessionCount: event.sessionCount,
    activeSessionParticipantCount: event.activeSessionParticipantCount,
    totalSessionParticipantCount: event.totalSessionParticipantCount,
  }));
}
