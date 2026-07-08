import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPauseOffsetIntervals,
  classifySegmentAgainstPauseIntervals,
  filterSegmentsByPauseIntervals,
} from "@/lib/transcription/pause-interval-filter";

test("buildPauseOffsetIntervals clamps intervals to recording window", () => {
  const recordingStart = new Date("2026-07-08T10:00:00.000Z");
  const recordingEnd = new Date("2026-07-08T10:05:00.000Z");
  const result = buildPauseOffsetIntervals({
    recordingStartedAt: recordingStart,
    recordingEndedAt: recordingEnd,
    pauseIntervals: [
      {
        startedAt: new Date("2026-07-08T09:59:50.000Z"),
        endedAt: new Date("2026-07-08T10:00:30.000Z"),
      },
      {
        startedAt: new Date("2026-07-08T10:03:00.000Z"),
        endedAt: new Date("2026-07-08T10:06:00.000Z"),
      },
    ],
  });
  assert.deepEqual(result, [
    { startSeconds: 0, endSeconds: 30 },
    { startSeconds: 180, endSeconds: 300 },
  ]);
});

const DEFAULT_OPTIONS = {
  dominantOverlapRatioThreshold: 0.6,
  boundaryToleranceSeconds: 0.35,
};

test("segment before pause is kept", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 2, endSeconds: 8 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "no_overlap");
  assert.equal(decision.shouldDrop, false);
});

test("segment fully inside pause is dropped", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 12, endSeconds: 15 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "fully_inside_pause");
  assert.equal(decision.shouldDrop, true);
});

test("segment after resume is kept", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 20.2, endSeconds: 24 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "no_overlap");
  assert.equal(decision.shouldDrop, false);
});

test("segment with tiny boundary overlap after resume is kept", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 19.85, endSeconds: 20.2 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
});

test("segment with tiny boundary overlap before pause is kept", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 9.8, endSeconds: 10.15 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
});

test("long segment with small pause overlap is kept", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 18, endSeconds: 30 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
});

test("segment mostly inside pause is dropped", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 8, endSeconds: 16 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "overlap_dominantly_paused");
  assert.equal(decision.shouldDrop, true);
});

test("segment crossing two pause intervals with low total overlap is kept", () => {
  const paused = [
    { startSeconds: 10, endSeconds: 11 },
    { startSeconds: 14, endSeconds: 15 },
  ];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 9, endSeconds: 17 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
  assert.equal(Math.round(decision.overlapRatio * 100) / 100, 0.25);
});

test("segment crossing two pause intervals with high total overlap is dropped", () => {
  const paused = [
    { startSeconds: 10, endSeconds: 13 },
    { startSeconds: 13.5, endSeconds: 16.5 },
  ];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 9.5, endSeconds: 17 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "overlap_dominantly_paused");
  assert.equal(decision.shouldDrop, true);
});

test("multiple pause/resume cycles preserve active speech and drop paused windows", () => {
  const segments = [
    { id: "pre-first-pause", startSeconds: 1, endSeconds: 5 },
    { id: "first-pause", startSeconds: 12, endSeconds: 18 },
    { id: "between-pauses", startSeconds: 22, endSeconds: 35 },
    { id: "second-pause", startSeconds: 42, endSeconds: 45 },
    { id: "post-second-resume", startSeconds: 55, endSeconds: 70 },
  ];
  const paused = [
    { startSeconds: 10, endSeconds: 20 },
    { startSeconds: 40, endSeconds: 50 },
  ];
  const result = filterSegmentsByPauseIntervals(
    segments,
    paused,
    (segment) => ({
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    }),
    DEFAULT_OPTIONS,
  );
  assert.deepEqual(
    result.keptSegments.map((segment) => segment.id),
    ["pre-first-pause", "between-pauses", "post-second-resume"],
  );
  assert.deepEqual(
    result.droppedSegments.map((segment) => segment.id),
    ["first-pause", "second-pause"],
  );
});

test("open pause interval clamped to recording end still works", () => {
  const recordingStart = new Date("2026-07-08T10:00:00.000Z");
  const recordingEnd = new Date("2026-07-08T10:01:00.000Z");
  const intervals = buildPauseOffsetIntervals({
    recordingStartedAt: recordingStart,
    recordingEndedAt: recordingEnd,
    pauseIntervals: [
      {
        startedAt: new Date("2026-07-08T10:00:45.000Z"),
        endedAt: null,
      },
    ],
  });
  assert.deepEqual(intervals, [{ startSeconds: 45, endSeconds: 60 }]);
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 50, endSeconds: 58 },
    intervals,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "fully_inside_pause");
  assert.equal(decision.shouldDrop, true);
});

