import assert from "node:assert/strict";
import test from "node:test";

import {
  getTranscriptEnhancementChunkMaxChars,
  getTranscriptEnhancementChunkMaxSegments,
  getTranscriptEnhancementChunkTimeoutMs,
  getTranscriptEnhancementMaxConcurrency,
  getTranscriptEnhancementMaxRetries,
  getTranscriptEnhancementMode,
  getYandexTranscriptEnhancementFallbackModel,
} from "@/lib/env";

test("TRANSCRIPT_ENHANCEMENT_MODE defaults to single", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_MODE;
  delete process.env.TRANSCRIPT_ENHANCEMENT_MODE;
  try {
    assert.equal(getTranscriptEnhancementMode(), "single");
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_MODE;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_MODE = previous;
    }
  }
});

test("TRANSCRIPT_ENHANCEMENT_MODE supports chunked", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_MODE;
  process.env.TRANSCRIPT_ENHANCEMENT_MODE = "chunked";
  try {
    assert.equal(getTranscriptEnhancementMode(), "chunked");
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_MODE;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_MODE = previous;
    }
  }
});

test("chunked enhancement env defaults and clamps are safe", () => {
  const previousSegments = process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS;
  const previousChars = process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS;
  const previousConcurrency = process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
  const previousTimeout = process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS;
  const previousRetries = process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES;
  process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS = "0";
  process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS = "-5";
  process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = "0";
  process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS = "1";
  process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES = "99";
  try {
    assert.equal(getTranscriptEnhancementChunkMaxSegments(), 6);
    assert.equal(getTranscriptEnhancementChunkMaxChars(), 700);
    assert.equal(getTranscriptEnhancementMaxConcurrency(), 4);
    assert.equal(getTranscriptEnhancementChunkTimeoutMs(), 5000);
    assert.equal(getTranscriptEnhancementMaxRetries(), 3);
  } finally {
    if (previousSegments === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS = previousSegments;
    }
    if (previousChars === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS = previousChars;
    }
    if (previousConcurrency === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = previousConcurrency;
    }
    if (previousTimeout === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS = previousTimeout;
    }
    if (previousRetries === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES = previousRetries;
    }
  }
});

test("fallback model env is disabled by default and trimmed when set", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL;
  delete process.env.TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL;
  try {
    assert.equal(getYandexTranscriptEnhancementFallbackModel(), null);
    process.env.TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL = "  yandexgpt-lite/latest  ";
    assert.equal(getYandexTranscriptEnhancementFallbackModel(), "yandexgpt-lite/latest");
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL = previous;
    }
  }
});
