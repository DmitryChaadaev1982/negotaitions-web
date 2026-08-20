import assert from "node:assert/strict";
import test from "node:test";

import { ParticipantType } from "@/app/generated/prisma/client";
import { evaluateSpeakerMappingStructuralCompleteness } from "@/lib/transcription/speaker-mapping-completeness";

const buyer = { id: "buyer", type: ParticipantType.PARTICIPANT };
const seller = { id: "seller", type: ParticipantType.PARTICIPANT };
const observer = { id: "observer", type: ParticipantType.OBSERVER };

const completeSegments = [
  { speakerLabel: "speaker_0", mappedParticipantId: "buyer", text: "Hello" },
  { speakerLabel: "speaker_1", mappedParticipantId: "seller", text: "Hi" },
];

test("AUTO_SUGGESTED string alone is not structurally complete", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: true,
    speakerMappingStatus: "AUTO_SUGGESTED",
    segments: [
      { speakerLabel: "speaker_0", mappedParticipantId: null, text: "Hello" },
      { speakerLabel: "speaker_1", mappedParticipantId: null, text: "Hi" },
    ],
    participants: [buyer, seller],
  });
  assert.equal(result.structurallyComplete, false);
  assert.equal(result.readyForAnalysis, false);
  assert.equal(result.reason, "INCOMPLETE_UNMAPPED");
});

test("cluster JSON is not consulted for completeness", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: true,
    speakerMappingStatus: "AUTO_SUGGESTED",
    segments: [
      { speakerLabel: "speaker_0", mappedParticipantId: null, text: "Hello" },
    ],
    participants: [buyer, seller],
  });
  assert.equal(result.readyForAnalysis, false);
});

test("REQUIRED blocks even when every spoken segment is mapped", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: true,
    speakerMappingStatus: "REQUIRED",
    segments: completeSegments,
    participants: [buyer, seller],
  });
  assert.equal(result.reviewRequired, true);
  assert.equal(result.readyForAnalysis, false);
  assert.equal(result.reason, "REVIEW_REQUIRED");
});

test("NEEDS_REVIEW blocks AI even with mapped segments", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: true,
    speakerMappingStatus: "NEEDS_REVIEW",
    segments: completeSegments,
    participants: [buyer, seller],
  });
  assert.equal(result.readyForAnalysis, false);
});

test("structurally complete AUTO_SUGGESTED is analysis-ready", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: true,
    speakerMappingStatus: "AUTO_SUGGESTED",
    segments: completeSegments,
    participants: [buyer, seller],
  });
  assert.equal(result.structurallyComplete, true);
  assert.equal(result.readyForAnalysis, true);
  assert.equal(result.reason, "COMPLETE");
});

test("mapped Observer is not an eligible negotiation speaker", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: true,
    speakerMappingStatus: "AUTO_SUGGESTED",
    segments: [
      { speakerLabel: "speaker_0", mappedParticipantId: "observer", text: "Hello" },
    ],
    participants: [observer, buyer],
  });
  assert.equal(result.readyForAnalysis, false);
  assert.equal(result.reason, "INCOMPLETE_INELIGIBLE_PARTICIPANT");
});

test("unknown mappedParticipantId is incomplete", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: true,
    speakerMappingStatus: "AUTO_SUGGESTED",
    segments: [
      { speakerLabel: "speaker_0", mappedParticipantId: "missing", text: "Hello" },
    ],
    participants: [buyer],
  });
  assert.equal(result.reason, "INCOMPLETE_INVALID_PARTICIPANT");
});

test("spoken segment without a diarization label is incomplete", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: true,
    speakerMappingStatus: "AUTO_SUGGESTED",
    segments: [{ speakerLabel: null, mappedParticipantId: "buyer", text: "Hello" }],
    participants: [buyer],
  });
  assert.equal(result.reason, "INCOMPLETE_MISSING_LABEL");
});

test("no diarization is not-required and analysis-ready", () => {
  const result = evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: false,
    speakerMappingStatus: "NOT_REQUIRED",
    segments: [{ speakerLabel: null, mappedParticipantId: null, text: "Hello" }],
    participants: [buyer],
  });
  assert.equal(result.reason, "NOT_REQUIRED");
  assert.equal(result.readyForAnalysis, true);
});
