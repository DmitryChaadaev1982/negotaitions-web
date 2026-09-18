import assert from "node:assert/strict";
import test from "node:test";

import { getProviderSlotPerJobCap } from "@/lib/services/transcript-enhancement-provider-slots";
import {
  isTranscriptEnhancementAutoRunEnabled,
  isTranscriptEnhancementAutoTriggerEnabled,
  isYandexTranscriptEnhancementEnabled,
  getTranscriptEnhancementChunkMaxChars,
  getTranscriptEnhancementChunkMaxSegments,
  getTranscriptEnhancementOutputMode,
  getTranscriptEnhancementChunkTimeoutMs,
  getTranscriptEnhancementMaxConcurrency,
  getTranscriptEnhancementGlobalConcurrency,
  TRANSCRIPT_ENHANCEMENT_HARD_PER_JOB_CONCURRENCY,
  TRANSCRIPT_ENHANCEMENT_HARD_GLOBAL_CONCURRENCY,
  getTranscriptEnhancementFairnessPolicy,
  getTranscriptEnhancementMaxRetries,
  getTranscriptEnhancementMode,
  getTranscriptEnhancementTimeoutMs,
  DEFAULT_TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS,
  getYandexTranscriptEnhancementFallbackModel,
} from "@/lib/env";

test("TRANSCRIPT_ENHANCEMENT_MODE defaults to chunked", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_MODE;
  delete process.env.TRANSCRIPT_ENHANCEMENT_MODE;
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

test("TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE defaults to json_schema", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE;
  delete process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE;
  try {
    assert.equal(getTranscriptEnhancementOutputMode(), "json_schema");
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE = previous;
    }
  }
});

test("TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE accepts legacy and json_schema", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE;
  try {
    process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE = "legacy";
    assert.equal(getTranscriptEnhancementOutputMode(), "legacy");
    process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE = "json_schema";
    assert.equal(getTranscriptEnhancementOutputMode(), "json_schema");
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE = previous;
    }
  }
});

test("TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE invalid value falls back to json_schema", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE;
  process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE = "bad-value";
  try {
    assert.equal(getTranscriptEnhancementOutputMode(), "json_schema");
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE = previous;
    }
  }
});

test("frozen B02-1 operating point defaults are 1800/8/10/reserved_slot", () => {
  const previous = {
    chars: process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS,
    concurrency: process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY,
    global: process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY,
    fairness: process.env.TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY,
  };
  delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS;
  delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
  delete process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY;
  delete process.env.TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY;
  try {
    assert.equal(getTranscriptEnhancementChunkMaxChars(), 1800);
    assert.equal(getTranscriptEnhancementMaxConcurrency(), 8);
    assert.equal(getTranscriptEnhancementGlobalConcurrency(), 10);
    assert.equal(getTranscriptEnhancementFairnessPolicy(), "reserved_slot");
  } finally {
    if (previous.chars === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS;
    else process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS = previous.chars;
    if (previous.concurrency === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
    else process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = previous.concurrency;
    if (previous.global === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY;
    else process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY = previous.global;
    if (previous.fairness === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY;
    else process.env.TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY = previous.fairness;
  }
});

test("CAP-01/02/03 configured per-job above 8 is hard-clamped to 8", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
  try {
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = "9";
    assert.equal(getTranscriptEnhancementMaxConcurrency(), 8);
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = "10";
    assert.equal(getTranscriptEnhancementMaxConcurrency(), 8);
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = "100";
    assert.equal(getTranscriptEnhancementMaxConcurrency(), TRANSCRIPT_ENHANCEMENT_HARD_PER_JOB_CONCURRENCY);
  } finally {
    if (previous === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
    else process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = previous;
  }
});

test("CAP-07 configured lower per-job value is honored", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
  try {
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = "4";
    assert.equal(getTranscriptEnhancementMaxConcurrency(), 4);
    assert.equal(getProviderSlotPerJobCap(), 4);
  } finally {
    if (previous === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
    else process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = previous;
  }
});

test("configured global concurrency cannot exceed the hard cap of 10", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY;
  try {
    process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY = "100";
    assert.equal(getTranscriptEnhancementGlobalConcurrency(), TRANSCRIPT_ENHANCEMENT_HARD_GLOBAL_CONCURRENCY);
  } finally {
    if (previous === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY;
    else process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY = previous;
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
    assert.equal(getTranscriptEnhancementChunkMaxSegments(), 18);
    assert.equal(getTranscriptEnhancementChunkMaxChars(), 1800);
    assert.equal(getTranscriptEnhancementMaxConcurrency(), 8);
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

test("TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS defaults to 7000 and is independent of chunk timeout", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS;
  const previousChunk = process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS;
  delete process.env.TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS;
  process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS = "120000";
  try {
    assert.equal(DEFAULT_TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS, 7000);
    assert.equal(getTranscriptEnhancementTimeoutMs(), 7000);
    process.env.TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS = "2500";
    assert.equal(getTranscriptEnhancementTimeoutMs(), 2500);
  } finally {
    if (previous === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS;
    else process.env.TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS = previous;
    if (previousChunk === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS;
    else process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS = previousChunk;
  }
});

test("TRANSCRIPT_ENHANCEMENT_AUTO_RUN defaults to false", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
  delete process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
  try {
    assert.equal(isTranscriptEnhancementAutoRunEnabled(), false);
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = previous;
    }
  }
});

test("TRANSCRIPT_ENHANCEMENT_AUTO_RUN parses valid true/false values", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
  try {
    process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = "true";
    assert.equal(isTranscriptEnhancementAutoRunEnabled(), true);
    process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = "false";
    assert.equal(isTranscriptEnhancementAutoRunEnabled(), false);
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = previous;
    }
  }
});

test("TRANSCRIPT_ENHANCEMENT_AUTO_RUN invalid value falls back to false", () => {
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
  process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = "not-a-boolean";
  try {
    assert.equal(isTranscriptEnhancementAutoRunEnabled(), false);
  } finally {
    if (previous === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = previous;
    }
  }
});

test("auto trigger requires both enhancement flags", () => {
  const previousAuto = process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
  const previousEnhancement = process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED;
  try {
    process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = "true";
    process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = "false";
    assert.equal(isYandexTranscriptEnhancementEnabled(), false);
    assert.equal(isTranscriptEnhancementAutoTriggerEnabled(), false);

    process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = "true";
    assert.equal(isYandexTranscriptEnhancementEnabled(), true);
    assert.equal(isTranscriptEnhancementAutoTriggerEnabled(), true);
  } finally {
    if (previousAuto === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = previousAuto;
    }
    if (previousEnhancement === undefined) {
      delete process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED;
    } else {
      process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = previousEnhancement;
    }
  }
});
