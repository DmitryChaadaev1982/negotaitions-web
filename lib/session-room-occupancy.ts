import { Prisma, RoomLifecycle } from "@/app/generated/prisma/client";
import { getDebriefAutoCloseGraceMs } from "@/lib/env";
import { prisma } from "@/lib/prisma";

type DbClient = Pick<typeof prisma, "$queryRaw">;

export type ActiveConnectionDiagnostics = {
  sessionId: string;
  activeConnectionCount: number;
  activeConnectionExists: boolean;
};

export type DebriefAutoCloseEligibility = {
  eligible: boolean;
  reason:
    | "room_not_debrief_open"
    | "active_connections_remain"
    | "no_invalidated_connections"
    | "grace_period_active"
    | "grace_period_elapsed";
  graceRemainingMs: number;
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

function sqlLastInvalidatedConnectionTimestampForSession(sessionId: string) {
  return Prisma.sql`
    SELECT MAX(
      CASE
        WHEN src."supersededAt" IS NOT NULL OR src."revokedAt" IS NOT NULL THEN NULL
        WHEN src."disconnectedAt" IS NULL THEN NULL
        WHEN src."disconnectedReason" = 'EXPIRED' THEN src."expiresAt"
        ELSE src."disconnectedAt"
      END
    ) AS "lastInvalidatedAt"
    FROM "SessionRoomConnection" src
    INNER JOIN "User" u ON u.id = src."userId"
    WHERE src."sessionId" = ${sessionId}
      AND src.role IN (
        'FACILITATOR'::"ParticipantType",
        'PARTICIPANT'::"ParticipantType",
        'OBSERVER'::"ParticipantType"
      )
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

export async function getLastInvalidatedSessionRoomConnectionAt(
  sessionId: string,
  client: DbClient = prisma,
): Promise<Date | null> {
  const [lastInvalidationRow] = await client.$queryRaw<
    Array<{ lastInvalidatedAt: Date | null }>
  >(sqlLastInvalidatedConnectionTimestampForSession(sessionId));
  return lastInvalidationRow?.lastInvalidatedAt ?? null;
}

export function evaluateDebriefAutoCloseEligibility(params: {
  roomLifecycle: RoomLifecycle | null;
  activeConnectionCount: number;
  lastInvalidatedAt: Date | null;
  now: Date;
  graceMs: number;
}): DebriefAutoCloseEligibility {
  if (params.roomLifecycle !== RoomLifecycle.DEBRIEF_OPEN) {
    return {
      eligible: false,
      reason: "room_not_debrief_open",
      graceRemainingMs: 0,
    };
  }
  if (params.activeConnectionCount > 0) {
    return {
      eligible: false,
      reason: "active_connections_remain",
      graceRemainingMs: 0,
    };
  }
  if (!params.lastInvalidatedAt) {
    return {
      eligible: false,
      reason: "no_invalidated_connections",
      graceRemainingMs: params.graceMs,
    };
  }

  const elapsedMs = params.now.getTime() - params.lastInvalidatedAt.getTime();
  if (elapsedMs < params.graceMs) {
    return {
      eligible: false,
      reason: "grace_period_active",
      graceRemainingMs: Math.max(0, params.graceMs - elapsedMs),
    };
  }
  return {
    eligible: true,
    reason: "grace_period_elapsed",
    graceRemainingMs: 0,
  };
}

export async function closeDebriefRoomIfEmpty(
  sessionId: string,
  client: DbClient = prisma,
  options?: {
    now?: Date;
    graceMs?: number;
  },
): Promise<{ closed: boolean; reason: string; activeConnectionCount: number }> {
  const now = options?.now ?? new Date();
  const graceMs = options?.graceMs ?? getDebriefAutoCloseGraceMs();
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
  const lastInvalidatedAt = await getLastInvalidatedSessionRoomConnectionAt(
    sessionId,
    client,
  );
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: sessionRow?.roomLifecycle ?? null,
    activeConnectionCount,
    lastInvalidatedAt,
    now,
    graceMs,
  });

  if (!sessionRow) {
    return {
      closed: false,
      reason: "session_not_found",
      activeConnectionCount,
    };
  }
  if (!eligibility.eligible) {
    return {
      closed: false,
      reason:
        eligibility.reason === "room_not_debrief_open"
          ? sessionRow.roomLifecycle === RoomLifecycle.CLOSED
            ? "already_closed"
            : sessionRow.roomLifecycle === RoomLifecycle.OPEN
              ? "room_open"
              : "no_transition"
          : eligibility.reason === "grace_period_active"
            ? "grace_period_active"
            : eligibility.reason,
      activeConnectionCount,
    };
  }

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

  const refreshedActiveConnectionCount = await countActiveSessionRoomConnections(
    sessionId,
    client,
  );
  return {
    closed: false,
    reason:
      refreshedActiveConnectionCount > 0
        ? "active_connections_remain"
        : "no_transition",
    activeConnectionCount: refreshedActiveConnectionCount,
  };
}

