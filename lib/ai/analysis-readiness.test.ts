import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";
import {
  evaluateAiAnalysisReadiness,
  type TranscriptForAiAnalysisReadiness,
} from "@/lib/ai/analysis-readiness";

function transcript(
  overrides: Partial<TranscriptForAiAnalysisReadiness> = {},
): TranscriptForAiAnalysisReadiness {
  return {
    status: TranscriptStatus.COMPLETED,
    text: "Synthetic usable transcript.",
    diarizedText: null,
    hasSpeakerDiarization: false,
    speakerMappingStatus: "NOT_REQUIRED",
    speakerMapping: null,
    segments: [],
    ...overrides,
  };
}

test("COMPLETED usable text with ready mapping is analysis-ready", () => {
  assert.deepEqual(evaluateAiAnalysisReadiness(transcript()), {
    ready: true,
    reason: "READY",
    hasUsableContent: true,
    speakerMappingReady: true,
  });
});

test("COMPLETED usable segments are analysis-ready without aggregate text", () => {
  const readiness = evaluateAiAnalysisReadiness(
    transcript({
      text: " ",
      segments: [{ speakerLabel: null, text: "Synthetic segment." }],
    }),
  );
  assert.equal(readiness.ready, true);
});

test("COMPLETED whitespace with no usable segments is not ready", () => {
  const readiness = evaluateAiAnalysisReadiness(
    transcript({
      text: " \n ",
      diarizedText: "\t",
      segments: [{ speakerLabel: null, text: " " }],
    }),
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "TRANSCRIPT_CONTENT_EMPTY");
});

test("empty COMPLETED transcript is rejected by the canonical POST contract", () => {
  const readiness = evaluateAiAnalysisReadiness(
    transcript({ text: "", diarizedText: null, segments: [] }),
  );
  assert.equal(readiness.reason, "TRANSCRIPT_CONTENT_EMPTY");
});

for (const speakerMappingStatus of ["REQUIRED", "NEEDS_REVIEW"]) {
  test(`mapping ${speakerMappingStatus} blocks analysis`, () => {
    const readiness = evaluateAiAnalysisReadiness(
      transcript({
        hasSpeakerDiarization: true,
        speakerMappingStatus,
        segments: [
          {
            speakerLabel: "speaker-1",
            mappedParticipantId: null,
            text: "Synthetic speech.",
          },
        ],
      }),
    );
    assert.equal(readiness.ready, false);
    assert.equal(readiness.reason, "SPEAKER_MAPPING_REQUIRED");
  });
}

for (const status of [
  TranscriptStatus.QUEUED,
  TranscriptStatus.TRANSCRIBING,
  TranscriptStatus.FAILED,
]) {
  test(`${status} transcription is not analysis-ready`, () => {
    const readiness = evaluateAiAnalysisReadiness(transcript({ status }));
    assert.equal(readiness.ready, false);
    assert.equal(readiness.reason, "TRANSCRIPT_NOT_COMPLETED");
  });
}

test("enhancement state is independent when valid raw transcript is ready", () => {
  // Enhancement is intentionally absent from the canonical helper input.
  assert.equal(evaluateAiAnalysisReadiness(transcript()).ready, true);
});

test("enhancement cannot make invalid raw transcript ready", () => {
  const readiness = evaluateAiAnalysisReadiness(
    transcript({ text: " ", segments: [] }),
  );
  assert.equal(readiness.ready, false);
});

test("mapping REQUIRED blocks usable raw text even without segment rows", () => {
  for (const hasSpeakerDiarization of [true, false]) {
    const readiness = evaluateAiAnalysisReadiness(
      transcript({
        hasSpeakerDiarization,
        speakerMappingStatus: "REQUIRED",
        segments: [],
      }),
    );
    assert.equal(readiness.reason, "SPEAKER_MAPPING_REQUIRED");
  }
});
