import assert from "node:assert/strict";
import test from "node:test";

import { RecordingStatus } from "@/app/generated/prisma/client";
import {
  applyVoximplantRecordingStatusCallback,
  assertRecordingAttemptCorrelation,
  headRecordingObjectWithBoundedRetry,
  isMonotonicRecordingTransition,
  mapVoximplantStatusToDb,
  RecordingStatusFencingError,
} from "@/lib/voximplant/recording-status-fencing";
import { prisma } from "@/lib/prisma";

test("STARTING remains distinct from provider-confirmed RECORDING", () => {
  assert.equal(
    mapVoximplantStatusToDb("starting", false),
    RecordingStatus.STARTING,
  );
  assert.equal(
    mapVoximplantStatusToDb("recording", false),
    RecordingStatus.RECORDING,
  );
});

test("current attempt is accepted and obsolete or missing attempts are rejected", () => {
  assert.doesNotThrow(() =>
    assertRecordingAttemptCorrelation("attempt-b", "attempt-b"),
  );
  assert.throws(
    () => assertRecordingAttemptCorrelation("attempt-b", "attempt-a"),
    (error) =>
      error instanceof RecordingStatusFencingError &&
      error.status === 409 &&
      error.code === "OBSOLETE_RECORDING_ATTEMPT",
  );
  assert.throws(
    () => assertRecordingAttemptCorrelation("attempt-b", null),
    (error) =>
      error instanceof RecordingStatusFencingError &&
      error.code === "MISSING_RECORDING_ATTEMPT_ID",
  );
});

test("legacy NULL rows do not accept fabricated fenced attempt identities", () => {
  assert.doesNotThrow(() => assertRecordingAttemptCorrelation(null, null));
  assert.throws(
    () => assertRecordingAttemptCorrelation(null, "fabricated"),
    (error) =>
      error instanceof RecordingStatusFencingError &&
      error.code === "RECORDING_ATTEMPT_MISMATCH",
  );
});

test("delayed STARTING or RECORDING cannot regress terminal state", () => {
  assert.equal(
    isMonotonicRecordingTransition(
      RecordingStatus.STOPPED,
      RecordingStatus.STARTING,
    ),
    false,
  );
  assert.equal(
    isMonotonicRecordingTransition(
      RecordingStatus.COMPLETED,
      RecordingStatus.RECORDING,
    ),
    false,
  );
  assert.equal(
    isMonotonicRecordingTransition(
      RecordingStatus.STARTING,
      RecordingStatus.RECORDING,
    ),
    true,
  );
});

test("bounded S3 HEAD retries eventual visibility", async () => {
  let attempts = 0;
  const result = await headRecordingObjectWithBoundedRetry("recording.flac", {
    attempts: 3,
    delayMs: 0,
    head: async () => {
      attempts += 1;
      return attempts < 3
        ? {
            exists: false,
            contentLength: 0,
            contentType: "application/octet-stream",
          }
        : {
            exists: true,
            contentLength: 1234,
            contentType: "audio/flac",
          };
    },
  });
  assert.equal(attempts, 3);
  assert.equal(result.contentLength, 1234);
});

test("second fence rejects recovery when attempt changes during S3 HEAD", async () => {
  let releaseHead!: () => void;
  const headBlocked = new Promise<void>((resolve) => {
    releaseHead = resolve;
  });
  let currentAttemptId = "attempt-a";

  const recovery = (async () => {
    assertRecordingAttemptCorrelation(currentAttemptId, "attempt-a");
    await headBlocked;
    assertRecordingAttemptCorrelation(currentAttemptId, "attempt-a");
  })();

  currentAttemptId = "attempt-b";
  releaseHead();
  await assert.rejects(
    recovery,
    (error) =>
      error instanceof RecordingStatusFencingError &&
      error.code === "OBSOLETE_RECORDING_ATTEMPT",
  );
});

test("transient S3 HEAD exhaustion remains retryable", async () => {
  await assert.rejects(
    headRecordingObjectWithBoundedRetry("recording.flac", {
      attempts: 2,
      delayMs: 0,
      head: async () => {
        throw new Error("temporary transport failure");
      },
    }),
    (error) =>
      error instanceof RecordingStatusFencingError &&
      error.status === 503 &&
      error.retryable === true,
  );
});

