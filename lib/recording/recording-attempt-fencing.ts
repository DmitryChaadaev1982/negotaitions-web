import { randomUUID } from "crypto";

import {
  Prisma,
  RecordingStatus,
  RecordingType,
} from "@/app/generated/prisma/client";

const NON_RESTARTABLE_RECORDING_STATUSES = new Set<RecordingStatus>([
  RecordingStatus.STARTING,
  RecordingStatus.RECORDING,
  RecordingStatus.PAUSED,
  RecordingStatus.PROCESSING,
  RecordingStatus.COMPLETED,
]);

export type RecordingAttemptAdmission =
  | {
      admitted: true;
      recordingId: string;
      recordingAttemptId: string;
      status: RecordingStatus;
    }
  | {
      admitted: false;
      recordingId: string;
      recordingAttemptId: string | null;
      status: RecordingStatus;
      reason: "already_active_or_completed" | "legacy_transient_recording";
    };

/**
 * Serializes one Session's recording START admission and makes the attempt
 * identity durable before any provider command can be constructed or relayed.
 */
export async function admitRecordingAttempt(
  tx: Prisma.TransactionClient,
  input: {
    sessionId: string;
    provider: string;
    recordingType?: RecordingType;
    recordingAttemptId?: string;
  },
): Promise<RecordingAttemptAdmission> {
  const sessionRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT s.id
    FROM "Session" s
    WHERE s.id = ${input.sessionId}
      AND s."deletedAt" IS NULL
    FOR UPDATE OF s
  `);
  if (sessionRows.length !== 1) {
    throw new Error("Session not found or deleted.");
  }

  const existing = await tx.recording.findUnique({
    where: { sessionId: input.sessionId },
    select: {
      id: true,
      status: true,
      recordingAttemptId: true,
    },
  });

  if (existing && NON_RESTARTABLE_RECORDING_STATUSES.has(existing.status)) {
    return {
      admitted: false,
      recordingId: existing.id,
      recordingAttemptId: existing.recordingAttemptId,
      status: existing.status,
      reason: existing.recordingAttemptId
        ? "already_active_or_completed"
        : "legacy_transient_recording",
    };
  }

  const recordingAttemptId = input.recordingAttemptId ?? randomUUID();
  const resetData = {
    recordingAttemptId,
    provider: input.provider,
    status: RecordingStatus.STARTING,
    recordingType: input.recordingType ?? RecordingType.AUDIO_ONLY,
    egressId: null,
    fileUrl: null,
    fileKey: null,
    fileName: null,
    mimeType: null,
    originalSizeBytes: null,
    compressedFileKey: null,
    compressedFileName: null,
    compressedMimeType: null,
    compressedSizeBytes: null,
    compressionStatus: null,
    compressionError: null,
    startedAt: null,
    endedAt: null,
    errorMessage: null,
  } satisfies Prisma.RecordingUncheckedUpdateInput;

  if (existing) {
    // Stop-operation IDs are attempt-scoped. Removing the old row prevents a
    // delayed operation from being mistaken for the newly admitted attempt.
    await tx.sessionRecordingStopOperation.deleteMany({
      where: { recordingId: existing.id },
    });
    const updated = await tx.recording.update({
      where: { id: existing.id },
      data: resetData,
      select: { id: true, status: true },
    });
    return {
      admitted: true,
      recordingId: updated.id,
      recordingAttemptId,
      status: updated.status,
    };
  }

  const created = await tx.recording.create({
    data: {
      sessionId: input.sessionId,
      ...resetData,
    },
    select: { id: true, status: true },
  });
  return {
    admitted: true,
    recordingId: created.id,
    recordingAttemptId,
    status: created.status,
  };
}

export async function updateRecordingAttemptCas(
  tx: Prisma.TransactionClient,
  input: {
    recordingId: string;
    recordingAttemptId: string;
    allowedStatuses?: RecordingStatus[];
    data: Prisma.RecordingUpdateManyMutationInput;
  },
): Promise<boolean> {
  const result = await tx.recording.updateMany({
    where: {
      id: input.recordingId,
      recordingAttemptId: input.recordingAttemptId,
      ...(input.allowedStatuses
        ? { status: { in: input.allowedStatuses } }
        : {}),
    },
    data: input.data,
  });
  return result.count === 1;
}
