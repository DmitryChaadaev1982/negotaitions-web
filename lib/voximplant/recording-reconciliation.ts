import "server-only";

import { RecordingStatus } from "@/app/generated/prisma/client";
import { appendRecordingDebugEvent } from "@/lib/debug/recording-debug";
import { prisma } from "@/lib/prisma";
import { resolveEffectiveRecordingProvider } from "@/lib/recording/provider";
import { retryRecordingStopAfterExactAttemptReconciliation } from "@/lib/session-completion";
import { VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION } from "@/lib/voximplant/recording-control-signature";
import {
  applyVoximplantRecordingStatusCallback,
  RECORDING_STARTING_TIMEOUT_RECONCILED,
} from "@/lib/voximplant/recording-status-fencing";
import {
  queryVoximplantRecordingAttemptStatus,
  type VoximplantRecordingStatusQueryResult,
} from "@/lib/voximplant/server-stop-client";
import { getVoximplantServerStopConfig } from "@/lib/voximplant/server-stop-config";
import {
  evaluateRecordingReconciliationAdmission,
  normalizeSafeReconciledRecordingObjectKey,
} from "@/lib/voximplant/recording-reconciliation-policy";

export {
  RECORDING_RECONCILIATION_THROTTLE_MS,
  STOPPING_RECONCILIATION_MIN_AGE_MS,
} from "@/lib/voximplant/recording-reconciliation-policy";

type ReconciliationResult = {
  action:
    | "not_eligible"
    | "throttled"
    | "reconciled"
    | "recoverable_uncertainty"
    | "stale";
  status: RecordingStatus | null;
  recordingAttemptId: string | null;
  providerStatus?: string;
  reason?: string;
};

type ReconciliationDependencies = {
  now?: () => Date;
  queryStatus?: typeof queryVoximplantRecordingAttemptStatus;
  applyStatus?: typeof applyVoximplantRecordingStatusCallback;
  retryStop?: typeof retryRecordingStopAfterExactAttemptReconciliation;
  getConfig?: typeof getVoximplantServerStopConfig;
  prismaClient?: typeof prisma;
};

const inFlightBySession = new Map<string, Promise<ReconciliationResult>>();

async function markRecoverableUncertainty(input: {
  prismaClient: typeof prisma;
  sessionId: string;
  recordingId: string;
  recordingAttemptId: string;
  currentStatus: RecordingStatus;
  now: Date;
  reason: string;
}): Promise<ReconciliationResult> {
  const eligibleStatuses =
    input.currentStatus === RecordingStatus.STARTING
      ? [RecordingStatus.STARTING]
      : [RecordingStatus.FAILED];
  const updated = await input.prismaClient.recording.updateMany({
    where: {
      id: input.recordingId,
      recordingAttemptId: input.recordingAttemptId,
      status: { in: eligibleStatuses },
      ...(input.currentStatus === RecordingStatus.FAILED
        ? { errorMessage: RECORDING_STARTING_TIMEOUT_RECONCILED }
        : {}),
    },
    data: {
      status: RecordingStatus.FAILED,
      endedAt: input.now,
      errorMessage: RECORDING_STARTING_TIMEOUT_RECONCILED,
    },
  });
  if (updated.count !== 1) {
    return {
      action: "stale",
      status: null,
      recordingAttemptId: input.recordingAttemptId,
      reason: "recording_attempt_changed",
    };
  }
  appendRecordingDebugEvent({
    sessionId: input.sessionId,
    source: "materials-status",
    level: "warn",
    step: "recording-reconciliation:recoverable-uncertainty",
    message: input.reason,
    data: {
      recordingId: input.recordingId,
      recordingAttemptId: input.recordingAttemptId,
    },
  });
  return {
    action: "recoverable_uncertainty",
    status: RecordingStatus.FAILED,
    recordingAttemptId: input.recordingAttemptId,
    reason: input.reason,
  };
}

