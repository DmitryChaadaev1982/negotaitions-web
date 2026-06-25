import type { SessionDisplayStatus } from "@/lib/session-display-status";

export type SessionOverviewStats = {
  id: string;
  onlineParticipantCount: number;
};

export type SessionNegotiationState =
  | "PREPARATION"
  | "PREPARATION_RUNNING"
  | "PREPARATION_PAUSED"
  | "READY_TO_START"
  | "RUNNING"
  | "PAUSED"
  | "FINISHED";

export type SessionListItem = {
  id: string;
  title: string;
  caseTitle: string;
  eventId: string | null;
  eventTitle: string | null;
  eventStatus: "DRAFT" | "LOBBY_OPEN" | "SESSION_CREATED" | "COMPLETED" | "CANCELLED" | null;
  eventLobbyUrl: string | null;
  status: SessionDisplayStatus;
  negotiationState: SessionNegotiationState;
  closedByEventAt: string | null;
  facilitatorJoinToken: string | null;
  participantCount: number;
  onlineParticipantCount: number;
  durationMinutes: number;
  createdAt: string;
  // AI analysis pipeline status for sessions page
  recordingStage: string | null;
  transcriptStage: string | null;
  speakerMappingStage: string | null;
  aiStage: string | null;
  aiVisibility: string;
};

export function isSessionActiveForPresence(session: {
  negotiationState: SessionNegotiationState;
  closedByEventAt: Date | string | null;
}) {
  return (
    session.closedByEventAt == null && session.negotiationState !== "FINISHED"
  );
}

/** Active sessions where the live video room is the primary entry point. */
export function isSessionActiveForRoom(session: {
  negotiationState: SessionNegotiationState | string;
  closedByEventAt: Date | string | null;
  deletedAt?: Date | string | null;
}) {
  if (session.deletedAt != null) {
    return false;
  }

  return isSessionActiveForPresence({
    negotiationState: session.negotiationState as SessionNegotiationState,
    closedByEventAt: session.closedByEventAt,
  });
}

export function applySessionOverviewStats<
  T extends {
    id: string;
    negotiationState: SessionNegotiationState;
    closedByEventAt: string | null;
    onlineParticipantCount: number;
  },
>(sessions: T[], stats: SessionOverviewStats[]): T[] {
  const statsById = new Map(stats.map((session) => [session.id, session]));

  return sessions.map((session) => {
    const sessionStats = statsById.get(session.id);

    if (!sessionStats) {
      return session;
    }

    if (!isSessionActiveForPresence(session)) {
      return {
        ...session,
        onlineParticipantCount: 0,
      };
    }

    return {
      ...session,
      onlineParticipantCount: sessionStats.onlineParticipantCount,
    };
  });
}
