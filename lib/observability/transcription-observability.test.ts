import test from "node:test";
import assert from "node:assert/strict";

import {
  computeTranscriptQualityReport,
  sanitizeRawProviderSnapshot,
} from "@/lib/observability/transcription-observability";
import type { NormalizedSegment } from "@/lib/transcription/speaker-labels";

function segment(overrides: Partial<NormalizedSegment>): NormalizedSegment {
  return {
    speakerLabel: null,
    displaySpeakerLabel: null,
    startSeconds: 0,
    endSeconds: 1,
    text: "hello world",
    orderIndex: 0,
    ...overrides,
  };
}

test("quality report flags low sample rate and mono source", () => {
  const report = computeTranscriptQualityReport({
    segments: [segment({ text: "a full sentence here", speakerLabel: "speaker_1" })],
    text: "a full sentence here with enough characters to pass",
    durationSeconds: 60,
    sourceSampleRate: 8000,
    sourceChannels: 1,
    hasRawProviderSnapshot: true,
    hasSpeakerActivity: true,
  });

  assert.ok(report.warnings.includes("low_sample_rate"));
  assert.ok(report.warnings.includes("mono_source"));
  assert.equal(report.speakerCount, 1);
});

test("quality report flags missing snapshot, activity and short transcript", () => {
  const report = computeTranscriptQualityReport({
    segments: [segment({ text: "hi" })],
    text: "hi",
    durationSeconds: null,
    sourceSampleRate: 48000,
    sourceChannels: 2,
    hasRawProviderSnapshot: false,
    hasSpeakerActivity: false,
  });

  assert.ok(report.warnings.includes("no_raw_provider_snapshot"));
  assert.ok(report.warnings.includes("no_speaker_activity"));
  assert.ok(report.warnings.includes("suspiciously_short_transcript"));
  assert.ok(!report.warnings.includes("low_sample_rate"));
  assert.ok(!report.warnings.includes("mono_source"));
});

test("quality report computes average confidence and low_confidence warning", () => {
  const report = computeTranscriptQualityReport({
    segments: [
      segment({ text: "one two three four", confidence: 0.2 }),
      segment({ text: "five six seven eight", confidence: 0.3, orderIndex: 1 }),
    ],
    text: "one two three four five six seven eight nine ten eleven twelve",
    durationSeconds: 120,
    sourceSampleRate: 48000,
    sourceChannels: 2,
    hasRawProviderSnapshot: true,
    hasSpeakerActivity: true,
  });

  assert.ok(report.averageConfidence !== null && report.averageConfidence < 0.6);
  assert.ok(report.warnings.includes("low_confidence"));
  assert.equal(report.lowConfidenceSegments, 2);
});

test("empty/near-empty segments are counted", () => {
  const report = computeTranscriptQualityReport({
    segments: [
      segment({ text: "" }),
      segment({ text: " ", orderIndex: 1 }),
      segment({ text: "real content here", orderIndex: 2 }),
    ],
    text: "real content here that is long enough to avoid short warning flag",
    durationSeconds: 30,
    sourceSampleRate: 48000,
    sourceChannels: 2,
    hasRawProviderSnapshot: true,
    hasSpeakerActivity: true,
  });

  assert.equal(report.emptySegments, 2);
  assert.equal(report.totalSegments, 3);
});

test("sanitizeRawProviderSnapshot returns null for null/undefined", () => {
  assert.equal(sanitizeRawProviderSnapshot(null), null);
  assert.equal(sanitizeRawProviderSnapshot(undefined), null);
});

test("sanitizeRawProviderSnapshot strips secret/audio keys", () => {
  const result = sanitizeRawProviderSnapshot({
    text: "recognized",
    content: "BASE64AUDIODATA",
    authorization: "Bearer secret",
    nested: { token: "abc", apiKey: "xyz", ok: "keep" },
  });

  assert.ok(result);
  const snapshot = result.snapshot as Record<string, unknown>;
  assert.equal(snapshot.text, "recognized");
  assert.equal(snapshot.content, "[STRIPPED]");
  assert.equal(snapshot.authorization, "[STRIPPED]");
  const nested = snapshot.nested as Record<string, unknown>;
  assert.equal(nested.token, "[STRIPPED]");
  assert.equal(nested.apiKey, "[STRIPPED]");
  assert.equal(nested.ok, "keep");
  assert.equal(result.truncated, false);
});

test("sanitizeRawProviderSnapshot strips signed URLs by key and by value", () => {
  const result = sanitizeRawProviderSnapshot({
    uri: "https://storage.example.com/audio.flac?X-Amz-Signature=abc123",
    metadata: {
      audioUrl: "https://s3.example.com/a.flac",
      link: "https://cdn.example.com/x?signature=deadbeef&expires=1",
      plain: "just some recognized text",
    },
  });

  assert.ok(result);
  const snapshot = result.snapshot as Record<string, unknown>;
  assert.equal(snapshot.uri, "[STRIPPED]");
  const metadata = snapshot.metadata as Record<string, unknown>;
  assert.equal(metadata.audioUrl, "[STRIPPED]");
  assert.equal(metadata.link, "[STRIPPED_URL]");
  assert.equal(metadata.plain, "just some recognized text");
});

test("sanitizeRawProviderSnapshot truncates oversized payloads", () => {
  // Many short strings (each < 4000 chars so they are not individually
  // truncated) that together exceed the 256 KB snapshot cap.
  const big = {
    chunks: Array.from({ length: 400 }, () => "y".repeat(1000)),
  };
  const result = sanitizeRawProviderSnapshot(big);
  assert.ok(result);
  assert.equal(result.truncated, true);
  assert.ok(result.sizeBytes > 256 * 1024);
});
