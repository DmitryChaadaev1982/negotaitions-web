export const PRESENCE_HEARTBEAT_INTERVAL_MS = 15_000;
export const PRESENCE_OVERVIEW_POLL_INTERVAL_MS = 1_000;
export const PRESENCE_ONLINE_THRESHOLD_MS = 30_000;
export const PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS = 120_000;
export const PRESENCE_STREAM_INTERVAL_MS = 3_000;

/**
 * Lobby-specific presence constants — more aggressive than session-room constants
 * so that disconnect detection in the lobby roster is visible within ~10-15 seconds
 * rather than the 30+ seconds of the global thresholds.
 */
export const LOBBY_HEARTBEAT_INTERVAL_MS = 5_000;
export const LOBBY_ONLINE_THRESHOLD_MS = 12_000;
export const LOBBY_RECENTLY_DISCONNECTED_THRESHOLD_MS = 60_000;

export type ParticipantConnectionStatus =
  | "ONLINE"
  | "RECENTLY_DISCONNECTED"
  | "OFFLINE";

export function resolveConnectionStatus(
  lastSeenAt: Date | null | undefined,
  now = Date.now(),
  onlineThresholdMs = PRESENCE_ONLINE_THRESHOLD_MS,
  recentlyDisconnectedThresholdMs = PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS,
): ParticipantConnectionStatus {
  if (!lastSeenAt) {
    return "OFFLINE";
  }

  const elapsed = now - lastSeenAt.getTime();

  if (elapsed <= onlineThresholdMs) {
    return "ONLINE";
  }

  if (elapsed <= recentlyDisconnectedThresholdMs) {
    return "RECENTLY_DISCONNECTED";
  }

  return "OFFLINE";
}

/** Lobby-aware variant with shorter online/disconnect thresholds. */
export function resolveConnectionStatusForLobby(
  lastSeenAt: Date | null | undefined,
): ParticipantConnectionStatus {
  return resolveConnectionStatus(
    lastSeenAt,
    Date.now(),
    LOBBY_ONLINE_THRESHOLD_MS,
    LOBBY_RECENTLY_DISCONNECTED_THRESHOLD_MS,
  );
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

/** Parse a shared SSR/client presence epoch from an ISO string or epoch ms. */
export function parsePresenceSnapshotAt(
  presenceSnapshotAt: string | number,
): number {
  if (typeof presenceSnapshotAt === "number") {
    return presenceSnapshotAt;
  }

  const parsed = Date.parse(presenceSnapshotAt);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid presenceSnapshotAt: ${presenceSnapshotAt}`);
  }

  return parsed;
}

/**
 * Build the initial presence classification using a stable shared timestamp so
 * SSR HTML and the first client hydration render agree. Live SSE/polling
 * updates should use fresh response timestamps after hydration.
 */
export function buildInitialParticipantPresenceSnapshot(
  participant: {
    id: string;
    joinedAt: string | null;
    lastSeenAt: string | null;
  },
  presenceSnapshotAt: string | number,
): ParticipantPresenceSnapshot {
  const now = parsePresenceSnapshotAt(presenceSnapshotAt);
  const lastSeenAt = participant.lastSeenAt
    ? new Date(participant.lastSeenAt)
    : null;
  const connectionStatus = resolveConnectionStatus(lastSeenAt, now);

  return {
    id: participant.id,
    joinedAt: participant.joinedAt,
    lastSeenAt: participant.lastSeenAt,
    isOnline: connectionStatus === "ONLINE",
    connectionStatus,
  };
}

export function toParticipantPresenceSnapshot(participant: {
  id: string;
  joinedAt: Date | null;
  lastSeenAt: Date | null;
}, now = Date.now()): ParticipantPresenceSnapshot {
  const connectionStatus = resolveConnectionStatus(participant.lastSeenAt, now);

  return {
    id: participant.id,
    joinedAt: participant.joinedAt?.toISOString() ?? null,
    lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
    isOnline: connectionStatus === "ONLINE",
    connectionStatus,
  };
}
