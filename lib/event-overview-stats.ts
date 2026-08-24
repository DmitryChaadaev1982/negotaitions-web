import { NegotiationState } from "@/app/generated/prisma/client";
import type { AuthUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import {
  type EventOverviewStats,
  isEventActiveForPresence,
  type TrainingEventListItem,
} from "@/lib/event-overview-shared";
import { normalizeUserEmail } from "@/lib/invite-email";
import { prisma } from "@/lib/prisma";
import { derivePresenceBuckets } from "@/lib/event-presence-buckets";
import { eventVisibilityWhere } from "@/lib/visibility";

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

function latestActivityIso(dates: Array<Date | null | undefined>) {
  const latest = dates
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return latest?.toISOString() ?? null;
}

export async function getTrainingEventsForList(
  limit?: number,
): Promise<TrainingEventListItem[]> {
  return getEventsForUser(null, limit);
}

export async function getEventsForUser(
  user: AuthUser | null,
  limit?: number,
): Promise<TrainingEventListItem[]> {
  const where =
    user && !isAdmin(user)
      ? eventVisibilityWhere(user.id, normalizeUserEmail(user.email))
      : { deletedAt: null };

  const events = await prisma.trainingEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    ...(limit ? { take: limit } : {}),
    select: {
      id: true,
      title: true,
      hostUserId: true,
      facilitatorUserId: true,
      visibility: true,
      status: true,
      scheduledAt: true,
      timeZone: true,
      estimatedEventDurationSeconds: true,
      publicJoinCode: true,
      createdAt: true,
      hostUser: {
        select: { id: true, name: true, email: true },
      },
      participants: {
        select: {
          id: true,
          userId: true,
          // participantToken intentionally omitted — do not expose in list data.
          isHost: true,
          lastSeenAt: true,
        },
      },
      sessions: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          closedByEventAt: true,
          negotiationState: true,
          status: true,
          roomLifecycle: true,
          deletedAt: true,
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
          roomConnections: {
            select: {
              userId: true,
              sessionId: true,
              disconnectedAt: true,
              supersededAt: true,
              revokedAt: true,
              expiresAt: true,
              updatedAt: true,
            },
          },
        },
      },
    },
  });

  return events.map((event) => {
    const presenceActive = isEventActiveForPresence(event.status);
    const activeSessions = event.sessions.filter(isActiveSession).length;
    const finishedSessions = event.sessions.filter(isFinishedSession).length;
    const presence = derivePresenceBuckets({
      participants: event.participants,
      sessionConnections: event.sessions.flatMap((session) =>
        session.roomConnections.map((connection) => ({
          ...connection,
          sessionTitle: session.title,
          session: {
            status: session.status,
            negotiationState: session.negotiationState,
            roomLifecycle: session.roomLifecycle,
            closedByEventAt: session.closedByEventAt,
            deletedAt: session.deletedAt,
          },
        })),
      ),
    });
    const participantsInLobby = presence.lobbyCount;
    const participantsInActiveSessions = presence.inSessionCount;
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
      visibility: event.visibility as "PUBLIC" | "PRIVATE",
      canManage: Boolean(
        user &&
          (isAdmin(user) ||
            event.hostUserId === user.id ||
            event.facilitatorUserId === user.id),
      ),
      scheduledAt: event.scheduledAt?.toISOString() ?? null,
      timeZone: event.timeZone,
      estimatedDurationSeconds: event.estimatedEventDurationSeconds ?? null,
      publicJoinCode: event.publicJoinCode,
      primarySessionId: event.sessions[0]?.id ?? null,
      createdAt: event.createdAt.toISOString(),
      ownerLabel: event.hostUser?.name ?? event.hostUser?.email ?? null,
      ownerUserId: event.hostUserId,
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
      uniqueParticipantsWithSessions: presence.totalParticipantsCount,
      recordingsCount,
      transcriptsCount,
      latestActivityAt,
      activeSessionParticipantCount: presenceActive
        ? participantsInActiveSessions
        : 0,
      totalSessionParticipantCount: presence.totalParticipantsCount,
    };
  });
}

export async function getEventOverviewStats(): Promise<EventOverviewStats[]> {
  return getEventOverviewStatsForUser(null);
}

export async function getEventOverviewStatsForUser(
  user: AuthUser | null,
): Promise<EventOverviewStats[]> {
  const events = await getEventsForUser(user);

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
