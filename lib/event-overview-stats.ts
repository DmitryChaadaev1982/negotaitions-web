import { NegotiationState } from "@/app/generated/prisma/client";
import {
  type EventOverviewStats,
  isEventActiveForPresence,
  type TrainingEventListItem,
} from "@/lib/event-overview-shared";
import { prisma } from "@/lib/prisma";

export type { EventOverviewStats, TrainingEventListItem } from "@/lib/event-overview-shared";
export {
  applyEventOverviewStats,
  isEventActiveForPresence,
} from "@/lib/event-overview-shared";

function isActiveSession(session: {
  closedByEventAt: Date | null;
  negotiationState: NegotiationState;
  status?: string;
}) {
  return (
    session.closedByEventAt == null &&
    session.negotiationState !== NegotiationState.FINISHED &&
    session.status !== "COMPLETED"
  );
}

function isFinishedSession(session: {
  closedByEventAt: Date | null;
  negotiationState: NegotiationState;
  status?: string;
}) {
  return (
    session.closedByEventAt != null ||
    session.negotiationState === NegotiationState.FINISHED ||
    session.status === "COMPLETED"
  );
}

function countUniqueSessionParticipants(
  sessions: Array<{
    participants: Array<{
      id: string;
      eventParticipantId: string | null;
    }>;
  }>,
) {
  const participated = new Set<string>();

  for (const session of sessions) {
    for (const participant of session.participants) {
      participated.add(participant.eventParticipantId ?? participant.id);
    }
  }

  return participated.size;
}

function countParticipantsInLobby(
  participants: Array<{ id: string }>,
  sessions: Array<{
    closedByEventAt: Date | null;
    negotiationState: NegotiationState;
    status: string;
    participants: Array<{ eventParticipantId: string | null }>;
  }>,
) {
  const activeAssignmentIds = new Set<string>();

  for (const session of sessions.filter(isActiveSession)) {
    for (const participant of session.participants) {
      if (participant.eventParticipantId) {
        activeAssignmentIds.add(participant.eventParticipantId);
      }
    }
  }

  return participants.filter((participant) => !activeAssignmentIds.has(participant.id)).length;
}

function countActiveSessionParticipants(
  sessions: Array<{
    closedByEventAt: Date | null;
    negotiationState: NegotiationState;
    status: string;
    participants: Array<{ eventParticipantId: string | null; id: string }>;
  }>,
) {
  const activeParticipantIds = new Set<string>();

  for (const session of sessions.filter(isActiveSession)) {
    for (const participant of session.participants) {
      activeParticipantIds.add(participant.eventParticipantId ?? participant.id);
    }
  }

  return activeParticipantIds.size;
}

function latestActivityIso(dates: Array<Date | null | undefined>) {
  const latest = dates
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return latest?.toISOString() ?? null;
}

export async function getTrainingEventsForList(
  limit?: number,
): Promise<TrainingEventListItem[]> {
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
          id: true,
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
          status: true,
          updatedAt: true,
          createdAt: true,
          recording: {
            select: { id: true, updatedAt: true },
          },
          transcript: {
            select: { id: true, updatedAt: true },
          },
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
    const activeSessions = event.sessions.filter(isActiveSession).length;
    const finishedSessions = event.sessions.filter(isFinishedSession).length;
    const participantsInLobby = countParticipantsInLobby(
      event.participants,
      event.sessions,
    );
    const participantsInActiveSessions = countActiveSessionParticipants(event.sessions);
    const uniqueParticipantsWithSessions = countUniqueSessionParticipants(event.sessions);
    const recordingsCount = event.sessions.filter((session) => session.recording).length;
    const transcriptsCount = event.sessions.filter((session) => session.transcript).length;
    const latestActivityAt = latestActivityIso([
      event.createdAt,
      ...event.participants.map((participant) => participant.lastSeenAt),
      ...event.sessions.flatMap((session) => [
        session.createdAt,
        session.updatedAt,
        session.recording?.updatedAt,
        session.transcript?.updatedAt,
        ...session.participants.map((participant) => participant.lastSeenAt),
      ]),
    ]);

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
        ? participantsInLobby
        : 0,
      sessionCount: event.sessions.length,
      totalSessions: event.sessions.length,
      activeSessions,
      finishedSessions,
      participantsInLobby: presenceActive ? participantsInLobby : 0,
      participantsInActiveSessions: presenceActive
        ? participantsInActiveSessions
        : 0,
      uniqueParticipantsWithSessions,
      recordingsCount,
      transcriptsCount,
      latestActivityAt,
      activeSessionParticipantCount: presenceActive
        ? participantsInActiveSessions
        : 0,
      totalSessionParticipantCount: uniqueParticipantsWithSessions,
    };
  });
}

export async function getEventOverviewStats(): Promise<EventOverviewStats[]> {
  const events = await getTrainingEventsForList();

  return events.map((event) => ({
    id: event.id,
    lobbyParticipantCount: event.lobbyParticipantCount,
    sessionCount: event.sessionCount,
    totalSessions: event.totalSessions,
    activeSessions: event.activeSessions,
    finishedSessions: event.finishedSessions,
    participantsInLobby: event.participantsInLobby,
    participantsInActiveSessions: event.participantsInActiveSessions,
    uniqueParticipantsWithSessions: event.uniqueParticipantsWithSessions,
    recordingsCount: event.recordingsCount,
    transcriptsCount: event.transcriptsCount,
    latestActivityAt: event.latestActivityAt,
    activeSessionParticipantCount: event.activeSessionParticipantCount,
    totalSessionParticipantCount: event.totalSessionParticipantCount,
  }));
}
