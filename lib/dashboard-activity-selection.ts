import type {
  NegotiationState,
  RoomLifecycle,
  SessionStatus,
  TrainingEventStatus,
} from "@/app/generated/prisma/client";
import { isCanonicallyCompletedSession } from "@/lib/session-display-status";

export type DashboardSessionCandidate = {
  id: string;
  eventId: string | null;
  eventStatus: TrainingEventStatus | null;
  sessionStatus: SessionStatus;
  negotiationState: NegotiationState;
  roomLifecycle: RoomLifecycle | null;
  deletedAt?: Date | string | null;
  createdAt: string;
};

export type DashboardEventCandidate = {
  id: string;
  status: TrainingEventStatus;
  scheduledAt: string | null;
  createdAt?: string;
  deletedAt?: Date | string | null;
};

const SESSION_RELEVANCE: Record<string, number> = {
  RUNNING: 0,
  PAUSED: 1,
  PREPARATION_RUNNING: 2,
  PREPARATION_PAUSED: 3,
  READY_TO_START: 4,
  PREPARATION: 5,
  FINISHED: 6,
};

const EVENT_RELEVANCE: Record<string, number> = {
  SESSION_CREATED: 0,
  LOBBY_OPEN: 1,
  DRAFT: 2,
};

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isEligibleDashboardSession(
  session: DashboardSessionCandidate,
): boolean {
  if (
    session.deletedAt != null ||
    session.eventStatus === "COMPLETED" ||
    session.eventStatus === "CANCELLED"
  ) {
    return false;
  }

  return !isCanonicallyCompletedSession({
    status: session.sessionStatus,
    negotiationState: session.negotiationState,
    roomLifecycle: session.roomLifecycle,
  });
}

export function sortDashboardSessions<
  T extends DashboardSessionCandidate,
>(sessions: readonly T[]): T[] {
  return sessions
    .filter(isEligibleDashboardSession)
    .sort((left, right) => {
      const relevance =
        (SESSION_RELEVANCE[left.negotiationState] ?? Number.MAX_SAFE_INTEGER) -
        (SESSION_RELEVANCE[right.negotiationState] ?? Number.MAX_SAFE_INTEGER);
      if (relevance !== 0) return relevance;

      const newestFirst =
        timestamp(right.createdAt) - timestamp(left.createdAt);
      if (newestFirst !== 0) return newestFirst;

      return left.id.localeCompare(right.id);
    });
}

export function selectDashboardSessionForEvent<
  T extends DashboardSessionCandidate,
>(sessions: readonly T[], eventId: string): T | null {
  return (
    sortDashboardSessions(
      sessions.filter((session) => session.eventId === eventId),
    )[0] ?? null
  );
}

export function isEligibleDashboardEvent(
  event: DashboardEventCandidate,
): boolean {
  return (
    event.deletedAt == null &&
    event.status !== "COMPLETED" &&
    event.status !== "CANCELLED"
  );
}

export function sortDashboardEvents<T extends DashboardEventCandidate>(
  events: readonly T[],
  now: Date,
): T[] {
  const nowMs = now.getTime();
  return events.filter(isEligibleDashboardEvent).sort((left, right) => {
    const leftScheduledAt = timestamp(left.scheduledAt);
    const rightScheduledAt = timestamp(right.scheduledAt);
    const leftIsFuture = leftScheduledAt > nowMs;
    const rightIsFuture = rightScheduledAt > nowMs;

    if (leftIsFuture !== rightIsFuture) {
      return leftIsFuture ? 1 : -1;
    }

    if (leftIsFuture) {
      const nearestFirst = leftScheduledAt - rightScheduledAt;
      if (nearestFirst !== 0) return nearestFirst;
    } else {
      const relevance =
        (EVENT_RELEVANCE[left.status] ?? Number.MAX_SAFE_INTEGER) -
        (EVENT_RELEVANCE[right.status] ?? Number.MAX_SAFE_INTEGER);
      if (relevance !== 0) return relevance;

      const mostRecentFirst = rightScheduledAt - leftScheduledAt;
      if (mostRecentFirst !== 0) return mostRecentFirst;
    }

    const newestCreatedFirst =
      timestamp(right.createdAt) - timestamp(left.createdAt);
    if (newestCreatedFirst !== 0) return newestCreatedFirst;

    return left.id.localeCompare(right.id);
  });
}

export function selectDashboardActivity<
  S extends DashboardSessionCandidate,
  E extends DashboardEventCandidate,
>(params: {
  sessions: readonly S[];
  events: readonly E[];
  now: Date;
}):
  | { kind: "session"; item: S }
  | { kind: "event"; item: E }
  | null {
  const session = sortDashboardSessions(params.sessions)[0];
  if (session) {
    return { kind: "session", item: session };
  }

  const event = sortDashboardEvents(params.events, params.now)[0];
  return event ? { kind: "event", item: event } : null;
}
