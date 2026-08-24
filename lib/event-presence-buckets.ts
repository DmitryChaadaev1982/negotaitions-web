import { LOBBY_ONLINE_THRESHOLD_MS } from "@/lib/presence";
import { getCanonicalActiveSessionPresenceByUser } from "@/lib/session-active-presence";
import {
  isCurrentSessionRoomPresenceConnection,
  type CurrentPresenceSession,
} from "@/lib/session-current-presence";

export function derivePresenceBuckets(params: {
  participants: Array<{ userId: string | null; lastSeenAt: Date | null }>;
  sessionConnections: Array<{
    userId: string;
    sessionId: string;
    sessionTitle: string;
    disconnectedAt: Date | null;
    revokedAt: Date | null;
    supersededAt: Date | null;
    expiresAt: Date;
    updatedAt: Date;
    session?: CurrentPresenceSession | null;
  }>;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  const onlineLobbyUsers = new Set<string>();
  const eventUserIds = new Set<string>();
  for (const participant of params.participants) {
    if (!participant.userId) continue;
    eventUserIds.add(participant.userId);
    if (
      participant.lastSeenAt &&
      now.getTime() - participant.lastSeenAt.getTime() <= LOBBY_ONLINE_THRESHOLD_MS
    ) {
      onlineLobbyUsers.add(participant.userId);
    }
  }

  const currentRoomConnections = params.sessionConnections.filter((connection) =>
    isCurrentSessionRoomPresenceConnection(connection, now),
  );
  const canonicalSessionUsers = getCanonicalActiveSessionPresenceByUser(
    currentRoomConnections,
    now,
  );
  const onlineSessionUsers = new Set<string>();
  for (const userId of canonicalSessionUsers.keys()) {
    if (eventUserIds.has(userId)) {
      onlineSessionUsers.add(userId);
    }
  }

  // Room presence wins over a still-fresh Lobby heartbeat.
  for (const userId of onlineSessionUsers) {
    onlineLobbyUsers.delete(userId);
  }

  return {
    lobbyCount: onlineLobbyUsers.size,
    inSessionCount: onlineSessionUsers.size,
    onlineCount: onlineLobbyUsers.size + onlineSessionUsers.size,
    totalParticipantsCount: params.participants.length,
  };
}
