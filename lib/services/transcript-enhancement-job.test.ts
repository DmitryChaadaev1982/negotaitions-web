import assert from "node:assert/strict";
import test from "node:test";

import {
  computeEnhancementProgress,
  deriveEnhancementTerminalQuality,
  failUnfinishedEnhancementChunks,
  reconcileIllegalInFlightIneligibleJob,
  terminalizeEnhancementJob,
  type TranscriptEnhancementDurableChunk,
  type TranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";

function chunk(
  index: number,
  status: TranscriptEnhancementDurableChunk["status"],
): TranscriptEnhancementDurableChunk {
  return {
    chunkIndex: index,
    status,
    targetIndexes: [index],
    attemptCount: 1,
    unpublishedByOrderIndex: status === "COMPLETED" ? { [String(index)]: `text-${index}` } : {},
    lastErrorClass: status === "FAILED" ? "non_retryable" : null,
    lastHttpClass: null,
    lastSchemaResult: null,
    providerDurationMs: null,
    usageInputTokens: null,
    usageOutputTokens: null,
    usageTotalTokens: null,
    usageClassification: null,
    startedAt: null,
    finishedAt: status === "PENDING" || status === "RUNNING" ? null : "2026-01-01T00:00:00.000Z",
  };
}

function jobFromChunks(
  chunks: Record<string, TranscriptEnhancementDurableChunk>,
  extra?: Partial<TranscriptEnhancementJob>,
): TranscriptEnhancementJob {
  const progress = computeEnhancementProgress(chunks);
  return {
    schemaVersion: "d1-v1",
    jobId: "job-1",
    runId: "run-1",
    leaseToken: "lease-1",
    leaseExpiresAt: "2026-01-01T01:00:00.000Z",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: "identity",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress,
    chunks,
    unpublishedByOrderIndex: {},
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
    ...extra,
  };
}

test("terminal quality truth table after unfinished buckets are failed", () => {
  assert.equal(
    deriveEnhancementTerminalQuality({
      totalChunks: 0,
      completedChunks: 0,
      runningChunks: 0,
      pendingChunks: 0,
      retryableFailedChunks: 0,
      permanentFailedChunks: 0,
    }),
    "FAILED",
  );
  assert.equal(
    deriveEnhancementTerminalQuality(
      computeEnhancementProgress({
        "0": chunk(0, "COMPLETED"),
        "1": chunk(1, "RUNNING"),
      }),
    ),
    "FAILED",
  );
  assert.equal(
    deriveEnhancementTerminalQuality(
      computeEnhancementProgress({
        "0": chunk(0, "COMPLETED"),
        "1": chunk(1, "COMPLETED"),
      }),
    ),
    "COMPLETED",
  );
  assert.equal(
    deriveEnhancementTerminalQuality(
      computeEnhancementProgress({
        "0": chunk(0, "COMPLETED"),
        "1": chunk(1, "FAILED"),
      }),
    ),
    "PARTIAL",
  );
  assert.equal(
    deriveEnhancementTerminalQuality(
      computeEnhancementProgress({
        "0": chunk(0, "FAILED"),
        "1": chunk(1, "FAILED"),
      }),
    ),
    "FAILED",
  );
});

test("terminalize never returns COMPLETED while unfinished work remains", () => {
  const terminal = terminalizeEnhancementJob({
    job: jobFromChunks({
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "PENDING"),
      "2": chunk(2, "RETRYABLE_FAILED"),
    }),
    nowMs: Date.parse("2026-01-01T00:02:00.000Z"),
    cancelReason: "terminal_failure",
  });
  assert.equal(terminal.executionStatus, "FAILED");
  assert.notEqual(terminal.terminalQuality, "COMPLETED");
  assert.equal(terminal.chunks["1"]?.status, "FAILED");
  assert.equal(terminal.chunks["2"]?.status, "FAILED");
  assert.equal(terminal.terminalQuality, "PARTIAL");
  assert.equal(terminal.publicationEligible, false);
});

test("reconcile illegal RUNNING+ineligible Skip-like jobs without re-enabling publication", () => {
  const reconciled = reconcileIllegalInFlightIneligibleJob(
    jobFromChunks(
      { "0": chunk(0, "COMPLETED"), "1": chunk(1, "RUNNING") },
      {
        publicationEligible: false,
        cancelReason: "continue_with_current",
      },
    ),
    Date.parse("2026-01-01T00:02:00.000Z"),
  );
  assert.ok(reconciled);
  assert.equal(reconciled?.executionStatus, "CANCELLED_FOR_PUBLICATION");
  assert.equal(reconciled?.publicationEligible, false);
  assert.equal(reconciled?.terminalQuality, null);
});

test("reconcile illegal RUNNING+ineligible permanent-failure jobs to PARTIAL/FAILED", () => {
  const reconciled = reconcileIllegalInFlightIneligibleJob(
    jobFromChunks(
      {
        "0": chunk(0, "COMPLETED"),
        "1": chunk(1, "FAILED"),
        "2": chunk(2, "PENDING"),
      },
      { publicationEligible: false, cancelReason: "permanent_chunk_failure" },
    ),
    Date.parse("2026-01-01T00:02:00.000Z"),
  );
  assert.ok(reconciled);
  assert.equal(reconciled?.executionStatus, "FAILED");
  assert.equal(reconciled?.publicationEligible, false);
  assert.equal(reconciled?.terminalQuality, "PARTIAL");
  assert.equal(reconciled?.chunks["2"]?.status, "FAILED");
});

test("failUnfinished then derive never reports COMPLETED with a pending hole", () => {
  const failed = failUnfinishedEnhancementChunks(
    {
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "PENDING"),
    },
    "2026-01-01T00:02:00.000Z",
  );
  const quality = deriveEnhancementTerminalQuality(computeEnhancementProgress(failed));
  assert.equal(failed["1"]?.status, "FAILED");
  assert.equal(quality, "PARTIAL");
});
