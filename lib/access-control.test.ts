import assert from "node:assert/strict";
import test from "node:test";

import type { TrainingEvent } from "@/app/generated/prisma/client";
import {
  canAccessEvent,
  type CurrentUserEventAccess,
} from "@/lib/access-control";
import { createSessionFromEvent } from "@/lib/create-event-session";
import { classifyEventDashboardLane } from "@/lib/dashboard-activity-selection";
import { isEventOpenAndJoinable } from "@/lib/visibility";

function access(
  overrides: Partial<CurrentUserEventAccess> = {},
): CurrentUserEventAccess {
  return {
    event: { id: "event-1" } as TrainingEvent,
    user: null,
    isAdmin: false,
    isHostOwner: false,
    isFacilitatorOwner: false,
    isHostToken: false,
    isHost: false,
    isEventOwner: false,
    currentParticipant: null,
    hasUserParticipant: false,
    hasTokenParticipant: false,
    hasEmailInvite: false,
    hasPublicAccess: false,
    ...overrides,
  };
}

test("E06 canAccessEvent stays authorization-only for a past archived Event", () => {
  const now = new Date("2026-08-13T12:00:00.000Z");
  const lane = classifyEventDashboardLane({
    eventStatus: "LOBBY_OPEN",
    scheduledAt: "2026-08-12T12:00:00.000Z",
    activeLobbyCount: 0,
    hasActiveChildSession: false,
    now,
  });

  assert.equal(lane, "ARCHIVE");
  assert.equal(access({ isHostOwner: true }).event.id, "event-1");
  assert.equal(canAccessEvent(access({ isHostOwner: true })), true);
  assert.equal(canAccessEvent(access({ isFacilitatorOwner: true })), true);
  assert.equal(canAccessEvent(access({ hasUserParticipant: true })), true);
  assert.equal(canAccessEvent(access({ hasEmailInvite: true })), true);
  assert.equal(canAccessEvent(access({ hasPublicAccess: true })), true);
  assert.equal(canAccessEvent(access()), false);
});

test("E10 dashboard ARCHIVE lane is not an access input", () => {
  const authorized = access({ isHostOwner: true });
  assert.equal("dashboardLane" in authorized, false);
  assert.equal("scheduledAt" in authorized, false);
  assert.equal(canAccessEvent(authorized), true);
  assert.equal(
    canAccessEvent.toString().includes("scheduledAt"),
    false,
  );
  assert.equal(
    canAccessEvent.toString().includes("dashboardLane"),
    false,
  );
});

test("Event joinability helpers stay status-based and ignore the clock", () => {
  assert.equal(isEventOpenAndJoinable("LOBBY_OPEN"), true);
  assert.equal(isEventOpenAndJoinable("SESSION_CREATED"), true);
  assert.equal(isEventOpenAndJoinable("DRAFT"), false);
  assert.equal(isEventOpenAndJoinable("COMPLETED"), false);
  assert.equal(isEventOpenAndJoinable("CANCELLED"), false);
  assert.equal(isEventOpenAndJoinable.toString().includes("scheduledAt"), false);
});

test("E07 Event Session create path ignores scheduledAt and dashboard lane", () => {
  assert.equal(createSessionFromEvent.toString().includes("scheduledAt"), false);
  assert.equal(createSessionFromEvent.toString().includes("dashboardLane"), false);
  assert.equal(createSessionFromEvent.toString().includes("ARCHIVE"), false);
});
