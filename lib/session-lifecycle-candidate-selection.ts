import {
  NegotiationState,
  Prisma,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import type { SessionLifecycleDurations } from "@/lib/config/session-lifecycle-settings";
import { prisma } from "@/lib/prisma";
import {
  sqlAbandonedReferenceAt,
  sqlDebriefEmptyReferenceAt,
  sqlParentEventStillOperableGuard,
} from "@/lib/session-lifecycle-sql";
import { sqlUtcWallClockOrDate } from "@/lib/sql-utc-wall-clock";

type CandidateDb = Pick<typeof prisma, "session" | "$queryRaw">;

export type SessionLifecycleCandidateSelectionPlan = {
  emptyCutoff: Date;
  maxCutoff: Date;
  abandonedCutoff: Date;
  debriefEmptyWhere: Prisma.SessionWhereInput;
  debriefMaxWhere: Prisma.SessionWhereInput;
  abandonedWhere: Prisma.SessionWhereInput;
  orderBy: Prisma.SessionOrderByWithRelationInput[];
  take: number;
};

/**
 * Active-lease exclusion used only as a non-authoritative selector hint.
 * The policy + fenced finalizer still decide close.
 */
function noActiveRoomConnectionWhere(
  now: Date,
): Prisma.SessionWhereInput {
  return {
    roomConnections: {
      none: {
        disconnectedAt: null,
        supersededAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { status: "ACTIVE" },
      },
    },
  };
}

function operableParentEventWhere(): Prisma.TrainingEventWhereInput {
  return {
    deletedAt: null,
    status: {
      notIn: [TrainingEventStatus.COMPLETED, TrainingEventStatus.CANCELLED],
    },
  };
}

function standaloneOrOperableParentWhere(): Prisma.SessionWhereInput {
  return {
    closedByEventAt: null,
    OR: [{ eventId: null }, { event: operableParentEventWhere() }],
  };
}

function sqlNoActiveRoomConnectionGuard(now: Date) {
  const nowExpr = sqlUtcWallClockOrDate(now);
  return Prisma.sql`
    AND NOT EXISTS (
      SELECT 1
      FROM "SessionRoomConnection" src
      INNER JOIN "User" u ON u.id = src."userId"
      WHERE src."sessionId" = s.id
        AND src."disconnectedAt" IS NULL
        AND src."supersededAt" IS NULL
        AND src."revokedAt" IS NULL
        AND src."expiresAt" > ${nowExpr}
        AND u.status = 'ACTIVE'
    )
  `;
}

function sqlScopeSessionIds(scopeSessionIds?: readonly string[]) {
  if (!scopeSessionIds || scopeSessionIds.length === 0) {
    return Prisma.empty;
  }
  return Prisma.sql`AND s.id IN (${Prisma.join(scopeSessionIds)})`;
}

/**
 * Bounded, no-starvation candidate plan.
 *
 * This is a conservative superset of policy-due Sessions: it uses occupancy
 * emptiness, the shared current-generation departure/reference SQL, and a
 * parent-Event fence. Occupied / not-yet-due / terminal-parent rows are
 * excluded from the empty and abandoned pages so they cannot occupy the
 * limit forever. Policy plus the fenced writer remain authoritative.
 */
export function buildSessionLifecycleCandidateSelectionPlan(params: {
  now: Date;
  limit: number;
  durations: SessionLifecycleDurations;
}): SessionLifecycleCandidateSelectionPlan {
  const take = Math.max(1, Math.min(params.limit, 5000));
  const emptyCutoff = new Date(
    params.now.getTime() - params.durations.debriefEmptyCloseMs,
  );
  const maxCutoff = new Date(
    params.now.getTime() - params.durations.debriefMaxDurationMs,
  );
  const abandonedCutoff = new Date(
    params.now.getTime() - params.durations.abandonedCloseMs,
  );
  const noActiveConnection = noActiveRoomConnectionWhere(params.now);
  const parentFence = standaloneOrOperableParentWhere();

  return {
    emptyCutoff,
    maxCutoff,
    abandonedCutoff,
    debriefEmptyWhere: {
      deletedAt: null,
      roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
      negotiationEndedAt: { lte: emptyCutoff },
      ...parentFence,
      ...noActiveConnection,
    },
    debriefMaxWhere: {
      deletedAt: null,
      roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
      negotiationEndedAt: { lte: maxCutoff },
      ...parentFence,
    },
    abandonedWhere: {
      deletedAt: null,
      closedByEventAt: null,
      OR: [
        {
          roomLifecycle: RoomLifecycle.OPEN,
          negotiationState: { not: NegotiationState.FINISHED },
        },
        {
          roomLifecycle: null,
          negotiationState: { not: NegotiationState.FINISHED },
        },
      ],
      AND: [
        { OR: [{ eventId: null }, { event: operableParentEventWhere() }] },
        noActiveConnection,
        {
          OR: [
            { eventId: null, createdAt: { lte: abandonedCutoff } },
            {
              event: {
                ...operableParentEventWhere(),
                scheduledAt: { lte: abandonedCutoff },
              },
            },
            {
              eventId: { not: null },
              createdAt: { lte: abandonedCutoff },
              event: {
                ...operableParentEventWhere(),
                scheduledAt: null,
              },
            },
          ],
        },
      ],
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take,
  };
}

export async function selectSessionLifecycleReconcileCandidateIds(params: {
  now: Date;
  limit: number;
  durations: SessionLifecycleDurations;
  extraSessionIds?: readonly string[];
  scopeSessionIds?: readonly string[];
  client?: CandidateDb;
}): Promise<string[]> {
  const client = params.client ?? prisma;
  const plan = buildSessionLifecycleCandidateSelectionPlan({
    now: params.now,
    limit: params.limit,
    durations: params.durations,
  });
  const sessionIdExpr = Prisma.sql`s.id`;
  const emptyCutoffExpr = sqlUtcWallClockOrDate(plan.emptyCutoff);
  const abandonedCutoffExpr = sqlUtcWallClockOrDate(plan.abandonedCutoff);
  const scope = sqlScopeSessionIds(params.scopeSessionIds);
  const noActive = sqlNoActiveRoomConnectionGuard(params.now);

  const [debriefEmpty, debriefMax, abandoned] = await Promise.all([
    client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT s.id
      FROM "Session" s
      WHERE s."deletedAt" IS NULL
        AND s."roomLifecycle" = ${RoomLifecycle.DEBRIEF_OPEN}
        AND s."negotiationEndedAt" IS NOT NULL
        ${sqlParentEventStillOperableGuard()}
        ${noActive}
        AND ${sqlDebriefEmptyReferenceAt({ sessionIdExpr, now: params.now })}
          <= ${emptyCutoffExpr}
        ${scope}
      ORDER BY s."updatedAt" ASC, s.id ASC
      LIMIT ${plan.take}
    `),
    client.session.findMany({
      where: {
        AND: [
          plan.debriefMaxWhere,
          params.scopeSessionIds
            ? { id: { in: [...params.scopeSessionIds] } }
            : {},
        ],
      },
      orderBy: plan.orderBy,
      take: plan.take,
      select: { id: true },
    }),
    client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT s.id
      FROM "Session" s
      WHERE s."deletedAt" IS NULL
        AND (
          s."roomLifecycle" = ${RoomLifecycle.OPEN}
          OR s."roomLifecycle" IS NULL
        )
        AND s."negotiationState" <> ${NegotiationState.FINISHED}
        ${sqlParentEventStillOperableGuard()}
        ${noActive}
        AND ${sqlAbandonedReferenceAt({ sessionIdExpr, now: params.now })}
          <= ${abandonedCutoffExpr}
        ${scope}
      ORDER BY s."updatedAt" ASC, s.id ASC
      LIMIT ${plan.take}
    `),
  ]);

  const sessionIds = new Set(params.extraSessionIds ?? []);
  for (const row of [...debriefEmpty, ...debriefMax, ...abandoned]) {
    sessionIds.add(row.id);
  }
  return [...sessionIds];
}
