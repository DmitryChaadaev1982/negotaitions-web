import assert from "node:assert/strict";
import test from "node:test";

import { resolveSourceRecordingExtension } from "@/lib/transcription/source-recording-extension";

test("resolveSourceRecordingExtension prefers recording.fileName extension", () => {
  assert.equal(
    resolveSourceRecordingExtension({
      fileName: "capture.webm",
      fileKey: "sessions/a/source.flac",
      mimeType: "audio/flac",
    }),
    ".webm",
  );
});

test("resolveSourceRecordingExtension falls back to fileKey extension", () => {
  assert.equal(
    resolveSourceRecordingExtension({
      fileName: null,
      fileKey: "sessions/a/source.flac",
      mimeType: null,
    }),
    ".flac",
  );
});

test("resolveSourceRecordingExtension falls back to mimeType and then safe default", () => {
  assert.equal(
    resolveSourceRecordingExtension({
      fileName: null,
      fileKey: "sessions/a/source",
      mimeType: "audio/ogg",
    }),
    ".ogg",
  );
  assert.equal(
    resolveSourceRecordingExtension({
      fileName: null,
      fileKey: "sessions/a/source",
      mimeType: null,
    }),
    ".wav",
  );
});
