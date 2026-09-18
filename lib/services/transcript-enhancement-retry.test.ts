import assert from "node:assert/strict";
import test from "node:test";

import {
  getProviderPostAttemptBudget,
  isRetryableProviderCategory,
  MAX_PROVIDER_POST_ATTEMPTS_PER_CHUNK,
  MAX_PROVIDER_RETRY_AFTER_MS,
  parseRetryAfterMs,
  resolveAttemptFlavor,
  resolveChunkAttemptPlan,
  resolveChunkStatusAfterAttempt,
  resolveRetryDelayMs,
  retryBackoffMs,
} from "@/lib/services/transcript-enhancement-retry";

const NOW = Date.parse("2026-09-16T10:00:00.000Z");

test("RETRY-AFTER delta-seconds is parsed into milliseconds", () => {
  assert.equal(parseRetryAfterMs("5", NOW), 5_000);
  assert.equal(parseRetryAfterMs(" 12 ", NOW), 12_000);
  assert.equal(parseRetryAfterMs("0", NOW), 0);
});

test("RETRY-AFTER HTTP-date is parsed relative to now and clamped at zero", () => {
  assert.equal(parseRetryAfterMs("Wed, 16 Sep 2026 10:00:12 GMT", NOW), 12_000);
  assert.equal(parseRetryAfterMs("Wed, 16 Sep 2026 09:59:00 GMT", NOW), 0);
});

test("RETRY-AFTER malformed or missing values fall back to normal backoff", () => {
  assert.equal(parseRetryAfterMs(undefined, NOW), null);
  assert.equal(parseRetryAfterMs(null, NOW), null);
  assert.equal(parseRetryAfterMs("", NOW), null);
  assert.equal(parseRetryAfterMs("soon", NOW), null);
  assert.equal(parseRetryAfterMs("-5", NOW), null);
  assert.equal(resolveRetryDelayMs({ backoffMs: 400, retryAfterMs: null }), 400);
});

test("RETRY-AFTER provider-requested delay is capped", () => {
  assert.equal(parseRetryAfterMs("600", NOW), MAX_PROVIDER_RETRY_AFTER_MS);
  assert.equal(
    parseRetryAfterMs("Wed, 16 Sep 2026 10:05:00 GMT", NOW),
    MAX_PROVIDER_RETRY_AFTER_MS,
  );
  assert.equal(
    resolveRetryDelayMs({ backoffMs: 250, retryAfterMs: 120_000 }),
    MAX_PROVIDER_RETRY_AFTER_MS,
  );
});

test("retry delay is never shorter than normal backoff", () => {
  assert.equal(resolveRetryDelayMs({ backoffMs: 6_000, retryAfterMs: 1_000 }), 6_000);
  assert.equal(resolveRetryDelayMs({ backoffMs: 250, retryAfterMs: 5_000 }), 5_000);
  assert.equal(retryBackoffMs(1, () => 0), 250);
  assert.equal(retryBackoffMs(2, () => 0), 500);
  assert.ok(retryBackoffMs(9, () => 0.99) <= 8_000);
});

