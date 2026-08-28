import assert from "node:assert/strict";
import test from "node:test";

import {
  SOURCE_RECORDING_NOT_AVAILABLE_CODE,
  isSourceRecordingNotAvailableError,
  isUnsafeRecordingFileKeyError,
} from "@/lib/services/source-recording-not-available";
import {
  preloadRecordingSource,
  resolveTranscriptionRecordingSource,
} from "@/lib/services/source-recording-preload";

test("preload downloads the normalized fileKey and performs no extra GETs", async () => {
  let downloads = 0;
  const buffer = Buffer.from("audio-bytes");
  const result = await preloadRecordingSource({
    fileKey: "voximplant/audio/session/file.mp4",
    download: async (fileKey) => {
      downloads += 1;
      assert.equal(fileKey, "voximplant/audio/session/file.mp4");
      return buffer;
    },
  });
  assert.equal(result.fileKey, "voximplant/audio/session/file.mp4");
  assert.equal(result.buffer, buffer);
  assert.equal(downloads, 1);
});

test("preload maps GET NoSuchKey to SOURCE_RECORDING_NOT_AVAILABLE", async () => {
  await assert.rejects(
    () =>
      preloadRecordingSource({
        fileKey: "voximplant/audio/missing.mp4",
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
});

test("preload does not classify timeout as source unavailable", async () => {
  await assert.rejects(
    () =>
      preloadRecordingSource({
        fileKey: "voximplant/audio/file.mp4",
        download: async () => {
          throw Object.assign(new Error("Request timed out"), {
            name: "TimeoutError",
          });
        },
      }),
    (error: unknown) => {
      assert.equal(isSourceRecordingNotAvailableError(error), false);
      assert.equal(error instanceof Error && error.message, "Request timed out");
      return true;
    },
  );
});

test("preload rejects raw URL keys without downloading", async () => {
  let downloads = 0;
  await assert.rejects(
    () =>
      preloadRecordingSource({
        fileKey: "negotiation-room/audio/https://vox.example/file.flac",
        download: async () => {
          downloads += 1;
          return Buffer.from("nope");
        },
      }),
    (error: unknown) => isUnsafeRecordingFileKeyError(error),
  );
  assert.equal(downloads, 0);
});

test("resolveTranscriptionRecordingSource reuses a preloaded buffer without loading", async () => {
  const preloaded = {
    fileKey: "voximplant/audio/file.mp4",
    buffer: Buffer.from("preloaded"),
  };
  let loads = 0;
  const resolved = await resolveTranscriptionRecordingSource({
    recordingFileKey: "voximplant/audio/file.mp4",
    preloaded,
    load: async () => {
      loads += 1;
      return { fileKey: "other", buffer: Buffer.from("other") };
    },
  });
  assert.equal(resolved.reusedPreloaded, true);
  assert.equal(resolved.source, preloaded);
  assert.equal(loads, 0);
});
