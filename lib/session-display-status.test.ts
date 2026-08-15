import assert from "node:assert/strict";
import test from "node:test";

import {
  NegotiationState,
  ParticipantType,
  RoomLifecycle,
  SessionStatus,
} from "@/app/generated/prisma/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";
import {
  isCompletedSessionDisplayStatus,
  isJoinableObserverDebriefSession,
  isPostNegotiationSessionDisplayStatus,
  resolveSessionDisplayStatus,
  type SessionParticipantLike,
} from "@/lib/session-display-status";

const assignedParticipants: SessionParticipantLike[] = [
  { type: ParticipantType.FACILITATOR, joinedAt: null },
  { type: ParticipantType.PARTICIPANT, joinedAt: null },
  { type: ParticipantType.PARTICIPANT, joinedAt: null },
];

function resolve(input: {
  status?: SessionStatus;
  negotiationState: NegotiationState;
  roomLifecycle?: RoomLifecycle | null;
  participants?: SessionParticipantLike[];
}) {
  return resolveSessionDisplayStatus(
    {
      status: input.status ?? SessionStatus.READY,
      negotiationState: input.negotiationState,
      roomLifecycle:
        input.roomLifecycle === undefined
          ? RoomLifecycle.OPEN
          : input.roomLifecycle,
    },
    input.participants ?? assignedParticipants,
  );
}

test("standalone and Event-created finished negotiations remain Debrief while DEBRIEF_OPEN", () => {
  const debriefState = {
    status: SessionStatus.COMPLETED,
    negotiationState: NegotiationState.FINISHED,
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
  };

  assert.equal(
    resolveSessionDisplayStatus(debriefState, assignedParticipants),
    "DEBRIEF",
    "standalone Session",
  );
  assert.equal(
    resolveSessionDisplayStatus(debriefState, assignedParticipants),
    "DEBRIEF",
    "Event-created Session",
  );
});

test("empty Debrief grace and a rejoin during grace remain Debrief", () => {
  const stateDuringGrace = {
    status: SessionStatus.READY,
    negotiationState: NegotiationState.FINISHED,
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
  };

  assert.equal(
    resolveSessionDisplayStatus(stateDuringGrace, []),
    "DEBRIEF",
    "empty room during grace",
  );
  assert.equal(
    resolveSessionDisplayStatus(stateDuringGrace, assignedParticipants),
    "DEBRIEF",
    "rejoined room during grace",
  );
});

test("canonical facilitator, grace-expiry, and Event closes display Completed", () => {
  for (const closeAuthority of [
    "facilitator completion",
    "empty-Debrief grace expiry",
    "Event completion",
  ]) {
    const status = resolve({
      status: SessionStatus.COMPLETED,
      negotiationState: NegotiationState.FINISHED,
      roomLifecycle: RoomLifecycle.CLOSED,
    });
    assert.equal(status, "FINISHED", closeAuthority);
    assert.equal(isCompletedSessionDisplayStatus(status), true, closeAuthority);
  }
});

test("CLOSED is terminal display authority despite stale coarse status", () => {
  for (const status of [
    SessionStatus.COMPLETED,
    SessionStatus.READY,
    SessionStatus.DRAFT,
  ]) {
    assert.equal(
      resolve({
        status,
        negotiationState: NegotiationState.FINISHED,
        roomLifecycle: RoomLifecycle.CLOSED,
      }),
      "FINISHED",
      status,
    );
  }
});

test("legacy FINISHED rows with null lifecycle display Completed", () => {
  for (const status of [
    SessionStatus.COMPLETED,
    SessionStatus.READY,
    SessionStatus.DRAFT,
  ]) {
    assert.equal(
      resolve({
        status,
        negotiationState: NegotiationState.FINISHED,
        roomLifecycle: null,
      }),
      "FINISHED",
      status,
    );
  }
});

test("FINISHED with explicit OPEN remains recoverable Debrief", () => {
  assert.equal(
    resolve({
      status: SessionStatus.READY,
      negotiationState: NegotiationState.FINISHED,
      roomLifecycle: RoomLifecycle.OPEN,
    }),
    "DEBRIEF",
  );
});

test("recording, transcription, and analysis completion cannot override an open Debrief", () => {
  const status = resolve({
    status: SessionStatus.COMPLETED,
    negotiationState: NegotiationState.FINISHED,
    roomLifecycle: RoomLifecycle.DEBRIEF_OPEN,
  });

  assert.equal(status, "DEBRIEF");
  assert.equal(isPostNegotiationSessionDisplayStatus(status), true);
});

test("Preparation, Ready, Running, and Paused mappings remain unchanged", () => {
  assert.equal(
    resolve({
      negotiationState: NegotiationState.PREPARATION,
      participants: [],
    }),
    "DRAFT",
  );
  assert.equal(
    resolve({
      negotiationState: NegotiationState.PREPARATION,
    }),
    "READY",
  );
  assert.equal(
    resolve({
      negotiationState: NegotiationState.PREPARATION,
      participants: [
        { ...assignedParticipants[0]!, joinedAt: new Date() },
        assignedParticipants[1]!,
        assignedParticipants[2]!,
      ],
    }),
    "PREPARATION",
  );
  assert.equal(
    resolve({ negotiationState: NegotiationState.PREPARATION_RUNNING }),
    "PREPARATION_RUNNING",
  );
  assert.equal(
    resolve({ negotiationState: NegotiationState.PREPARATION_PAUSED }),
    "PREPARATION_PAUSED",
  );
  assert.equal(
    resolve({ negotiationState: NegotiationState.READY_TO_START }),
    "READY_TO_START",
  );
  assert.equal(resolve({ negotiationState: NegotiationState.RUNNING }), "RUNNING");
  assert.equal(resolve({ negotiationState: NegotiationState.PAUSED }), "PAUSED");
});

test("joinable Observer sessions in FINISHED show Debrief, not Completed", () => {
  assert.equal(
    isJoinableObserverDebriefSession({
      negotiationState: "FINISHED",
      roomLifecycle: "DEBRIEF_OPEN",
      sessionDisplayState: "joinable",
      displayStatus: "DEBRIEF",
    }),
    true,
  );
  assert.equal(
    isJoinableObserverDebriefSession({
      negotiationState: "FINISHED",
      roomLifecycle: null,
      sessionDisplayState: "joinable",
    }),
    true,
  );
  assert.equal(
    isJoinableObserverDebriefSession({
      negotiationState: "FINISHED",
      roomLifecycle: "CLOSED",
      sessionDisplayState: "materials-only",
      displayStatus: "FINISHED",
    }),
    false,
  );
});

test("Debrief and Completed labels are localized in English and Russian", () => {
  assert.equal(en.status.DEBRIEF, "Debrief");
  assert.equal(ru.status.DEBRIEF, "Дебриф");
  assert.equal(en.status.FINISHED, "Completed");
  assert.equal(ru.status.FINISHED, "Завершено");
});
