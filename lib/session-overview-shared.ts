import type {
  RoomLifecycle,
  SessionStatus,
} from "@/app/generated/prisma/client";
import {
  isCanonicallyCompletedSession,
  type SessionDisplayStatus,
} from "@/lib/session-display-status";

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
  visibility: "PUBLIC" | "PRIVATE";
  userRole: "FACILITATOR" | "PARTICIPANT" | "OBSERVER" | "HOST" | null;
  canManage: boolean;
  caseTitle: string;
  eventId: string | null;
  eventTitle: string | null;
  eventStatus: "DRAFT" | "LOBBY_OPEN" | "SESSION_CREATED" | "COMPLETED" | "CANCELLED" | null;
  eventVisibility: "PUBLIC" | "PRIVATE" | null;
  eventLobbyUrl: string | null;
  status: SessionDisplayStatus;
  sessionStatus: SessionStatus;
  negotiationState: SessionNegotiationState;
  roomLifecycle: RoomLifecycle | null;
  closedByEventAt: string | null;
  // facilitatorJoinToken intentionally omitted — must not appear in list HTML.
  // Deep-link access is available via the session detail page (/sessions/[id]).
  participantCount: number;
  onlineParticipantCount: number;
  durationMinutes: number;
  createdAt: string;
  // AI analysis pipeline status for sessions page
  recordingStage: string | null;
  transcriptStage: string | null;
  speakerMappingStage: string | null;
  aiStage: string | null;
  aiPublicationStatus: "none" | "partial" | "full" | null;
  aiVisibility: string;
  roomUrl: string;
  materialsUrl: string;
  ownerLabel?: string | null;
};

export function isSessionActiveForPresence(session: {
  status: SessionStatus;
  negotiationState: SessionNegotiationState;
  roomLifecycle: RoomLifecycle | null;
  closedByEventAt: Date | string | null;
  event?: {
    status?: string | null;
    completedAt?: Date | string | null;
  } | null;
}) {
  return (
    !isCanonicallyCompletedSession(session) &&
    session.closedByEventAt == null &&
    session.event?.status !== "COMPLETED" &&
    session.event?.completedAt == null
  );
}

/** Active sessions where the live video room is the primary entry point. */
export function isSessionActiveForRoom(session: {
  status: SessionStatus;
  negotiationState: SessionNegotiationState | string;
  roomLifecycle: RoomLifecycle | null;
  closedByEventAt: Date | string | null;
  deletedAt?: Date | string | null;
  event?: {
    status?: string | null;
    completedAt?: Date | string | null;
  } | null;
}) {
  if (session.deletedAt != null) {
    return false;
  }

  return isSessionActiveForPresence({
    status: session.status,
    negotiationState: session.negotiationState as SessionNegotiationState,
    roomLifecycle: session.roomLifecycle,
    closedByEventAt: session.closedByEventAt,
    event: session.event,
  });
}

export function applySessionOverviewStats<
  T extends {
    id: string;
    sessionStatus: SessionStatus;
    negotiationState: SessionNegotiationState;
    roomLifecycle: RoomLifecycle | null;
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

    if (
      !isSessionActiveForPresence({
        status: session.sessionStatus,
        negotiationState: session.negotiationState,
        roomLifecycle: session.roomLifecycle,
        closedByEventAt: session.closedByEventAt,
      })
    ) {
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