async function runReconciliation(
  sessionId: string,
  dependencies: ReconciliationDependencies,
): Promise<ReconciliationResult> {
  const prismaClient = dependencies.prismaClient ?? prisma;
  const now = dependencies.now?.() ?? new Date();
  const recording = await prismaClient.recording.findUnique({
    where: { sessionId },
    select: {
      id: true,
      provider: true,
      status: true,
      recordingAttemptId: true,
      errorMessage: true,
      startedAt: true,
      updatedAt: true,
      stopOperation: {
        select: {
          id: true,
          state: true,
          updatedAt: true,
        },
      },
      session: {
        select: {
          voximplantControlChannel: {
            select: {
              providerSessionId: true,
              conferenceName: true,
              controlUrl: true,
              controlUrlFingerprint: true,
            },
          },
        },
      },
    },
  });
  if (
    !recording ||
    resolveEffectiveRecordingProvider(recording.provider) !== "voximplant" ||
    !recording.recordingAttemptId
  ) {
    return {
      action: "not_eligible",
      status: recording?.status ?? null,
      recordingAttemptId: recording?.recordingAttemptId ?? null,
      reason: "not_current_fenced_voximplant_attempt",
    };
  }

  const admission = evaluateRecordingReconciliationAdmission({
    status: recording.status,
    recordingAttemptId: recording.recordingAttemptId,
    errorMessage: recording.errorMessage,
    startedAt: recording.startedAt,
    updatedAt: recording.updatedAt,
    stopOperation: recording.stopOperation,
    now,
  });
  const recoverableFailed = admission.reason === "recoverable_failed";
  if (!admission.eligible) {
    return {
      action: admission.reason === "throttled" ? "throttled" : "not_eligible",
      status: recording.status,
      recordingAttemptId: recording.recordingAttemptId,
    };
  }

  const claimed = await prismaClient.recording.updateMany({
    where: {
      id: recording.id,
      recordingAttemptId: recording.recordingAttemptId,
      status: recording.status,
      errorMessage: recording.errorMessage,
      updatedAt: recording.updatedAt,
    },
    data: { updatedAt: now },
  });
  if (claimed.count !== 1) {
    return {
      action: "stale",
      status: recording.status,
      recordingAttemptId: recording.recordingAttemptId,
      reason: "reconciliation_claim_lost",
    };
  }

  const controlChannel = recording.session.voximplantControlChannel;
  let config: ReturnType<typeof getVoximplantServerStopConfig> | null;
  try {
    config = (dependencies.getConfig ?? getVoximplantServerStopConfig)();
  } catch {
    config = null;
  }
  if (
    !controlChannel ||
    !config ||
    !config.controlSecret ||
    config.mode === "disabled"
  ) {
    if (
      recording.status === RecordingStatus.STARTING ||
      recoverableFailed
    ) {
      return markRecoverableUncertainty({
        prismaClient,
        sessionId,
        recordingId: recording.id,
        recordingAttemptId: recording.recordingAttemptId,
        currentStatus: recording.status,
        now,
        reason: "Provider recording status control channel is unavailable.",
      });
    }
    return {
      action: "recoverable_uncertainty",
      status: recording.status,
      recordingAttemptId: recording.recordingAttemptId,
      reason: "provider_control_channel_unavailable",
    };
  }

  const queryStatus =
    dependencies.queryStatus ?? queryVoximplantRecordingAttemptStatus;
  const providerResult: VoximplantRecordingStatusQueryResult = await queryStatus({
    controlUrl: controlChannel.controlUrl,
    controlUrlFingerprint: controlChannel.controlUrlFingerprint,
    controlSecret: config.controlSecret,
    timeoutMs: config.controlTimeoutMs,
    operationId: `reconcile:${recording.id}:${recording.recordingAttemptId}`,
    sessionId,
    conferenceName: controlChannel.conferenceName,
    providerSessionId: controlChannel.providerSessionId,
    recordingAttemptId: recording.recordingAttemptId,
  });

  if (providerResult.code !== "STATUS_FOUND") {
    if (
      recording.status === RecordingStatus.STARTING ||
      recoverableFailed
    ) {
      return markRecoverableUncertainty({
        prismaClient,
        sessionId,
        recordingId: recording.id,
        recordingAttemptId: recording.recordingAttemptId,
        currentStatus: recording.status,
        now,
        reason:
          providerResult.warning ??
          "Provider recording status is temporarily unavailable.",
      });
    }
    return {
      action: "recoverable_uncertainty",
      status: recording.status,
      recordingAttemptId: recording.recordingAttemptId,
      reason: providerResult.code,
    };
  }

  const providerAttempt = providerResult.attempt;
  if (
    providerAttempt.status === "starting" ||
    providerAttempt.status === "idle" ||
    (providerAttempt.status === "error" &&
      !providerAttempt.terminalConfirmed)
  ) {
    return markRecoverableUncertainty({
      prismaClient,
      sessionId,
      recordingId: recording.id,
      recordingAttemptId: recording.recordingAttemptId,
      currentStatus: recording.status,
      now,
      reason:
        providerAttempt.message ??
        "Provider did not confirm that recording started.",
    });
  }

  const fileKey = normalizeSafeReconciledRecordingObjectKey(
    providerAttempt.objectKey,
  );
  const applyStatus =
    dependencies.applyStatus ?? applyVoximplantRecordingStatusCallback;
  const applied = await applyStatus({
    sessionId,
    payload: {
      status: providerAttempt.status,
      protocolVersion: VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION,
      recordingAttemptId: providerAttempt.recordingAttemptId,
      recordingId: providerAttempt.recordingId,
      fileKey,
      errorCode: providerAttempt.errorCode,
      message: providerAttempt.message,
      startedAt: providerAttempt.startedAt,
      stoppedAt: providerAttempt.stoppedAt,
    },
    verifyObjectBeforeCompletion: providerAttempt.status === "stopped",
    providerStatusReconciliation: true,
    prismaClient,
  });
  if (
    recording.stopOperation &&
    (recording.stopOperation.state === "FAILED" ||
      recording.stopOperation.state === "DELIVERING") &&
    (providerAttempt.status === "recording" ||
      providerAttempt.status === "paused" ||
      providerAttempt.status === "resuming")
  ) {
    const retryStop =
      dependencies.retryStop ??
      retryRecordingStopAfterExactAttemptReconciliation;
    await retryStop({
      sessionId,
      operationRowId: recording.stopOperation.id,
      recordingAttemptId: recording.recordingAttemptId,
      now,
    });
  }
  appendRecordingDebugEvent({
    sessionId,
    source: "materials-status",
    level: applied.status === RecordingStatus.COMPLETED ? "success" : "info",
    step: "recording-reconciliation:applied",
    message: `Exact provider attempt reconciled to ${applied.status}.`,
    data: {
      recordingId: applied.recordingId,
      recordingAttemptId: recording.recordingAttemptId,
      providerStatus: providerAttempt.status,
      recovered: applied.recovered,
    },
  });
  return {
    action: "reconciled",
    status: applied.status,
    recordingAttemptId: recording.recordingAttemptId,
    providerStatus: providerAttempt.status,
  };
}

export function maybeReconcileVoximplantRecordingAttempt(
  sessionId: string,
  dependencies: ReconciliationDependencies = {},
): Promise<ReconciliationResult> {
  const existing = inFlightBySession.get(sessionId);
  if (existing) return existing;
  const promise = runReconciliation(sessionId, dependencies).finally(() => {
    if (inFlightBySession.get(sessionId) === promise) {
      inFlightBySession.delete(sessionId);
    }
  });
  inFlightBySession.set(sessionId, promise);
  return promise;
}