test("POST attempt budget can be lowered but never widened past two", () => {
  assert.equal(MAX_PROVIDER_POST_ATTEMPTS_PER_CHUNK, 2);
  const previous = process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES;
  try {
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES = "3";
    assert.equal(getProviderPostAttemptBudget(), 2);
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES = "1";
    assert.equal(getProviderPostAttemptBudget(), 2);
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES = "0";
    assert.equal(getProviderPostAttemptBudget(), 1);
    delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES;
    assert.equal(getProviderPostAttemptBudget(), 2);
  } finally {
    if (previous === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES;
    else process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES = previous;
  }
});

test("retry classification keeps hard validation failures terminal", () => {
  assert.equal(isRetryableProviderCategory("provider_rate_limit"), true);
  assert.equal(isRetryableProviderCategory("provider_http_5xx"), true);
  assert.equal(isRetryableProviderCategory("timeout"), true);
  assert.equal(isRetryableProviderCategory("network"), true);
  assert.equal(isRetryableProviderCategory("empty_output"), true);
  assert.equal(isRetryableProviderCategory("malformed_output"), true);
  assert.equal(isRetryableProviderCategory("catastrophic_shrinkage"), false);
  assert.equal(isRetryableProviderCategory("unknown_segment_id"), false);
  assert.equal(isRetryableProviderCategory("duplicate_segment_id"), false);
  assert.equal(isRetryableProviderCategory(null), false);
});

test("attempt 2 uses strict JSON only for output-shape failures", () => {
  assert.equal(resolveAttemptFlavor("empty_output"), "strict_json");
  assert.equal(resolveAttemptFlavor("malformed_output"), "strict_json");
  assert.equal(resolveAttemptFlavor("missing_segment_id"), "strict_json");
  assert.equal(resolveAttemptFlavor("provider_rate_limit"), "same_request");
  assert.equal(resolveAttemptFlavor("provider_http_5xx"), "same_request");
  assert.equal(resolveAttemptFlavor("timeout"), "same_request");
  assert.equal(resolveAttemptFlavor("network"), "same_request");
  assert.equal(resolveAttemptFlavor(null), "same_request");
});

test("attempt plan is derived from the durable ledger only", () => {
  const plan = resolveChunkAttemptPlan({
    chunks: [
      { chunkIndex: 0, status: "COMPLETED", attemptCount: 1, lastErrorClass: null },
      { chunkIndex: 1, status: "PENDING", attemptCount: 0, lastErrorClass: null },
      {
        chunkIndex: 2,
        status: "RETRYABLE_FAILED",
        attemptCount: 1,
        lastErrorClass: "provider_rate_limit",
      },
      {
        chunkIndex: 3,
        status: "RETRYABLE_FAILED",
        attemptCount: 2,
        lastErrorClass: "provider_rate_limit",
      },
      { chunkIndex: 4, status: "FAILED", attemptCount: 1, lastErrorClass: "catastrophic_shrinkage" },
      { chunkIndex: 5, status: "RUNNING", attemptCount: 1, lastErrorClass: "empty_output" },
    ],
    budget: 2,
  });
  assert.deepEqual(
    plan.map((decision) => [decision.chunkIndex, decision.attemptNumber, decision.flavor]),
    [
      [1, 1, "same_request"],
      [2, 2, "same_request"],
      [5, 2, "strict_json"],
    ],
  );
});

test("recovery never manufactures a third POST after a crash", () => {
  const exhausted = resolveChunkAttemptPlan({
    chunks: [
      { chunkIndex: 0, status: "RUNNING", attemptCount: 2, lastErrorClass: null },
      { chunkIndex: 1, status: "RETRYABLE_FAILED", attemptCount: 2, lastErrorClass: "timeout" },
    ],
    budget: 2,
  });
  assert.deepEqual(exhausted, []);
});

test("durable status after an attempt honours the remaining budget", () => {
  assert.equal(
    resolveChunkStatusAfterAttempt({
      providerCompleted: true,
      retryable: false,
      attemptNumber: 1,
      budget: 2,
    }),
    "COMPLETED",
  );
  assert.equal(
    resolveChunkStatusAfterAttempt({
      providerCompleted: false,
      retryable: true,
      attemptNumber: 1,
      budget: 2,
    }),
    "RETRYABLE_FAILED",
  );
  assert.equal(
    resolveChunkStatusAfterAttempt({
      providerCompleted: false,
      retryable: true,
      attemptNumber: 2,
      budget: 2,
    }),
    "FAILED",
  );
  assert.equal(
    resolveChunkStatusAfterAttempt({
      providerCompleted: false,
      retryable: false,
      attemptNumber: 1,
      budget: 2,
    }),
    "FAILED",
  );
});
