import assert from "node:assert/strict";
import test from "node:test";

import { shouldConfirmAutoSuggestedMappingAfterAiAdmission } from "@/lib/transcription/confirm-mapping-after-ai-admission";

const completeSegments = [
  { text: "Hello", speakerLabel: "speaker_1", mappedParticipantId: "buyer" },
  { text: "Hi", speakerLabel: "speaker_2", mappedParticipantId: "seller" },
];
const participants = [
  { id: "buyer", type: "PARTICIPANT" },
  { id: "seller", type: "PARTICIPANT" },
];

test("complete AUTO_SUGGESTED is confirmed only after successful AI admission", () => {
  assert.equal(
    shouldConfirmAutoSuggestedMappingAfterAiAdmission({
      speakerMappingStatus: "AUTO_SUGGESTED",
      hasSpeakerDiarization: true,
      segments: completeSegments,
      participants,
    }),
    true,
  );
});

test("incomplete AUTO_SUGGESTED is not confirmed", () => {
  assert.equal(
    shouldConfirmAutoSuggestedMappingAfterAiAdmission({
      speakerMappingStatus: "AUTO_SUGGESTED",
      hasSpeakerDiarization: true,
      segments: [
        { text: "Hello", speakerLabel: "speaker_1", mappedParticipantId: null },
      ],
      participants,
    }),
    false,
  );
});

test("already CONFIRMED mapping is not rewritten by the admission helper", () => {
  assert.equal(
    shouldConfirmAutoSuggestedMappingAfterAiAdmission({
      speakerMappingStatus: "CONFIRMED",
      hasSpeakerDiarization: true,
      segments: completeSegments,
      participants,
    }),
    false,
  );
});
