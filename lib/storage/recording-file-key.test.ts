import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRecordingFileKey } from "@/lib/storage/recording-file-key";

test("collapses duplicated negotiation-room/audio prefix", () => {
  const input =
    "negotiation-room/audio/negotiation-room/audio/example.flac";
  const result = normalizeRecordingFileKey(input);

  assert.equal(result.normalizedKey, "negotiation-room/audio/example.flac");
  assert.equal(result.hadDuplicatePrefix, true);
  assert.equal(result.containsRawUrl, false);
  assert.equal(result.containsEncodedUrl, false);
});

test("flags raw provider URL embedded in key", () => {
  const input = "negotiation-room/audio/https://www-ru-45-12.voximplant.com/path.flac";
  const result = normalizeRecordingFileKey(input);

  assert.equal(result.containsRawUrl, true);
});

test("flags encoded provider URL-like segment", () => {
  const encoded = Buffer.from(
    "https://www-ru-45-12.voximplant.com:8443/securerecords/file.flac",
    "utf8",
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  const input = `negotiation-room/audio/${encoded}.flac`;
  const result = normalizeRecordingFileKey(input);

  assert.equal(result.containsEncodedUrl, true);
  assert.match(result.decodedUrlHost ?? "", /voximplant\.com/i);
});

test("keeps normal key unchanged", () => {
  const input = "voximplant/audio/2026/07/05/recording.flac";
  const result = normalizeRecordingFileKey(input);

  assert.equal(result.normalizedKey, input);
  assert.equal(result.hadDuplicatePrefix, false);
  assert.equal(result.containsRawUrl, false);
  assert.equal(result.containsEncodedUrl, false);
});
