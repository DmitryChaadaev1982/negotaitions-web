import {
  AudioCodec,
  EgressStatus,
  EncodedFileOutput,
  EncodingOptions,
  S3Upload,
} from "livekit-server-sdk";
import { EgressClient } from "livekit-server-sdk";

import {
  ExternalService,
  RecordingStatus,
  RecordingType,
  type Recording,
  type Session,
} from "@/app/generated/prisma/client";
import { getAudioRecordingTargetBitrateKbps } from "@/lib/audio/config";
import { ensureSessionLiveKitRoomName, getLiveKitConfig } from "@/lib/livekit";
import { prisma } from "@/lib/prisma";
import { handleExternalServiceFailure } from "@/lib/services/external-service-events";
import {
  getMockExternalServiceError,
  isRecordingMockMode,
} from "@/lib/test-mode";
import {
  trackLiveKitRecordingMinutes,
  trackRecordingCreated,
  trackStorageObjectWritten,
} from "@/lib/services/usage-counters";
import {
  buildRecordingFileKey,
  getS3Config,
  headObject,
} from "@/lib/storage/s3";
import { isLiveKitRecordingProvider } from "@/lib/recording/provider";
import { admitRecordingAttempt } from "@/lib/recording/recording-attempt-fencing";

export function createEgressClient() {
  const config = getLiveKitConfig();
  if (!config) {
    throw new Error("LiveKit recording is not configured.");
  }

  return new EgressClient(config.serverUrl, config.apiKey, config.apiSecret);
}

function mapEgressStatusToRecordingStatus(egressStatus: EgressStatus): RecordingStatus {
  switch (egressStatus) {
    case EgressStatus.EGRESS_STARTING:
      return RecordingStatus.STARTING;
    case EgressStatus.EGRESS_ACTIVE:
      return RecordingStatus.RECORDING;
    case EgressStatus.EGRESS_ENDING:
      return RecordingStatus.PROCESSING;
    case EgressStatus.EGRESS_COMPLETE:
      return RecordingStatus.COMPLETED;
    case EgressStatus.EGRESS_FAILED:
    case EgressStatus.EGRESS_ABORTED:
    case EgressStatus.EGRESS_LIMIT_REACHED:
      return RecordingStatus.FAILED;
    default:
      return RecordingStatus.PROCESSING;
  }
}

function buildS3Upload() {
  const s3Config = getS3Config();
  if (!s3Config) {
    throw new Error("S3 storage is not configured.");
  }

  return new S3Upload({
    accessKey: s3Config.accessKeyId,
    secret: s3Config.secretAccessKey,
    region: s3Config.region,
    endpoint: s3Config.endpoint,
    bucket: s3Config.bucket,
    forcePathStyle: s3Config.forcePathStyle,
  });
}

