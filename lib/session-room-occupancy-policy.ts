import { RoomLifecycle } from "@/app/generated/prisma/client";

export type DebriefAutoCloseEligibility = {
  eligible: boolean;
  reason:
    | "room_not_debrief_open"
    | "active_connections_remain"
    | "no_debrief_opened_at"
    | "grace_period_active"
    | "grace_period_elapsed";
  graceRemainingMs: number;
};

export function evaluateDebriefAutoCloseEligibility(params: {
  roomLifecycle: RoomLifecycle | null;
  activeConnectionCount: number;
  debriefOpenedAt: Date | null;
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
  if (!params.debriefOpenedAt) {
    return {
      eligible: false,
      reason: "no_debrief_opened_at",
      graceRemainingMs: params.graceMs,
    };
  }

  const emptySinceMs = Math.max(
    params.debriefOpenedAt.getTime(),
    params.lastInvalidatedAt?.getTime() ?? params.debriefOpenedAt.getTime(),
  );
  const elapsedMs = params.now.getTime() - emptySinceMs;
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

/**
 * Negotiation finish always opens Debrief. Empty-room Session completion is a
 * separate grace-fenced reconciliation; only an explicit hard-close authority
 * may bypass that grace.
 */
export function decideFinishRoomLifecycle(params: {
  effectiveLifecycle: RoomLifecycle;
  hardClose: boolean;
  activeConnectionCount: number;
}): RoomLifecycle {
  if (params.effectiveLifecycle === RoomLifecycle.CLOSED || params.hardClose) {
    return RoomLifecycle.CLOSED;
  }
  return RoomLifecycle.DEBRIEF_OPEN;
}

/**
 * Documents the production failure mode: comparing UTC-written lease expiry
 * against a DB-local NOW() that is hours ahead falsely yields zero occupancy.
 */
export function isLeaseExpiryAheadOfReferenceClock(params: {
  expiresAtUtcWallClock: Date;
  referenceClock: Date;
}): boolean {
  return params.expiresAtUtcWallClock.getTime() > params.referenceClock.getTime();
}
