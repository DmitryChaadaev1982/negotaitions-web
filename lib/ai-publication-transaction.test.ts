import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_PUBLICATION_TRANSACTION_ATTEMPTS,
  retryAiPublicationTransaction,
} from "@/lib/ai-publication-transaction";

test("Publish/Unshare serialization conflicts are retried once with fresh work", async () => {
  let calls = 0;
  const result = await retryAiPublicationTransaction(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("Code: `40001` could not serialize access due to read/write dependencies");
    }
    return "serialized";
  });

  assert.equal(result, "serialized");
  assert.equal(calls, AI_PUBLICATION_TRANSACTION_ATTEMPTS);
});

test("publication retry remains bounded for repeated serialization conflicts", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      retryAiPublicationTransaction(async () => {
        calls += 1;
        throw new Error("Code: `40001` could not serialize access due to read/write dependencies");
      }),
  );
  assert.equal(calls, AI_PUBLICATION_TRANSACTION_ATTEMPTS);
});
