import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { canOfferRetranscribe } from "@/lib/materials-status-readiness";
import {
  SOURCE_RECORDING_NOT_AVAILABLE_CODE,
  isSourceRecordingNotAvailableError,
} from "@/lib/services/source-recording-not-available";
import { preloadRecordingSource } from "@/lib/services/source-recording-preload";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

test("S324A-RT-07 initial transcription source absence does not rewrite Recording COMPLETED", async () => {
  const runnerSource = readFileSync(
    join(ROOT, "lib/services/transcription-runner.ts"),
    "utf8",
  );
  assert.doesNotMatch(runnerSource, /RecordingStatus\.FAILED/);
  assert.doesNotMatch(runnerSource, /status: RecordingStatus\.FAILED/);
  assert.match(runnerSource, /failTranscript/);
  assert.match(runnerSource, /resolveTranscriptionRecordingSource/);

  const recording = {
    status: RecordingStatus.COMPLETED,
    fileKey: "voximplant/audio/session/file.mp4",
    errorMessage: null,
  };

  await assert.rejects(
    () =>
      preloadRecordingSource({
        fileKey: recording.fileKey,
        download: async () => {
          throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        },
      }),
    (error: unknown) => {
      assert.equal(isSourceRecordingNotAvailableError(error), true);
      assert.equal(
        (error as { code: string }).code,
        SOURCE_RECORDING_NOT_AVAILABLE_CODE,
      );
      return true;
    },
  );

  assert.equal(recording.status, RecordingStatus.COMPLETED);
  assert.equal(recording.fileKey, "voximplant/audio/session/file.mp4");
  assert.equal(recording.errorMessage, null);
});

test("canOfferRetranscribe stays true when storage overlay says the object is gone", () => {
  assert.equal(
    canOfferRetranscribe({
      canRunTranscription: true,
      hasRunningTranscription: false,
      transcriptCompleted: true,
      recordingLifecycleReady: true,
      hasFileKey: true,
    }),
    true,
  );
});
