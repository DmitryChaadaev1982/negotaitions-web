import assert from "node:assert/strict";
import test from "node:test";

import { NegotiationState } from "@/app/generated/prisma/client";
import {
  buildLiveSessionSnapshot,
  createLiveSessionTransitionMachineState,
  reduceLiveSessionTransition,
} from "@/lib/live-session-transitions";

function snapshot(
  negotiationState: NegotiationState,
  remainingSeconds: number,
  timerStartedAt: string | null = "2026-08-11T10:00:00.000Z",
) {
  return buildLiveSessionSnapshot({
    negotiationState,
    remainingSeconds,
    timerStartedAt,
  });
}

test("hydration seeds state silently", () => {
  const reduction = reduceLiveSessionTransition({
    state: createLiveSessionTransitionMachineState(),
    currentSnapshot: snapshot(NegotiationState.READY_TO_START, 300),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(reduction.event, null);
  assert.equal(reduction.cue, null);
  assert.equal(reduction.announcementKey, null);
});

test("negotiation START cue and announcement fire once", () => {
  let state = createLiveSessionTransitionMachineState();

  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.READY_TO_START, 300),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  }).nextState;

  const started = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 300),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  state = started.nextState;

  assert.equal(started.event, "NEGOTIATION_STARTED");
  assert.equal(started.cue, "START");
  assert.equal(started.announcementKey, "room.a11yNegotiationStarted");

  const duplicate = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 300),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(duplicate.event, null);
  assert.equal(duplicate.cue, null);
});

test("PAUSE and RESUME cues fire once each", () => {
  let state = createLiveSessionTransitionMachineState();
  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 250),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  }).nextState;

  const paused = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.PAUSED, 250),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(paused.event, "NEGOTIATION_PAUSED");
  assert.equal(paused.cue, "PAUSE");

  const resumed = reduceLiveSessionTransition({
    state: paused.nextState,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 250),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(resumed.event, "NEGOTIATION_RESUMED");
  assert.equal(resumed.cue, "RESUME");
});

test("final-minute and final-10 cues fire once without per-second beeps", () => {
  let state = createLiveSessionTransitionMachineState();
  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 65),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  }).nextState;

  const oneMinute = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 60),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(oneMinute.event, "FINAL_MINUTE");
  assert.equal(oneMinute.cue, "ONE_MINUTE");

  const perSecond = reduceLiveSessionTransition({
    state: oneMinute.nextState,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 59),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(perSecond.event, null);
  assert.equal(perSecond.cue, null);

  const finalTen = reduceLiveSessionTransition({
    state: perSecond.nextState,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 10),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(finalTen.event, "FINAL_10_SECONDS");
  assert.equal(finalTen.cue, "TEN_SECONDS");
});

test("if one delayed poll crosses 60 and 10, only urgent 10 cue plays", () => {
  let state = createLiveSessionTransitionMachineState();
  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 61),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  }).nextState;

  const delayed = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 9),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(delayed.event, "FINAL_10_SECONDS");
  assert.equal(delayed.cue, "TEN_SECONDS");
});

test("END cue fires once on active-to-finished transition inside finish line", () => {
  let state = createLiveSessionTransitionMachineState();
  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 5),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  }).nextState;

  const ended = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.FINISHED, 0),
    isVisible: true,
    finishLineActive: true,
    allowAudio: true,
  });
  assert.equal(ended.event, "TIME_EXPIRED");
  assert.equal(ended.cue, "END");

  const duplicate = reduceLiveSessionTransition({
    state: ended.nextState,
    currentSnapshot: snapshot(NegotiationState.FINISHED, 0),
    isVisible: true,
    finishLineActive: true,
    allowAudio: true,
  });
  assert.equal(duplicate.cue, null);
});

test("manual finish maps to manual completion semantics and END cue", () => {
  let state = createLiveSessionTransitionMachineState();
  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.PAUSED, 145),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  }).nextState;

  const ended = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.FINISHED, 145),
    isVisible: true,
    finishLineActive: true,
    allowAudio: true,
  });
  assert.equal(ended.event, "MANUAL_COMPLETION");
  assert.equal(ended.cue, "END");
});

test("preparation transitions are announced but remain silent", () => {
  let state = createLiveSessionTransitionMachineState();
  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.PREPARATION, 120, null),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  }).nextState;

  const prepStarted = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.PREPARATION_RUNNING, 120, null),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(prepStarted.event, "PREPARATION_STARTED");
  assert.equal(prepStarted.cue, null);
  assert.equal(prepStarted.announcementKey, "room.a11yPreparationStarted");
});

test("sound OFF suppresses cues and unlock does not replay history", () => {
  let state = createLiveSessionTransitionMachineState();
  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.READY_TO_START, 300),
    isVisible: true,
    finishLineActive: false,
    allowAudio: false,
  }).nextState;

  const whileMuted = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 300),
    isVisible: true,
    finishLineActive: false,
    allowAudio: false,
  });
  assert.equal(whileMuted.event, "NEGOTIATION_STARTED");
  assert.equal(whileMuted.cue, null);

  const afterUnlock = reduceLiveSessionTransition({
    state: whileMuted.nextState,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 300),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(afterUnlock.event, null);
  assert.equal(afterUnlock.cue, null);
});

test("background wake suppresses historical transitions and cues", () => {
  let state = createLiveSessionTransitionMachineState();
  state = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 70),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  }).nextState;

  const hiddenUpdate = reduceLiveSessionTransition({
    state,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 9),
    isVisible: false,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(hiddenUpdate.cue, null);

  const firstVisible = reduceLiveSessionTransition({
    state: hiddenUpdate.nextState,
    currentSnapshot: snapshot(NegotiationState.RUNNING, 9),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(firstVisible.event, null);
  assert.equal(firstVisible.cue, null);
});

test("new machine state after remount starts silently", () => {
  const seeded = reduceLiveSessionTransition({
    state: createLiveSessionTransitionMachineState(),
    currentSnapshot: snapshot(NegotiationState.RUNNING, 42),
    isVisible: true,
    finishLineActive: false,
    allowAudio: true,
  });
  assert.equal(seeded.event, null);
  assert.equal(seeded.cue, null);
});
