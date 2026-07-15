import { Prisma, RoomLifecycle } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type DbClient = Pick<typeof prisma, "$queryRaw">;

export type ActiveConnectionDiagnostics = {
  sessionId: string;
  activeConnectionCount: number;
  activeConnectionExists: boolean;
};

function sqlNowActiveConnectionPredicateForSession(sessionId: string) {
  return Prisma.sql`
    src."sessionId" = ${sessionId}
    AND src.role IN (
      'FACILITATOR'::"ParticipantType",
      'PARTICIPANT'::"ParticipantType",
      'OBSERVER'::"ParticipantType"
    )
    AND src."disconnectedAt" IS NULL
    AND src."supersededAt" IS NULL
    AND src."revokedAt" IS NULL
    AND src."expiresAt" > NOW()
    AND s."deletedAt" IS NULL
    AND (s."roomLifecycle" IS NULL OR s."roomLifecycle" <> ${RoomLifecycle.CLOSED})
    AND u.status = 'ACTIVE'
    AND EXISTS (
      SELECT 1
      FROM "SessionParticipant" sp
      WHERE sp."sessionId" = src."sessionId"
        AND sp."userId" = src."userId"
        AND sp.type = src.role
    )
  `;
}

export async function countActiveSessionRoomConnections(
  sessionId: string,
  client: DbClient = prisma,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "SessionRoomConnection" src
    INNER JOIN "Session" s ON s.id = src."sessionId"
    INNER JOIN "User" u ON u.id = src."userId"
    WHERE ${sqlNowActiveConnectionPredicateForSession(sessionId)}
  `);
  return Number(rows[0]?.count ?? 0);
}

export async function getActiveConnectionDiagnostics(
  sessionId: string,
  client: DbClient = prisma,
): Promise<ActiveConnectionDiagnostics> {
  const activeConnectionCount = await countActiveSessionRoomConnections(
    sessionId,
    client,
  );
  return {
    sessionId,
    activeConnectionCount,
    activeConnectionExists: activeConnectionCount > 0,
  };
}

export async function closeDebriefRoomIfEmpty(
  sessionId: string,
  client: DbClient = prisma,
): Promise<{ closed: boolean; reason: string; activeConnectionCount: number }> {
  const updated = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "Session" s
    SET "roomLifecycle" = ${RoomLifecycle.CLOSED},
        "updatedAt" = NOW()
    WHERE s.id = ${sessionId}
      AND s."deletedAt" IS NULL
      AND s."roomLifecycle" = ${RoomLifecycle.DEBRIEF_OPEN}
      AND NOT EXISTS (
        SELECT 1
        FROM "SessionRoomConnection" src
        INNER JOIN "User" u ON u.id = src."userId"
        WHERE ${sqlNowActiveConnectionPredicateForSession(sessionId)}
      )
    RETURNING s.id
  `);
  if (updated.length > 0) {
    return { closed: true, reason: "room_closed", activeConnectionCount: 0 };
  }

  const [sessionRow] = await client.$queryRaw<
    Array<{ roomLifecycle: RoomLifecycle | null }>
  >(Prisma.sql`
    SELECT "roomLifecycle"
    FROM "Session"
    WHERE id = ${sessionId}
  `);
  const activeConnectionCount = await countActiveSessionRoomConnections(
    sessionId,
    client,
  );

  if (!sessionRow) {
    return {
      closed: false,
      reason: "session_not_found",
      activeConnectionCount,
    };
  }
  if (sessionRow.roomLifecycle === RoomLifecycle.OPEN) {
    return {
      closed: false,
      reason: "room_open",
      activeConnectionCount,
    };
  }
  if (sessionRow.roomLifecycle === RoomLifecycle.CLOSED) {
    return {
      closed: false,
      reason: "already_closed",
      activeConnectionCount,
    };
  }
  if (activeConnectionCount > 0) {
    return {
      closed: false,
      reason: "active_connections_remain",
      activeConnectionCount,
    };
  }
  return {
    closed: false,
    reason: "no_transition",
    activeConnectionCount,
  };
}

