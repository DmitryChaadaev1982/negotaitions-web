import assert from "node:assert/strict";
import test from "node:test";

import type { ActiveTimelineInterval } from "@/lib/transcription/active-audio-timeline";
import { normalizeAudioActivityToActiveTimeline } from "@/lib/telemetry/active-timeline-normalization";

const ACTIVE_TIMELINE: ActiveTimelineInterval[] = [
  {
    partIndex: 0,
    realStartMs: 0,
    realEndMs: 10_000,
    activeStartMs: 0,
    activeEndMs: 10_000,
    durationMs: 10_000,
  },
  {
    partIndex: 1,
    realStartMs: 20_000,
    realEndMs: 30_000,
    activeStartMs: 10_000,
    activeEndMs: 20_000,
    durationMs: 10_000,
  },
];

test("activity inside active interval shifts to active timeline", () => {
  const result = normalizeAudioActivityToActiveTimeline(
    [
      {
        sessionParticipantId: "p1",
        source: "VOX_REMOTE_STREAM_ACTIVITY",
        startSeconds: 22,
        endSeconds: 24,
        confidence: 0.9,
      },
    ],
    ACTIVE_TIMELINE,
  );
  assert.equal(result.excludedRows.length, 0);
  assert.equal(result.normalizedRows[0]?.startSeconds, 12);
  assert.equal(result.normalizedRows[0]?.endSeconds, 14);
});

test("activity inside pause gap is excluded", () => {
  const result = normalizeAudioActivityToActiveTimeline(
    [
      {
        sessionParticipantId: "p1",
        source: "VOX_REMOTE_STREAM_ACTIVITY",
        startSeconds: 12,
        endSeconds: 15,
        confidence: 0.9,
      },
    ],
    ACTIVE_TIMELINE,
  );
  assert.equal(result.normalizedRows.length, 0);
  assert.equal(result.excludedRows[0]?.reason, "inside_pause_gap");
});

test("activity crossing active pause boundary is split", () => {
  const result = normalizeAudioActivityToActiveTimeline(
    [
      {
        sessionParticipantId: "p1",
        source: "VOX_REMOTE_STREAM_ACTIVITY",
        startSeconds: 8,
        endSeconds: 22,
        confidence: 0.9,
      },
    ],
    ACTIVE_TIMELINE,
  );
  assert.equal(result.normalizedRows.length, 2);
  assert.deepEqual(
    result.normalizedRows.map((row) => [row.startSeconds, row.endSeconds]),
    [
      [8, 10],
      [10, 12],
    ],
  );
});

test("multiple rows normalize across multiple active intervals", () => {
  const result = normalizeAudioActivityToActiveTimeline(
    [
      {
        sessionParticipantId: "p1",
        source: "VOX_REMOTE_STREAM_ACTIVITY",
        startSeconds: 1,
        endSeconds: 2,
        confidence: 0.5,
      },
      {
        sessionParticipantId: "p2",
        source: "VOX_REMOTE_STREAM_ACTIVITY",
        startSeconds: 25,
        endSeconds: 27,
        confidence: 0.6,
      },
    ],
    ACTIVE_TIMELINE,
  );
  assert.deepEqual(
    result.normalizedRows.map((row) => row.startSeconds),
    [1, 15],
  );
});

test("remote source rows remain preserved after normalization", () => {
  const result = normalizeAudioActivityToActiveTimeline(
    [
      {
        sessionParticipantId: "p1",
        source: "VOX_REMOTE_STREAM_ACTIVITY",
        startSeconds: 0.5,
        endSeconds: 1.5,
        confidence: 0.8,
      },
    ],
    ACTIVE_TIMELINE,
  );
  assert.equal(result.normalizedRows[0]?.source, "VOX_REMOTE_STREAM_ACTIVITY");
});

test("missing active timeline falls back to original rows", () => {
  const result = normalizeAudioActivityToActiveTimeline(
    [
      {
        sessionParticipantId: "p1",
        source: "VOXIMPLANT_MIC_ACTIVITY",
        startSeconds: 3,
        endSeconds: 5,
        confidence: null,
      },
    ],
    null,
  );
  assert.equal(result.excludedRows.length, 0);
  assert.equal(result.normalizedRows[0]?.startSeconds, 3);
  assert.equal(result.normalizedRows[0]?.endSeconds, 5);
});
