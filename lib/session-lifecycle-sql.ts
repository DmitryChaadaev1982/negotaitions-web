import { Prisma, TrainingEventStatus } from "@/app/generated/prisma/client";
import { sqlUtcWallClockOrDate } from "@/lib/sql-utc-wall-clock";

/**
 * Shared current-generation departure expression.
 * Superseded leases are excluded. Live expiresAt is ignored;
 * expired-but-unswept leases use expiresAt.
 */
export function sqlLastCurrentGenerationDepartureSubquery(params: {
  sessionIdExpr: Prisma.Sql;
  now?: Date;
}) {
  const nowExpr = sqlUtcWallClockOrDate(params.now);
  return Prisma.sql`
    SELECT MAX(current_gen."leftAt") AS "lastDepartedAt"
    FROM (
      SELECT DISTINCT ON (src."userId")
        CASE
          WHEN src."disconnectedAt" IS NOT NULL
            AND src."disconnectedReason" = 'EXPIRED'
            THEN src."expiresAt"
          WHEN src."disconnectedAt" IS NOT NULL
            THEN src."disconnectedAt"
          WHEN src."revokedAt" IS NOT NULL
            THEN src."revokedAt"
          WHEN src."expiresAt" <= ${nowExpr}
            THEN src."expiresAt"
          ELSE NULL
        END AS "leftAt"
      FROM "SessionRoomConnection" src
      INNER JOIN "User" u ON u.id = src."userId"
      WHERE src."sessionId" = ${params.sessionIdExpr}
        AND src."supersededAt" IS NULL
        AND u.status = 'ACTIVE'
      ORDER BY src."userId", src."leaseVersion" DESC, src."createdAt" DESC, src.id DESC
    ) current_gen
  `;
}

export function sqlLastCurrentGenerationDepartureForSession(params: {
  sessionId: string;
  now?: Date;
}) {
  return sqlLastCurrentGenerationDepartureSubquery({
    sessionIdExpr: Prisma.sql`${params.sessionId}`,
    now: params.now,
  });
}

export function sqlParentEventStillOperableGuard() {
  return Prisma.sql`
    AND s."closedByEventAt" IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "TrainingEvent" e
      WHERE e.id = s."eventId"
        AND (
          e.status IN (
            ${TrainingEventStatus.COMPLETED},
            ${TrainingEventStatus.CANCELLED}
          )
          OR e."deletedAt" IS NOT NULL
        )
    )
  `;
}

/**
 * Empty-Debrief reference: max(negotiationEndedAt, last current-generation
 * departure). Same expression as the fenced empty-close UPDATE.
 */
export function sqlDebriefEmptyReferenceAt(params: {
  sessionIdExpr: Prisma.Sql;
  now?: Date;
}) {
  return Prisma.sql`
    GREATEST(
      s."negotiationEndedAt",
      COALESCE(
        (${sqlLastCurrentGenerationDepartureSubquery(params)}),
        s."negotiationEndedAt"
      )
    )
  `;
}

/**
 * Abandoned reference: max(last current-generation departure or createdAt,
 * parent Event.scheduledAt or createdAt). Same expression as the fenced
 * abandoned-close UPDATE.
 */
export function sqlAbandonedReferenceAt(params: {
  sessionIdExpr: Prisma.Sql;
  now?: Date;
}) {
  return Prisma.sql`
    GREATEST(
      COALESCE(
        (${sqlLastCurrentGenerationDepartureSubquery(params)}),
        s."createdAt"
      ),
      COALESCE(
        (
          SELECT e."scheduledAt"
          FROM "TrainingEvent" e
          WHERE e.id = s."eventId"
        ),
        s."createdAt"
      )
    )
  `;
}
