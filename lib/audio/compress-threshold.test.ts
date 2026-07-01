import test from "node:test";
import assert from "node:assert/strict";

import { shouldReuseOriginalAudioForTranscription } from "@/lib/audio/transcription-file-selection";
import {
  getAudioTranscriptionChannels,
  getAudioTranscriptionMaxFileBytes,
  getAudioTranscriptionSampleRate,
  getAudioTranscriptionTargetBitrateKbps,
} from "@/lib/audio/config";

function withEnv(
  entries: Record<string, string | undefined>,
  run: () => void,
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(entries)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("small compatible source is reused without recompression", () => {
  withEnv({ AUDIO_TRANSCRIPTION_MAX_FILE_MB: "24" }, () => {
    const result = shouldReuseOriginalAudioForTranscription(
      392 * 1024,
      "recording.webm",
      getAudioTranscriptionMaxFileBytes(),
    );
    assert.equal(result.isUnderCompressionThreshold, true);
    assert.equal(result.isContainerCompatible, true);
    assert.equal(result.shouldReuseOriginal, true);
  });
});

test("large source above threshold keeps compression/transcode path", () => {
  withEnv({ AUDIO_TRANSCRIPTION_MAX_FILE_MB: "24" }, () => {
    const result = shouldReuseOriginalAudioForTranscription(
      25 * 1024 * 1024,
      "recording.webm",
      getAudioTranscriptionMaxFileBytes(),
    );
    assert.equal(result.isUnderCompressionThreshold, false);
    assert.equal(result.isContainerCompatible, true);
    assert.equal(result.shouldReuseOriginal, false);
  });
});

test("incompatible source format is not reused even when small", () => {
  withEnv({ AUDIO_TRANSCRIPTION_MAX_FILE_MB: "24" }, () => {
    const result = shouldReuseOriginalAudioForTranscription(
      300 * 1024,
      "recording.m4a",
      getAudioTranscriptionMaxFileBytes(),
    );
    assert.equal(result.isUnderCompressionThreshold, true);
    assert.equal(result.isContainerCompatible, false);
    assert.equal(result.shouldReuseOriginal, false);
  });
});

test("existing transcription env vars keep their meaning", () => {
  withEnv(
    {
      AUDIO_TRANSCRIPTION_TARGET_BITRATE_KBPS: "96",
      AUDIO_TRANSCRIPTION_SAMPLE_RATE: "48000",
      AUDIO_TRANSCRIPTION_CHANNELS: "1",
      AUDIO_TRANSCRIPTION_MAX_FILE_MB: "24",
    },
    () => {
      assert.equal(getAudioTranscriptionTargetBitrateKbps(), 96);
      assert.equal(getAudioTranscriptionSampleRate(), 48000);
      assert.equal(getAudioTranscriptionChannels(), 1);
      assert.equal(getAudioTranscriptionMaxFileBytes(), 24 * 1024 * 1024);
    },
  );
});
