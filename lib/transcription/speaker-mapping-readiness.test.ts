import assert from "node:assert/strict";
import test from "node:test";

import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";

const baseTranscript = {
  hasSpeakerDiarization: true,
  speakerMapping: {
    speaker_1: "A",
    speaker_2: "A",
  },
  segments: [
    { speakerLabel: "speaker_1", mappedParticipantId: null, text: "hello" },
    { speakerLabel: "speaker_2", mappedParticipantId: null, text: "world" },
  ],
};

test("REQUIRED mapping blocks AI readiness even if mapping object is populated", () => {
  const ready = isSpeakerMappingReadyForAnalysis({
    ...baseTranscript,
    speakerMappingStatus: "REQUIRED",
  });
  assert.equal(ready, false);
});

test("AUTO_SUGGESTED mapping can unlock AI readiness", () => {
  const ready = isSpeakerMappingReadyForAnalysis({
    ...baseTranscript,
    speakerMappingStatus: "AUTO_SUGGESTED",
    speakerMapping: {
      speaker_1: "A",
      speaker_2: "B",
    },
  });
  assert.equal(ready, true);
});
