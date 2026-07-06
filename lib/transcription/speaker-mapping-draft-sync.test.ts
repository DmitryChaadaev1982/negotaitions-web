import assert from "node:assert/strict";
import test from "node:test";

import { shouldSyncSpeakerMappingDraft } from "@/lib/transcription/speaker-mapping-draft-sync";
import { getTranscriptionSectionRefreshKey } from "@/lib/transcription/transcription-section-key";

test("speaker-mapping draft is not overwritten on status refresh while dirty", () => {
  const shouldSync = shouldSyncSpeakerMappingDraft({
    currentTranscriptId: "tr_1",
    nextTranscriptId: "tr_1",
    isDirty: true,
  });

  assert.equal(shouldSync, false);
});

test("speaker-mapping draft is reset when transcript changes", () => {
  const shouldSync = shouldSyncSpeakerMappingDraft({
    currentTranscriptId: "tr_1",
    nextTranscriptId: "tr_2",
    isDirty: true,
  });

  assert.equal(shouldSync, true);
});

test("successful save can force speaker-mapping draft sync", () => {
  const shouldSync = shouldSyncSpeakerMappingDraft({
    currentTranscriptId: "tr_1",
    nextTranscriptId: "tr_1",
    isDirty: true,
    force: true,
  });

  assert.equal(shouldSync, true);
});

test("transcription section key includes mapping-status refresh flags", () => {
  const base = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: null,
    recordingId: null,
    processingStage: "transcribing",
    diarizationStatus: "PENDING",
    speakerMappingRequired: false,
  });

  const afterStatusRefresh = getTranscriptionSectionRefreshKey({
    sessionId: "sess_1",
    transcriptId: null,
    recordingId: null,
    processingStage: "ready",
    diarizationStatus: "COMPLETED",
    speakerMappingRequired: true,
  });

  assert.equal(base, "sess_1:transcribing|PENDING|0");
  assert.equal(afterStatusRefresh, "sess_1:ready|COMPLETED|1");
});
