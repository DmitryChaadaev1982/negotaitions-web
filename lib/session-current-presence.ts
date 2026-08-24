import type {
  RoomLifecycle,
  SessionStatus,
} from "@/app/generated/prisma/client";
import {
  parsePresenceSnapshotAt,
  type ParticipantConnectionStatus,
  type ParticipantPresenceSnapshot,
} from "@/lib/presence";
import { isActiveSessionPresenceConnection } from "@/lib/session-active-presence";
import {
  isSessionActiveForPresence,
  type SessionNegotiationState,
} from "@/lib/session-overview-shared";

export type CurrentPresenceSession = {
  status: SessionStatus;
  negotiationState: SessionNegotiationState | string;
  roomLifecycle: RoomLifecycle | null;
  closedByEventAt?: Date | string | null;
  deletedAt?: Date | string | null;
  event?: {
    status?: string | null;
    completedAt?: Date | string | null;
  } | null;
};

export type CurrentPresenceConnectionLease = {
  sessionId: string;
  disconnectedAt: Date | null;
  revokedAt: Date | null;
  supersededAt: Date | null;
  expiresAt: Date;
  updatedAt?: Date;
  session?: CurrentPresenceSession | null;
};

export type CurrentPresenceConnection = CurrentPresenceConnectionLease & {
  userId: string;
};

/**
 * Prisma where-clause for a live authoritative SessionRoomConnection lease.
 * Matches the occupancy lease fields plus active-user gating. Session
 * operability is applied by the caller from the parent Session row so this
 * helper does not import the lifecycle closer.
 */
export function liveSessionRoomConnectionWhere(now: Date) {
  return {
    disconnectedAt: null,
    supersededAt: null,
    revokedAt: null,
    expiresAt: {
      gt: now,
    },
    user: {
      status: "ACTIVE" as const,
    },
  };
}

/**
 * A Session can expose current room presence only when it is still operable.
 * CLOSED / canonically completed / deleted / Event-closed rows are excluded.
 * DEBRIEF_OPEN remains operable. Does not import automatic-close policy.
 */
export function isSessionOperableForCurrentRoomPresence(
  session: CurrentPresenceSession,
): boolean {
  if (session.deletedAt != null) {
    return false;
  }
  if (session.roomLifecycle === "CLOSED") {
    return false;
  }
  return isSessionActiveForPresence({
    status: session.status,
    negotiationState: session.negotiationState as SessionNegotiationState,
    roomLifecycle: session.roomLifecycle,
    closedByEventAt: session.closedByEventAt ?? null,
    event: session.event,
  });
}

export function isCurrentSessionRoomPresenceConnection(
  connection: CurrentPresenceConnectionLease,
  now: Date,
  session?: CurrentPresenceSession | null,
): boolean {
  if (!isActiveSessionPresenceConnection(connection, now)) {
    return false;
  }
  const operableSession = session ?? connection.session ?? null;
  if (
    operableSession &&
    !isSessionOperableForCurrentRoomPresence(operableSession)
  ) {
    return false;
  }
  return true;
}

export function collectCurrentSessionRoomUserIds(
  connections: CurrentPresenceConnection[],
  now: Date,
  session?: CurrentPresenceSession | null,
): Set<string> {
  const userIds = new Set<string>();
  for (const connection of connections) {
    if (isCurrentSessionRoomPresenceConnection(connection, now, session)) {
      userIds.add(connection.userId);
    }
  }
  return userIds;
}

export function countUniqueCurrentSessionRoomUsers(
  connections: CurrentPresenceConnection[],
  now: Date,
  session?: CurrentPresenceSession | null,
): number {
  return collectCurrentSessionRoomUserIds(connections, now, session).size;
}

export function connectionStatusFromCurrentRoomPresence(
  isCurrentlyInRoom: boolean,
): ParticipantConnectionStatus {
  return isCurrentlyInRoom ? "ONLINE" : "OFFLINE";
}

export function toSessionCurrentPresenceSnapshot(
  participant: {
    id: string;
    userId?: string | null;
    joinedAt: Date | null;
    lastSeenAt: Date | null;
  },
  currentRoomUserIds: Set<string>,
): ParticipantPresenceSnapshot {
  const isCurrentlyInRoom = Boolean(
    participant.userId && currentRoomUserIds.has(participant.userId),
  );
  return {
    id: participant.id,
    joinedAt: participant.joinedAt?.toISOString() ?? null,
    lastSeenAt: participant.lastSeenAt?.toISOString() ?? null,
    isOnline: isCurrentlyInRoom,
    connectionStatus: connectionStatusFromCurrentRoomPresence(isCurrentlyInRoom),
  };
}

export function buildInitialSessionCurrentPresenceSnapshot(
  participant: {
    id: string;
    joinedAt: string | null;
    lastSeenAt: string | null;
    isCurrentlyInRoom: boolean;
  },
  presenceSnapshotAt: string | number,
): ParticipantPresenceSnapshot {
  parsePresenceSnapshotAt(presenceSnapshotAt);
  return {
    id: participant.id,
    joinedAt: participant.joinedAt,
    lastSeenAt: participant.lastSeenAt,
    isOnline: participant.isCurrentlyInRoom,
    connectionStatus: connectionStatusFromCurrentRoomPresence(
      participant.isCurrentlyInRoom,
    ),
  };
}

export function deriveSessionCurrentPresenceSnapshots(params: {
  session: CurrentPresenceSession | null;
  participants: Array<{
    id: string;
    userId?: string | null;
    joinedAt: Date | null;
    lastSeenAt: Date | null;
  }>;
  connections: CurrentPresenceConnection[];
  now: Date;
}): ParticipantPresenceSnapshot[] {
  const currentRoomUserIds =
    params.session && isSessionOperableForCurrentRoomPresence(params.session)
      ? collectCurrentSessionRoomUserIds(
          params.connections,
          params.now,
          params.session,
        )
      : new Set<string>();

  return params.participants.map((participant) =>
    toSessionCurrentPresenceSnapshot(participant, currentRoomUserIds),
  );
}
