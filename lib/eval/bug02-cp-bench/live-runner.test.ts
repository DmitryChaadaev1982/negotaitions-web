import assert from "node:assert/strict";
import test from "node:test";

import { extractProviderUsage, withEnv } from "./live-runner";

test("extractProviderUsage reads Yandex-style usage without requiring transcript text", () => {
  assert.deepEqual(
    extractProviderUsage({
      usage: { input_text_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
    { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
  );
  assert.deepEqual(extractProviderUsage({ status: "completed" }), {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  });
});

test("withEnv restores previous values", async () => {
  delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS;
  await withEnv({ TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS: "1800" }, async () => {
    assert.equal(process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS, "1800");
  });
  assert.equal(process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS, undefined);
});
