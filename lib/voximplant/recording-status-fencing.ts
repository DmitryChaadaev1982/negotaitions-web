import { Prisma, RecordingStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { headObject } from "@/lib/storage/s3";

export const RECORDING_STARTING_TIMEOUT_RECONCILED =
  "RECORDING_STARTING_TIMEOUT_RECONCILED";

export type VoxRecordingCallbackStatus =
  | "idle"
  | "starting"
  | "recording"
  | "stopping"
  | "stopped"
  | "error"
  | "not_recording"
  | "paused"
  | "resuming";

export type FencedRecordingStatusPayload = {
  status: VoxRecordingCallbackStatus;
  protocolVersion?: string | null;
  recordingAttemptId?: string | null;
  recordingId?: string | null;
  fileKey: string | null;
  errorCode?: string | null;
  message?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
};

export class RecordingStatusFencingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function mapVoximplantStatusToDb(
  providerStatus: VoxRecordingCallbackStatus,
  hasFileKey: boolean,
): RecordingStatus {
  switch (providerStatus) {
    case "starting":
      return RecordingStatus.STARTING;
    case "recording":
    case "paused":
    case "resuming":
      return RecordingStatus.RECORDING;
    case "stopping":
      return RecordingStatus.STOPPED;
    case "stopped":
      return hasFileKey ? RecordingStatus.COMPLETED : RecordingStatus.STOPPED;
    case "error":
      return RecordingStatus.FAILED;
    case "idle":
    case "not_recording":
      return RecordingStatus.NOT_STARTED;
  }
}

export function isMonotonicRecordingTransition(
  current: RecordingStatus,
  next: RecordingStatus,
): boolean {
  const allowed: Record<RecordingStatus, ReadonlySet<RecordingStatus>> = {
    [RecordingStatus.NOT_STARTED]: new Set([
      RecordingStatus.NOT_STARTED,
      RecordingStatus.STARTING,
      RecordingStatus.RECORDING,
      RecordingStatus.FAILED,
    ]),
    [RecordingStatus.STARTING]: new Set([
      RecordingStatus.STARTING,
      RecordingStatus.RECORDING,
      RecordingStatus.STOPPED,
      RecordingStatus.COMPLETED,
      RecordingStatus.FAILED,
    ]),
    [RecordingStatus.RECORDING]: new Set([
      RecordingStatus.RECORDING,
      RecordingStatus.STOPPED,
      RecordingStatus.COMPLETED,
      RecordingStatus.FAILED,
    ]),
    [RecordingStatus.PAUSED]: new Set([
      RecordingStatus.PAUSED,
      RecordingStatus.RECORDING,
      RecordingStatus.STOPPED,
      RecordingStatus.COMPLETED,
      RecordingStatus.FAILED,
    ]),
    [RecordingStatus.PROCESSING]: new Set([
      RecordingStatus.PROCESSING,
      RecordingStatus.COMPLETED,
      RecordingStatus.FAILED,
    ]),
    [RecordingStatus.STOPPED]: new Set([
      RecordingStatus.STOPPED,
      RecordingStatus.COMPLETED,
    ]),
    [RecordingStatus.COMPLETED]: new Set([RecordingStatus.COMPLETED]),
    [RecordingStatus.FAILED]: new Set([RecordingStatus.FAILED]),
  };
  return allowed[current].has(next);
}

function isLateTimeoutRecoveryCandidate(
  recording: {
    recordingAttemptId: string | null;
    status: RecordingStatus;
    errorMessage: string | null;
  },
  payload: FencedRecordingStatusPayload,
) {
  return (
    Boolean(recording.recordingAttemptId) &&
    recording.status === RecordingStatus.FAILED &&
    recording.errorMessage === RECORDING_STARTING_TIMEOUT_RECONCILED &&
    (
      payload.status === "recording" ||
      payload.status === "paused" ||
      payload.status === "resuming" ||
      payload.status === "stopping" ||
      payload.status === "stopped"
    )
  );
}

export function assertRecordingAttemptCorrelation(
  recordingAttemptId: string | null,
  callbackAttemptId: string | null | undefined,
) {
  if (recordingAttemptId) {
    if (!callbackAttemptId) {
      throw new RecordingStatusFencingError(
        409,
        "MISSING_RECORDING_ATTEMPT_ID",
        "A fenced recording callback must include recordingAttemptId.",
      );
    }
    if (recordingAttemptId !== callbackAttemptId) {
      throw new RecordingStatusFencingError(
        409,
        "OBSOLETE_RECORDING_ATTEMPT",
        "The callback belongs to an obsolete recording attempt.",
      );
    }
    return;
  }

  if (callbackAttemptId) {
    throw new RecordingStatusFencingError(
      409,
      "RECORDING_ATTEMPT_MISMATCH",
      "The callback attempt does not match the legacy recording row.",
    );
  }
}

function assertCompatibleProviderIdentifiers(
  recording: { egressId: string | null; fileKey: string | null },
  payload: FencedRecordingStatusPayload,
) {
  if (
    recording.egressId &&
    payload.recordingId &&
    recording.egressId !== payload.recordingId
  ) {
    throw new RecordingStatusFencingError(
      409,
      "PROVIDER_RECORDING_ID_MISMATCH",
      "The provider recording ID does not match the current attempt.",
    );
  }
  if (
    recording.fileKey &&
    payload.fileKey &&
    recording.fileKey !== payload.fileKey
  ) {
    throw new RecordingStatusFencingError(
      409,
      "RECORDING_FILE_KEY_MISMATCH",
      "The recording object key does not match the current attempt.",
    );
  }
}

export async function headRecordingObjectWithBoundedRetry(
  fileKey: string,
  input?: {
    attempts?: number;
    delayMs?: number;
    head?: typeof headObject;
  },
) {
  const attempts = Math.max(1, input?.attempts ?? 3);
  const delayMs = Math.max(0, input?.delayMs ?? 200);
  const readHead = input?.head ?? headObject;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await readHead(fileKey);
      if (result.exists && result.contentLength > 0) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw new RecordingStatusFencingError(
    503,
    lastError
      ? "RECORDING_OBJECT_HEAD_TRANSIENT_FAILURE"
      : "RECORDING_OBJECT_NOT_YET_AVAILABLE",
    lastError
      ? "Recording object verification failed transiently."
      : "Recording object is not available yet.",
    true,
  );
}

type CallbackApplyResult = {
  action: "updated" | "duplicate" | "skipped";
  status: RecordingStatus;
  recordingId: string | null;
  recovered: boolean;
};

export async function applyVoximplantRecordingStatusCallback(input: {
  sessionId: string;
  payload: FencedRecordingStatusPayload;
  head?: typeof headObject;
  verifyObjectBeforeCompletion?: boolean;
  providerStatusReconciliation?: boolean;
  prismaClient?: typeof prisma;
}): Promise<CallbackApplyResult> {
  const prismaClient = input.prismaClient ?? prisma;
  const candidate = await prismaClient.recording.findUnique({
    where: { sessionId: input.sessionId },
    select: {
      id: true,
      status: true,
      recordingAttemptId: true,
      errorMessage: true,
      egressId: true,
      fileKey: true,
    },
  });

  if (!candidate) {
    if (input.payload.recordingAttemptId) {
      throw new RecordingStatusFencingError(
        409,
        "RECORDING_ATTEMPT_NOT_DURABLE",
        "No durable recording attempt exists for this fenced callback.",
      );
    }
    if (
      input.payload.status === "idle" ||
      input.payload.status === "not_recording"
    ) {
      return {
        action: "skipped",
        status: RecordingStatus.NOT_STARTED,
        recordingId: null,
        recovered: false,
      };
    }

    // Legacy RC2 compatibility only. New RC3 starts are always persisted before
    // dispatch and can never enter this branch.
    return prismaClient.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT s.id
        FROM "Session" s
        WHERE s.id = ${input.sessionId}
        FOR UPDATE OF s
      `);
      const raced = await tx.recording.findUnique({
        where: { sessionId: input.sessionId },
        select: { id: true },
      });
      if (raced) {
        throw new RecordingStatusFencingError(
          409,
          "LEGACY_RECORDING_CREATE_RACE",
          "The recording row changed while applying a legacy callback.",
        );
      }
      const targetStatus = mapVoximplantStatusToDb(
        input.payload.status,
        Boolean(input.payload.fileKey),
      );
      const created = await tx.recording.create({
        data: {
          sessionId: input.sessionId,
          provider: "VOXIMPLANT",
          status: targetStatus,
          recordingType: "AUDIO_ONLY",
          fileKey: input.payload.fileKey ?? undefined,
          egressId: input.payload.recordingId ?? undefined,
          startedAt:
            input.payload.startedAt &&
            (input.payload.status === "starting" ||
              input.payload.status === "recording")
              ? new Date(input.payload.startedAt)
              : undefined,
          endedAt:
            input.payload.status === "stopping" ||
            input.payload.status === "stopped"
              ? input.payload.stoppedAt
                ? new Date(input.payload.stoppedAt)
                : new Date()
              : undefined,
          errorMessage:
            targetStatus === RecordingStatus.FAILED
              ? input.payload.errorCode ??
                input.payload.message ??
                "Recording failed."
              : undefined,
        },
        select: { id: true, status: true },
      });
      return {
        action: "updated",
        status: created.status,
        recordingId: created.id,
        recovered: false,
      };
    });
  }

  assertRecordingAttemptCorrelation(
    candidate.recordingAttemptId,
    input.payload.recordingAttemptId,
  );
  assertCompatibleProviderIdentifiers(candidate, input.payload);

  const recoveryCandidate = isLateTimeoutRecoveryCandidate(
    candidate,
    input.payload,
  );
  const shouldVerifyObject =
    Boolean(input.payload.fileKey) &&
    (
      (recoveryCandidate && input.payload.status === "stopped") ||
      input.verifyObjectBeforeCompletion === true
    );
  const objectHead = shouldVerifyObject
    ? await headRecordingObjectWithBoundedRetry(input.payload.fileKey!, {
        head: input.head,
      })
    : null;

  return prismaClient.$transaction(async (tx) => {
    // Use the same lock order as START admission so a new attempt cannot be
    // installed between the final recovery recheck and mutation.
    await tx.$queryRaw(Prisma.sql`
      SELECT s.id
      FROM "Session" s
      WHERE s.id = ${input.sessionId}
      FOR UPDATE OF s
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT r.id
      FROM "Recording" r
      WHERE r."sessionId" = ${input.sessionId}
      FOR UPDATE OF r
    `);

    const current = await tx.recording.findUnique({
      where: { sessionId: input.sessionId },
      select: {
        id: true,
        status: true,
        recordingAttemptId: true,
        errorMessage: true,
        egressId: true,
        fileKey: true,
      },
    });
    if (!current) {
      throw new RecordingStatusFencingError(
        409,
        "RECORDING_ATTEMPT_NOT_DURABLE",
        "The recording attempt disappeared before callback finalization.",
      );
    }

    assertRecordingAttemptCorrelation(
      current.recordingAttemptId,
      input.payload.recordingAttemptId,
    );
    assertCompatibleProviderIdentifiers(current, input.payload);

    const recovering = isLateTimeoutRecoveryCandidate(current, input.payload);
    if (recoveryCandidate && !recovering) {
      throw new RecordingStatusFencingError(
        409,
        "RECOVERY_CANDIDATE_CHANGED",
        "The timed-out attempt changed while object verification was in progress.",
      );
    }
    if (!recoveryCandidate && current.status === RecordingStatus.FAILED) {
      if (
        input.payload.status === "stopping" ||
        input.payload.status === "stopped"
      ) {
        throw new RecordingStatusFencingError(
          409,
          "FAILED_RECORDING_NOT_RECOVERABLE",
          "This failed recording is not eligible for late recovery.",
        );
      }
    }

    const targetStatus = mapVoximplantStatusToDb(
      input.payload.status,
      Boolean(input.payload.fileKey),
    );
    if (!recovering && !isMonotonicRecordingTransition(current.status, targetStatus)) {
      return {
        action: "skipped",
        status: current.status,
        recordingId: current.id,
        recovered: false,
      };
    }

    const updateData: Prisma.RecordingUpdateManyMutationInput = {
      status: targetStatus,
      ...(input.payload.fileKey ? { fileKey: input.payload.fileKey } : {}),
      ...(input.payload.recordingId
        ? { egressId: input.payload.recordingId }
        : {}),
      ...(objectHead ? { originalSizeBytes: objectHead.contentLength } : {}),
    };
    if (
      input.payload.startedAt &&
      (input.payload.status === "starting" ||
        input.payload.status === "recording")
    ) {
      updateData.startedAt = new Date(input.payload.startedAt);
    }
    if (
      input.payload.status === "stopping" ||
      input.payload.status === "stopped"
    ) {
      updateData.endedAt = input.payload.stoppedAt
        ? new Date(input.payload.stoppedAt)
        : new Date();
      updateData.errorMessage = null;
    } else if (targetStatus === RecordingStatus.FAILED) {
      updateData.errorMessage =
        input.payload.errorCode ??
        input.payload.message ??
        "Recording failed.";
    } else {
      updateData.errorMessage = null;
      if (
        input.payload.status === "recording" ||
        input.payload.status === "paused" ||
        input.payload.status === "resuming"
      ) {
        updateData.endedAt = null;
      }
    }

    const expectedErrorMessage =
      targetStatus === RecordingStatus.FAILED
        ? input.payload.errorCode ??
          input.payload.message ??
          "Recording failed."
        : null;
    const alreadyCompatible =
      current.status === targetStatus &&
      (!input.payload.fileKey || current.fileKey === input.payload.fileKey) &&
      (!input.payload.recordingId ||
        current.egressId === input.payload.recordingId) &&
      current.errorMessage === expectedErrorMessage;
    if (alreadyCompatible) {
      return {
        action: "duplicate",
        status: current.status,
        recordingId: current.id,
        recovered: false,
      };
    }

    const mutation = await tx.recording.updateMany({
      where: {
        id: current.id,
        recordingAttemptId: current.recordingAttemptId,
        status: current.status,
        errorMessage: current.errorMessage,
        ...(recovering
          ? { errorMessage: RECORDING_STARTING_TIMEOUT_RECONCILED }
          : {}),
      },
      data: updateData,
    });
    if (mutation.count !== 1) {
      throw new RecordingStatusFencingError(
        409,
        "RECORDING_ATTEMPT_CAS_CONFLICT",
        "The recording attempt changed before callback finalization.",
      );
    }

    if (
      targetStatus === RecordingStatus.STOPPED ||
      targetStatus === RecordingStatus.COMPLETED ||
      targetStatus === RecordingStatus.PROCESSING
    ) {
      await tx.sessionRecordingStopOperation.updateMany({
        where: {
          recordingId: current.id,
          state: { in: ["PENDING", "DELIVERING", "FAILED"] },
          ...(input.providerStatusReconciliation
            ? {}
            : { providerSessionIdAtCommand: null }),
        },
        data: {
          state: "DELIVERED",
          deliveredAt: new Date(),
          failedAt: null,
          lastError: null,
          lastErrorClass: null,
          nextRetryAt: null,
          lastDeliveryTransport:
            input.providerStatusReconciliation
              ? "voximplant_exact_attempt_status_reconciliation"
              : input.payload.status === "stopped"
              ? "voximplant_provider_auto_finalization"
              : "voximplant_webhook_reconciliation",
          fallbackPayload: Prisma.JsonNull,
        },
      });
    }

    return {
      action: "updated",
      status: targetStatus,
      recordingId: current.id,
      recovered: recovering,
    };
  });
}
