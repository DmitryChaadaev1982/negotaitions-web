export type EventOverviewStats = {
  id: string;
  lobbyParticipantCount: number;
  sessionCount: number;
  totalSessions: number;
  activeSessions: number;
  finishedSessions: number;
  participantsInLobby: number;
  participantsInActiveSessions: number;
  uniqueParticipantsWithSessions: number;
  recordingsCount: number;
  transcriptsCount: number;
  latestActivityAt: string | null;
  activeSessionParticipantCount: number;
  totalSessionParticipantCount: number;
};

export type TrainingEventStatus =
  | "DRAFT"
  | "LOBBY_OPEN"
  | "SESSION_CREATED"
  | "COMPLETED"
  | "CANCELLED";

export type TrainingEventListItem = {
  id: string;
  title: string;
  status: TrainingEventStatus;
  visibility: "PUBLIC" | "PRIVATE";
  canManage: boolean;
  scheduledAt: string | null;
  timeZone: string;
  estimatedDurationSeconds: number | null;
  publicJoinCode: string;
  primarySessionId: string | null;
  lobbyParticipantCount: number;
  sessionCount: number;
  totalSessions: number;
  activeSessions: number;
  finishedSessions: number;
  participantsInLobby: number;
  participantsInActiveSessions: number;
  uniqueParticipantsWithSessions: number;
  recordingsCount: number;
  transcriptsCount: number;
  latestActivityAt: string | null;
  activeSessionParticipantCount: number;
  totalSessionParticipantCount: number;
  createdAt?: string;
  ownerLabel?: string | null;
};

export function isEventActiveForPresence(status: TrainingEventStatus) {
  return status !== "COMPLETED" && status !== "CANCELLED";
}

export function applyEventOverviewStats<
  T extends {
    id: string;
    status: TrainingEventStatus;
  },
>(events: T[], stats: EventOverviewStats[]): T[] {
  const statsById = new Map(stats.map((event) => [event.id, event]));

  return events.map((event) => {
    const eventStats = statsById.get(event.id);

    if (!eventStats) {
      return event;
    }

    const presenceActive = isEventActiveForPresence(event.status);

    return {
      ...event,
      sessionCount: eventStats.sessionCount,
      totalSessions: eventStats.totalSessions,
      activeSessions: eventStats.activeSessions,
      finishedSessions: eventStats.finishedSessions,
      participantsInLobby: presenceActive ? eventStats.participantsInLobby : 0,
      participantsInActiveSessions: presenceActive
        ? eventStats.participantsInActiveSessions
        : 0,
      uniqueParticipantsWithSessions: eventStats.uniqueParticipantsWithSessions,
      recordingsCount: eventStats.recordingsCount,
      transcriptsCount: eventStats.transcriptsCount,
      latestActivityAt: eventStats.latestActivityAt,
      totalSessionParticipantCount: eventStats.totalSessionParticipantCount,
      lobbyParticipantCount: presenceActive ? eventStats.lobbyParticipantCount : 0,
      activeSessionParticipantCount: presenceActive
        ? eventStats.activeSessionParticipantCount
        : 0,
    };
  });
}
