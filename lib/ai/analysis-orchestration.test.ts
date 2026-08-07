import assert from "node:assert/strict";
import test from "node:test";

import { executeOwnedAnalysis } from "@/lib/ai/analysis-orchestration";

test("provider failure terminalizes durably before logging failure", async () => {
  const events: string[] = [];
  const providerError = new Error("synthetic provider failure");

  const result = await executeOwnedAnalysis({
    run: async () => {
      events.push("provider");
      throw providerError;
    },
    complete: async () => {
      events.push("complete");
      return true;
    },
    fail: async () => {
      events.push("durable-fail");
      return true;
    },
    classifyFailure: (error) => ({
      errorClass: "NETWORK_ERROR",
      userMessage: "Synthetic safe message.",
      originalError: error,
    }),
    isOwnershipLost: () => false,
    observeFailure: async () => {
      events.push("external-log");
      throw new Error("synthetic logging failure");
    },
  });

  assert.equal(result.state, "failed");
  assert.deepEqual(events, ["provider", "durable-fail", "external-log"]);
  assert.equal(
    result.state === "failed" && result.failure.originalError,
    providerError,
  );
});

test("success instrumentation cannot convert durable success to failure", async () => {
  const events: string[] = [];
  const result = await executeOwnedAnalysis({
    run: async () => {
      events.push("provider");
      return "valid-result";
    },
    complete: async () => {
      events.push("durable-complete");
      return true;
    },
    fail: async () => {
      events.push("durable-fail");
      return true;
    },
    classifyFailure: (error) => ({
      errorClass: "INTERNAL_ERROR",
      userMessage: "Synthetic safe message.",
      originalError: error,
    }),
    isOwnershipLost: () => false,
    observeSuccess: async () => {
      events.push("success-log");
      throw new Error("synthetic logging failure");
    },
  });

  assert.deepEqual(result, { state: "completed", value: "valid-result" });
  assert.deepEqual(events, ["provider", "durable-complete", "success-log"]);
});

test("stale owner terminalization rejection becomes ownership_lost", async () => {
  let failureWrites = 0;
  const result = await executeOwnedAnalysis({
    run: async () => "valid-result",
    complete: async () => false,
    fail: async () => {
      failureWrites += 1;
      return false;
    },
    classifyFailure: (error) => ({
      errorClass: "INTERNAL_ERROR",
      userMessage: "Synthetic safe message.",
      originalError: error,
    }),
    isOwnershipLost: () => false,
  });

  assert.deepEqual(result, { state: "ownership_lost" });
  assert.equal(failureWrites, 0);
});

test("provider callback runs outside database transaction scope", async () => {
  let transactionOpen = false;
  const result = await executeOwnedAnalysis({
    run: async () => {
      assert.equal(transactionOpen, false);
      return "valid-result";
    },
    complete: async () => {
      assert.equal(transactionOpen, false);
      transactionOpen = true;
      transactionOpen = false;
      return true;
    },
    fail: async () => true,
    classifyFailure: (error) => ({
      errorClass: "INTERNAL_ERROR",
      userMessage: "Synthetic safe message.",
      originalError: error,
    }),
    isOwnershipLost: () => false,
  });

  assert.equal(result.state, "completed");
});

test("ownership-loss exception aborts without terminal or logging writes", async () => {
  const events: string[] = [];
  const ownershipError = new Error("ownership lost");
  const result = await executeOwnedAnalysis({
    run: async () => {
      throw ownershipError;
    },
    complete: async () => {
      events.push("complete");
      return true;
    },
    fail: async () => {
      events.push("fail");
      return true;
    },
    classifyFailure: (error) => ({
      errorClass: "OWNERSHIP_LOST",
      userMessage: "Ownership changed.",
      originalError: error,
    }),
    isOwnershipLost: (error) => error === ownershipError,
    observeFailure: () => {
      events.push("log");
    },
  });

  assert.deepEqual(result, { state: "ownership_lost" });
  assert.deepEqual(events, []);
});
