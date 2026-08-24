export type SessionPresenceLeaseFields = {
  disconnectedAt: Date | null;
  revokedAt: Date | null;
  supersededAt: Date | null;
  expiresAt: Date;
};

type SessionPresenceConnection = SessionPresenceLeaseFields & {
  userId: string;
  sessionId: string;
  sessionTitle: string;
  updatedAt: Date;
};

function isNewerConnection(
  current: SessionPresenceConnection,
  candidate: SessionPresenceConnection,
): boolean {
  const currentUpdatedMs = current.updatedAt.getTime();
  const candidateUpdatedMs = candidate.updatedAt.getTime();
  if (candidateUpdatedMs !== currentUpdatedMs) {
    return candidateUpdatedMs > currentUpdatedMs;
  }
  return candidate.expiresAt.getTime() > current.expiresAt.getTime();
}

export function isActiveSessionPresenceConnection(
  connection: SessionPresenceLeaseFields,
  now: Date = new Date(),
): boolean {
  return (
    connection.disconnectedAt == null &&
    connection.revokedAt == null &&
    connection.supersededAt == null &&
    connection.expiresAt > now
  );
}

export function getCanonicalActiveSessionPresenceByUser(
  connections: SessionPresenceConnection[],
  now: Date = new Date(),
): Map<string, SessionPresenceConnection> {
  const canonicalByUserId = new Map<string, SessionPresenceConnection>();
  for (const connection of connections) {
    if (!isActiveSessionPresenceConnection(connection, now)) {
      continue;
    }
    const current = canonicalByUserId.get(connection.userId);
    if (!current || isNewerConnection(current, connection)) {
      canonicalByUserId.set(connection.userId, connection);
    }
  }
  return canonicalByUserId;
}
