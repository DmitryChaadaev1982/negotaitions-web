import { RecordingStatus } from "@/app/generated/prisma/client";
import { STALE_RECORDING_STARTING_TIMEOUT_SECONDS } from "@/lib/materials-status-readiness";
import { normalizeRecordingFileKey } from "@/lib/storage/recording-file-key";
import { RECORDING_STARTING_TIMEOUT_RECONCILED } from "@/lib/voximplant/recording-status-fencing";

export const RECORDING_RECONCILIATION_THROTTLE_MS = 30_000;
export const STOPPING_RECONCILIATION_MIN_AGE_MS = 15_000;

export type RecordingReconciliationAdmission = {
  eligible: boolean;
  reason:
    | "stale_starting"
    | "recoverable_failed"
    | "stopping"
    | "throttled"
    | "not_eligible";
};

export function normalizeSafeReconciledRecordingObjectKey(
  value: string | null,
): string | null {
  if (!value) {
    return null;
  }
  const normalized = normalizeRecordingFileKey(value);
  if (normalized.containsRawUrl || normalized.containsEncodedUrl) {
    return null;
  }
  const key = normalized.normalizedKey;
  if (
    !key ||
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("?") ||
    key.includes("#") ||
    !(
      key.startsWith("negotiation-room/audio/") ||
      key.startsWith("voximplant/audio/") ||
      /^\d{4}\/\d{2}\/\d{2}\/negotiation-room\/audio\//.test(key)
    )
  ) {
    return null;
  }
  return key;
}

export function evaluateRecordingReconciliationAdmission(input: {
  status: RecordingStatus;
  recordingAttemptId: string | null;
  errorMessage: string | null;
  startedAt: Date | null;
  updatedAt: Date;
  stopOperation: {
    state: string;
    updatedAt: Date;
  } | null;
  now: Date;
}): RecordingReconciliationAdmission {
  if (!input.recordingAttemptId) {
    return { eligible: false, reason: "not_eligible" };
  }
  const ageMs = input.now.getTime() - input.updatedAt.getTime();
  const startBoundary = input.startedAt ?? input.updatedAt;
  const startAgeMs = input.now.getTime() - startBoundary.getTime();
  const stopAgeMs = input.stopOperation
    ? input.now.getTime() - input.stopOperation.updatedAt.getTime()
    : 0;

  if (
    input.status === RecordingStatus.STARTING &&
    startAgeMs >= STALE_RECORDING_STARTING_TIMEOUT_SECONDS * 1000 &&
    ageMs >= RECORDING_RECONCILIATION_THROTTLE_MS
  ) {
    return { eligible: true, reason: "stale_starting" };
  }
  if (
    input.status === RecordingStatus.FAILED &&
    input.errorMessage === RECORDING_STARTING_TIMEOUT_RECONCILED
  ) {
    return ageMs >= RECORDING_RECONCILIATION_THROTTLE_MS
      ? { eligible: true, reason: "recoverable_failed" }
      : { eligible: false, reason: "throttled" };
  }
  if (
    input.stopOperation &&
    input.stopOperation.state !== "DELIVERED" &&
    (
      input.status === RecordingStatus.RECORDING ||
      input.status === RecordingStatus.STARTING ||
      input.status === RecordingStatus.STOPPED
    ) &&
    ageMs >= RECORDING_RECONCILIATION_THROTTLE_MS &&
    stopAgeMs >= STOPPING_RECONCILIATION_MIN_AGE_MS
  ) {
    return { eligible: true, reason: "stopping" };
  }
  return { eligible: false, reason: "not_eligible" };
}