export async function startAudioOnlyRoomRecording(
  session: Pick<Session, "id" | "livekitRoomName">,
) {
  const admission = await prisma.$transaction((tx) =>
    admitRecordingAttempt(tx, {
      sessionId: session.id,
      provider: "LIVEKIT_CLOUD",
      recordingType: RecordingType.AUDIO_ONLY,
    }),
  );
  const attemptRef = {
    id: admission.recordingId,
    sessionId: session.id,
    recordingAttemptId: admission.recordingAttemptId,
  };
  if (!admission.admitted) {
    const recording = await prisma.recording.findUniqueOrThrow({
      where: { id: admission.recordingId },
    });
    return { ok: true as const, recording };
  }

  if (isRecordingMockMode()) {
    const simulatedError = getMockExternalServiceError();

    if (
      simulatedError === "LIVEKIT_QUOTA_EXCEEDED" ||
      simulatedError === "LIVEKIT_BILLING_LIMIT"
    ) {
      const classified = await handleExternalServiceFailure(
        ExternalService.LIVEKIT,
        new Error(
          simulatedError === "LIVEKIT_BILLING_LIMIT"
            ? "Mock LiveKit billing limit reached"
            : "Mock LiveKit Egress quota exceeded",
        ),
        { sessionId: session.id, context: "start" },
      );

      const recording = await updateRecordingForAttempt(attemptRef, {
        status: RecordingStatus.FAILED,
        errorMessage: classified.message,
        startedAt: new Date(),
      });

      return { ok: false as const, recording, warning: classified.message };
    }

    const timestamp = Date.now();
    const recording = await updateRecordingForAttempt(attemptRef, {
      status: RecordingStatus.RECORDING,
      egressId: `mock-egress-${session.id}`,
      fileKey: null,
      fileName: `${timestamp}-mock-audio.mp4`,
      mimeType: "audio/mp4",
      startedAt: new Date(),
      endedAt: null,
      errorMessage: null,
    });

    return { ok: true as const, recording };
  }

  const livekitConfig = getLiveKitConfig();
  const s3Config = getS3Config();

  if (!livekitConfig) {
    const classified = await handleExternalServiceFailure(
      ExternalService.LIVEKIT,
      new Error("LiveKit env not configured"),
      { sessionId: session.id, context: "start" },
    );

    const recording = await updateRecordingForAttempt(attemptRef, {
      status: RecordingStatus.FAILED,
      errorMessage: classified.message,
    });

    return { ok: false as const, recording, warning: classified.message };
  }

  if (!s3Config) {
    const classified = await handleExternalServiceFailure(
      ExternalService.YANDEX_OBJECT_STORAGE,
      new Error("S3 not configured"),
      { sessionId: session.id, context: "start" },
    );

    const recording = await updateRecordingForAttempt(attemptRef, {
      status: RecordingStatus.FAILED,
      errorMessage: classified.message,
    });

    return { ok: false as const, recording, warning: classified.message };
  }

  const roomName = session.livekitRoomName ?? (await ensureSessionLiveKitRoomName(session));
  const timestamp = Date.now();
  const fileKey = buildRecordingFileKey(session.id, timestamp);
  const fileName = `${timestamp}-audio.mp4`;
  const startedAt = new Date();
  const targetBitrateKbps = getAudioRecordingTargetBitrateKbps();

  await updateRecordingForAttempt(attemptRef, {
    status: RecordingStatus.STARTING,
    egressId: null,
    fileKey,
    fileName,
    mimeType: "audio/mp4",
    startedAt,
    endedAt: null,
    errorMessage: null,
  });

  try {
    const egressClient = createEgressClient();
    const fileOutput = new EncodedFileOutput({
      filepath: fileKey,
      output: {
        case: "s3",
        value: buildS3Upload(),
      },
    });

    const encodingOptions = new EncodingOptions({
      audioCodec: AudioCodec.AAC,
      audioBitrate: targetBitrateKbps * 1000,
    });

    const egressInfo = await egressClient.startRoomCompositeEgress(
      roomName,
      { file: fileOutput },
      {
        audioOnly: true,
        encodingOptions,
      },
    );

    const recording = await updateRecordingForAttempt(attemptRef, {
      status: mapEgressStatusToRecordingStatus(egressInfo.status),
      egressId: egressInfo.egressId,
      fileKey,
      fileName,
      mimeType: "audio/mp4",
      startedAt,
      errorMessage: egressInfo.error ? String(egressInfo.error) : null,
    });

    await trackRecordingCreated();
    await trackStorageObjectWritten();

    return { ok: true as const, recording };
  } catch (error) {
    const classified = await handleExternalServiceFailure(
      ExternalService.LIVEKIT,
      error,
      { sessionId: session.id, context: "start" },
    );

    const recording = await updateRecordingForAttempt(attemptRef, {
      status: RecordingStatus.FAILED,
      errorMessage: classified.message,
    });

    return { ok: false as const, recording, warning: classified.message };
  }
}

