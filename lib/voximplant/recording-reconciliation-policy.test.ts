import assert from "node:assert/strict";
import test from "node:test";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { RECORDING_STARTING_TIMEOUT_RECONCILED } from "@/lib/voximplant/recording-status-fencing";
import {
  evaluateRecordingReconciliationAdmission,
  normalizeSafeReconciledRecordingObjectKey,
  RECORDING_RECONCILIATION_THROTTLE_MS,
  STOPPING_RECONCILIATION_MIN_AGE_MS,
} from "@/lib/voximplant/recording-reconciliation-policy";

const now = new Date("2026-08-12T12:00:00.000Z");

function evaluate(
  overrides: Partial<Parameters<typeof evaluateRecordingReconciliationAdmission>[0]> = {},
) {
  return evaluateRecordingReconciliationAdmission({
    status: RecordingStatus.STARTING,
    recordingAttemptId: "attempt-a",
    errorMessage: null,
    startedAt: new Date(now.getTime() - 91_000),
    updatedAt: new Date(now.getTime() - 91_000),
    stopOperation: null,
    now,
    ...overrides,
  });
}

test("stale fenced STARTING attempt is admitted once threshold elapses", () => {
  assert.deepEqual(evaluate(), { eligible: true, reason: "stale_starting" });
  assert.deepEqual(evaluate({ startedAt: null }), {
    eligible: true,
    reason: "stale_starting",
  });
  assert.deepEqual(
    evaluate({ startedAt: new Date(now.getTime() - 89_000) }),
    { eligible: false, reason: "not_eligible" },
  );
  assert.deepEqual(
    evaluate({ updatedAt: new Date(now.getTime() - 5_000) }),
    { eligible: false, reason: "not_eligible" },
  );
});

test("recoverable FAILED attempt is throttled then re-admitted", () => {
  assert.deepEqual(
    evaluate({
      status: RecordingStatus.FAILED,
      errorMessage: RECORDING_STARTING_TIMEOUT_RECONCILED,
      updatedAt: new Date(
        now.getTime() - RECORDING_RECONCILIATION_THROTTLE_MS + 1,
      ),
    }),
    { eligible: false, reason: "throttled" },
  );
  assert.deepEqual(
    evaluate({
      status: RecordingStatus.FAILED,
      errorMessage: RECORDING_STARTING_TIMEOUT_RECONCILED,
      updatedAt: new Date(
        now.getTime() - RECORDING_RECONCILIATION_THROTTLE_MS,
      ),
    }),
    { eligible: true, reason: "recoverable_failed" },
  );
});

test("durable STOPPING representation is admitted without polling every client tick", () => {
  assert.deepEqual(
    evaluate({
      status: RecordingStatus.RECORDING,
      startedAt: new Date(now.getTime() - 10 * 60_000),
      stopOperation: {
        state: "DELIVERING",
        updatedAt: new Date(
          now.getTime() - STOPPING_RECONCILIATION_MIN_AGE_MS,
        ),
      },
    }),
    { eligible: true, reason: "stopping" },
  );
  assert.deepEqual(
    evaluate({
      status: RecordingStatus.RECORDING,
      stopOperation: {
        state: "DELIVERING",
        updatedAt: new Date(
          now.getTime() - STOPPING_RECONCILIATION_MIN_AGE_MS + 1,
        ),
      },
    }),
    { eligible: false, reason: "not_eligible" },
  );
});

test("legacy and unrelated FAILED rows are never admitted", () => {
  assert.deepEqual(evaluate({ recordingAttemptId: null }), {
    eligible: false,
    reason: "not_eligible",
  });
  assert.deepEqual(
    evaluate({
      status: RecordingStatus.FAILED,
      errorMessage: "PROVIDER_CONFIGURATION_ERROR",
    }),
    { eligible: false, reason: "not_eligible" },
  );
});

test("reconciled terminal object keys accept provider date prefixes and reject unsafe values", () => {
  assert.equal(
    normalizeSafeReconciledRecordingObjectKey(
      "2026/08/12/negotiation-room/audio/recording.flac",
    ),
    "2026/08/12/negotiation-room/audio/recording.flac",
  );
  assert.equal(
    normalizeSafeReconciledRecordingObjectKey(
      "https://storage.example/2026/08/12/negotiation-room/audio/recording.flac",
    ),
    null,
  );
  assert.equal(
    normalizeSafeReconciledRecordingObjectKey(
      "2026/08/12/negotiation-room/audio/../../other-object",
    ),
    null,
  );
});
