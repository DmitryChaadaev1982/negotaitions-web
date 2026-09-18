import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNotProductionRuntime,
  frozenEnhancementEnv,
  LargeRealisticUatSafetyError,
  readFrozenEnhancementSelection,
} from "./large-realistic-uat-safety";

test("refuses NODE_ENV=production and production hosts", () => {
  assert.throws(
    () => assertNotProductionRuntime({ NODE_ENV: "production" }),
    LargeRealisticUatSafetyError,
  );
  assert.throws(
    () =>
      assertNotProductionRuntime({
        NODE_ENV: "development",
        APP_URL: "https://negotaitions.ru",
      }),
    /production application host/,
  );
  assert.doesNotThrow(() =>
    assertNotProductionRuntime({
      NODE_ENV: "development",
      APP_URL: "http://127.0.0.1:3101",
    }),
  );
});

test("frozen enhancement env is 1800 / 8 / 10 / reserved_slot", () => {
  const frozen = frozenEnhancementEnv();
  const selected = readFrozenEnhancementSelection(frozen);
  assert.equal(selected.chunkMaxChars, 1800);
  assert.equal(selected.perJobConcurrency, 8);
  assert.equal(selected.globalConcurrency, 10);
  assert.equal(selected.fairness, "reserved_slot");
  assert.equal(selected.matchesFrozen, true);
  assert.equal(frozen.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED, "true");
});
