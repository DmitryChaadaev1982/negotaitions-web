import { RoomLifecycle } from "@/app/generated/prisma/client";

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

/**
 * Pure decision used by finish: keep DEBRIEF_OPEN while any durable active
 * connection exists; otherwise CLOSED. Separated for deterministic unit tests.
 */
export function decideFinishRoomLifecycle(params: {
  effectiveLifecycle: RoomLifecycle;
  hardClose: boolean;
  activeConnectionCount: number;
}): RoomLifecycle {
  if (params.effectiveLifecycle === RoomLifecycle.CLOSED || params.hardClose) {
    return RoomLifecycle.CLOSED;
  }
  return params.activeConnectionCount > 0
    ? RoomLifecycle.DEBRIEF_OPEN
    : RoomLifecycle.CLOSED;
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
