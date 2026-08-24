import {
  NegotiationState,
  Prisma,
  RoomLifecycle,
  SessionStatus,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import {
  getSessionLifecycleDurations,
  type SessionLifecycleDurations,
} from "@/lib/config/session-lifecycle-settings";
import { prisma } from "@/lib/prisma";
import {
  evaluateSessionLifecyclePolicy,
  SESSION_AUTO_CLOSE_REASONS,
  type SessionAutoCloseReason,
  type SessionLifecycleDecision,
  type SessionLifecyclePolicyResult,
} from "@/lib/session-lifecycle-policy";
import {
  runAfterAutomaticPolicyDueHook,
  runAfterSessionRowLockedForFinalizeHook,
} from "@/lib/session-lifecycle-concurrency-hooks";
import {
  resolveAutomaticCloseLogEmission,
  type AutomaticCloseInvocation,
} from "@/lib/session-lifecycle-observability";
import {
  sqlAbandonedReferenceAt,
  sqlDebriefEmptyReferenceAt,
  sqlLastCurrentGenerationDepartureForSession,
  sqlParentEventStillOperableGuard,
} from "@/lib/session-lifecycle-sql";
import { sqlUtcWallClockOrDate } from "@/lib/sql-utc-wall-clock";

export type { AutomaticCloseInvocation } from "@/lib/session-lifecycle-observability";

export {
  decideFinishRoomLifecycle,
  evaluateDebriefAutoCloseEligibility,
  isLeaseExpiryAheadOfReferenceClock,
  type DebriefAutoCloseEligibility,
} from "@/lib/session-room-occupancy-policy";

type QueryRawClient = Pick<typeof prisma, "$queryRaw">;
type TransactionalDbClient = QueryRawClient & {
  $transaction: typeof prisma.$transaction;
};
type DbClient = QueryRawClient | TransactionalDbClient;

function hasTransaction(
  client: DbClient,
): client is TransactionalDbClient {
  return typeof (client as { $transaction?: unknown }).$transaction === "function";
}

export type SessionFinalCloseAuthority =
  | "FACILITATOR_SESSION_COMPLETE"
  | "DEBRIEF_EMPTY_TIMEOUT"
  | "DEBRIEF_MAX_DURATION"
  | "SESSION_ABANDONED_TIMEOUT"
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

export type SessionAutomaticCloseDecision =
  | SessionLifecycleDecision
  | "closed"
  | "lost_race";

export type SessionAutomaticCloseResult = {
  closed: boolean;
  reason: string;
  activeConnectionCount: number;
  decision: SessionAutomaticCloseDecision;
  policy: SessionLifecyclePolicyResult | null;
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

export async function getLastInvalidatedSessionRoomConnectionAt(
  sessionId: string,
  client: DbClient = prisma,
  now?: Date,
): Promise<Date | null> {
  const [lastInvalidationRow] = await client.$queryRaw<
    Array<{ lastDepartedAt: Date | null }>
  >(sqlLastCurrentGenerationDepartureForSession({ sessionId, now }));
  return lastInvalidationRow?.lastDepartedAt ?? null;
}

export async function getLastCurrentGenerationDepartureAt(
  sessionId: string,
  client: DbClient = prisma,
  now?: Date,
): Promise<Date | null> {
  return getLastInvalidatedSessionRoomConnectionAt(sessionId, client, now);
}

function resolveDurations(params?: {
  graceMs?: number;
  durations?: Partial<SessionLifecycleDurations>;
}): SessionLifecycleDurations {
  const defaults = getSessionLifecycleDurations();
  return {
    debriefEmptyCloseMs:
      params?.durations?.debriefEmptyCloseMs ??
      params?.graceMs ??
      defaults.debriefEmptyCloseMs,
    debriefMaxDurationMs:
      params?.durations?.debriefMaxDurationMs ?? defaults.debriefMaxDurationMs,
    abandonedCloseMs:
      params?.durations?.abandonedCloseMs ?? defaults.abandonedCloseMs,
  };
}

function sqlAutomaticCloseAuthorityGuard(params: {
  sessionId: string;
  authority: SessionFinalCloseAuthority;
  now: Date;
  durations: SessionLifecycleDurations;
}) {
  const now = params.now;
  const emptyCutoffExpr = sqlUtcWallClockOrDate(
    new Date(now.getTime() - params.durations.debriefEmptyCloseMs),
  );
  const maxCutoffExpr = sqlUtcWallClockOrDate(
    new Date(now.getTime() - params.durations.debriefMaxDurationMs),
  );
  const abandonedCutoffExpr = sqlUtcWallClockOrDate(
    new Date(now.getTime() - params.durations.abandonedCloseMs),
  );
  const sessionIdExpr = Prisma.sql`${params.sessionId}`;

  if (params.authority === "DEBRIEF_EMPTY_TIMEOUT") {
    return Prisma.sql`
      AND s."roomLifecycle" = ${RoomLifecycle.DEBRIEF_OPEN}
      AND s."negotiationEndedAt" IS NOT NULL
      ${sqlParentEventStillOperableGuard()}
      AND ${sqlDebriefEmptyReferenceAt({ sessionIdExpr, now })} <= ${emptyCutoffExpr}
      AND NOT EXISTS (
        SELECT 1
        FROM "SessionRoomConnection" src
        INNER JOIN "User" u ON u.id = src."userId"
        WHERE ${sqlActiveConnectionPredicateForSessionAt({
          sessionId: params.sessionId,
          now,
        })}
      )
    `;
  }

  if (params.authority === "DEBRIEF_MAX_DURATION") {
    return Prisma.sql`
      AND s."roomLifecycle" = ${RoomLifecycle.DEBRIEF_OPEN}
      AND s."negotiationEndedAt" IS NOT NULL
      ${sqlParentEventStillOperableGuard()}
      AND s."negotiationEndedAt" <= ${maxCutoffExpr}
    `;
  }

  if (params.authority === "SESSION_ABANDONED_TIMEOUT") {
    return Prisma.sql`
      AND (
        s."roomLifecycle" IS NULL OR
        s."roomLifecycle" = ${RoomLifecycle.OPEN}
      )
      ${sqlParentEventStillOperableGuard()}
      AND ${sqlAbandonedReferenceAt({ sessionIdExpr, now })} <= ${abandonedCutoffExpr}
      AND NOT EXISTS (
        SELECT 1
        FROM "SessionRoomConnection" src
        INNER JOIN "User" u ON u.id = src."userId"
        WHERE ${sqlActiveConnectionPredicateForSessionAt({
          sessionId: params.sessionId,
          now,
        })}
      )
    `;
  }

  if (params.authority === "FACILITATOR_SESSION_COMPLETE") {
    return Prisma.sql`
      AND (
        s."roomLifecycle" IS NULL OR
        s."roomLifecycle" <> ${RoomLifecycle.CLOSED}
      )
    `;
  }

  return Prisma.empty;
}

export async function lockSessionRowForLifecycleWrite(
  sessionId: string,
  client: QueryRawClient,
): Promise<void> {
  await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT s.id
    FROM "Session" s
    WHERE s.id = ${sessionId}
    FOR UPDATE OF s
  `);
  await runAfterSessionRowLockedForFinalizeHook();
}

async function finalizeSessionCanonicalCloseOnLockedClient(
  params: {
    sessionId: string;
    authority: SessionFinalCloseAuthority;
    now: Date;
    durations: SessionLifecycleDurations;
    closedByEventId?: string | null;
  },
  client: QueryRawClient,
): Promise<CanonicalFinalSessionCloseResult> {
  const nowExpr = sqlUtcWallClockOrDate(params.now);
  const isEventAuthority = params.authority === "EVENT_COMPLETION";
  const closeReason =
    params.authority === "EVENT_COMPLETION"
      ? "EVENT_COMPLETED"
      : params.authority;
  const authorityGuard = sqlAutomaticCloseAuthorityGuard({
    sessionId: params.sessionId,
    authority: params.authority,
    now: params.now,
    durations: params.durations,
  });

  await lockSessionRowForLifecycleWrite(params.sessionId, client);

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

/**
 * Canonical Session closer. Automatic and claim/rejoin writers serialize on
 * the Session row (`SELECT ... FOR UPDATE` / `UPDATE`), not on `NOT EXISTS`
 * alone. A concurrent `SessionRoomConnection` INSERT cannot commit while this
 * lock is held, and this UPDATE cannot evaluate emptiness against an
 * uncommitted later INSERT.
 */
export async function finalizeSessionCanonicalClose(
  params: {
    sessionId: string;
    authority: SessionFinalCloseAuthority;
    now?: Date;
    graceMs?: number;
    durations?: Partial<SessionLifecycleDurations>;
    closedByEventId?: string | null;
  },
  client: DbClient = prisma,
): Promise<CanonicalFinalSessionCloseResult> {
  const now = params.now ?? new Date();
  const durations = resolveDurations(params);
  const writeParams = {
    sessionId: params.sessionId,
    authority: params.authority,
    now,
    durations,
    closedByEventId: params.closedByEventId,
  };
  if (hasTransaction(client)) {
    return client.$transaction((tx) =>
      finalizeSessionCanonicalCloseOnLockedClient(writeParams, tx),
    );
  }
  return finalizeSessionCanonicalCloseOnLockedClient(writeParams, client);
}

function logAutomaticCloseDecision(params: {
  sessionId: string;
  now: Date;
  occupancyCount: number;
  policy: SessionLifecyclePolicyResult | null;
  decision: SessionAutomaticCloseDecision;
  closed: boolean;
  invocation: AutomaticCloseInvocation;
}) {
  const emission = resolveAutomaticCloseLogEmission({
    invocation: params.invocation,
    decision: params.decision,
    closed: params.closed,
  });
  if (!emission.emit) {
    return;
  }
  const payload = JSON.stringify({
    area: "session_lifecycle",
    event: "session_auto_close_decision",
    sessionId: params.sessionId,
    automaticReason: params.policy?.reason ?? null,
    dueAt: params.policy?.dueAt?.toISOString() ?? null,
    evaluatedAt: params.now.toISOString(),
    occupancyCount: params.occupancyCount,
    occupancyClassification:
      params.occupancyCount > 0 ? "occupied" : "empty",
    decision: params.decision,
    referenceAt: params.policy?.referenceAt?.toISOString() ?? null,
    emptySinceAt: params.policy?.emptySinceAt?.toISOString() ?? null,
    remainingMs: params.policy?.remainingMs ?? 0,
    whyNotDue: params.policy?.whyNotDue ?? null,
    closed: params.closed,
    invocation: params.invocation,
  });
  if (emission.level === "warn") {
    console.warn(payload);
    return;
  }
  console.info(payload);
}

export async function reconcileSessionAutomaticClose(
  sessionId: string,
  client: DbClient = prisma,
  options?: {
    now?: Date;
    graceMs?: number;
    durations?: Partial<SessionLifecycleDurations>;
    invocation?: AutomaticCloseInvocation;
  },
): Promise<SessionAutomaticCloseResult> {
  const now = options?.now ?? new Date();
  const durations = resolveDurations(options);
  const invocation = options?.invocation ?? "transition";
  const [sessionRow] = await client.$queryRaw<
    Array<{
      roomLifecycle: RoomLifecycle | null;
      negotiationEndedAt: Date | null;
      negotiationState: NegotiationState | null;
      deletedAt: Date | null;
      createdAt: Date;
      closedByEventAt: Date | null;
      eventScheduledAt: Date | null;
      eventStatus: TrainingEventStatus | null;
      eventDeletedAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      s."roomLifecycle",
      s."negotiationEndedAt",
      s."negotiationState",
      s."deletedAt",
      s."createdAt",
      s."closedByEventAt",
      e."scheduledAt" AS "eventScheduledAt",
      e.status AS "eventStatus",
      e."deletedAt" AS "eventDeletedAt"
    FROM "Session" s
    LEFT JOIN "TrainingEvent" e ON e.id = s."eventId"
    WHERE s.id = ${sessionId}
  `);
  const activeConnectionCount = await countActiveSessionRoomConnections(
    sessionId,
    client,
    now,
  );
  const lastCurrentGenerationDepartureAt =
    await getLastCurrentGenerationDepartureAt(sessionId, client, now);

  if (!sessionRow) {
    return {
      closed: false,
      reason: "session_not_found",
      activeConnectionCount,
      decision: "ineligible",
      policy: null,
    };
  }

  const policy = evaluateSessionLifecyclePolicy({
    now,
    roomLifecycle: sessionRow.roomLifecycle,
    deletedAt: sessionRow.deletedAt,
    createdAt: sessionRow.createdAt,
    negotiationEndedAt: sessionRow.negotiationEndedAt,
    negotiationState: sessionRow.negotiationState,
    closedByEventAt: sessionRow.closedByEventAt,
    occupancyCount: activeConnectionCount,
    lastCurrentGenerationDepartureAt,
    parentEvent: sessionRow.eventStatus
      ? {
          scheduledAt: sessionRow.eventScheduledAt,
          status: sessionRow.eventStatus,
          deletedAt: sessionRow.eventDeletedAt,
        }
      : null,
    durations,
  });

  if (!policy.currentlyDue || !policy.reason) {
    const compatibilityReason =
      policy.decision === "already_terminal"
        ? sessionRow.roomLifecycle === RoomLifecycle.CLOSED
          ? "already_closed"
          : "already_terminal"
        : policy.decision === "occupied"
          ? "active_connections_remain"
          : policy.whyNotDue === "no_debrief_opened_at"
            ? "no_debrief_opened_at"
            : policy.decision === "not_due" &&
                policy.reason ===
                  SESSION_AUTO_CLOSE_REASONS.DEBRIEF_EMPTY_TIMEOUT
              ? "grace_period_active"
              : sessionRow.roomLifecycle === RoomLifecycle.OPEN
                ? "room_open"
                : policy.whyNotDue ?? "no_transition";
    logAutomaticCloseDecision({
      sessionId,
      now,
      occupancyCount: activeConnectionCount,
      policy,
      decision: policy.decision,
      closed: false,
      invocation,
    });
    return {
      closed: false,
      reason: compatibilityReason,
      activeConnectionCount,
      decision: policy.decision,
      policy,
    };
  }

  await runAfterAutomaticPolicyDueHook();

  if (policy.reason === SESSION_AUTO_CLOSE_REASONS.SESSION_ABANDONED_TIMEOUT) {
    const { completeSessionCanonical } = await import("@/lib/session-completion-core");
    const completion = await completeSessionCanonical({
      sessionId,
      mode: "SESSION_ABANDONED_TIMEOUT",
      reason: policy.reason,
      hardClose: true,
      now,
      durations,
      client: hasTransaction(client) ? (client as typeof prisma) : undefined,
    });
    if (completion.sessionCloseApplied) {
      logAutomaticCloseDecision({
        sessionId,
        now,
        occupancyCount: 0,
        policy,
        decision: "closed",
        closed: true,
        invocation,
      });
      return {
        closed: true,
        reason: "room_closed",
        activeConnectionCount: 0,
        decision: "closed",
        policy,
      };
    }
    const refreshedActiveConnectionCount = await countActiveSessionRoomConnections(
      sessionId,
      client,
      now,
    );
    const lostRaceDecision: SessionAutomaticCloseDecision =
      completion.roomLifecycle === RoomLifecycle.CLOSED
        ? "already_terminal"
        : refreshedActiveConnectionCount > 0
          ? "lost_race"
          : "lost_race";
    logAutomaticCloseDecision({
      sessionId,
      now,
      occupancyCount: refreshedActiveConnectionCount,
      policy,
      decision: lostRaceDecision,
      closed: false,
      invocation,
    });
    return {
      closed: false,
      reason:
        refreshedActiveConnectionCount > 0
          ? "active_connections_remain"
          : completion.roomLifecycle === RoomLifecycle.CLOSED
            ? "already_closed"
            : "no_transition",
      activeConnectionCount: refreshedActiveConnectionCount,
      decision: lostRaceDecision,
      policy,
    };
  }

  const finalized = await finalizeSessionCanonicalClose(
    {
      sessionId,
      authority: policy.reason,
      now,
      durations,
    },
    client,
  );
  if (finalized.applied) {
    logAutomaticCloseDecision({
      sessionId,
      now,
      occupancyCount: 0,
      policy,
      decision: "closed",
      closed: true,
      invocation,
    });
    return {
      closed: true,
      reason: "room_closed",
      activeConnectionCount: 0,
      decision: "closed",
      policy,
    };
  }

  const refreshedActiveConnectionCount = await countActiveSessionRoomConnections(
    sessionId,
    client,
    now,
  );
  const lostRaceDecision: SessionAutomaticCloseDecision =
    finalized.session?.roomLifecycle === RoomLifecycle.CLOSED
      ? "already_terminal"
      : refreshedActiveConnectionCount > 0
        ? "lost_race"
        : "lost_race";
  logAutomaticCloseDecision({
    sessionId,
    now,
    occupancyCount: refreshedActiveConnectionCount,
    policy,
    decision: lostRaceDecision,
    closed: false,
    invocation,
  });
  return {
    closed: false,
    reason:
      refreshedActiveConnectionCount > 0
        ? "active_connections_remain"
        : finalized.session?.roomLifecycle === RoomLifecycle.CLOSED
          ? "already_closed"
          : "no_transition",
    activeConnectionCount: refreshedActiveConnectionCount,
    decision: lostRaceDecision,
    policy,
  };
}

export async function closeDebriefRoomIfEmpty(
  sessionId: string,
  client: DbClient = prisma,
  options?: {
    now?: Date;
    graceMs?: number;
    durations?: Partial<SessionLifecycleDurations>;
    invocation?: AutomaticCloseInvocation;
  },
): Promise<{ closed: boolean; reason: string; activeConnectionCount: number }> {
  const result = await reconcileSessionAutomaticClose(sessionId, client, options);
  return {
    closed: result.closed,
    reason: result.reason,
    activeConnectionCount: result.activeConnectionCount,
  };
}

export function isAutomaticSessionCloseReason(
  value: string | null | undefined,
): value is SessionAutoCloseReason {
  return (
    value === SESSION_AUTO_CLOSE_REASONS.DEBRIEF_EMPTY_TIMEOUT ||
    value === SESSION_AUTO_CLOSE_REASONS.DEBRIEF_MAX_DURATION ||
    value === SESSION_AUTO_CLOSE_REASONS.SESSION_ABANDONED_TIMEOUT
  );
}
