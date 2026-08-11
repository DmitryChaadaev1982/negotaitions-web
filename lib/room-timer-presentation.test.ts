import assert from "node:assert/strict";
import test from "node:test";

import { NegotiationState, ParticipantType } from "@/app/generated/prisma/client";
import { buildRoomTimerPresentation } from "@/lib/room-timer-presentation";

function makeState(negotiationState: NegotiationState, remainingSeconds: number) {
  return {
    negotiationState,
    remainingSeconds,
    participantType: ParticipantType.PARTICIPANT,
  };
}

test("ROOM_READY keeps identical title and role-specific subtitle", () => {
  const participant = buildRoomTimerPresentation({
    negotiationState: NegotiationState.PREPARATION,
    remainingSeconds: 600,
    participantType: ParticipantType.PARTICIPANT,
  });
  const facilitator = buildRoomTimerPresentation({
    negotiationState: NegotiationState.PREPARATION,
    remainingSeconds: 600,
    participantType: ParticipantType.FACILITATOR,
  });

  assert.equal(participant.titleKey, "room.waitingForPreparation");
  assert.equal(facilitator.titleKey, "room.waitingForPreparation");
  assert.equal(participant.subtitleKey, "room.facilitatorWillStartShortly");
  assert.equal(facilitator.subtitleKey, "room.checkParticipantsAndConnection");
});

test("preparation-running and preparation-paused states map correctly", () => {
  const running = buildRoomTimerPresentation(
    makeState(NegotiationState.PREPARATION_RUNNING, 400),
  );
  assert.equal(running.presentationState, "PREPARATION_RUNNING");
  assert.equal(running.titleKey, "room.preparationRunning");

  const pausedParticipant = buildRoomTimerPresentation({
    negotiationState: NegotiationState.PREPARATION_PAUSED,
    remainingSeconds: 400,
    participantType: ParticipantType.PARTICIPANT,
  });
  assert.equal(pausedParticipant.presentationState, "PREPARATION_PAUSED");
  assert.equal(pausedParticipant.subtitleKey, "room.waitingForFacilitator");
});

test("ready-to-start uses approved waiting copy", () => {
  const waiting = buildRoomTimerPresentation(
    makeState(NegotiationState.READY_TO_START, 900),
  );
  assert.equal(waiting.presentationState, "WAITING_FOR_NEGOTIATION_START");
  assert.equal(waiting.titleKey, "room.preparationComplete");
  assert.equal(waiting.subtitleKey, "room.waitingForFacilitatorStart");
});

test("running state warning precedence: final-10 overrides final-minute", () => {
  const running = buildRoomTimerPresentation(makeState(NegotiationState.RUNNING, 120));
  assert.equal(running.presentationState, "NEGOTIATION_RUNNING");
  assert.equal(running.titleKey, "room.negotiationInProgress");

  const finalMinute = buildRoomTimerPresentation(
    makeState(NegotiationState.RUNNING, 60),
  );
  assert.equal(finalMinute.presentationState, "FINAL_MINUTE");
  assert.equal(finalMinute.titleKey, "room.oneMinuteRemaining");

  const finalTen = buildRoomTimerPresentation(makeState(NegotiationState.RUNNING, 10));
  assert.equal(finalTen.presentationState, "FINAL_10_SECONDS");
  assert.equal(finalTen.titleKey, "room.finalTenSeconds");
  assert.equal(finalTen.tone, "critical");
});

test("paused state stays paused even with low remaining seconds", () => {
  const paused = buildRoomTimerPresentation(makeState(NegotiationState.PAUSED, 8));
  assert.equal(paused.presentationState, "NEGOTIATION_PAUSED");
  assert.equal(paused.titleKey, "room.negotiationPaused");
});

test("finished state maps timer-expired and manual-finish variants", () => {
  const expired = buildRoomTimerPresentation(makeState(NegotiationState.FINISHED, 0));
  assert.equal(expired.presentationState, "FINISH_LINE_TIMER_EXPIRED");
  assert.equal(expired.titleKey, "room.timeIsUp");
  assert.equal(expired.subtitleKey, "room.negotiationsComplete");

  const manual = buildRoomTimerPresentation(makeState(NegotiationState.FINISHED, 180));
  assert.equal(manual.presentationState, "FINISH_LINE_MANUAL_FINISH");
  assert.equal(manual.titleKey, "room.negotiationsComplete");
  assert.equal(manual.subtitleKey, "room.debriefIsNext");
});
