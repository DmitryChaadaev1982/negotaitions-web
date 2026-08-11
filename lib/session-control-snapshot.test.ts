import assert from "node:assert/strict";
import test from "node:test";

import { NegotiationState, RoomLifecycle } from "@/app/generated/prisma/enums";
import { getControlUpdateData } from "@/lib/negotiation-control";
import {
  buildSessionControlSnapshotWhere,
  createSessionControlToken,
  pickSessionControlSnapshot,
  type SessionControlSnapshotFields,
} from "@/lib/session-control-snapshot";

function baseFields(): SessionControlSnapshotFields {
  return {
    negotiationState: NegotiationState.PREPARATION,
    preparationDurationSeconds: 300,
    durationSeconds: 900,
    preparationStartedAt: null,
    preparationEndedAt: null,
    preparationTimerStartedAt: null,
    preparationPausedAt: null,
    preparationTotalPausedSeconds: 0,
    negotiationStartedAt: null,
    negotiationEndedAt: null,
    timerStartedAt: null,
    pausedAt: null,
    totalPausedSeconds: 0,
    facilitatorId: "fac-1",
    deletedAt: null,
    closedByEventAt: null,
    closedByEventId: null,
    closeReason: null,
    roomLifecycle: RoomLifecycle.OPEN,
  };
}

test("control token is deterministic and stable across property ordering", () => {
  const a = pickSessionControlSnapshot(baseFields());
  const b = pickSessionControlSnapshot({
    roomLifecycle: RoomLifecycle.OPEN,
    closeReason: null,
    closedByEventId: null,
    closedByEventAt: null,
    deletedAt: null,
    facilitatorId: "fac-1",
    totalPausedSeconds: 0,
    pausedAt: null,
    timerStartedAt: null,
    negotiationEndedAt: null,
    negotiationStartedAt: null,
    preparationTotalPausedSeconds: 0,
    preparationPausedAt: null,
    preparationTimerStartedAt: null,
    preparationEndedAt: null,
    preparationStartedAt: null,
    durationSeconds: 900,
    preparationDurationSeconds: 300,
    negotiationState: NegotiationState.PREPARATION,
  });

  assert.equal(createSessionControlToken(a), createSessionControlToken(b));
});

test("unrelated Session.updatedAt/liveKit/status changes do not alter control token", () => {
  const withUnrelatedA = {
    ...baseFields(),
    updatedAt: new Date("2026-08-11T09:00:00.000Z"),
    liveKitRoomName: "room-A",
    status: "READY",
  } as SessionControlSnapshotFields & {
    updatedAt: Date;
    liveKitRoomName: string;
    status: string;
  };
  const withUnrelatedB = {
    ...withUnrelatedA,
    updatedAt: new Date("2026-08-11T09:00:01.000Z"),
    liveKitRoomName: "room-B",
    status: "DRAFT",
  };

  const tokenA = createSessionControlToken(pickSessionControlSnapshot(withUnrelatedA));
  const tokenB = createSessionControlToken(pickSessionControlSnapshot(withUnrelatedB));
  assert.equal(tokenA, tokenB);
});

test("every control-relevant field invalidates the token", () => {
  const baselineFields = baseFields();
  const baselineToken = createSessionControlToken(
    pickSessionControlSnapshot(baselineFields),
  );

  const variants: Array<SessionControlSnapshotFields> = [
    { ...baselineFields, negotiationState: NegotiationState.READY_TO_START },
    { ...baselineFields, preparationDurationSeconds: 301 },
    { ...baselineFields, durationSeconds: 901 },
    { ...baselineFields, preparationStartedAt: new Date("2026-08-11T09:00:00.000Z") },
    { ...baselineFields, preparationEndedAt: new Date("2026-08-11T09:00:00.000Z") },
    {
      ...baselineFields,
      preparationTimerStartedAt: new Date("2026-08-11T09:00:00.000Z"),
    },
    { ...baselineFields, preparationPausedAt: new Date("2026-08-11T09:00:00.000Z") },
    { ...baselineFields, preparationTotalPausedSeconds: 1 },
    { ...baselineFields, negotiationStartedAt: new Date("2026-08-11T09:00:00.000Z") },
    { ...baselineFields, negotiationEndedAt: new Date("2026-08-11T09:00:00.000Z") },
    { ...baselineFields, timerStartedAt: new Date("2026-08-11T09:00:00.000Z") },
    { ...baselineFields, pausedAt: new Date("2026-08-11T09:00:00.000Z") },
    { ...baselineFields, totalPausedSeconds: 1 },
    { ...baselineFields, facilitatorId: "fac-2" },
    { ...baselineFields, deletedAt: new Date("2026-08-11T09:00:00.000Z") },
    { ...baselineFields, closedByEventAt: new Date("2026-08-11T09:00:00.000Z") },
    { ...baselineFields, closedByEventId: "event-close-1" },
    { ...baselineFields, closeReason: "EVENT_CLOSED" },
    { ...baselineFields, roomLifecycle: RoomLifecycle.CLOSED },
  ];

  for (const variant of variants) {
    const token = createSessionControlToken(pickSessionControlSnapshot(variant));
    assert.notEqual(token, baselineToken);
  }
});

test("timestamp epoch differences invalidate stale actions", () => {
  const baseline = baseFields();
  const nextEpoch = {
    ...baseline,
    pausedAt: new Date("2026-08-11T09:10:01.000Z"),
  };
  const olderEpoch = {
    ...baseline,
    pausedAt: new Date("2026-08-11T09:10:00.000Z"),
  };
  const nextToken = createSessionControlToken(pickSessionControlSnapshot(nextEpoch));
  const olderToken = createSessionControlToken(pickSessionControlSnapshot(olderEpoch));
  assert.notEqual(nextToken, olderToken);
});

test("a sub-second pause/resume cycle cannot recreate the prior RUNNING token", () => {
  const running = {
    ...baseFields(),
    id: "session-1",
    negotiationState: NegotiationState.RUNNING,
    negotiationStartedAt: new Date("2026-08-11T09:00:00.000Z"),
    timerStartedAt: new Date("2026-08-11T09:00:00.000Z"),
  };
  const oldToken = createSessionControlToken(
    pickSessionControlSnapshot(running),
  );
  const pausedAt = new Date("2026-08-11T09:01:00.100Z");
  const pausedUpdate = getControlUpdateData(running, "PAUSE", pausedAt);
  const resumedUpdate = getControlUpdateData(
    {
      ...running,
      ...pausedUpdate,
    },
    "RESUME",
    new Date("2026-08-11T09:01:00.350Z"),
  );
  const resumedToken = createSessionControlToken(
    pickSessionControlSnapshot({
      ...running,
      ...pausedUpdate,
      ...resumedUpdate,
    }),
  );

  assert.notEqual(resumedToken, oldToken);
});

test("snapshot where predicate excludes unrelated fields", () => {
  const snapshot = pickSessionControlSnapshot(baseFields());
  const where = buildSessionControlSnapshotWhere("session-1", snapshot);
  assert.equal(where.id, "session-1");
  assert.equal(where.negotiationState, NegotiationState.PREPARATION);
  assert.equal("updatedAt" in where, false);
  assert.equal("liveKitRoomName" in where, false);
  assert.equal("status" in where, false);
});
