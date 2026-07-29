import { Prisma, RoomLifecycle } from "@/app/generated/prisma/client";
import { getDebriefAutoCloseGraceMs } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import {
  evaluateDebriefAutoCloseEligibility,
  type DebriefAutoCloseEligibility,
} from "@/lib/session-room-occupancy-policy";
import { sqlUtcWallClockOrDate } from "@/lib/sql-utc-wall-clock";

export {
  decideFinishRoomLifecycle,
  evaluateDebriefAutoCloseEligibility,
  isLeaseExpiryAheadOfReferenceClock,
  type DebriefAutoCloseEligibility,
} from "@/lib/session-room-occupancy-policy";

type DbClient = Pick<typeof prisma, "$queryRaw">;

export type ActiveConnectionDiagnostics = {
  sessionId: string;
  activeConnectionCount: number;
  activeConnectionExists: boolean;
};

/**
 * Active-connection predicate must compare expiresAt against UTC wall-clock
 * time (Prisma DateTime / timestamp-without-time-zone convention).
 * Never use bare NOW() here: production DB TimeZone is Europe/Moscow.
 */
function sqlActiveConnectionPredicateForSessionAt(params: {
  sessionId: string;
  now?: Date;
}) {
  const nowExpr = sqlUtcWallClockOrDate(params.now);
  return Prisma.sql`
    src."sessionId" = ${params.sessionId}
    AND src.role IN (
      'FACILITATOR'::"ParticipantType",
      'PARTICIPANT'::"ParticipantType",
      'OBSERVER'::"ParticipantType"
    )
    AND src."disconnectedAt" IS NULL
    AND src."supersededAt" IS NULL
    AND src."revokedAt" IS NULL
    AND src."expiresAt" > ${nowExpr}
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
  now?: Date,
): Promise<number> {
  const rows = await client.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM "SessionRoomConnection" src
    INNER JOIN "Session" s ON s.id = src."sessionId"
    INNER JOIN "User" u ON u.id = src."userId"
    WHERE ${sqlActiveConnectionPredicateForSessionAt({ sessionId, now })}
  `);
  return Number(rows[0]?.count ?? 0);
}

export async function getActiveConnectionDiagnostics(
  sessionId: string,
  client: DbClient = prisma,
  now?: Date,
): Promise<ActiveConnectionDiagnostics> {
  const activeConnectionCount = await countActiveSessionRoomConnections(
    sessionId,
    client,
    now,
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
    now,
  );
  const lastInvalidatedAt = await getLastInvalidatedSessionRoomConnectionAt(
    sessionId,
    client,
  );
  const eligibility: DebriefAutoCloseEligibility =
    evaluateDebriefAutoCloseEligibility({
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
    console.info(
      JSON.stringify({
        area: "session_room_occupancy",
        event: "debrief_auto_close_decision",
        sessionId,
        currentLifecycle: sessionRow.roomLifecycle,
        activeConnectionCount,
        lastInvalidatedAt: lastInvalidatedAt?.toISOString() ?? null,
        now: now.toISOString(),
        graceMs,
        graceRemainingMs: eligibility.graceRemainingMs,
        eligibilityReason: eligibility.reason,
        updateRowCount: 0,
        closed: false,
      }),
    );
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

  const updatedAtExpr = sqlUtcWallClockOrDate(options?.now);
  const updated = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE "Session" s
    SET "roomLifecycle" = ${RoomLifecycle.CLOSED},
        "updatedAt" = ${updatedAtExpr}
    WHERE s.id = ${sessionId}
      AND s."deletedAt" IS NULL
      AND s."roomLifecycle" = ${RoomLifecycle.DEBRIEF_OPEN}
      AND NOT EXISTS (
        SELECT 1
        FROM "SessionRoomConnection" src
        INNER JOIN "User" u ON u.id = src."userId"
        WHERE ${sqlActiveConnectionPredicateForSessionAt({
          sessionId,
          now: options?.now,
        })}
      )
    RETURNING s.id
  `);
  if (updated.length > 0) {
    console.info(
      JSON.stringify({
        area: "session_room_occupancy",
        event: "debrief_auto_close_decision",
        sessionId,
        currentLifecycle: RoomLifecycle.DEBRIEF_OPEN,
        activeConnectionCount: 0,
        lastInvalidatedAt: lastInvalidatedAt?.toISOString() ?? null,
        now: now.toISOString(),
        graceMs,
        graceRemainingMs: 0,
        eligibilityReason: eligibility.reason,
        updateRowCount: updated.length,
        closed: true,
      }),
    );
    return { closed: true, reason: "room_closed", activeConnectionCount: 0 };
  }

  const refreshedActiveConnectionCount = await countActiveSessionRoomConnections(
    sessionId,
    client,
    now,
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
