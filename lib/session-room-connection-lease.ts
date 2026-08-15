import "server-only";

import { Prisma, ParticipantType } from "@/app/generated/prisma/client";
import { PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS } from "@/lib/presence";
import { prisma } from "@/lib/prisma";
import { reconcileSessionAfterOccupancyChange } from "@/lib/session-empty-room-reconciliation";
import { deriveEffectiveRoomLifecycle } from "@/lib/session-room-lifecycle";
import { materializeActivePublicationGrantForRoomEntrantSafe } from "@/lib/ai-publication-entry-grant";
import { sqlUtcWallClockNow } from "@/lib/sql-utc-wall-clock";

type ClaimResult = {
  activeConnectionId: string;
  version: number;
  replacedConnectionId: string | null;
  isCurrentConnectionActive: boolean;
};

type ValidateResult = {
  isCurrentConnectionActive: boolean;
  activeConnectionId: string;
  version: number;
};

export type SessionRoomConnectionFinalState =
  | "DISCONNECTED"
  | "SUPERSEDED"
  | "REVOKED"
  | "EXPIRED"
  | "ACTIVE"
  | "NOT_FOUND";

type DisconnectResult = {
  disconnected: boolean;
  alreadyFinalized: boolean;
  roomClosed: boolean;
  finalState: SessionRoomConnectionFinalState;
};

const LEASE_EXPIRY_GRACE_MS = PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS;
const ACTIVE_HUMAN_ROLES = [
  ParticipantType.FACILITATOR,
  ParticipantType.PARTICIPANT,
  ParticipantType.OBSERVER,
] as const;

function activeConnectionWhere(params: {
  sessionId: string;
  userId: string;
  now: Date;
}): Prisma.SessionRoomConnectionWhereInput {
  return {
    sessionId: params.sessionId,
    userId: params.userId,
    role: {
      in: Array.from(ACTIVE_HUMAN_ROLES),
    },
    disconnectedAt: null,
    supersededAt: null,
    revokedAt: null,
    expiresAt: {
      gt: params.now,
    },
    user: {
      status: "ACTIVE",
    },
    session: {
      deletedAt: null,
      OR: [{ roomLifecycle: null }, { roomLifecycle: { not: "CLOSED" } }],
      participants: {
        some: {
          userId: params.userId,
          type: {
            in: Array.from(ACTIVE_HUMAN_ROLES),
          },
        },
      },
    },
  };
}

function withExpiry(now: Date) {
  return new Date(now.getTime() + LEASE_EXPIRY_GRACE_MS);
}

function isUniqueConstraintError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function deriveConnectionFinalState(
  row:
    | {
        disconnectedAt: Date | null;
        supersededAt: Date | null;
        revokedAt: Date | null;
        expiresAt: Date;
      }
    | null,
  now: Date,
): SessionRoomConnectionFinalState {
  if (!row) return "NOT_FOUND";
  if (row.disconnectedAt) return "DISCONNECTED";
  if (row.supersededAt) return "SUPERSEDED";
  if (row.revokedAt) return "REVOKED";
  if (row.expiresAt <= now) return "EXPIRED";
  return "ACTIVE";
}

/**
 * Canonical CURRENT room presence: active human lease at `now`.
 * Not publication authorization. Publish uses historical SessionRoomConnection
 * rows via `historicalSessionRoomEntryWhere`.
 */
export function activeHumanSessionConnectionWhere(params: {
  sessionId: string;
  now?: Date;
}) {
  const now = params.now ?? new Date();
  return {
    sessionId: params.sessionId,
    role: { in: Array.from(ACTIVE_HUMAN_ROLES) },
    disconnectedAt: null,
    supersededAt: null,
    revokedAt: null,
    expiresAt: {
      gt: now,
    },
  } as const;
}

/**
 * Locks and validates the exact authoritative facilitator lease used by an
 * interactive Session mutation. Row invalidation (takeover, disconnect, or
 * revocation) must update this same lease row and therefore linearizes before
 * or after the mutation transaction rather than racing through it.
 */
