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

