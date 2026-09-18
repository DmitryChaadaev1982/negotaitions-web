import assert from "node:assert/strict";
import test from "node:test";

import { parseTranscriptEnhancementJob } from "@/lib/services/transcript-enhancement-job";

import {
  summarizeProviderSkipObservability,
  summarizeSkipEvidence,
} from "./large-realistic-uat-metrics";
import {
  completedChunksCalledAgain,
  controlledRecoveryLeaseExpiresAt,
  formatChunkIndexList,
  RECOVERY_HANDOFF,
  RESUME_SEMANTICS,
  SKIP_SEMANTICS,
  summarizeRecoveryProviderCalls,
} from "./large-realistic-uat-skip-resume";

test("Skip and Resume are different operations", () => {
  assert.equal(SKIP_SEMANTICS.partialEnhancedTextPublishedAfterSkip, false);
  assert.equal(SKIP_SEMANTICS.rawCurrentRemainsAuthoritative, true);
  assert.equal(SKIP_SEMANTICS.lateResultCanPublish, false);
  assert.equal(SKIP_SEMANTICS.newRunRequiredForNewImprove, true);
  assert.equal(RESUME_SEMANTICS.continuesUnfinishedDurableWork, true);
  assert.equal(RESUME_SEMANTICS.sameRunId, true);
  assert.equal(RESUME_SEMANTICS.trigger, "automatic");
  assert.equal(RECOVERY_HANDOFF.trigger, "automatic");
  assert.notEqual(SKIP_SEMANTICS.operation, RESUME_SEMANTICS.operation);
});

test("held lease stays in the future and expired lease is recoverable", () => {
  const now = Date.parse("2026-09-15T18:00:00.000Z");
  assert.equal(
    Date.parse(controlledRecoveryLeaseExpiresAt(now, "held")) > now,
    true,
  );
  assert.equal(
    Date.parse(controlledRecoveryLeaseExpiresAt(now, "expired")) < now,
    true,
  );
});

test("recovery report lists unfinished calls and empty completed recalls", () => {
  assert.equal(formatChunkIndexList([0, 1, 2]), "0-2");
  assert.equal(formatChunkIndexList([3, 4, 5, 19, 20]), "3-5,19-20");
  const summary = summarizeRecoveryProviderCalls({
    runId: "run-1",
    recoveryStart: "2026-09-15T18:00:00.000Z",
    completedBeforeRecovery: [0, 1, 2],
    records: [
      { runId: "run-1", chunkIndex: 0, requestStartedAt: "2026-09-15T17:59:00.000Z" },
      { runId: "run-1", chunkIndex: 1, requestStartedAt: "2026-09-15T17:59:10.000Z" },
      { runId: "run-1", chunkIndex: 2, requestStartedAt: "2026-09-15T17:59:20.000Z" },
      { runId: "run-1", chunkIndex: 3, requestStartedAt: "2026-09-15T18:00:01.000Z" },
      { runId: "run-1", chunkIndex: 20, requestStartedAt: "2026-09-15T18:00:02.000Z" },
    ],
  });
  assert.deepEqual(summary.recoveryProviderCallChunks, [3, 20]);
  assert.deepEqual(summary.recalledCompletedChunks, []);
});

test("completed chunks called again must be empty", () => {
  assert.deepEqual(
    completedChunksCalledAgain({
      completedBeforeResume: [0, 1, 2],
      resumeCallChunks: [3, 4, 5],
    }),
    [],
  );
  assert.deepEqual(
    completedChunksCalledAgain({
      completedBeforeResume: [0, 1, 2],
      resumeCallChunks: [2, 3],
    }),
    [2],
  );
});

test("Skip evidence classifies completed-before vs in-flight vs pending", () => {
  const job = parseTranscriptEnhancementJob({
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      runId: "run-1",
      executionStatus: "CANCELLED_FOR_PUBLICATION",
      publicationEligible: false,
      publicationOutcome: "cancelled_continue",
      startedAt: "2026-09-15T17:40:17.653Z",
      cancelledAt: "2026-09-15T17:40:31.001Z",
      progress: { totalChunks: 3, completedChunks: 1, runningChunks: 1, pendingChunks: 1, retryableFailedChunks: 0, permanentFailedChunks: 0 },
      chunks: {
        "0": {
          chunkIndex: 0,
          status: "COMPLETED",
          targetIndexes: [0],
          attemptCount: 1,
          unpublishedByOrderIndex: { "0": "x" },
          startedAt: "2026-09-15T17:40:17.722Z",
          finishedAt: "2026-09-15T17:40:27.870Z",
        },
        "1": {
          chunkIndex: 1,
          status: "RUNNING",
          targetIndexes: [1],
          attemptCount: 1,
          unpublishedByOrderIndex: {},
          startedAt: "2026-09-15T17:40:24.175Z",
          finishedAt: null,
        },
        "2": {
          chunkIndex: 2,
          status: "PENDING",
          targetIndexes: [2],
          attemptCount: 0,
          unpublishedByOrderIndex: {},
          startedAt: null,
          finishedAt: null,
        },
      },
    },
  });
  const skip = summarizeSkipEvidence(job);
  assert.deepEqual(skip.completedBeforeSkip, [0]);
  assert.deepEqual(skip.inFlightAtSkip, [1]);
  assert.deepEqual(skip.completedAfterSkip, []);
  assert.deepEqual(skip.pendingAfterSkip, [2]);
  assert.equal(skip.skipTime, "2026-09-15T17:40:31.001Z");
});

test("provider observability can complete after Skip with rejected checkpoint", () => {
  const skipTime = "2026-09-15T17:40:31.001Z";
  const summary = summarizeProviderSkipObservability(
    [
      {
        runId: "run-1",
        chunkIndex: 7,
        requestStartedAt: "2026-09-15T17:40:17.779Z",
        responseReceivedAt: "2026-09-15T17:40:24.162Z",
        checkpointAccepted: true,
        checkpointRejectionReason: null,
      },
      {
        runId: "run-1",
        chunkIndex: 9,
        requestStartedAt: "2026-09-15T17:40:24.755Z",
        responseReceivedAt: "2026-09-15T17:40:40.200Z",
        checkpointAccepted: false,
        checkpointRejectionReason: "execution_not_in_flight",
      },
      {
        runId: "run-1",
        chunkIndex: 15,
        requestStartedAt: "2026-09-15T17:40:27.925Z",
        responseReceivedAt: null,
        checkpointAccepted: null,
        checkpointRejectionReason: null,
      },
    ],
    skipTime,
    "run-1",
  );
  assert.deepEqual(summary.completedBeforeSkip, [7]);
  assert.deepEqual(summary.completedAfterSkip, [9]);
  assert.deepEqual(summary.inFlightAtSkip, [9, 15]);
  assert.deepEqual(summary.stillInFlightOrAborted, [15]);
  assert.equal(summary.lateCheckpointAccepted, false);
  assert.equal(summary.lateCheckpointRejected, true);
});
