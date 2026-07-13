import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTranscriptDurationUi,
  formatTranscriptTimeRangeWithDurationUi,
  formatTranscriptTimestampUi,
  groupSegmentsIntoTurns,
} from "@/lib/transcription/transcript-timing";

test("formatTranscriptTimestampUi rounds to tenths under one hour", () => {
  assert.equal(formatTranscriptTimestampUi(0), "00:00.0");
  assert.equal(formatTranscriptTimestampUi(0.7), "00:00.7");
  assert.equal(formatTranscriptTimestampUi(2.673), "00:02.7");
  assert.equal(formatTranscriptTimestampUi(59.96), "01:00.0");
  assert.equal(formatTranscriptTimestampUi(65.15), "01:05.2");
});

test("formatTranscriptTimestampUi uses hour format at one hour+", () => {
  assert.equal(formatTranscriptTimestampUi(3600), "01:00:00.0");
  assert.equal(formatTranscriptTimestampUi(3661.24), "01:01:01.2");
});

test("formatTranscriptTimestampUi keeps safe fallback for invalid or missing values", () => {
  assert.equal(formatTranscriptTimestampUi(null), "00:00:00");
  assert.equal(formatTranscriptTimestampUi(Number.NaN), "00:00:00");
  assert.equal(formatTranscriptTimestampUi(-0.1), "00:00:00");
});

test("formatTranscriptDurationUi renders positive and sub-second durations", () => {
  assert.equal(
    formatTranscriptDurationUi({
      startSeconds: 5.2,
      endSeconds: 19.4,
      unitLabel: "s",
    }),
    "14.2 s",
  );
  assert.equal(
    formatTranscriptDurationUi({
      startSeconds: 1.04,
      endSeconds: 1.09,
      unitLabel: "s",
    }),
    "0.1 s",
  );
});

test("formatTranscriptDurationUi uses numeric timestamps and rejects invalid negative duration", () => {
  assert.equal(
    formatTranscriptDurationUi({
      startSeconds: 0.04,
      endSeconds: 0.14,
      unitLabel: "s",
    }),
    "0.1 s",
  );
  assert.equal(
    formatTranscriptDurationUi({
      startSeconds: 2,
      endSeconds: 1,
      unitLabel: "s",
    }),
    null,
  );
});

test("formatTranscriptTimeRangeWithDurationUi keeps safe fallback when duration invalid", () => {
  assert.equal(
    formatTranscriptTimeRangeWithDurationUi({
      startSeconds: 2,
      endSeconds: 1,
      durationUnitLabel: "s",
    }),
    "00:02.0-00:01.0",
  );
  assert.equal(
    formatTranscriptTimeRangeWithDurationUi({
      startSeconds: null,
      endSeconds: null,
      durationUnitLabel: "s",
    }),
    "00:00:00",
  );
});

test("groupSegmentsIntoTurns preserves segment order without timestamp re-sorting", () => {
  const turns = groupSegmentsIntoTurns(
    [
      { text: "First", startSeconds: 30, endSeconds: 31, speaker: "A" },
      { text: "Second", startSeconds: 5, endSeconds: 6, speaker: "B" },
    ],
    (segment) => ({
      speakerName: segment.speaker,
      rawSpeakerLabel: segment.speaker,
      mappingApplied: false,
      speakerKey: segment.speaker,
    }),
  );

  assert.equal(turns[0]?.text, "First");
  assert.equal(turns[1]?.text, "Second");
});

test("groupSegmentsIntoTurns keeps stable order for equal timestamps", () => {
  const turns = groupSegmentsIntoTurns(
    [
      { text: "One", startSeconds: 1, endSeconds: 2, speaker: "A" },
      { text: "Two", startSeconds: 1, endSeconds: 2, speaker: "B" },
      { text: "Three", startSeconds: 1, endSeconds: 2, speaker: "C" },
    ],
    (segment) => ({
      speakerName: segment.speaker,
      rawSpeakerLabel: segment.speaker,
      mappingApplied: false,
      speakerKey: segment.speaker,
    }),
  );

  assert.deepEqual(
    turns.map((turn) => turn.text),
    ["One", "Two", "Three"],
  );
});

test("groupSegmentsIntoTurns duration follows existing grouped turn boundaries", () => {
  const turns = groupSegmentsIntoTurns(
    [
      { text: "Part 1", startSeconds: 5.2, endSeconds: 10.0, speaker: "A" },
      { text: "Part 2", startSeconds: 10.0, endSeconds: 19.4, speaker: "A" },
    ],
    (segment) => ({
      speakerName: segment.speaker,
      rawSpeakerLabel: segment.speaker,
      mappingApplied: false,
      speakerKey: segment.speaker,
    }),
  );

  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.startSeconds, 5.2);
  assert.equal(turns[0]?.endSeconds, 19.4);
  assert.equal(
    formatTranscriptTimeRangeWithDurationUi({
      startSeconds: turns[0]?.startSeconds ?? null,
      endSeconds: turns[0]?.endSeconds ?? null,
      durationUnitLabel: "s",
    }),
    "00:05.2-00:19.4 · 14.2 s",
  );
});
