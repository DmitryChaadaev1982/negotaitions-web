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
  type Recording,
  type Session,
} from "@/app/generated/prisma/client";
import { getAudioRecordingTargetBitrateKbps } from "@/lib/audio/config";
import { ensureSessionLiveKitRoomName, getLiveKitConfig } from "@/lib/livekit";
import { prisma } from "@/lib/prisma";
import { handleExternalServiceFailure } from "@/lib/services/external-service-events";
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
  const livekitConfig = getLiveKitConfig();
  const s3Config = getS3Config();

  if (!livekitConfig) {
    const classified = await handleExternalServiceFailure(
      ExternalService.LIVEKIT,
      new Error("LiveKit env not configured"),
      { sessionId: session.id, context: "start" },
    );

    const recording = await upsertRecording(session.id, {
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

    const recording = await upsertRecording(session.id, {
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

  await upsertRecording(session.id, {
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

    const recording = await upsertRecording(session.id, {
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

    const recording = await upsertRecording(session.id, {
      status: RecordingStatus.FAILED,
      errorMessage: classified.message,
    });

    return { ok: false as const, recording, warning: classified.message };
  }
}

export async function stopRecording(recording: Pick<Recording, "id" | "sessionId" | "egressId" | "startedAt">) {
  if (!recording.egressId) {
    const updated = await upsertRecording(recording.sessionId, {
      status: RecordingStatus.STOPPED,
      endedAt: new Date(),
    });
    return { ok: true as const, recording: updated };
  }

  try {
    const egressClient = createEgressClient();
    const egressInfo = await egressClient.stopEgress(recording.egressId);
    const endedAt = new Date();

    const updated = await upsertRecording(recording.sessionId, {
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

    const updated = await upsertRecording(recording.sessionId, {
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
    | "egressId"
    | "fileKey"
    | "status"
    | "startedAt"
    | "endedAt"
  >,
) {
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

  const updated = await prisma.recording.update({
    where: { id: recording.id },
    data: {
      status: nextStatus,
      errorMessage,
      ...(originalSizeBytes !== undefined ? { originalSizeBytes } : {}),
    },
  });

  return updated;
}

async function upsertRecording(
  sessionId: string,
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
  return prisma.recording.upsert({
    where: { sessionId },
    create: {
      sessionId,
      status: data.status ?? RecordingStatus.NOT_STARTED,
      egressId: data.egressId ?? undefined,
      fileKey: data.fileKey ?? undefined,
      fileName: data.fileName ?? undefined,
      mimeType: data.mimeType ?? undefined,
      startedAt: data.startedAt ?? undefined,
      endedAt: data.endedAt ?? undefined,
      errorMessage: data.errorMessage ?? undefined,
    },
    update: data,
  });
}

export async function getSessionRecording(sessionId: string) {
  return prisma.recording.findUnique({ where: { sessionId } });
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
