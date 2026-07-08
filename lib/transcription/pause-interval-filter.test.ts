import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPauseOffsetIntervals,
  segmentOverlapsPausedInterval,
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

test("segmentOverlapsPausedInterval detects overlap only when timestamps are present", () => {
  const paused = [{ startSeconds: 10, endSeconds: 20 }];
  assert.equal(
    segmentOverlapsPausedInterval(
      { startSeconds: 5, endSeconds: 10 },
      paused,
    ),
    false,
  );
  assert.equal(
    segmentOverlapsPausedInterval(
      { startSeconds: 5, endSeconds: 15 },
      paused,
    ),
    true,
  );
  assert.equal(
    segmentOverlapsPausedInterval(
      { startSeconds: null, endSeconds: 15 },
      paused,
    ),
    false,
  );
});

test("pause interval filtering keeps pre/post-resume and removes paused segments", () => {
  const recordingStart = new Date("2026-07-08T10:00:00.000Z");
  const recordingEnd = new Date("2026-07-08T10:01:00.000Z");
  const intervals = buildPauseOffsetIntervals({
    recordingStartedAt: recordingStart,
    recordingEndedAt: recordingEnd,
    pauseIntervals: [
      {
        startedAt: new Date("2026-07-08T10:00:10.000Z"),
        endedAt: new Date("2026-07-08T10:00:20.000Z"),
      },
    ],
  });
  assert.deepEqual(intervals, [{ startSeconds: 10, endSeconds: 20 }]);

  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 0, endSeconds: 5 }, intervals),
    false,
    "pre-pause segment should remain",
  );
  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 12, endSeconds: 15 }, intervals),
    true,
    "segment during pause must be removed",
  );
  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 25, endSeconds: 30 }, intervals),
    false,
    "post-resume segment should remain",
  );
});

test("multiple pause/resume cycles are all respected", () => {
  const recordingStart = new Date("2026-07-08T10:00:00.000Z");
  const recordingEnd = new Date("2026-07-08T10:02:00.000Z");
  const intervals = buildPauseOffsetIntervals({
    recordingStartedAt: recordingStart,
    recordingEndedAt: recordingEnd,
    pauseIntervals: [
      {
        startedAt: new Date("2026-07-08T10:00:10.000Z"),
        endedAt: new Date("2026-07-08T10:00:20.000Z"),
      },
      {
        startedAt: new Date("2026-07-08T10:00:40.000Z"),
        endedAt: new Date("2026-07-08T10:00:50.000Z"),
      },
    ],
  });
  assert.deepEqual(intervals, [
    { startSeconds: 10, endSeconds: 20 },
    { startSeconds: 40, endSeconds: 50 },
  ]);

  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 1, endSeconds: 5 }, intervals),
    false,
    "pre-first-pause kept",
  );
  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 12, endSeconds: 18 }, intervals),
    true,
    "first pause removed",
  );
  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 22, endSeconds: 35 }, intervals),
    false,
    "between pauses kept",
  );
  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 42, endSeconds: 45 }, intervals),
    true,
    "second pause removed",
  );
  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 55, endSeconds: 70 }, intervals),
    false,
    "post-second-resume kept",
  );
});

test("open pause interval is clamped safely at recording end", () => {
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
  assert.equal(
    segmentOverlapsPausedInterval({ startSeconds: 50, endSeconds: 58 }, intervals),
    true,
  );
});