export async function lockStrictActiveFacilitatorSessionRoomConnectionLease(
  tx: Prisma.TransactionClient,
  params: {
    sessionId: string;
    userId: string;
    participantId: string;
    connectionId: string;
  },
): Promise<boolean> {
  const now = sqlUtcWallClockNow();
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT src.id
    FROM "SessionRoomConnection" src
    INNER JOIN "SessionParticipant" sp
      ON sp.id = ${params.participantId}
     AND sp."sessionId" = src."sessionId"
     AND sp."userId" = src."userId"
     AND sp.type = 'FACILITATOR'::"ParticipantType"
    INNER JOIN "User" u
      ON u.id = src."userId"
     AND u.status = 'ACTIVE'
    WHERE src."sessionId" = ${params.sessionId}
      AND src."userId" = ${params.userId}
      AND src."connectionId" = ${params.connectionId}
      AND src.role = 'FACILITATOR'::"ParticipantType"
      AND src."disconnectedAt" IS NULL
      AND src."supersededAt" IS NULL
      AND src."revokedAt" IS NULL
      AND src."expiresAt" > ${now}
      AND NOT EXISTS (
        SELECT 1
        FROM "SessionRoomConnection" competing
        WHERE competing."sessionId" = src."sessionId"
          AND competing."userId" = src."userId"
          AND competing."connectionId" <> src."connectionId"
          AND competing."disconnectedAt" IS NULL
          AND competing."supersededAt" IS NULL
          AND competing."revokedAt" IS NULL
          AND competing."expiresAt" > ${now}
      )
    FOR UPDATE OF src, sp, u
  `);
  return rows.length === 1;
}

export async function touchSessionRoomConnectionLease(params: {
  sessionId: string;
  userId: string;
  connectionId: string;
}): Promise<{ touched: boolean }> {
  const now = new Date();
  const touched = await prisma.sessionRoomConnection.updateMany({
    where: {
      ...activeConnectionWhere({
        sessionId: params.sessionId,
        userId: params.userId,
        now,
      }),
      connectionId: params.connectionId,
    },
    data: {
      expiresAt: withExpiry(now),
    },
  });
  return { touched: touched.count > 0 };
}

export async function claimSessionRoomConnectionLease(params: {
  sessionId: string;
  userId: string;
  connectionId: string;
  role?: ParticipantType;
}): Promise<ClaimResult> {
  let claimed: ClaimResult | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const now = new Date();
      const expiresAt = withExpiry(now);

      claimed = await prisma.$transaction(async (tx) => {
        const session = await tx.session.findUnique({
          where: { id: params.sessionId },
          select: {
            id: true,
            deletedAt: true,
            roomLifecycle: true,
            closeReason: true,
            closedByEventAt: true,
            negotiationState: true,
            event: {
              select: {
                status: true,
              },
            },
          },
        });
        if (!session) {
          return {
            activeConnectionId: params.connectionId,
            version: 0,
            replacedConnectionId: null,
            isCurrentConnectionActive: false,
          };
        }
        const effectiveLifecycle = deriveEffectiveRoomLifecycle({
          roomLifecycle: session.roomLifecycle,
          deletedAt: session.deletedAt,
          closedByEventAt: session.closedByEventAt,
          closeReason: session.closeReason,
          negotiationState: session.negotiationState,
          eventStatus: session.event?.status ?? null,
        });
        if (effectiveLifecycle === "CLOSED") {
          return {
            activeConnectionId: params.connectionId,
            version: 0,
            replacedConnectionId: null,
            isCurrentConnectionActive: false,
          };
        }

        const [latestByUser, previousActive] = await Promise.all([
          tx.sessionRoomConnection.findFirst({
            where: {
              sessionId: params.sessionId,
              userId: params.userId,
            },
            orderBy: {
              leaseVersion: "desc",
            },
            select: {
              leaseVersion: true,
            },
          }),
          tx.sessionRoomConnection.findFirst({
            where: activeConnectionWhere({
              sessionId: params.sessionId,
              userId: params.userId,
              now,
            }),
            orderBy: {
              leaseVersion: "desc",
            },
            select: {
              connectionId: true,
            },
          }),
        ]);
        const existingByConnectionId =
          await tx.sessionRoomConnection.findUnique({
            where: { connectionId: params.connectionId },
            select: {
              sessionId: true,
              userId: true,
              leaseVersion: true,
              disconnectedAt: true,
              supersededAt: true,
              revokedAt: true,
              expiresAt: true,
            },
          });

        if (
          existingByConnectionId &&
          (
            existingByConnectionId.sessionId !== params.sessionId ||
            existingByConnectionId.userId !== params.userId ||
            existingByConnectionId.disconnectedAt != null ||
            existingByConnectionId.supersededAt != null ||
            existingByConnectionId.revokedAt != null ||
            existingByConnectionId.expiresAt <= now
          )
        ) {
          return {
            activeConnectionId:
              previousActive?.connectionId ?? params.connectionId,
            version:
              latestByUser?.leaseVersion ??
              existingByConnectionId.leaseVersion,
            replacedConnectionId: null,
            isCurrentConnectionActive: false,
          };
        }

        const hasSameActiveConnection =
          previousActive?.connectionId === params.connectionId;
        const version = hasSameActiveConnection
          ? (latestByUser?.leaseVersion ?? 1)
          : (latestByUser?.leaseVersion ?? 0) + 1;

        await tx.sessionRoomConnection.updateMany({
          where: {
            sessionId: params.sessionId,
            userId: params.userId,
            disconnectedAt: null,
            supersededAt: null,
            revokedAt: null,
            connectionId: {
              not: params.connectionId,
            },
          },
          data: {
            supersededAt: now,
            supersededByConnectionId: params.connectionId,
          },
        });

        await tx.sessionRoomConnection.upsert({
          where: {
            connectionId: params.connectionId,
          },
          create: {
            sessionId: params.sessionId,
            userId: params.userId,
            connectionId: params.connectionId,
            leaseVersion: version,
            role: params.role ?? ParticipantType.PARTICIPANT,
            expiresAt,
          },
          update: {
            sessionId: params.sessionId,
            userId: params.userId,
            leaseVersion: version,
            role: params.role ?? ParticipantType.PARTICIPANT,
            expiresAt,
            disconnectedAt: null,
            disconnectedReason: null,
            supersededAt: null,
            supersededByConnectionId: null,
            revokedAt: null,
          },
        });

        return {
          activeConnectionId: params.connectionId,
          version,
          replacedConnectionId:
            previousActive && previousActive.connectionId !== params.connectionId
              ? previousActive.connectionId
              : null,
          isCurrentConnectionActive: true,
        };
      });
      break;
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 1) {
        throw error;
      }
    }
  }

  if (!claimed) {
    throw new Error("Unable to claim connection lease.");
  }
  if (claimed.isCurrentConnectionActive) {
    await materializeActivePublicationGrantForRoomEntrantSafe({
      sessionId: params.sessionId,
      userId: params.userId,
    });
  }
  return claimed;
}

export async function validateSessionRoomConnectionLease(params: {
  sessionId: string;
  userId: string;
  connectionId: string;
}): Promise<ValidateResult> {
  const now = new Date();
  const session = await prisma.session.findUnique({
    where: { id: params.sessionId },
    select: {
      deletedAt: true,
      roomLifecycle: true,
      closeReason: true,
      closedByEventAt: true,
      negotiationState: true,
      event: {
        select: { status: true },
      },
    },
  });
  if (!session) {
    return {
      isCurrentConnectionActive: false,
      activeConnectionId: params.connectionId,
      version: 0,
    };
  }
  const effectiveLifecycle = deriveEffectiveRoomLifecycle({
    roomLifecycle: session.roomLifecycle,
    deletedAt: session.deletedAt,
    closedByEventAt: session.closedByEventAt,
    closeReason: session.closeReason,
    negotiationState: session.negotiationState,
    eventStatus: session.event?.status ?? null,
  });
  if (effectiveLifecycle === "CLOSED") {
    return {
      isCurrentConnectionActive: false,
      activeConnectionId: params.connectionId,
      version: 0,
    };
  }

  const current = await prisma.sessionRoomConnection.findFirst({
    where: activeConnectionWhere({
      sessionId: params.sessionId,
      userId: params.userId,
      now,
    }),
    orderBy: {
      leaseVersion: "desc",
    },
    select: {
      connectionId: true,
      leaseVersion: true,
    },
  });

  if (!current) {
    return {
      isCurrentConnectionActive: true,
      activeConnectionId: params.connectionId,
      version: 0,
    };
  }

  return {
    isCurrentConnectionActive: current.connectionId === params.connectionId,
    activeConnectionId: current.connectionId,
    version: current.leaseVersion,
  };
}

export async function disconnectSessionRoomConnectionLease(params: {
  sessionId: string;
  userId: string;
  connectionId: string;
  reason?: string;
}): Promise<DisconnectResult> {
  const now = new Date();
  const reason = params.reason ?? "EXPLICIT_LEAVE";

  const updated = await prisma.sessionRoomConnection.updateMany({
    where: {
      ...activeConnectionWhere({
        sessionId: params.sessionId,
        userId: params.userId,
        now,
      }),
      connectionId: params.connectionId,
    },
    data: {
      disconnectedAt: now,
      disconnectedReason: reason,
    },
  });

  const targetConnection = await prisma.sessionRoomConnection.findFirst({
    where: {
      sessionId: params.sessionId,
      userId: params.userId,
      connectionId: params.connectionId,
    },
    select: {
      disconnectedAt: true,
      supersededAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  const finalState = deriveConnectionFinalState(targetConnection, now);

  const reconciliation = await reconcileSessionAfterOccupancyChange({
    sessionId: params.sessionId,
  });
  const logPayload = {
    area: "room_occupancy",
    event: updated.count > 0 ? "connection_disconnected" : "connection_disconnect_skipped",
    sessionId: params.sessionId,
    connectionId: params.connectionId,
    roomClosed: reconciliation.roomClosed,
    roomClosureReason: reconciliation.roomClosureReason,
    roomClosureActiveConnectionCount:
      reconciliation.roomClosureActiveConnectionCount,
    sessionCompleted: reconciliation.sessionCompleted,
    sessionAlreadyCompleted: reconciliation.alreadyCompleted,
    completionReason: reconciliation.completionReason,
    graceRemainingMs: reconciliation.graceRemainingMs,
    activeConnectionCount: reconciliation.activeConnectionCount,
  };
  console.log(JSON.stringify(logPayload));

  return {
    disconnected: updated.count > 0,
    alreadyFinalized: updated.count === 0,
    roomClosed: reconciliation.roomClosed,
    finalState,
  };
}

export async function disconnectSessionRoomConnectionLeaseByConnectionId(params: {
  sessionId: string;
  connectionId: string;
  reason?: string;
}): Promise<DisconnectResult> {
  const now = new Date();
  const reason = params.reason ?? "EXPLICIT_LEAVE";

  const updated = await prisma.sessionRoomConnection.updateMany({
    where: {
      sessionId: params.sessionId,
      connectionId: params.connectionId,
      disconnectedAt: null,
      supersededAt: null,
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    data: {
      disconnectedAt: now,
      disconnectedReason: reason,
    },
  });

  const targetConnection = await prisma.sessionRoomConnection.findFirst({
    where: {
      sessionId: params.sessionId,
      connectionId: params.connectionId,
    },
    select: {
      disconnectedAt: true,
      supersededAt: true,
      revokedAt: true,
      expiresAt: true,
    },
  });
  const finalState = deriveConnectionFinalState(targetConnection, now);

  const reconciliation = await reconcileSessionAfterOccupancyChange({
    sessionId: params.sessionId,
  });

  return {
    disconnected: updated.count > 0,
    alreadyFinalized: updated.count === 0,
    roomClosed: reconciliation.roomClosed,
    finalState,
  };
}
