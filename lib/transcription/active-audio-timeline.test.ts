import assert from "node:assert/strict";
import test from "node:test";

import {
  ActiveAudioTimelineError,
  buildActiveAudioTimeline,
} from "@/lib/transcription/active-audio-timeline";

test("no pause produces single active interval", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 100_000,
    pauseIntervals: [],
  });
  assert.deepEqual(result.activeIntervals, [
    {
      partIndex: 0,
      realStartMs: 0,
      realEndMs: 100_000,
      activeStartMs: 0,
      activeEndMs: 100_000,
      durationMs: 100_000,
    },
  ]);
});

test("one pause produces two active intervals", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 100_000,
    pauseIntervals: [{ startMs: 30_000, endMs: 50_000 }],
  });
  assert.deepEqual(result.activeIntervals, [
    {
      partIndex: 0,
      realStartMs: 0,
      realEndMs: 30_000,
      activeStartMs: 0,
      activeEndMs: 30_000,
      durationMs: 30_000,
    },
    {
      partIndex: 1,
      realStartMs: 50_000,
      realEndMs: 100_000,
      activeStartMs: 30_000,
      activeEndMs: 80_000,
      durationMs: 50_000,
    },
  ]);
});

test("two pauses produce three active intervals", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 100_000,
    pauseIntervals: [
      { startMs: 10_000, endMs: 20_000 },
      { startMs: 60_000, endMs: 70_000 },
    ],
  });
  assert.equal(result.activeIntervals.length, 3);
  assert.equal(result.diagnostics.activeDurationMs, 80_000);
});

test("pause then end keeps only pre-pause active interval", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 100_000,
    pauseIntervals: [{ startMs: 40_000, endMs: 100_000 }],
  });
  assert.deepEqual(result.activeIntervals, [
    {
      partIndex: 0,
      realStartMs: 0,
      realEndMs: 40_000,
      activeStartMs: 0,
      activeEndMs: 40_000,
      durationMs: 40_000,
    },
  ]);
});

test("duplicate and overlapping pauses are normalized", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 100_000,
    pauseIntervals: [
      { startMs: 20_000, endMs: 35_000 },
      { startMs: 20_000, endMs: 35_000 },
      { startMs: 30_000, endMs: 50_000 },
    ],
  });
  assert.deepEqual(result.normalizedPauseIntervals, [
    { startMs: 20_000, endMs: 50_000 },
  ]);
  assert.equal(result.diagnostics.mergedPauseCount, 2);
});

test("pause start before recording is clamped", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 100_000,
    pauseIntervals: [{ startMs: -10_000, endMs: 10_000 }],
  });
  assert.equal(result.activeIntervals[0]?.realStartMs, 10_000);
});

test("pause end after recording is clamped", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 100_000,
    pauseIntervals: [{ startMs: 90_000, endMs: 200_000 }],
  });
  assert.deepEqual(result.normalizedPauseIntervals, [
    { startMs: 90_000, endMs: 100_000 },
  ]);
});

test("open pause is clamped to recording end", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 100_000,
    pauseIntervals: [{ startMs: 90_000, endMs: null }],
  });
  assert.deepEqual(result.normalizedPauseIntervals, [
    { startMs: 90_000, endMs: 100_000 },
  ]);
});

test("very short active intervals are retained when positive", () => {
  const result = buildActiveAudioTimeline({
    recordingDurationMs: 1_000,
    pauseIntervals: [{ startMs: 499, endMs: 500 }],
  });
  assert.equal(result.activeIntervals.length, 2);
  assert.equal(result.activeIntervals[0]?.durationMs, 499);
  assert.equal(result.activeIntervals[1]?.durationMs, 500);
});

test("empty active result throws explicit error", () => {
  assert.throws(
    () =>
      buildActiveAudioTimeline({
        recordingDurationMs: 100_000,
        pauseIntervals: [{ startMs: 0, endMs: 100_000 }],
      }),
    (error: unknown) => {
      assert.ok(error instanceof ActiveAudioTimelineError);
      assert.equal(error.message, "No active audio remains after pause exclusion.");
      return true;
    },
  );
});
