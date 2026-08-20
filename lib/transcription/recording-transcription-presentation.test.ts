import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveRecordingTranscriptionPresentation,
  showRecordingStatusDetail,
  showTranscriptLanguageSelector,
} from "@/lib/transcription/recording-transcription-presentation";

test("room sidebar uses the quick presentation", () => {
  assert.equal(
    resolveRecordingTranscriptionPresentation("roomSidebar"),
    "roomQuick",
  );
});

test("materials page uses the detailed presentation", () => {
  assert.equal(
    resolveRecordingTranscriptionPresentation("materialsPage"),
    "materialsDetail",
  );
});

test("room quick view hides recording status detail and language selector", () => {
  assert.equal(showRecordingStatusDetail("roomQuick"), false);
  assert.equal(showTranscriptLanguageSelector("roomQuick"), false);
});

test("materials detailed view keeps recording status detail and language selector", () => {
  assert.equal(showRecordingStatusDetail("materialsDetail"), true);
  assert.equal(showTranscriptLanguageSelector("materialsDetail"), true);
});
