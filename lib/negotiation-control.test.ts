import assert from "node:assert/strict";
import test from "node:test";

import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";
import {
  getControlUpdateData,
  isMicAllowed,
  type SessionControlFields,
} from "@/lib/negotiation-control";

test("isMicAllowed keeps RUNNING participant-only policy", () => {
  assert.equal(
    isMicAllowed(NegotiationState.RUNNING, ParticipantType.PARTICIPANT),
    true,
  );
  assert.equal(
    isMicAllowed(NegotiationState.RUNNING, ParticipantType.FACILITATOR),
    false,
  );
  assert.equal(
    isMicAllowed(NegotiationState.RUNNING, ParticipantType.OBSERVER),
    false,
  );
});

test("isMicAllowed allows all in-room roles while PAUSED", () => {
  assert.equal(
    isMicAllowed(NegotiationState.PAUSED, ParticipantType.PARTICIPANT),
    true,
  );
  assert.equal(
    isMicAllowed(NegotiationState.PAUSED, ParticipantType.FACILITATOR),
    true,
  );
  assert.equal(
    isMicAllowed(NegotiationState.PAUSED, ParticipantType.OBSERVER),
    true,
  );
});

function baseSession(
  negotiationState: NegotiationState = NegotiationState.PREPARATION,
): SessionControlFields {
  return {
    id: "session-1",
    negotiationState,
    durationSeconds: 900,
    preparationDurationSeconds: 300,
    negotiationStartedAt: null,
    negotiationEndedAt: null,
    timerStartedAt: null,
    pausedAt: null,
    totalPausedSeconds: 0,
    preparationStartedAt: null,
    preparationEndedAt: null,
    preparationTimerStartedAt: null,
    preparationPausedAt: null,
    preparationTotalPausedSeconds: 0,
  };
}

test("preparation lifecycle enforces START_PREPARATION -> STOP_PREPARATION contract", () => {
  const startAt = new Date("2026-08-11T09:00:00.000Z");
  const running = getControlUpdateData(
    baseSession(NegotiationState.PREPARATION),
    "START_PREPARATION",
    startAt,
  );
  assert.equal(running.negotiationState, NegotiationState.PREPARATION_RUNNING);
  assert.equal(running.preparationStartedAt?.toISOString(), startAt.toISOString());
  assert.equal(
    running.preparationTimerStartedAt?.toISOString(),
    startAt.toISOString(),
  );

  const stopFromRunning = getControlUpdateData(
    {
      ...baseSession(NegotiationState.PREPARATION_RUNNING),
      preparationStartedAt: startAt,
      preparationTimerStartedAt: startAt,
    },
    "STOP_PREPARATION",
    new Date("2026-08-11T09:01:00.000Z"),
  );
  assert.equal(stopFromRunning.negotiationState, NegotiationState.READY_TO_START);
  assert.equal(
    stopFromRunning.preparationEndedAt?.toISOString(),
    "2026-08-11T09:01:00.000Z",
  );
  assert.equal(stopFromRunning.preparationPausedAt, null);
});

test("STOP_PREPARATION from paused closes pause without negotiation pause rows", () => {
  const pausedAt = new Date("2026-08-11T09:01:00.000Z");
  const now = new Date("2026-08-11T09:01:30.000Z");
  const stopped = getControlUpdateData(
    {
      ...baseSession(NegotiationState.PREPARATION_PAUSED),
      preparationStartedAt: new Date("2026-08-11T09:00:00.000Z"),
      preparationTimerStartedAt: new Date("2026-08-11T09:00:00.000Z"),
      preparationPausedAt: pausedAt,
      preparationTotalPausedSeconds: 5,
    },
    "STOP_PREPARATION",
    now,
  );
  assert.equal(stopped.negotiationState, NegotiationState.READY_TO_START);
  assert.equal(stopped.preparationPausedAt, null);
  assert.equal(stopped.preparationTotalPausedSeconds, 35);
  assert.equal(stopped.preparationEndedAt?.toISOString(), now.toISOString());
});

test("direct START from PREPARATION is rejected", () => {
  assert.throws(
    () => getControlUpdateData(baseSession(NegotiationState.PREPARATION), "START"),
    /Cannot START from PREPARATION/,
  );
});

test("SKIP_PREPARATION is rejected", () => {
  assert.throws(
    () =>
      getControlUpdateData(
        baseSession(NegotiationState.PREPARATION),
        "SKIP_PREPARATION" as unknown as never,
      ),
    /Unknown action: SKIP_PREPARATION/,
  );
});

test("FINISH before negotiation start is rejected", () => {
  assert.throws(
    () => getControlUpdateData(baseSession(NegotiationState.PREPARATION), "FINISH"),
    /Cannot FINISH from PREPARATION/,
  );
  assert.throws(
    () => getControlUpdateData(baseSession(NegotiationState.READY_TO_START), "FINISH"),
    /Cannot FINISH from READY_TO_START/,
  );
});

test("duplicate resume math remains monotonic and deterministic", () => {
  const pausedAt = new Date("2026-08-11T10:00:00.000Z");
  const resumed = getControlUpdateData(
    {
      ...baseSession(NegotiationState.PAUSED),
      negotiationStartedAt: new Date("2026-08-11T09:50:00.000Z"),
      timerStartedAt: new Date("2026-08-11T09:50:00.000Z"),
      pausedAt,
      totalPausedSeconds: 11,
    },
    "RESUME",
    new Date("2026-08-11T10:00:09.000Z"),
  );
  assert.equal(resumed.negotiationState, NegotiationState.RUNNING);
  assert.equal(resumed.pausedAt, null);
  assert.equal(resumed.totalPausedSeconds, 20);
});
