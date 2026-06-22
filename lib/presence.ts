export const PRESENCE_HEARTBEAT_INTERVAL_MS = 15_000;
export const PRESENCE_ONLINE_THRESHOLD_MS = 30_000;
export const PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS = 120_000;
export const PRESENCE_STREAM_INTERVAL_MS = 3_000;

export type ParticipantConnectionStatus =
  | "ONLINE"
  | "RECENTLY_DISCONNECTED"
  | "OFFLINE";

export function resolveConnectionStatus(
  lastSeenAt: Date | null | undefined,
  now = Date.now(),
): ParticipantConnectionStatus {
  if (!lastSeenAt) {
    return "OFFLINE";
  }

  const elapsed = now - lastSeenAt.getTime();

  if (elapsed <= PRESENCE_ONLINE_THRESHOLD_MS) {
    return "ONLINE";
  }

  if (elapsed <= PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS) {
    return "RECENTLY_DISCONNECTED";
  }

  return "OFFLINE";
}

export function isParticipantOnline(lastSeenAt: Date | null | undefined) {
  return resolveConnectionStatus(lastSeenAt) === "ONLINE";
}

export type ParticipantPresenceSnapshot = {
  id: string;
  joinedAt: string | null;
  lastSeenAt: string | null;
  isOnline: boolean;
  connectionStatus: ParticipantConnectionStatus;
};

export function toParticipantPresenceSnapshot(participant: {
  id: string;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
}): ParticipantPresenceSnapshot {
  const connectionStatus = resolveConnectionStatus(participant.lastSeenAt);

  return {
    id: participant.id,
    joinedAt: participant.joinedAt?.toISOString() ?? null,
    lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
    isOnline: connectionStatus === "ONLINE",
    connectionStatus,
  };
}
