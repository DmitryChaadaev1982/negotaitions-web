import { LOBBY_ONLINE_THRESHOLD_MS } from "@/lib/presence";
import { getCanonicalActiveSessionPresenceByUser } from "@/lib/session-active-presence";

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

  const canonicalSessionUsers = getCanonicalActiveSessionPresenceByUser(
    params.sessionConnections,
    now,
  );
  const onlineSessionUsers = new Set<string>();
  for (const userId of canonicalSessionUsers.keys()) {
    if (eventUserIds.has(userId)) {
      onlineSessionUsers.add(userId);
    }
  }

  // Transitional overlap is classified as "In Sessions".
  for (const userId of onlineSessionUsers) {
    onlineLobbyUsers.delete(userId);
  }

  return {
    lobbyCount: onlineLobbyUsers.size,
    inSessionCount: onlineSessionUsers.size,
    totalParticipantsCount: params.participants.length,
  };
}
