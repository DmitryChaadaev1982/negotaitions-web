type SessionRoomConnectionPresenceRow = {
  userId: string;
  connectionId: string;
  leaseVersion: number;
  disconnectedAt: Date | null;
  disconnectedReason: string | null;
  supersededAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  updatedAt: Date;
};

export type SessionLogicalPresenceState = {
  isActive: boolean | null;
  inactiveReason: string | null;
  activeConnectionId: string | null;
};

function isActiveConnection(
  row: SessionRoomConnectionPresenceRow,
  now: Date,
): boolean {
  return (
    row.disconnectedAt == null &&
    row.supersededAt == null &&
    row.revokedAt == null &&
    row.expiresAt > now
  );
}

function pickNewestRow(
  current: SessionRoomConnectionPresenceRow | null,
  candidate: SessionRoomConnectionPresenceRow,
): SessionRoomConnectionPresenceRow {
  if (!current) return candidate;
  const candidateUpdatedAt = candidate.updatedAt.getTime();
  const currentUpdatedAt = current.updatedAt.getTime();
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
  }
  return candidate.leaseVersion > current.leaseVersion ? candidate : current;
}

function deriveInactiveReason(row: SessionRoomConnectionPresenceRow): string | null {
  if (row.disconnectedReason) {
    return row.disconnectedReason;
  }
  if (row.disconnectedAt) {
    return "DISCONNECTED";
  }
  if (row.supersededAt) {
    return "SUPERSEDED";
  }
  if (row.revokedAt) {
    return "REVOKED";
  }
  return "EXPIRED";
}

export function summarizeLogicalPresenceByUser(
  rows: SessionRoomConnectionPresenceRow[],
  now: Date = new Date(),
): Map<string, SessionLogicalPresenceState> {
  const newestByUserId = new Map<string, SessionRoomConnectionPresenceRow | null>();
  const activeByUserId = new Map<string, SessionRoomConnectionPresenceRow | null>();

  for (const row of rows) {
    const newest = newestByUserId.get(row.userId) ?? null;
    newestByUserId.set(row.userId, pickNewestRow(newest, row));
    if (isActiveConnection(row, now)) {
      const activeCurrent = activeByUserId.get(row.userId) ?? null;
      activeByUserId.set(row.userId, pickNewestRow(activeCurrent, row));
    }
  }

  const summary = new Map<string, SessionLogicalPresenceState>();
  for (const [userId, newestRow] of newestByUserId) {
    const activeRow = activeByUserId.get(userId) ?? null;
    if (activeRow) {
      summary.set(userId, {
        isActive: true,
        inactiveReason: null,
        activeConnectionId: activeRow.connectionId,
      });
      continue;
    }

    summary.set(userId, {
      isActive: false,
      inactiveReason: newestRow ? deriveInactiveReason(newestRow) : null,
      activeConnectionId: null,
    });
  }

  return summary;
}
