import {
  NegotiationState,
  Prisma,
  RoomLifecycle,
  SessionStatus,
} from "@/app/generated/prisma/client";
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

export type SessionFinalCloseAuthority =
  | "FACILITATOR_SESSION_COMPLETE"
  | "DEBRIEF_EMPTY_TIMEOUT"
  | "EVENT_COMPLETION";

export type CanonicalFinalSessionCloseResult = {
  applied: boolean;
  session: {
    id: string;
    status: SessionStatus;
    negotiationState: NegotiationState;
    roomLifecycle: RoomLifecycle | null;
    closeReason: string | null;
    endedAt: Date | null;
    closedByEventAt: Date | null;
  } | null;
};

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
    AND src."disconnectedAt" IS NULL
    AND src."supersededAt" IS NULL
    AND src."revokedAt" IS NULL
    AND src."expiresAt" > ${nowExpr}
    AND s."deletedAt" IS NULL
    AND (s."roomLifecycle" IS NULL OR s."roomLifecycle" <> ${RoomLifecycle.CLOSED})
    AND u.status = 'ACTIVE'
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
      GREATEST(
        CASE
          WHEN src."disconnectedAt" IS NOT NULL
            AND src."disconnectedReason" = 'EXPIRED'
            THEN src."expiresAt"
          WHEN src."disconnectedAt" IS NOT NULL
            THEN src."disconnectedAt"
          WHEN src."supersededAt" IS NULL AND src."revokedAt" IS NULL
            THEN src."expiresAt"
          ELSE NULL
        END,
        src."supersededAt",
        src."revokedAt"
      )
    ) AS "lastInvalidatedAt"
    FROM "SessionRoomConnection" src
    INNER JOIN "User" u ON u.id = src."userId"
    WHERE src."sessionId" = ${sessionId}
      AND u.status = 'ACTIVE'
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

export async function finalizeSessionCanonicalClose(
  params: {
    sessionId: string;
    authority: SessionFinalCloseAuthority;
    now?: Date;
    graceMs?: number;
    closedByEventId?: string | null;
  },
  client: DbClient = prisma,
): Promise<CanonicalFinalSessionCloseResult> {
  const now = params.now ?? new Date();
  const nowExpr = sqlUtcWallClockOrDate(now);
  const isEmptyDebriefAuthority =
    params.authority === "DEBRIEF_EMPTY_TIMEOUT";
  const isEventAuthority = params.authority === "EVENT_COMPLETION";
  const closeReason =
    params.authority === "EVENT_COMPLETION"
      ? "EVENT_COMPLETED"
      : params.authority;
  const graceMs = params.graceMs ?? getDebriefAutoCloseGraceMs();
  const graceCutoffExpr = sqlUtcWallClockOrDate(
    new Date(now.getTime() - graceMs),
  );
  const authorityGuard = isEmptyDebriefAuthority
    ? Prisma.sql`
        AND s."roomLifecycle" = ${RoomLifecycle.DEBRIEF_OPEN}
        AND s."negotiationEndedAt" IS NOT NULL
        AND GREATEST(
          s."negotiationEndedAt",
          COALESCE(
            (${sqlLastInvalidatedConnectionTimestampForSession(params.sessionId)}),
            s."negotiationEndedAt"
          )
        ) <= ${graceCutoffExpr}
        AND NOT EXISTS (
          SELECT 1
          FROM "SessionRoomConnection" src
          INNER JOIN "User" u ON u.id = src."userId"
          WHERE ${sqlActiveConnectionPredicateForSessionAt({
            sessionId: params.sessionId,
            now,
          })}
        )
      `
    : params.authority === "FACILITATOR_SESSION_COMPLETE"
      ? Prisma.sql`
          AND (
            s."roomLifecycle" IS NULL OR
            s."roomLifecycle" <> ${RoomLifecycle.CLOSED}
          )
        `
      : Prisma.empty;

  const updated = await client.$queryRaw<
    CanonicalFinalSessionCloseResult["session"][]
  >(Prisma.sql`
    UPDATE "Session" s
    SET "status" = ${SessionStatus.COMPLETED},
        "endedAt" = COALESCE(s."endedAt", ${nowExpr}),
        "closeReason" = ${closeReason},
        "roomLifecycle" = ${RoomLifecycle.CLOSED},
        "closedByEventAt" = CASE
          WHEN ${isEventAuthority}
            THEN COALESCE(s."closedByEventAt", ${nowExpr})
          ELSE s."closedByEventAt"
        END,
        "closedByEventId" = CASE
          WHEN ${isEventAuthority}
            THEN ${params.closedByEventId ?? null}
          ELSE s."closedByEventId"
        END,
        "updatedAt" = ${nowExpr}
    WHERE s.id = ${params.sessionId}
      AND s."deletedAt" IS NULL
      ${authorityGuard}
    RETURNING
      s.id,
      s.status,
      s."negotiationState",
      s."roomLifecycle",
      s."closeReason",
      s."endedAt",
      s."closedByEventAt"
  `);
  if (updated[0]) {
    return { applied: true, session: updated[0] };
  }
  const [existing] = await client.$queryRaw<
    CanonicalFinalSessionCloseResult["session"][]
  >(Prisma.sql`
    SELECT
      s.id,
      s.status,
      s."negotiationState",
      s."roomLifecycle",
      s."closeReason",
      s."endedAt",
      s."closedByEventAt"
    FROM "Session" s
    WHERE s.id = ${params.sessionId}
  `);
  return { applied: false, session: existing ?? null };
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
    Array<{
      roomLifecycle: RoomLifecycle | null;
      negotiationEndedAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT "roomLifecycle", "negotiationEndedAt"
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
      debriefOpenedAt: sessionRow?.negotiationEndedAt ?? null,
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
        debriefOpenedAt:
          sessionRow.negotiationEndedAt?.toISOString() ?? null,
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

  const finalized = await finalizeSessionCanonicalClose(
    {
      sessionId,
      authority: "DEBRIEF_EMPTY_TIMEOUT",
      now,
      graceMs,
    },
    client,
  );
  if (finalized.applied) {
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
        updateRowCount: 1,
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
