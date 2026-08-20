import assert from "node:assert/strict";
import test from "node:test";

import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";

const baseTranscript = {
  hasSpeakerDiarization: true,
  speakerMapping: {
    speaker_1: "A",
    speaker_2: "B",
  },
  participants: [
    { id: "A", type: "PARTICIPANT" },
    { id: "B", type: "PARTICIPANT" },
  ],
  segments: [
    { speakerLabel: "speaker_1", mappedParticipantId: "A", text: "hello" },
    { speakerLabel: "speaker_2", mappedParticipantId: "B", text: "world" },
  ],
};

test("REQUIRED mapping blocks AI readiness even if mapping object is populated", () => {
  const ready = isSpeakerMappingReadyForAnalysis({
    ...baseTranscript,
    speakerMappingStatus: "REQUIRED",
  });
  assert.equal(ready, false);
});

test("AUTO_SUGGESTED mapping unlocks AI only when segments are structurally complete", () => {
  const ready = isSpeakerMappingReadyForAnalysis({
    ...baseTranscript,
    speakerMappingStatus: "AUTO_SUGGESTED",
  });
  assert.equal(ready, true);
});

test("AUTO_SUGGESTED without mappedParticipantId does not unlock AI", () => {
  const ready = isSpeakerMappingReadyForAnalysis({
    ...baseTranscript,
    speakerMappingStatus: "AUTO_SUGGESTED",
    segments: [
      { speakerLabel: "speaker_1", mappedParticipantId: null, text: "hello" },
      { speakerLabel: "speaker_2", mappedParticipantId: null, text: "world" },
    ],
  });
  assert.equal(ready, false);
});
