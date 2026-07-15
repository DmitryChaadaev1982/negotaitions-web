import "server-only";

import { Prisma, ParticipantType } from "@/app/generated/prisma/client";
import { PRESENCE_RECENTLY_DISCONNECTED_THRESHOLD_MS } from "@/lib/presence";
import { prisma } from "@/lib/prisma";
import { deriveEffectiveRoomLifecycle } from "@/lib/session-room-lifecycle";
import { closeDebriefRoomIfEmpty } from "@/lib/session-room-occupancy";

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

type DisconnectResult = {
  disconnected: boolean;
  alreadyFinalized: boolean;
  roomClosed: boolean;
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
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const now = new Date();
      const expiresAt = withExpiry(now);

      return await prisma.$transaction(async (tx) => {
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
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 1) {
        throw error;
      }
    }
  }

  throw new Error("Unable to claim connection lease.");
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

  const roomClosure = await closeDebriefRoomIfEmpty(params.sessionId);
  const logPayload = {
    area: "room_occupancy",
    event: updated.count > 0 ? "connection_disconnected" : "connection_disconnect_skipped",
    sessionId: params.sessionId,
    connectionId: params.connectionId,
    roomClosed: roomClosure.closed,
    roomClosureReason: roomClosure.reason,
    activeConnectionCount: roomClosure.activeConnectionCount,
  };
  console.log(JSON.stringify(logPayload));

  return {
    disconnected: updated.count > 0,
    alreadyFinalized: updated.count === 0,
    roomClosed: roomClosure.closed,
  };
}
