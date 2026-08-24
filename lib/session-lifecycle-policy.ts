import {
  NegotiationState,
  RoomLifecycle,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import type { SessionLifecycleDurations } from "@/lib/config/session-lifecycle-settings";

export const SESSION_AUTO_CLOSE_REASONS = {
  DEBRIEF_EMPTY_TIMEOUT: "DEBRIEF_EMPTY_TIMEOUT",
  DEBRIEF_MAX_DURATION: "DEBRIEF_MAX_DURATION",
  SESSION_ABANDONED_TIMEOUT: "SESSION_ABANDONED_TIMEOUT",
} as const;

export type SessionAutoCloseReason =
  (typeof SESSION_AUTO_CLOSE_REASONS)[keyof typeof SESSION_AUTO_CLOSE_REASONS];

export type SessionLifecycleDecision =
  | "not_due"
  | "occupied"
  | "due"
  | "already_terminal"
  | "ineligible";

export type SessionLifecyclePolicyInput = {
  now: Date;
  roomLifecycle: RoomLifecycle | null;
  deletedAt: Date | null;
  createdAt: Date;
  negotiationEndedAt: Date | null;
  negotiationState: NegotiationState | null;
  closedByEventAt: Date | null;
  occupancyCount: number;
  lastCurrentGenerationDepartureAt: Date | null;
  parentEvent: {
    scheduledAt: Date | null;
    status: TrainingEventStatus;
    deletedAt: Date | null;
  } | null;
  durations: SessionLifecycleDurations;
};

export type SessionLifecyclePolicyResult = {
  eligible: boolean;
  currentlyDue: boolean;
  reason: SessionAutoCloseReason | null;
  referenceAt: Date | null;
  dueAt: Date | null;
  emptySinceAt: Date | null;
  occupancyCount: number;
  occupancyClassification: "occupied" | "empty";
  decision: SessionLifecycleDecision;
  whyNotDue: string | null;
  remainingMs: number;
};

export type CurrentGenerationConnection = {
  userId: string;
  leaseVersion: number;
  createdAt: Date;
  supersededAt: Date | null;
  disconnectedAt: Date | null;
  disconnectedReason: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

function laterDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function result(params: {
  input: SessionLifecyclePolicyInput;
  decision: SessionLifecycleDecision;
  whyNotDue: string | null;
  reason?: SessionAutoCloseReason | null;
  referenceAt?: Date | null;
  dueAt?: Date | null;
  emptySinceAt?: Date | null;
}): SessionLifecyclePolicyResult {
  const remainingMs =
    params.dueAt && params.decision !== "due"
      ? Math.max(0, params.dueAt.getTime() - params.input.now.getTime())
      : 0;
  const currentlyDue = params.decision === "due";
  return {
    eligible: currentlyDue,
    currentlyDue,
    reason: params.reason ?? null,
    referenceAt: params.referenceAt ?? null,
    dueAt: params.dueAt ?? null,
    emptySinceAt: params.emptySinceAt ?? null,
    occupancyCount: params.input.occupancyCount,
    occupancyClassification:
      params.input.occupancyCount > 0 ? "occupied" : "empty",
    decision: params.decision,
    whyNotDue: params.whyNotDue,
    remainingMs,
  };
}

export function isHistoricalTerminalSession(params: {
  roomLifecycle: RoomLifecycle | null;
  deletedAt: Date | null;
  closedByEventAt: Date | null;
  negotiationState: NegotiationState | null;
}): boolean {
  if (params.deletedAt) return true;
  if (params.roomLifecycle === RoomLifecycle.CLOSED) return true;
  if (params.closedByEventAt) return true;
  return (
    params.negotiationState === NegotiationState.FINISHED &&
    params.roomLifecycle == null
  );
}

export function isParentEventNonOperable(params: {
  status: TrainingEventStatus;
  deletedAt: Date | null;
}): boolean {
  return (
    params.deletedAt != null ||
    params.status === TrainingEventStatus.COMPLETED ||
    params.status === TrainingEventStatus.CANCELLED
  );
}

/**
 * Current-generation departure only.
 *
 * For each user, the latest non-superseded lease (`leaseVersion`, then
 * `createdAt`) is the only generation that may contribute a timestamp.
 * Live `expiresAt` values are ignored; passive network loss uses `expiresAt`
 * only after that lease is no longer valid against `now`.
 */
export function resolveLastCurrentGenerationDepartureAt(
  connections: readonly CurrentGenerationConnection[],
  now: Date,
): Date | null {
  const currentByUser = new Map<string, CurrentGenerationConnection>();
  for (const connection of connections) {
    if (connection.supersededAt) continue;
    const existing = currentByUser.get(connection.userId);
    if (
      !existing ||
      connection.leaseVersion > existing.leaseVersion ||
      (connection.leaseVersion === existing.leaseVersion &&
        connection.createdAt.getTime() > existing.createdAt.getTime())
    ) {
      currentByUser.set(connection.userId, connection);
    }
  }

  let latest: Date | null = null;
  for (const connection of currentByUser.values()) {
    const departedAt = currentGenerationDepartureTimestamp(connection, now);
    if (
      departedAt &&
      (latest == null || departedAt.getTime() > latest.getTime())
    ) {
      latest = departedAt;
    }
  }
  return latest;
}

export function currentGenerationDepartureTimestamp(
  connection: CurrentGenerationConnection,
  now: Date,
): Date | null {
  if (connection.supersededAt) return null;
  if (
    connection.disconnectedAt &&
    connection.disconnectedReason === "EXPIRED"
  ) {
    return connection.expiresAt;
  }
  if (connection.disconnectedAt) return connection.disconnectedAt;
  if (connection.revokedAt) return connection.revokedAt;
  if (connection.expiresAt.getTime() <= now.getTime()) {
    return connection.expiresAt;
  }
  return null;
}

export function resolveAbandonedReferenceAt(params: {
  createdAt: Date;
  lastCurrentGenerationDepartureAt: Date | null;
  parentEventScheduledAt: Date | null;
}): Date {
  const rawReferenceAt =
    params.lastCurrentGenerationDepartureAt ?? params.createdAt;
  if (!params.parentEventScheduledAt) {
    return rawReferenceAt;
  }
  return laterDate(rawReferenceAt, params.parentEventScheduledAt);
}

export function evaluateSessionLifecyclePolicy(
  input: SessionLifecyclePolicyInput,
): SessionLifecyclePolicyResult {
  if (
    isHistoricalTerminalSession({
      roomLifecycle: input.roomLifecycle,
      deletedAt: input.deletedAt,
      closedByEventAt: input.closedByEventAt,
      negotiationState: input.negotiationState,
    })
  ) {
    return result({
      input,
      decision: "already_terminal",
      whyNotDue: "already_terminal",
    });
  }

  if (input.parentEvent && isParentEventNonOperable(input.parentEvent)) {
    return result({
      input,
      decision: "ineligible",
      whyNotDue: "parent_event_non_operable",
    });
  }

  if (input.roomLifecycle === RoomLifecycle.DEBRIEF_OPEN) {
    return evaluateDebriefPolicy(input);
  }

  if (
    input.negotiationState === NegotiationState.FINISHED &&
    input.roomLifecycle === RoomLifecycle.OPEN
  ) {
    return result({
      input,
      decision: "ineligible",
      whyNotDue: "recoverable_finish_fence",
    });
  }

  return evaluateAbandonedPolicy(input);
}

function evaluateDebriefPolicy(
  input: SessionLifecyclePolicyInput,
): SessionLifecyclePolicyResult {
  if (!input.negotiationEndedAt) {
    return result({
      input,
      decision: "ineligible",
      whyNotDue: "no_debrief_opened_at",
    });
  }

  const debriefOpenedAt = input.negotiationEndedAt;
  const emptySinceAt = laterDate(
    debriefOpenedAt,
    input.lastCurrentGenerationDepartureAt ?? debriefOpenedAt,
  );
  const hardDueAt = new Date(
    debriefOpenedAt.getTime() + input.durations.debriefMaxDurationMs,
  );
  const emptyDueAt =
    input.occupancyCount === 0
      ? new Date(
          emptySinceAt.getTime() + input.durations.debriefEmptyCloseMs,
        )
      : null;

  const emptyCandidate = emptyDueAt
    ? {
        reason: SESSION_AUTO_CLOSE_REASONS.DEBRIEF_EMPTY_TIMEOUT,
        dueAt: emptyDueAt,
        referenceAt: emptySinceAt,
      }
    : null;
  const hardCandidate = {
    reason: SESSION_AUTO_CLOSE_REASONS.DEBRIEF_MAX_DURATION,
    dueAt: hardDueAt,
    referenceAt: debriefOpenedAt,
  };

  const winning =
    emptyCandidate &&
    emptyCandidate.dueAt.getTime() <= hardCandidate.dueAt.getTime()
      ? emptyCandidate
      : hardCandidate;

  if (input.now.getTime() >= winning.dueAt.getTime()) {
    return result({
      input,
      decision: "due",
      whyNotDue: null,
      reason: winning.reason,
      referenceAt: winning.referenceAt,
      dueAt: winning.dueAt,
      emptySinceAt,
    });
  }

  if (input.occupancyCount > 0) {
    return result({
      input,
      decision: "occupied",
      whyNotDue: "occupied",
      reason: hardCandidate.reason,
      referenceAt: hardCandidate.referenceAt,
      dueAt: hardCandidate.dueAt,
      emptySinceAt,
    });
  }

  return result({
    input,
    decision: "not_due",
    whyNotDue: "not_due",
    reason: winning.reason,
    referenceAt: winning.referenceAt,
    dueAt: winning.dueAt,
    emptySinceAt,
  });
}

function evaluateAbandonedPolicy(
  input: SessionLifecyclePolicyInput,
): SessionLifecyclePolicyResult {
  const referenceAt = resolveAbandonedReferenceAt({
    createdAt: input.createdAt,
    lastCurrentGenerationDepartureAt: input.lastCurrentGenerationDepartureAt,
    parentEventScheduledAt: input.parentEvent?.scheduledAt ?? null,
  });
  const dueAt = new Date(
    referenceAt.getTime() + input.durations.abandonedCloseMs,
  );

  if (input.occupancyCount > 0) {
    return result({
      input,
      decision: "occupied",
      whyNotDue: "occupied",
      reason: SESSION_AUTO_CLOSE_REASONS.SESSION_ABANDONED_TIMEOUT,
      referenceAt,
      dueAt,
    });
  }

  if (input.now.getTime() >= dueAt.getTime()) {
    return result({
      input,
      decision: "due",
      whyNotDue: null,
      reason: SESSION_AUTO_CLOSE_REASONS.SESSION_ABANDONED_TIMEOUT,
      referenceAt,
      dueAt,
    });
  }

  return result({
    input,
    decision: "not_due",
    whyNotDue: "not_due",
    reason: SESSION_AUTO_CLOSE_REASONS.SESSION_ABANDONED_TIMEOUT,
    referenceAt,
    dueAt,
  });
}