export async function stopRecording(
  recording: Pick<
    Recording,
    | "id"
    | "sessionId"
    | "recordingAttemptId"
    | "egressId"
    | "startedAt"
    | "provider"
    | "status"
  >,
) {
  if (!isLiveKitRecordingProvider(recording.provider)) {
    const current = await prisma.recording.findUniqueOrThrow({
      where: { id: recording.id },
    });
    return {
      ok: true as const,
      recording: current,
      warning: "Skipped LiveKit stop for non-LiveKit recording provider.",
    };
  }
  const attemptRef = {
    id: recording.id,
    sessionId: recording.sessionId,
    recordingAttemptId: recording.recordingAttemptId,
  };

  if (isRecordingMockMode()) {
    const simulatedError = getMockExternalServiceError();

    if (simulatedError === "NETWORK_ERROR") {
      const classified = await handleExternalServiceFailure(
        ExternalService.LIVEKIT,
        new Error("Mock LiveKit network failure"),
        {
          sessionId: recording.sessionId,
          recordingId: recording.id,
          context: "stop",
        },
      );
      const updated = await updateRecordingForAttempt(attemptRef, {
        status: RecordingStatus.PROCESSING,
        endedAt: new Date(),
        errorMessage: classified.message,
      });

      return { ok: false as const, recording: updated, warning: classified.message };
    }

    const timestamp = Date.now();
    const updated = await updateRecordingForAttempt(attemptRef, {
      status: RecordingStatus.COMPLETED,
      egressId: recording.egressId,
      fileKey: buildRecordingFileKey(recording.sessionId, timestamp),
      fileName: `${timestamp}-mock-audio.mp4`,
      mimeType: "audio/mp4",
      endedAt: new Date(),
      errorMessage: null,
    });

    return { ok: true as const, recording: updated };
  }

  if (!recording.egressId) {
    const updated = await updateRecordingForAttempt(attemptRef, {
      status: RecordingStatus.STOPPED,
      endedAt: new Date(),
    });
    return { ok: true as const, recording: updated };
  }

  try {
    const egressClient = createEgressClient();
    const egressInfo = await egressClient.stopEgress(recording.egressId);
    const endedAt = new Date();

    const updated = await updateRecordingForAttempt(attemptRef, {
      status: mapEgressStatusToRecordingStatus(egressInfo.status),
      endedAt,
      errorMessage: egressInfo.error ? String(egressInfo.error) : null,
    });

    if (recording.startedAt) {
      await trackLiveKitRecordingMinutes(recording.startedAt, endedAt, recording.sessionId);
    }

    return { ok: true as const, recording: updated };
  } catch (error) {
    const classified = await handleExternalServiceFailure(
      ExternalService.LIVEKIT,
      error,
      {
        sessionId: recording.sessionId,
        recordingId: recording.id,
        context: "stop",
      },
    );

    const updated = await updateRecordingForAttempt(attemptRef, {
      status: RecordingStatus.PROCESSING,
      endedAt: new Date(),
      errorMessage: classified.message,
    });

    return { ok: false as const, recording: updated, warning: classified.message };
  }
}

