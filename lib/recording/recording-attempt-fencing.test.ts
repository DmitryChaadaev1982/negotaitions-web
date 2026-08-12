import assert from "node:assert/strict";
import test from "node:test";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { admitRecordingAttempt } from "@/lib/recording/recording-attempt-fencing";

test("START admission persists attempt identity without claiming provider start time", async () => {
  const createdRows: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: async () => [{ id: "session-a" }],
    recording: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createdRows.push(data);
        return { id: "recording-a", status: RecordingStatus.STARTING };
      },
    },
  };

  const result = await admitRecordingAttempt(tx as never, {
    sessionId: "session-a",
    provider: "VOXIMPLANT",
    recordingAttemptId: "attempt-a",
  });

  assert.equal(result.admitted, true);
  assert.equal(createdRows[0]?.recordingAttemptId, "attempt-a");
  assert.equal(createdRows[0]?.status, RecordingStatus.STARTING);
  assert.equal(createdRows[0]?.startedAt, null);
});

test("active fenced attempt cannot be replaced by a new START", async () => {
  let createCalled = false;
  const tx = {
    $queryRaw: async () => [{ id: "session-a" }],
    recording: {
      findUnique: async () => ({
        id: "recording-a",
        status: RecordingStatus.STARTING,
        recordingAttemptId: "attempt-a",
      }),
      create: async () => {
        createCalled = true;
        return { id: "unexpected", status: RecordingStatus.STARTING };
      },
    },
  };

  const result = await admitRecordingAttempt(tx as never, {
    sessionId: "session-a",
    provider: "VOXIMPLANT",
    recordingAttemptId: "attempt-b",
  });

  assert.deepEqual(result, {
    admitted: false,
    recordingId: "recording-a",
    recordingAttemptId: "attempt-a",
    status: RecordingStatus.STARTING,
    reason: "already_active_or_completed",
  });
  assert.equal(createCalled, false);
});
