import assert from "node:assert/strict";
import test from "node:test";

import { RoomLifecycle } from "@/app/generated/prisma/client";
import { evaluateDebriefAutoCloseEligibility } from "@/lib/session-room-occupancy";

const GRACE_MS = 30_000;

test("debrief close waits full grace after last invalidation", () => {
  const now = new Date("2026-07-21T15:00:00.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    activeConnectionCount: 0,
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
    lastInvalidatedAt: new Date("2026-07-21T15:00:00.000Z"),
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "active_connections_remain");
});

test("debrief does not close without definitive invalidation evidence", () => {
  const now = new Date("2026-07-21T15:01:00.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
    activeConnectionCount: 0,
    lastInvalidatedAt: null,
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "no_invalidated_connections");
});

test("OPEN lifecycle is never auto-closed by the debrief guard", () => {
  const now = new Date("2026-07-21T15:01:00.000Z");
  const eligibility = evaluateDebriefAutoCloseEligibility({
    roomLifecycle: RoomLifecycle.OPEN,
    activeConnectionCount: 0,
    lastInvalidatedAt: new Date("2026-07-21T15:00:00.000Z"),
    now,
    graceMs: GRACE_MS,
  });

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "room_not_debrief_open");
});
