import assert from "node:assert/strict";
import test from "node:test";

import { RoomLifecycle } from "@/app/generated/prisma/client";
import {
  decideFinishRoomLifecycle,
  evaluateDebriefAutoCloseEligibility,
  isLeaseExpiryAheadOfReferenceClock,
} from "@/lib/session-room-occupancy-policy";

const GRACE_MS = 30_000;

test("debrief close waits full grace after last invalidation", () => {
  const now = new Date("2026-07-21T15:00:00.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    activeConnectionCount: 0,
    debriefOpenedAt: new Date("2026-07-21T14:59:00.000Z"),
    lastInvalidatedAt: new Date("2026-07-21T14:59:45.000Z"),
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "grace_period_active");
  assert.equal(eligibility.graceRemainingMs, 15_000);
});

test("debrief closes once grace elapses with zero active connections", () => {
  const now = new Date("2026-07-21T15:00:31.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    activeConnectionCount: 0,
    debriefOpenedAt: new Date("2026-07-21T14:59:00.000Z"),
    lastInvalidatedAt: new Date("2026-07-21T15:00:00.000Z"),
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reason, "grace_period_elapsed");
});

test("debrief stays open while at least one active connection remains", () => {
  const now = new Date("2026-07-21T15:01:00.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    activeConnectionCount: 1,
    debriefOpenedAt: new Date("2026-07-21T15:00:30.000Z"),
    lastInvalidatedAt: new Date("2026-07-21T15:00:00.000Z"),
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "active_connections_remain");
});

test("debrief does not close without an authoritative open boundary", () => {
  const now = new Date("2026-07-21T15:01:00.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    activeConnectionCount: 0,
    debriefOpenedAt: null,
    lastInvalidatedAt: null,
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "no_debrief_opened_at");
});

test("already-empty debrief starts a full grace at debrief opening", () => {
  const now = new Date("2026-07-21T15:00:20.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    activeConnectionCount: 0,
    debriefOpenedAt: new Date("2026-07-21T15:00:00.000Z"),
    lastInvalidatedAt: new Date("2026-07-21T14:50:00.000Z"),
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "grace_period_active");
  assert.equal(eligibility.graceRemainingMs, 10_000);
});

test("OPEN lifecycle is never auto-closed by the debrief guard", () => {
  const now = new Date("2026-07-21T15:01:00.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.OPEN,
    activeConnectionCount: 0,
    debriefOpenedAt: null,
    lastInvalidatedAt: new Date("2026-07-21T15:00:00.000Z"),
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "room_not_debrief_open");
});

test("finish keeps DEBRIEF_OPEN when durable occupancy exists", () => {
  assert.equal(
    decideFinishRoomLifecycle({
      effectiveLifecycle: RoomLifecycle.OPEN,
      hardClose: false,
      activeConnectionCount: 1,
    }),
    RoomLifecycle.DEBRIEF_OPEN,
  );
});

test("finish opens DEBRIEF even when occupancy is zero", () => {
  assert.equal(
    decideFinishRoomLifecycle({
      effectiveLifecycle: RoomLifecycle.OPEN,
      hardClose: false,
      activeConnectionCount: 0,
    }),
    RoomLifecycle.DEBRIEF_OPEN,
  );
});

test("hard close and already-CLOSED stay CLOSED regardless of occupancy", () => {
  assert.equal(
    decideFinishRoomLifecycle({
      effectiveLifecycle: RoomLifecycle.OPEN,
      hardClose: true,
      activeConnectionCount: 3,
    }),
    RoomLifecycle.CLOSED,
  );
  assert.equal(
    decideFinishRoomLifecycle({
      effectiveLifecycle: RoomLifecycle.CLOSED,
      hardClose: false,
      activeConnectionCount: 3,
    }),
    RoomLifecycle.CLOSED,
  );
});

test("MSK-style clock skew falsely marks UTC lease as expired against local NOW", () => {
  // Production evidence: expiresAt written as UTC wall-clock 19:35, DB NOW() in
  // Europe/Moscow at finish was ~22:33 → occupancy predicate returned 0.
  const expiresAtUtcWallClock = new Date("2026-07-29T19:35:15.522Z");
  const finishUtcClock = new Date("2026-07-29T19:33:25.910Z");
  const moscowLocalNowAsNaive = new Date("2026-07-29T22:33:25.910Z");

  assert.equal(
    isLeaseExpiryAheadOfReferenceClock({
      expiresAtUtcWallClock,
      referenceClock: finishUtcClock,
    }),
    true,
  );
  assert.equal(
    isLeaseExpiryAheadOfReferenceClock({
      expiresAtUtcWallClock,
      referenceClock: moscowLocalNowAsNaive,
    }),
    false,
  );
  assert.equal(
    decideFinishRoomLifecycle({
      effectiveLifecycle: RoomLifecycle.OPEN,
      hardClose: false,
      activeConnectionCount: isLeaseExpiryAheadOfReferenceClock({
        expiresAtUtcWallClock,
        referenceClock: moscowLocalNowAsNaive,
      })
        ? 1
        : 0,
    }),
    RoomLifecycle.DEBRIEF_OPEN,
  );
  assert.equal(
    decideFinishRoomLifecycle({
      effectiveLifecycle: RoomLifecycle.OPEN,
      hardClose: false,
      activeConnectionCount: isLeaseExpiryAheadOfReferenceClock({
        expiresAtUtcWallClock,
        referenceClock: finishUtcClock,
      })
        ? 1
        : 0,
    }),
    RoomLifecycle.DEBRIEF_OPEN,
  );
});