test("eligible late completion verifies S3 before opening the final DB transaction", async () => {
  const attemptId = "attempt-recovery";
  const stoppedAt = "2026-08-12T10:30:00.000Z";
  const failedCandidate = {
    id: "recording-1",
    status: RecordingStatus.FAILED,
    recordingAttemptId: attemptId,
    errorMessage: "RECORDING_STARTING_TIMEOUT_RECONCILED",
    egressId: null,
    fileKey: null,
  };
  let inTransaction = false;
  let updateData: Record<string, unknown> | null = null;
  let stopOperationUpdateCount = 0;
  const tx = {
    $queryRaw: async () => [],
    recording: {
      findUnique: async () => failedCandidate,
      updateMany: async (input: { data: Record<string, unknown> }) => {
        updateData = input.data;
        return { count: 1 };
      },
    },
    sessionRecordingStopOperation: {
      updateMany: async () => {
        stopOperationUpdateCount += 1;
        return { count: 0 };
      },
    },
  };
  const fakePrisma = {
    recording: {
      findUnique: async () => failedCandidate,
    },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await callback(tx);
      } finally {
        inTransaction = false;
      }
    },
  } as unknown as typeof prisma;

  const result = await applyVoximplantRecordingStatusCallback({
    sessionId: "session-1",
    payload: {
      status: "stopped",
      requestId: "stop-1",
      recordingAttemptId: attemptId,
      recordingId: "provider-recording-1",
      fileKey: "negotiation-room/audio/recovery.flac",
      stoppedAt,
      errorCode: null,
      message: null,
    },
    head: async () => {
      assert.equal(inTransaction, false);
      return {
        exists: true,
        contentLength: 2048,
        contentType: "audio/flac",
      };
    },
    prismaClient: fakePrisma,
  });

  assert.equal(result.recovered, true);
  assert.equal(result.status, RecordingStatus.COMPLETED);
  assert.equal(updateData?.status, RecordingStatus.COMPLETED);
  assert.equal(
    updateData?.fileKey,
    "negotiation-room/audio/recovery.flac",
  );
  assert.equal(updateData?.egressId, "provider-recording-1");
  assert.equal(updateData?.originalSizeBytes, 2048);
  assert.deepEqual(updateData?.endedAt, new Date(stoppedAt));
  assert.equal(updateData?.errorMessage, null);
  assert.equal(stopOperationUpdateCount, 1);
});

test("late completion is rejected if attempt B wins while A is in S3 HEAD", async () => {
  const candidateA = {
    id: "recording-1",
    status: RecordingStatus.FAILED,
    recordingAttemptId: "attempt-a",
    errorMessage: "RECORDING_STARTING_TIMEOUT_RECONCILED",
    egressId: null,
    fileKey: null,
  };
  const currentB = {
    ...candidateA,
    status: RecordingStatus.STARTING,
    recordingAttemptId: "attempt-b",
    errorMessage: null,
  };
  const tx = {
    $queryRaw: async () => [],
    recording: {
      findUnique: async () => currentB,
      updateMany: async () => {
        assert.fail("obsolete attempt must not reach mutation");
      },
    },
  };
  const fakePrisma = {
    recording: {
      findUnique: async () => candidateA,
    },
    $transaction: async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
  } as unknown as typeof prisma;

  await assert.rejects(
    applyVoximplantRecordingStatusCallback({
      sessionId: "session-1",
      payload: {
        status: "stopped",
        requestId: "stop-a",
        recordingAttemptId: "attempt-a",
        recordingId: "provider-a",
        fileKey: "negotiation-room/audio/a.flac",
        stoppedAt: new Date().toISOString(),
        errorCode: null,
        message: null,
      },
      head: async () => ({
        exists: true,
        contentLength: 2048,
        contentType: "audio/flac",
      }),
      prismaClient: fakePrisma,
    }),
    (error) =>
      error instanceof RecordingStatusFencingError &&
      error.code === "OBSOLETE_RECORDING_ATTEMPT",
  );
});
