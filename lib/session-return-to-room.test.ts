import assert from "node:assert/strict";
import test from "node:test";

import { isSessionActiveForRoom } from "@/lib/session-overview-shared";

const activeDebrief = {
  status: "READY" as const,
  negotiationState: "FINISHED",
  roomLifecycle: "DEBRIEF_OPEN" as const,
  closedByEventAt: null,
  deletedAt: null,
};

test("standalone FINISHED Debrief remains returnable through leave and grace", () => {
  assert.equal(isSessionActiveForRoom(activeDebrief), true);
  assert.equal(
    isSessionActiveForRoom({
      ...activeDebrief,
      status: "COMPLETED",
    }),
    true,
    "explicit DEBRIEF_OPEN wins over a non-canonical completed status",
  );
});

test("standalone canonical close makes the room non-returnable", () => {
  assert.equal(
    isSessionActiveForRoom({
      ...activeDebrief,
      status: "COMPLETED",
      roomLifecycle: "CLOSED",
    }),
    false,
  );
});

test("Event-created FINISHED Debrief remains an active assignment", () => {
  assert.equal(
    isSessionActiveForRoom({
      ...activeDebrief,
      event: { status: "SESSION_CREATED" },
    }),
    true,
  );
});

test("Event authority close makes the Session non-returnable", () => {
  assert.equal(
    isSessionActiveForRoom({
      ...activeDebrief,
      event: { status: "COMPLETED" },
    }),
    false,
  );
  assert.equal(
    isSessionActiveForRoom({
      ...activeDebrief,
      closedByEventAt: new Date("2026-08-12T12:00:00.000Z"),
      event: { status: "SESSION_CREATED" },
    }),
    false,
  );
});

test("pre-Debrief active lifecycle semantics remain returnable", () => {
  for (const negotiationState of [
    "PREPARATION",
    "PREPARATION_RUNNING",
    "PREPARATION_PAUSED",
    "READY_TO_START",
    "RUNNING",
    "PAUSED",
  ] as const) {
    assert.equal(
      isSessionActiveForRoom({
          status: "READY",
        negotiationState,
        roomLifecycle: "OPEN",
        closedByEventAt: null,
      }),
      true,
      negotiationState,
    );
  }
});
