import assert from "node:assert/strict";
import test from "node:test";

import { RoomLifecycle } from "@/app/generated/prisma/client";
import {
  isEligibleDashboardSession,
  selectDashboardActivity,
  selectDashboardSessionForEvent,
  sortDashboardEvents,
  sortDashboardSessions,
  type DashboardEventCandidate,
  type DashboardSessionCandidate,
} from "@/lib/dashboard-activity-selection";

function session(
  overrides: Partial<DashboardSessionCandidate> = {},
): DashboardSessionCandidate {
  return {
    id: "session-default",
    eventId: null,
    eventStatus: null,
    sessionStatus: "READY",
    negotiationState: "PREPARATION",
    roomLifecycle: RoomLifecycle.OPEN,
    deletedAt: null,
    createdAt: "2026-08-13T10:00:00.000Z",
    ...overrides,
  };
}

function event(
  overrides: Partial<DashboardEventCandidate> = {},
): DashboardEventCandidate {
  return {
    id: "event-default",
    status: "LOBBY_OPEN",
    scheduledAt: "2026-08-14T06:00:00.000Z",
    createdAt: "2026-08-13T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

const now = new Date("2026-08-13T12:00:00.000Z");

test("completed-only and stale terminal history never become current activity", () => {
  const completed = session({
    id: "completed",
    negotiationState: "FINISHED",
    roomLifecycle: RoomLifecycle.CLOSED,
  });
  const legacyNull = session({
    id: "legacy-null",
    negotiationState: "FINISHED",
    roomLifecycle: null,
  });

  assert.equal(isEligibleDashboardSession(completed), false);
  assert.equal(isEligibleDashboardSession(legacyNull), false);
  assert.equal(
    selectDashboardActivity({
      sessions: [completed, legacyNull],
      events: [],
      now,
    }),
    null,
  );
});

test("current standalone room wins over completed history", () => {
  const current = session({
    id: "standalone-current",
    negotiationState: "RUNNING",
  });
  const activity = selectDashboardActivity({
    sessions: [
      session({
        id: "completed",
        negotiationState: "FINISHED",
        roomLifecycle: RoomLifecycle.CLOSED,
      }),
      current,
    ],
    events: [],
    now,
  });

  assert.equal(activity?.kind, "session");
  assert.equal(activity?.item.id, current.id);
});

test("normal nonterminal Session states remain display candidates", () => {
  for (const negotiationState of [
    "PREPARATION",
    "PREPARATION_RUNNING",
    "PREPARATION_PAUSED",
    "READY_TO_START",
    "RUNNING",
    "PAUSED",
  ] as const) {
    assert.equal(
      isEligibleDashboardSession(session({ negotiationState })),
      true,
      negotiationState,
    );
  }
});

test("current Event-created Session uses the same display eligibility", () => {
  const current = session({
    id: "event-current",
    eventId: "event-1",
    eventStatus: "SESSION_CREATED",
    negotiationState: "PAUSED",
  });

  assert.equal(
    selectDashboardActivity({
      sessions: [current],
      events: [event({ id: "event-1", status: "SESSION_CREATED" })],
      now,
    })?.item.id,
    current.id,
  );
});

test("nearest eligible future Event wins when only completed history exists", () => {
  const nearest = event({
    id: "future-nearest",
    scheduledAt: "2026-08-14T06:00:00.000Z",
  });
  const later = event({
    id: "future-later",
    scheduledAt: "2026-08-15T06:00:00.000Z",
  });
  const activity = selectDashboardActivity({
    sessions: [
      session({
        negotiationState: "FINISHED",
        roomLifecycle: RoomLifecycle.CLOSED,
      }),
    ],
    events: [later, nearest],
    now,
  });

  assert.equal(activity?.kind, "event");
  assert.equal(activity?.item.id, nearest.id);
});

test("unscheduled Draft may precede a future Event", () => {
  const future = event({
    id: "future-open",
    status: "LOBBY_OPEN",
    scheduledAt: "2026-08-14T06:00:00.000Z",
  });
  const activity = selectDashboardActivity({
    sessions: [],
    events: [
      event({
        id: "unscheduled-draft",
        status: "DRAFT",
        scheduledAt: null,
      }),
      future,
    ],
    now,
  });

  assert.equal(activity?.kind, "event");
  assert.equal(activity?.item.id, "unscheduled-draft");
});

test("only unscheduled Draft is displayed as Dashboard activity", () => {
  const activity = selectDashboardActivity({
    sessions: [],
    events: [
      event({
        id: "unscheduled-draft",
        status: "DRAFT",
        scheduledAt: null,
      }),
    ],
    now,
  });

  assert.equal(activity?.kind, "event");
  assert.equal(activity?.item.id, "unscheduled-draft");
});

test("genuinely open current Event takes precedence over future Event", () => {
  const current = event({
    id: "current-lobby",
    status: "LOBBY_OPEN",
    scheduledAt: null,
  });
  const future = event({
    id: "future-lobby",
    status: "LOBBY_OPEN",
    scheduledAt: "2026-08-14T06:00:00.000Z",
  });
  const activity = selectDashboardActivity({
    sessions: [],
    events: [future, current],
    now,
  });

  assert.equal(activity?.kind, "event");
  assert.equal(activity?.item.id, current.id);
});

test("genuine DEBRIEF_OPEN remains current Dashboard activity", () => {
  const debrief = session({
    id: "debrief",
    negotiationState: "FINISHED",
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
  });

  assert.equal(isEligibleDashboardSession(debrief), true);
  assert.equal(
    selectDashboardActivity({ sessions: [debrief], events: [], now })?.item.id,
    debrief.id,
  );
});

test("Event card selects a later current Session instead of terminal history", () => {
  const firstCreated = session({
    id: "first-completed",
    eventId: "event-1",
    eventStatus: "SESSION_CREATED",
    negotiationState: "FINISHED",
    roomLifecycle: RoomLifecycle.CLOSED,
    createdAt: "2026-08-13T08:00:00.000Z",
  });
  const laterActive = session({
    id: "later-active",
    eventId: "event-1",
    eventStatus: "SESSION_CREATED",
    negotiationState: "RUNNING",
    createdAt: "2026-08-13T09:00:00.000Z",
  });

  assert.equal(
    selectDashboardSessionForEvent(
      [firstCreated, laterActive],
      "event-1",
    )?.id,
    laterActive.id,
  );
});

test("session ordering uses explicit state priority and deterministic tie-breaks", () => {
  const ordered = sortDashboardSessions([
    session({ id: "z-paused", negotiationState: "PAUSED" }),
    session({
      id: "b-running",
      negotiationState: "RUNNING",
      createdAt: "2026-08-13T09:00:00.000Z",
    }),
    session({
      id: "a-running",
      negotiationState: "RUNNING",
      createdAt: "2026-08-13T09:00:00.000Z",
    }),
  ]);

  assert.deepEqual(
    ordered.map((candidate) => candidate.id),
    ["a-running", "b-running", "z-paused"],
  );
});

test("deleted sessions and cancelled/completed Event sessions are excluded", () => {
  for (const candidate of [
    session({ id: "deleted", deletedAt: "2026-08-13T11:00:00.000Z" }),
    session({ id: "cancelled-event-session", eventStatus: "CANCELLED" }),
    session({ id: "completed-event-session", eventStatus: "COMPLETED" }),
  ]) {
    assert.equal(isEligibleDashboardSession(candidate), false, candidate.id);
  }
});

test("deleted, cancelled, and completed Events are excluded deterministically", () => {
  const eligible = event({ id: "eligible" });
  const ordered = sortDashboardEvents(
    [
      event({ id: "deleted", deletedAt: "2026-08-13T11:00:00.000Z" }),
      event({ id: "cancelled", status: "CANCELLED" }),
      event({ id: "completed", status: "COMPLETED" }),
      eligible,
    ],
    now,
  );

  assert.deepEqual(ordered.map((candidate) => candidate.id), [eligible.id]);
});
