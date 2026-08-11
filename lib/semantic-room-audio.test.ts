import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOM_AUDIO_CUE_DEFINITIONS,
  ROOM_AUDIO_MASTER_GAIN,
  playSemanticRoomAudioCue,
  type RoomAudioCue,
} from "@/lib/semantic-room-audio";

function totalCueDurationMs(cue: RoomAudioCue) {
  const definition = ROOM_AUDIO_CUE_DEFINITIONS[cue];
  const gapMs = definition.stepGapMs ?? 18;
  return definition.steps.reduce((sum, step, index) => {
    const trailingGap = index < definition.steps.length - 1 ? gapMs : 0;
    return sum + step.durationMs + trailingGap;
  }, 0);
}

test("cue design uses conservative gain and short semantic durations", () => {
  assert.ok(ROOM_AUDIO_MASTER_GAIN <= 0.05);
  for (const cue of Object.keys(ROOM_AUDIO_CUE_DEFINITIONS) as RoomAudioCue[]) {
    const durationMs = totalCueDurationMs(cue);
    assert.ok(
      durationMs >= 120 && durationMs <= 450,
      `${cue} duration ${durationMs}ms is outside 120-450ms`,
    );
  }
});

test("cue frequency direction matches semantic contract", () => {
  const startSteps = ROOM_AUDIO_CUE_DEFINITIONS.START.steps;
  assert.ok(startSteps[1].frequencyHz > startSteps[0].frequencyHz);

  const resumeSteps = ROOM_AUDIO_CUE_DEFINITIONS.RESUME.steps;
  assert.ok(resumeSteps[1].frequencyHz > resumeSteps[0].frequencyHz);
  assert.ok(
    totalCueDurationMs("RESUME") < totalCueDurationMs("START"),
    "RESUME should be lighter than START",
  );

  const pauseSteps = ROOM_AUDIO_CUE_DEFINITIONS.PAUSE.steps;
  assert.ok(pauseSteps[1].frequencyHz < pauseSteps[0].frequencyHz);

  const oneMinuteSteps = ROOM_AUDIO_CUE_DEFINITIONS.ONE_MINUTE.steps;
  assert.equal(oneMinuteSteps.length, 1);

  const tenSecondsSteps = ROOM_AUDIO_CUE_DEFINITIONS.TEN_SECONDS.steps;
  assert.equal(tenSecondsSteps.length, 2);

  const endSteps = ROOM_AUDIO_CUE_DEFINITIONS.END.steps;
  assert.ok(
    endSteps[endSteps.length - 1].frequencyHz < endSteps[0].frequencyHz,
    "END cadence should be distinct from upward START",
  );
});

test("audio scheduler emits one oscillator sequence per cue step", () => {
  const starts: number[] = [];
  const stops: number[] = [];
  const frequencies: number[] = [];

  const context = {
    currentTime: 1,
    destination: {},
    createOscillator: () =>
      ({
        type: "sine",
        frequency: {
          setValueAtTime(value: number) {
            frequencies.push(value);
          },
        },
        connect() {
          // No-op.
        },
        start(time: number) {
          starts.push(time);
        },
        stop(time: number) {
          stops.push(time);
        },
      }) as unknown as OscillatorNode,
    createGain: () =>
      ({
        gain: {
          setValueAtTime() {
            // No-op.
          },
          linearRampToValueAtTime() {
            // No-op.
          },
          exponentialRampToValueAtTime() {
            // No-op.
          },
        },
        connect() {
          // No-op.
        },
      }) as unknown as GainNode,
  };

  playSemanticRoomAudioCue(context, "END");
  assert.equal(starts.length, ROOM_AUDIO_CUE_DEFINITIONS.END.steps.length);
  assert.equal(stops.length, ROOM_AUDIO_CUE_DEFINITIONS.END.steps.length);
  assert.deepEqual(
    frequencies,
    ROOM_AUDIO_CUE_DEFINITIONS.END.steps.map((step) => step.frequencyHz),
  );
});
