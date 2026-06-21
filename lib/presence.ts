export const PRESENCE_HEARTBEAT_INTERVAL_MS = 15_000;
export const PRESENCE_ONLINE_THRESHOLD_MS = 45_000;
export const PRESENCE_STREAM_INTERVAL_MS = 3_000;

export function isParticipantOnline(lastSeenAt: Date | null | undefined) {
  if (!lastSeenAt) {
    return false;
  }

  return Date.now() - lastSeenAt.getTime() <= PRESENCE_ONLINE_THRESHOLD_MS;
}

export type ParticipantPresenceSnapshot = {
  id: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
  isOnline: boolean;
};

export function toParticipantPresenceSnapshot(participant: {
  id: string;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
}): ParticipantPresenceSnapshot {
  return {
    id: participant.id,
    joinedAt: participant.joinedAt?.toISOString() ?? null,
    lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
    isOnline: isParticipantOnline(participant.lastSeenAt),
  };
}
