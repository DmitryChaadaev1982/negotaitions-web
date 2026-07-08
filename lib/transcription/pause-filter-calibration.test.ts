import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRawCalibrationInputArtifact,
  runPauseFilterCalibration,
  type RawCalibrationInputArtifact,
} from "@/lib/transcription/pause-filter-calibration";

function buildFixtureInput(
  overrides?: Partial<RawCalibrationInputArtifact>,
): RawCalibrationInputArtifact {
  const base: RawCalibrationInputArtifact = {
    schemaVersion: "1",
    generatedAt: "2026-07-08T00:00:00.000Z",
    warnings: [],
    sessionId: "s1",
    recordingId: "r1",
    transcriptId: "t1",
    recording: {
      startedAt: "2026-07-08T10:00:00.000Z",
      endedAt: "2026-07-08T10:01:00.000Z",
      durationSeconds: 60,
    },
    transcriptBeforeFiltering: {
      text: "КАЛИБРОВКА АКТИВНАЯ ФРАЗА ОДИН КАЛИБРОВКА ПАУЗА ФРАЗА ОДИН",
      diarizedText: null,
    },
    provider: {
      normalizedSegments: [],
    },
    mappedSegmentsBeforeFiltering: [
      {
        orderIndex: 0,
        speakerLabel: "speaker_1",
        displaySpeakerLabel: "Speaker 1",
        rawSpeakerLabel: "1",
        mappedParticipantId: null,
        startSeconds: 2,
        endSeconds: 4,
        durationSeconds: 2,
        text: "КАЛИБРОВКА АКТИВНАЯ ФРАЗА ОДИН",
        productionDecision: {
          classification: "no_overlap",
          shouldDrop: false,
          overlapDurationSeconds: 0,
          overlapRatio: 0,
          matchedIntervals: 0,
        },
      },
      {
        orderIndex: 1,
        speakerLabel: "speaker_2",
        displaySpeakerLabel: "Speaker 2",
        rawSpeakerLabel: "2",
        mappedParticipantId: null,
        startSeconds: 12,
        endSeconds: 14,
        durationSeconds: 2,
        text: "КАЛИБРОВКА ПАУЗА ФРАЗА ОДИН",
        productionDecision: {
          classification: "fully_inside_pause",
          shouldDrop: true,
          overlapDurationSeconds: 2,
          overlapRatio: 1,
          matchedIntervals: 1,
        },
      },
      {
        orderIndex: 2,
        speakerLabel: "speaker_1",
        displaySpeakerLabel: "Speaker 1",
        rawSpeakerLabel: "1",
        mappedParticipantId: null,
        startSeconds: 22,
        endSeconds: 24,
        durationSeconds: 2,
        text: "КАЛИБРОВКА АКТИВНАЯ ФРАЗА ДВА",
        productionDecision: {
          classification: "no_overlap",
          shouldDrop: false,
          overlapDurationSeconds: 0,
          overlapRatio: 0,
          matchedIntervals: 0,
        },
      },
    ],
    pauseIntervals: {
      absolute: [
        {
          startedAt: "2026-07-08T10:00:10.000Z",
          endedAt: "2026-07-08T10:00:20.000Z",
        },
      ],
      offsets: [{ startSeconds: 10, endSeconds: 20 }],
    },
    markers: {
      active: [
        "КАЛИБРОВКА АКТИВНАЯ ФРАЗА ОДИН",
        "КАЛИБРОВКА АКТИВНАЯ ФРАЗА ДВА",
      ],
      paused: ["КАЛИБРОВКА ПАУЗА ФРАЗА ОДИН"],
    },
  };
  return {
    ...base,
    ...overrides,
  };
}

