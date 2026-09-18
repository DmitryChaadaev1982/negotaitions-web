import assert from "node:assert/strict";
import test from "node:test";

import { getTranscriptionSectionRefreshKey } from "@/lib/transcription/transcription-section-key";

test("section identity is stable across volatile enhancement/processing flags", () => {
  const running = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: "tr_1",
    recordingId: "rec_1",
    processingStage: "enhancing",
    diarizationStatus: "PENDING",
    speakerMappingRequired: false,
    enhancementStatus: "IN_PROGRESS",
  });
  const completed = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: "tr_1",
    recordingId: "rec_1",
    processingStage: "ready",
    diarizationStatus: "COMPLETED",
    speakerMappingRequired: true,
    enhancementStatus: "COMPLETED",
  });
  assert.equal(running, "rec_1:tr_1");
  assert.equal(completed, running);
});

test("a new transcript generation changes section identity", () => {
  const first = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: "tr_1",
    recordingId: "rec_1",
  });
  const retried = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: "tr_2",
    recordingId: "rec_1",
  });
  assert.notEqual(first, retried);
});

test("the same transcript ID with a new retranscribeCount changes section identity", () => {
  const generationOne = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: "tr_1",
    recordingId: "rec_1",
    retranscribeCount: 1,
  });
  const generationTwo = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: "tr_1",
    recordingId: "rec_1",
    retranscribeCount: 2,
  });
  assert.equal(generationOne, "rec_1:tr_1:g1");
  assert.equal(generationTwo, "rec_1:tr_1:g2");
  assert.notEqual(generationOne, generationTwo);
});
