import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFailedRetranscriptionRestoreData,
  buildRetranscriptionUpsertData,
  shouldRestoreArchivedTranscript,
} from "@/lib/services/retranscription-safety";

test("queued retranscription keeps previous transcript text", () => {
  const now = new Date("2026-07-13T12:00:00.000Z");
  const previousMetadata = {
    transcriptionProvider: "yandex_speechkit",
    transcriptionProcessingTimings: { totalMs: 3210 },
    rawProviderSnapshot: { requestId: "req-1" },
    transcriptEnhancement: {
      status: "COMPLETED",
      inputIdentity: "old-identity",
      triggerSource: "automatic_initial_transcription",
    },
    diagnostics: {
      pauseProcessing: {
        mode: "source_audio_cut",
        ffmpeg: { version: "6.0" },
      },
    },
  };
  const upsert = buildRetranscriptionUpsertData({
    sessionId: "session-1",
    recordingId: "rec-1",
    language: "auto",
    newVersion: 4,
    history: [],
    now,
    existingTranscript: {
      status: "COMPLETED",
      text: "previous successful transcript",
      diarizedText: "previous diarized transcript",
      language: "ru",
      transcriptionModel: "general:rc",
      hasSpeakerDiarization: true,
      diarizationStatus: "COMPLETED",
      speakerMapping: { speaker_1: "participant_1" },
      speakerMappingStatus: "CONFIRMED",
      completedAt: new Date("2026-07-13T11:59:00.000Z"),
      processingMetadata: previousMetadata,
    },
  });

  assert.equal(upsert.create.text, "previous successful transcript");
  assert.equal(upsert.create.diarizedText, "previous diarized transcript");
  assert.deepEqual(upsert.create.processingMetadata, previousMetadata);
  assert.equal(upsert.update.status, "QUEUED");
  assert.equal("processingMetadata" in upsert.update, false);
  assert.equal("speakerMapping" in upsert.update, false);
  assert.equal("diarizationStatus" in upsert.update, false);
  assert.equal("language" in upsert.update, false);
});

test("failed retranscription requests restoration of archived transcript", () => {
  assert.equal(
    shouldRestoreArchivedTranscript({
      runFailed: true,
      archiveStatus: "COMPLETED",
      archiveText: "archived transcript",
    }),
    true,
  );

  assert.equal(
    shouldRestoreArchivedTranscript({
      runFailed: false,
      archiveStatus: "COMPLETED",
      archiveText: "archived transcript",
    }),
    false,
  );
});

test("failed retranscription restore data keeps previous processing metadata exactly", () => {
  const previousMetadata = {
    transcriptionProvider: "yandex_speechkit",
    rawProviderSnapshot: {
      requestId: "snapshot-42",
      chunks: [{ id: "chunk-1", latencyMs: 1200 }],
    },
    transcriptionProcessingTimings: {
      downloadMs: 400,
      transcribeMs: 2600,
      totalMs: 3000,
    },
    transcriptEnhancement: {
      status: "COMPLETED",
      inputIdentity: "identity-old",
      model: "deepseek-v4-flash",
    },
    nestedDiagnostics: {
      pauseMap: {
        intervals: [{ startMs: 100, endMs: 400 }],
      },
    },
  };

  const restoreData = buildFailedRetranscriptionRestoreData({
    archiveEntry: {
      status: "COMPLETED",
      text: "previous successful transcript",
      diarizedText: "previous diarized transcript",
      language: "ru",
      transcriptionModel: "general:rc",
      hasSpeakerDiarization: true,
      diarizationStatus: "COMPLETED",
      speakerMapping: { speaker_1: "participant_1" },
      speakerMappingStatus: "CONFIRMED",
      completedAt: new Date("2026-07-13T11:58:00.000Z"),
      processingMetadata: previousMetadata,
    },
  });

  assert.equal(restoreData.status, "COMPLETED");
  assert.equal(restoreData.text, "previous successful transcript");
  assert.equal(restoreData.diarizedText, "previous diarized transcript");
  assert.equal(restoreData.errorMessage, null);
  assert.deepEqual(restoreData.processingMetadata, previousMetadata);
  assert.deepEqual(restoreData.speakerMapping, { speaker_1: "participant_1" });
});
