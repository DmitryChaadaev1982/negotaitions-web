import {
  isCurrentSessionRoomPresenceConnection,
  type CurrentPresenceSession,
} from "@/lib/session-current-presence";

export type EventParticipantPresenceState =
  | "IN_LOBBY"
  | "IN_SESSION"
  | "TEMPORARILY_AWAY"
  | "OFFLINE"
  | "INVITED_NOT_CONNECTED";

export type EventParticipantPresenceLocation =
  | { kind: "lobby" }
  | { kind: "session"; sessionId: string; sessionTitle: string }
  | { kind: "none" };

export type EventParticipantPresenceResolution = {
  state: EventParticipantPresenceState;
  location: EventParticipantPresenceLocation;
  terminalSeenAt: Date | null;
};

export type EventParticipantSessionPresenceEvidence = {
  eventId?: string | null;
  sessionId: string;
  sessionTitle: string;
  disconnectedAt: Date | null;
  revokedAt: Date | null;
  supersededAt: Date | null;
  expiresAt: Date;
  updatedAt: Date;
  session?: CurrentPresenceSession | null;
};

export type EventParticipantLobbyPresenceEvidence = {
  joinedAt: Date | null;
  lastSeenAt: Date | null;
};

function isActiveSessionConnection(
  connection: EventParticipantSessionPresenceEvidence,
  now: Date,
) {
  return isCurrentSessionRoomPresenceConnection(connection, now);
}

function activeSessionSortValue(
  connection: EventParticipantSessionPresenceEvidence,
) {
  return Math.max(connection.updatedAt.getTime(), connection.expiresAt.getTime());
}

function newestActiveSession(
  connections: EventParticipantSessionPresenceEvidence[],
  now: Date,
) {
  let selected: EventParticipantSessionPresenceEvidence | null = null;
  for (const connection of connections) {
    if (!isActiveSessionConnection(connection, now)) continue;
    if (
      !selected ||
      activeSessionSortValue(connection) > activeSessionSortValue(selected) ||
      (activeSessionSortValue(connection) === activeSessionSortValue(selected) &&
        connection.sessionId > selected.sessionId)
    ) {
      selected = connection;
    }
  }
  return selected;
}

/**
 * When the participant actually stopped being present in a Session.
 *
 * Two different disconnect kinds reach this function and they must not share a
 * clock:
 *
 * - `EXPLICIT_LEAVE` — the participant used a product action that deliberately
 *   exits the room, so the server wrote a real terminal timestamp
 *   (`disconnectedAt`, `revokedAt` or `supersededAt`). That timestamp is the
 *   truth. The row keeps whatever `expiresAt` the last heartbeat had already
 *   written, which is up to a full lease ahead of the departure; honouring it
 *   would restart the away window when the abandoned lease later lapses and
 *   delay `OFFLINE` by another lease period.
 * - `NETWORK_LOSS` — refresh, tab close or a dropped connection leaves no
 *   terminal marker at all. The only durable evidence is the lease, so the
 *   effective disconnect time is `expiresAt` once it has passed.
 *
 * Timestamps are never backdated or synthesised: an explicitly terminated
 * connection reports its own terminal time, and a lapsed one reports its lease
 * expiry.
 */
function latestTerminalTimestamp(
  connection: EventParticipantSessionPresenceEvidence,
  now: Date,
) {
  const explicitTerminals = [
    connection.disconnectedAt,
    connection.revokedAt,
    connection.supersededAt,
  ].filter((value): value is Date => Boolean(value));

  if (explicitTerminals.length > 0) {
    return new Date(
      Math.max(...explicitTerminals.map((value) => value.getTime())),
    );
  }

  return connection.expiresAt <= now ? connection.expiresAt : null;
}

function isWithinRecentWindow(value: Date | null, now: Date, windowMs: number) {
  if (!value) return false;
  const elapsedMs = now.getTime() - value.getTime();
  return elapsedMs >= 0 && elapsedMs <= windowMs;
}

export function resolveEventParticipantPresence(params: {
  lobbyPresence: EventParticipantLobbyPresenceEvidence;
  sessionConnections: EventParticipantSessionPresenceEvidence[];
  now: Date;
  lobbyOnlineWindowMs: number;
  recentDisconnectWindowMs: number;
  historicalParticipation?: boolean;
  eventId?: string | null;
}): EventParticipantPresenceResolution {
  const connections = params.eventId
    ? params.sessionConnections.filter(
        (connection) =>
          connection.eventId == null || connection.eventId === params.eventId,
      )
    : params.sessionConnections;
  const activeSession = newestActiveSession(connections, params.now);
  const lobbyLastSeenAt = params.lobbyPresence.lastSeenAt;
  const hasActiveLobbyPresence = isWithinRecentWindow(
    lobbyLastSeenAt,
    params.now,
    params.lobbyOnlineWindowMs,
  );

  if (activeSession) {
    return {
      state: "IN_SESSION",
      location: {
        kind: "session",
        sessionId: activeSession.sessionId,
        sessionTitle: activeSession.sessionTitle,
      },
      terminalSeenAt: null,
    };
  }

  if (hasActiveLobbyPresence) {
    return {
      state: "IN_LOBBY",
      location: { kind: "lobby" },
      terminalSeenAt: null,
    };
  }

  const terminalCandidates = [
    lobbyLastSeenAt,
    ...connections.map((connection) =>
      latestTerminalTimestamp(connection, params.now),
    ),
  ].filter((value): value is Date => Boolean(value));
  const terminalSeenAt =
    terminalCandidates.length > 0
      ? new Date(Math.max(...terminalCandidates.map((value) => value.getTime())))
      : null;

  if (
    terminalSeenAt &&
    isWithinRecentWindow(
      terminalSeenAt,
      params.now,
      params.recentDisconnectWindowMs,
    )
  ) {
    return {
      state: "TEMPORARILY_AWAY",
      location: { kind: "none" },
      terminalSeenAt,
    };
  }

  const hasConfirmedHistory =
    Boolean(params.historicalParticipation) ||
    Boolean(params.lobbyPresence.joinedAt) ||
    Boolean(params.lobbyPresence.lastSeenAt) ||
    connections.length > 0;

  return {
    state: hasConfirmedHistory ? "OFFLINE" : "INVITED_NOT_CONNECTED",
    location: { kind: "none" },
    terminalSeenAt,
  };
}

export function connectionStatusForEventPresenceState(
  state: EventParticipantPresenceState,
) {
  if (state === "IN_LOBBY" || state === "IN_SESSION") {
    return "ONLINE" as const;
  }
  if (state === "TEMPORARILY_AWAY") {
    return "RECENTLY_DISCONNECTED" as const;
  }
  return "OFFLINE" as const;
}
