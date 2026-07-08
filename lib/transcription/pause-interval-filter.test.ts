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
  dropOverlapRatio: 0.6,
  boundaryToleranceSeconds: 0.35,
  significantPauseOverlapSeconds: 1.25,
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

test("tiny boundary overlap after resume is kept", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 19.8, endSeconds: 21.2 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
  assert.equal(Math.round(decision.overlapDurationSeconds * 10) / 10, 0.2);
});

test("tiny boundary overlap before pause is kept", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 8.8, endSeconds: 10.2 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
  assert.equal(Math.round(decision.overlapDurationSeconds * 10) / 10, 0.2);
});

test("significant absolute overlap is dropped even when ratio is below threshold", () => {
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 0, endSeconds: 10 },
    [{ startSeconds: 2, endSeconds: 4 }],
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "significant_pause_overlap");
  assert.equal(decision.shouldDrop, true);
  assert.equal(Math.round(decision.overlapRatio * 100) / 100, 0.2);
  assert.equal(decision.overlapDurationSeconds, 2);
});

test("forensic-like segment is dropped by significant overlap calibration", () => {
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 0, endSeconds: 7 },
    [{ startSeconds: 2, endSeconds: 4.5 }],
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "significant_pause_overlap");
  assert.equal(decision.shouldDrop, true);
  assert.equal(Math.round(decision.overlapRatio * 100) / 100, 0.36);
  assert.equal(decision.overlapDurationSeconds, 2.5);
});

test("post-resume segment with 0.3s overlap is kept", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 19.7, endSeconds: 23 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
  assert.equal(Math.round(decision.overlapDurationSeconds * 10) / 10, 0.3);
});

test("long segment with 0.5s overlap is kept below significant threshold", () => {
  const paused = [{ startSeconds: 15, endSeconds: 15.5 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 0, endSeconds: 20 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
  assert.equal(decision.overlapDurationSeconds, 0.5);
});

test("segment mostly inside pause is dropped by ratio", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 8, endSeconds: 16 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "overlap_dominantly_paused");
  assert.equal(decision.shouldDrop, true);
});

test("multiple pause intervals low total overlap is kept", () => {
  const paused = [
    { startSeconds: 10, endSeconds: 10.4 },
    { startSeconds: 14, endSeconds: 14.5 },
  ];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 9, endSeconds: 17 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "boundary_overlap_mostly_unpaused");
  assert.equal(decision.shouldDrop, false);
  assert.equal(Math.round(decision.overlapDurationSeconds * 10) / 10, 0.9);
});

test("multiple pause intervals significant total overlap is dropped", () => {
  const paused = [
    { startSeconds: 10, endSeconds: 10.8 },
    { startSeconds: 12, endSeconds: 13.1 },
  ];
  const decision = classifySegmentAgainstPauseIntervals(
    { startSeconds: 9, endSeconds: 15 },
    paused,
    DEFAULT_OPTIONS,
  );
  assert.equal(decision.classification, "significant_pause_overlap");
  assert.equal(decision.shouldDrop, true);
  assert.equal(Math.round(decision.overlapDurationSeconds * 10) / 10, 1.9);
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
  assert.equal(result.diagnostics.fullyPausedDroppedCount, 2);
  assert.equal(result.diagnostics.boundaryOverlapKeptCount, 0);
  assert.equal(result.diagnostics.boundaryOverlapDroppedCount, 0);
  assert.equal(result.diagnostics.significantOverlapDroppedCount, 0);
  assert.equal(result.diagnostics.maxKeptPauseOverlapSeconds, 0);
  assert.equal(result.diagnostics.maxDroppedPauseOverlapSeconds, 6);
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

test("filter diagnostics track significant and boundary overlap outcomes", () => {
  const segments = [
    { id: "tiny-kept", startSeconds: 19.8, endSeconds: 21.2 },
    { id: "significant-dropped", startSeconds: 0, endSeconds: 7 },
    { id: "ratio-dropped", startSeconds: 8, endSeconds: 16 },
  ];
  const pauseIntervals = [
    { startSeconds: 10, endSeconds: 20 },
    { startSeconds: 2, endSeconds: 4.5 },
  ];

  const result = filterSegmentsByPauseIntervals(
    segments,
    pauseIntervals,
    (segment) => ({
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
    }),
    DEFAULT_OPTIONS,
  );

  assert.deepEqual(
    result.keptSegments.map((segment) => segment.id),
    ["tiny-kept"],
  );
  assert.deepEqual(
    result.droppedSegments.map((segment) => segment.id),
    ["significant-dropped", "ratio-dropped"],
  );
  assert.equal(result.diagnostics.filteredSegmentCount, 2);
  assert.equal(result.diagnostics.fullyPausedDroppedCount, 0);
  assert.equal(result.diagnostics.boundaryOverlapKeptCount, 1);
  assert.equal(result.diagnostics.boundaryOverlapDroppedCount, 2);
  assert.equal(result.diagnostics.significantOverlapDroppedCount, 1);
  assert.equal(
    Math.round(result.diagnostics.maxKeptPauseOverlapSeconds * 10) / 10,
    0.2,
  );
  assert.equal(result.diagnostics.maxDroppedPauseOverlapSeconds, 6);
});