export async function refreshRecordingStatus(
  recording: Pick<
    Recording,
    | "id"
    | "sessionId"
    | "recordingAttemptId"
    | "egressId"
    | "fileKey"
    | "status"
    | "startedAt"
    | "endedAt"
    | "provider"
  >,
) {
  if (!isLiveKitRecordingProvider(recording.provider)) {
    return prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
  }

  let nextStatus = recording.status;
  let errorMessage: string | null = null;
  let originalSizeBytes: number | undefined;

  if (recording.egressId) {
    try {
      const egressClient = createEgressClient();
      const egressList = await egressClient.listEgress({ egressId: recording.egressId });
      const egressInfo = egressList[0];

      if (egressInfo) {
        nextStatus = mapEgressStatusToRecordingStatus(egressInfo.status);
        errorMessage = egressInfo.error ? String(egressInfo.error) : null;

        if (
          egressInfo.status === EgressStatus.EGRESS_FAILED ||
          egressInfo.status === EgressStatus.EGRESS_ABORTED ||
          egressInfo.status === EgressStatus.EGRESS_LIMIT_REACHED
        ) {
          await handleExternalServiceFailure(
            ExternalService.LIVEKIT,
            new Error(errorMessage ?? "Egress failed"),
            {
              sessionId: recording.sessionId,
              recordingId: recording.id,
              context: "status",
            },
          );
        }
      }
    } catch (error) {
      const classified = await handleExternalServiceFailure(
        ExternalService.LIVEKIT,
        error,
        {
          sessionId: recording.sessionId,
          recordingId: recording.id,
          context: "status",
        },
      );
      errorMessage = classified.message;
    }
  }

  if (recording.fileKey) {
    const shouldCheckStorage =
      nextStatus !== RecordingStatus.RECORDING &&
      nextStatus !== RecordingStatus.STARTING;

    if (shouldCheckStorage) {
      try {
        const head = await headObject(recording.fileKey);
        if (head.exists && head.contentLength > 0) {
          nextStatus = RecordingStatus.COMPLETED;
          originalSizeBytes = head.contentLength;
        }
      } catch (error) {
        const classified = await handleExternalServiceFailure(
          ExternalService.YANDEX_OBJECT_STORAGE,
          error,
          {
            sessionId: recording.sessionId,
            recordingId: recording.id,
            context: "head",
          },
        );
        errorMessage = errorMessage ?? classified.message;
      }
    }
  }

  const mutation = await prisma.recording.updateMany({
    where: {
      id: recording.id,
      recordingAttemptId: recording.recordingAttemptId,
      status: recording.status,
    },
    data: {
      status: nextStatus,
      errorMessage,
      ...(originalSizeBytes !== undefined ? { originalSizeBytes } : {}),
    },
  });
  if (mutation.count !== 1) {
    return prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
  }
  return prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
}

async function updateRecordingForAttempt(
  recording: {
    id: string;
    sessionId: string;
    recordingAttemptId: string | null;
  },
  data: {
    status?: RecordingStatus;
    egressId?: string | null;
    fileKey?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    startedAt?: Date | null;
    endedAt?: Date | null;
    errorMessage?: string | null;
  },
) {
  const mutation = await prisma.recording.updateMany({
    where: {
      id: recording.id,
      sessionId: recording.sessionId,
      recordingAttemptId: recording.recordingAttemptId,
    },
    data,
  });
  if (mutation.count !== 1) {
    throw new Error("Recording attempt changed before provider result persistence.");
  }
  return prisma.recording.findUniqueOrThrow({ where: { id: recording.id } });
}

export async function getSessionRecording(sessionId: string) {
  return prisma.recording.findUnique({ where: { sessionId } });
}

export function isStoppableRecordingStatus(status: RecordingStatus) {
  return (
    status === RecordingStatus.STARTING || status === RecordingStatus.RECORDING
  );
}

export async function findActiveRecordingForSession(sessionId: string) {
  const recording = await getSessionRecording(sessionId);

  if (!recording || !isStoppableRecordingStatus(recording.status)) {
    return null;
  }

  return recording;
}

function isActiveRecordingStatus(status: RecordingStatus) {
  return (
    status === RecordingStatus.RECORDING ||
    status === RecordingStatus.STARTING ||
    status === RecordingStatus.PROCESSING
  );
}

export async function handleNegotiationStartRecording(sessionId: string) {
  const existingRecording = await getSessionRecording(sessionId);

  if (existingRecording && isActiveRecordingStatus(existingRecording.status)) {
    return { ok: true as const, recording: existingRecording };
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, livekitRoomName: true },
  });

  if (!session) {
    return null;
  }

  return startAudioOnlyRoomRecording(session);
}

export async function handleNegotiationFinishRecording(sessionId: string) {
  const recording = await getSessionRecording(sessionId);

  if (!recording) {
    return { recording: null, warning: undefined };
  }

  if (
    recording.status === RecordingStatus.NOT_STARTED ||
    recording.status === RecordingStatus.FAILED ||
    recording.status === RecordingStatus.COMPLETED ||
    recording.status === RecordingStatus.STOPPED
  ) {
    return { recording, warning: undefined };
  }

  const result = await stopRecording(recording);
  return { recording: result.recording, warning: result.warning };
}