test("raw calibration artifact includes pre-filter segments and production decisions", () => {
  const artifact = buildRawCalibrationInputArtifact({
    sessionId: "session-1",
    recordingId: "recording-1",
    transcriptId: "transcript-1",
    recordingStartedAt: new Date("2026-07-08T10:00:00.000Z"),
    recordingEndedAt: new Date("2026-07-08T10:01:00.000Z"),
    recordingDurationSeconds: 60,
    transcriptTextBeforeFiltering: "raw transcript",
    diarizedTextBeforeFiltering: "raw diarized",
    providerNormalizedSegments: [
      {
        orderIndex: 0,
        speakerLabel: "speaker_1",
        displaySpeakerLabel: "Speaker 1",
        startSeconds: 1,
        endSeconds: 2,
        text: "hello",
      },
    ],
    mappedSegmentsBeforeFiltering: [
      {
        orderIndex: 0,
        speakerLabel: "speaker_1",
        displaySpeakerLabel: "Speaker 1",
        mappedParticipantId: null,
        rawSpeakerLabel: "1",
        startSeconds: 12,
        endSeconds: 14,
        text: "paused phrase",
      },
    ],
    pauseIntervalsAbsolute: [
      {
        startedAt: new Date("2026-07-08T10:00:10.000Z"),
        endedAt: new Date("2026-07-08T10:00:20.000Z"),
      },
    ],
    pauseIntervalsOffsets: [{ startSeconds: 10, endSeconds: 20 }],
    activeMarkers: ["active"],
    pausedMarkers: ["paused"],
  });

  assert.equal(artifact.sessionId, "session-1");
  assert.equal(artifact.provider.normalizedSegments.length, 1);
  assert.equal(artifact.mappedSegmentsBeforeFiltering.length, 1);
  assert.equal(
    artifact.mappedSegmentsBeforeFiltering[0].productionDecision.shouldDrop,
    true,
  );
});

test("marker scoring prefers candidates that keep active and drop paused markers", () => {
  const input = buildFixtureInput();
  const result = runPauseFilterCalibration({ input });
  assert.equal(result.inconclusive, false);
  assert.ok(result.recommendedRule);
  const top = result.candidates[0];
  assert.equal(top.markerStats.activeMarkersMissing, 0);
  assert.equal(top.markerStats.pausedMarkersPresent, 0);
});

test("missing active marker causes heavy score penalty", () => {
  const input = buildFixtureInput({
    mappedSegmentsBeforeFiltering: [
      buildFixtureInput().mappedSegmentsBeforeFiltering[1],
    ],
  });
  const result = runPauseFilterCalibration({ input });
  const best = result.candidates[0];
  assert.ok(best.markerStats.activeMarkersMissing > 0);
  assert.ok(best.score < 0);
});

test("paused marker leak is penalized", () => {
  const input = buildFixtureInput({
    pauseIntervals: { absolute: [], offsets: [] },
  });
  const result = runPauseFilterCalibration({ input });
  const best = result.candidates[0];
  assert.ok(best.markerStats.pausedMarkersPresent >= 1);
});

test("candidate ranking is sorted by score descending", () => {
  const input = buildFixtureInput();
  const result = runPauseFilterCalibration({ input });
  assert.ok(result.candidates.length > 5);
  for (let i = 1; i < result.candidates.length; i += 1) {
    assert.ok(result.candidates[i - 1].score >= result.candidates[i].score);
  }
});

test("calibration is inconclusive when markers are absent in raw text", () => {
  const input = buildFixtureInput({
    markers: {
      active: ["НЕСУЩЕСТВУЮЩИЙ МАРКЕР"],
      paused: ["ЕЩЕ ОДИН НЕСУЩЕСТВУЮЩИЙ МАРКЕР"],
    },
  });
  const result = runPauseFilterCalibration({ input });
  assert.equal(result.inconclusive, true);
  assert.equal(result.recommendedRule, null);
});

test("grid search returns a recommended rule when marker signal is clear", () => {
  const input = buildFixtureInput();
  const result = runPauseFilterCalibration({ input });
  assert.equal(result.inconclusive, false);
  assert.ok(result.recommendedRule);
  assert.ok(result.recommendedRule?.candidateId.length);
});
