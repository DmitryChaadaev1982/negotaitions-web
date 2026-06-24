import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CompressionStatus,
  ExternalService,
  ExternalServiceEventSeverity,
  ParticipantType,
  Prisma,
  RecordingStatus,
  TranscriptSource,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { compressAudioForTranscription } from "@/lib/audio/compress";
import { getAudioTranscriptionMaxFileBytes } from "@/lib/audio/config";
import { prisma } from "@/lib/prisma";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";
import {
  isOpenAiConfigured,
  transcribeAudioBuffer,
  type TranscriptionLanguageHint,
} from "@/lib/services/openai-transcription";
import {
  trackOpenAiTranscriptionBytes,
  trackOpenAiTranscriptionMinutes,
} from "@/lib/services/usage-counters";
import {
  buildCompressedFileKey,
  downloadObjectToBuffer,
  uploadBufferToS3,
} from "@/lib/storage/s3";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import { classifyExternalServiceError } from "@/lib/services/error-classifier";
import { applySpeakerMapping } from "@/lib/transcription/speaker-labels";
import {
  getMockExternalServiceError,
  isTranscriptionMockMode,
} from "@/lib/test-mode";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
  language: z.enum(["ru", "en", "auto"]).optional().default("auto"),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const ACTIVE_TRANSCRIPT_STATUSES = new Set<TranscriptStatus>([
  TranscriptStatus.QUEUED,
  TranscriptStatus.DOWNLOADING_RECORDING,
  TranscriptStatus.COMPRESSING_AUDIO,
  TranscriptStatus.TRANSCRIBING,
]);

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { joinToken, language } = parsed.data;

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found or deleted." }, { status: 404 });
  }

  if (!isTranscriptionMockMode() && !isOpenAiConfigured()) {
    return NextResponse.json({ error: "OpenAI API key is missing." }, { status: 503 });
  }

  const recording = await prisma.recording.findUnique({ where: { sessionId } });

  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  if (
    recording.status !== RecordingStatus.COMPLETED ||
    !recording.fileKey
  ) {
    return NextResponse.json(
      { error: "No recording file available yet." },
      { status: 400 },
    );
  }

  if (!recording.fileKey) {
    return NextResponse.json(
      { error: "No recording file key available." },
      { status: 400 },
    );
  }

  const existingTranscript = await prisma.transcript.findUnique({
    where: { sessionId },
  });

  if (
    existingTranscript &&
    ACTIVE_TRANSCRIPT_STATUSES.has(existingTranscript.status)
  ) {
    return NextResponse.json(
      {
        error: "A transcription is already in progress.",
        transcriptId: existingTranscript.id,
        status: existingTranscript.status,
      },
      { status: 409 },
    );
  }

  const now = new Date();

  const transcript = await prisma.transcript.upsert({
    where: { sessionId },
    create: {
      sessionId,
      recordingId: recording.id,
      source: TranscriptSource.GENERATED,
      status: TranscriptStatus.QUEUED,
      text: existingTranscript?.text ?? "",
      language: language === "auto" ? null : language,
      startedAt: now,
    },
    update: {
      recordingId: recording.id,
      source: TranscriptSource.GENERATED,
      status: TranscriptStatus.QUEUED,
      language: language === "auto" ? null : language,
      startedAt: now,
      completedAt: null,
      errorMessage: null,
    },
  });

  if (isTranscriptionMockMode()) {
    return await processMockTranscription(
      sessionId,
      recording,
      transcript.id,
      language,
    );
  }

  if (!recording.fileKey) {
    await failTranscript(transcript.id, "Recording file key is missing.");
    return NextResponse.json({ error: "Recording file key is missing." }, { status: 400 });
  }

  return await processRealTranscription(
    sessionId,
    { ...recording, fileKey: recording.fileKey },
    transcript.id,
    language,
  );
}

async function setTranscriptStatus(
  transcriptId: string,
  status: TranscriptStatus,
) {
  await prisma.transcript.update({
    where: { id: transcriptId },
    data: { status },
  });
}

async function failTranscript(
  transcriptId: string,
  errorMessage: string,
) {
  await prisma.transcript.update({
    where: { id: transcriptId },
    data: {
      status: TranscriptStatus.FAILED,
      errorMessage,
      completedAt: new Date(),
    },
  });
}

async function processMockTranscription(
  sessionId: string,
  recording: { id: string; fileKey: string | null; fileName: string | null; mimeType: string | null },
  transcriptId: string,
  language: string,
) {
  const simulatedError = getMockExternalServiceError();

  if (simulatedError === "YANDEX_STORAGE_DOWNLOAD_FAILED") {
    const classified = classifyExternalServiceError(
      ExternalService.YANDEX_OBJECT_STORAGE,
      new Error("Mock storage download failure"),
      "download",
    );

    await logExternalServiceEvent({
      service: classified.service,
      severity: classified.severity,
      errorCode: classified.errorCode,
      title: classified.title,
      message: classified.message,
      rawError: classified.rawError,
      sessionId,
      recordingId: recording.id,
    });

    await failTranscript(transcriptId, classified.message);
    return NextResponse.json({ error: classified.message }, { status: 500 });
  }

  if (
    simulatedError === "OPENAI_QUOTA_EXCEEDED" ||
    simulatedError === "OPENAI_BILLING_LIMIT" ||
    simulatedError === "OPENAI_RATE_LIMIT"
  ) {
    const classified = classifyExternalServiceError(
      ExternalService.OPENAI,
      {
        status: 429,
        message:
          simulatedError === "OPENAI_RATE_LIMIT"
            ? "Mock OpenAI rate limit"
            : simulatedError === "OPENAI_BILLING_LIMIT"
              ? "Mock OpenAI billing payment limit"
              : "Mock OpenAI quota exceeded",
      },
      "transcription",
    );

    await logExternalServiceEvent({
      service: classified.service,
      severity: classified.severity,
      errorCode: classified.errorCode,
      title: classified.title,
      message: classified.message,
      rawError: classified.rawError,
      sessionId,
      recordingId: recording.id,
    });

    await failTranscript(transcriptId, classified.message);
    return NextResponse.json({ error: classified.message }, { status: 500 });
  }

  await setTranscriptStatus(transcriptId, TranscriptStatus.DOWNLOADING_RECORDING);
  await setTranscriptStatus(transcriptId, TranscriptStatus.TRANSCRIBING);

  const saved = await prisma.transcript.update({
    where: { id: transcriptId },
    data: {
      status: TranscriptStatus.COMPLETED,
      text: "Mock transcript for NegotAItions regression test.",
      diarizedText: "[Speaker 1] Mock transcript for NegotAItions regression test.",
      language: language === "auto" ? "en" : language,
      originalFileName: recording.fileName ?? "mock-audio.mp4",
      originalMimeType: recording.mimeType ?? "audio/mp4",
      transcriptionModel: "mock-transcription",
      hasSpeakerDiarization: true,
      speakerMapping: Prisma.JsonNull,
      completedAt: new Date(),
    },
  });

  await prisma.transcriptSegment.deleteMany({ where: { transcriptId } });
  await prisma.transcriptSegment.create({
    data: {
      transcriptId,
      speakerLabel: "speaker_1",
      startSeconds: 0,
      endSeconds: 3,
      text: "Mock transcript for NegotAItions regression test.",
      orderIndex: 0,
    },
  });

  return NextResponse.json({
    transcriptId: saved.id,
    status: saved.status,
    text: saved.text,
    language: saved.language,
    model: saved.transcriptionModel,
    completedAt: saved.completedAt?.toISOString() ?? null,
  });
}

async function processRealTranscription(
  sessionId: string,
  recording: {
    id: string;
    fileKey: string;
    fileName: string | null;
    mimeType: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
  },
  transcriptId: string,
  language: string,
) {
  try {
    await setTranscriptStatus(transcriptId, TranscriptStatus.DOWNLOADING_RECORDING);
    const originalBuffer = await downloadObjectToBuffer(recording.fileKey, {
      sessionId,
      recordingId: recording.id,
    });

    if (!recording.mimeType) {
      await prisma.recording.update({
        where: { id: recording.id },
        data: { originalSizeBytes: originalBuffer.length },
      });
    } else {
      await prisma.recording.update({
        where: { id: recording.id },
        data: { originalSizeBytes: originalBuffer.length },
      });
    }

    await setTranscriptStatus(transcriptId, TranscriptStatus.COMPRESSING_AUDIO);
    const compression = await compressAudioForTranscription(
      originalBuffer,
      recording.fileName ?? "recording.mp4",
      { recordingId: recording.id, sessionId },
    );

    const timestamp = Date.now();
    const extension = compression.compressedFileName.endsWith(".mp3") ? "mp3" : "webm";
    const compressedFileKey = buildCompressedFileKey(sessionId, timestamp, extension);

    await uploadBufferToS3(
      compressedFileKey,
      compression.compressedBuffer,
      compression.compressedMimeType,
      { sessionId, recordingId: recording.id },
    );

    await prisma.recording.update({
      where: { id: recording.id },
      data: {
        compressedFileKey,
        compressedFileName: compression.compressedFileName,
        compressedMimeType: compression.compressedMimeType,
        compressedSizeBytes: compression.compressedSizeBytes,
        compressionStatus: CompressionStatus.COMPLETED,
        compressionError: null,
      },
    });

    const maxBytes = getAudioTranscriptionMaxFileBytes();
    if (compression.compressedSizeBytes > maxBytes) {
      const classified = classifyExternalServiceError(
        ExternalService.OPENAI,
        new Error("File too large"),
        "file_too_large",
      );

      await logExternalServiceEvent({
        service: classified.service,
        severity: ExternalServiceEventSeverity.ERROR,
        errorCode: classified.errorCode,
        title: classified.title,
        message: classified.message,
        rawError: classified.rawError,
        sessionId,
        recordingId: recording.id,
      });

      await failTranscript(transcriptId, classified.message);
      return NextResponse.json({ error: classified.message }, { status: 413 });
    }

    await setTranscriptStatus(transcriptId, TranscriptStatus.TRANSCRIBING);
    const transcription = await transcribeAudioBuffer(
      compression.compressedBuffer,
      compression.compressedFileName,
      compression.compressedMimeType,
      language as TranscriptionLanguageHint,
      { sessionId, recordingId: recording.id },
    );

    const mappedSegments = applySpeakerMapping(transcription.segments, {});

    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.transcript.update({
        where: { id: transcriptId },
        data: {
          status: TranscriptStatus.COMPLETED,
          text: transcription.text,
          diarizedText: transcription.diarizedText,
          language: transcription.language,
          originalFileName: compression.compressedFileName,
          originalMimeType: compression.compressedMimeType,
          transcriptionModel: transcription.model,
          hasSpeakerDiarization: transcription.hasSpeakerDiarization,
          speakerMapping: Prisma.JsonNull,
          completedAt: new Date(),
          errorMessage: null,
        },
      });

      await tx.transcriptSegment.deleteMany({ where: { transcriptId } });

      if (mappedSegments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: mappedSegments.map((segment) => ({
            transcriptId,
            speakerLabel: segment.speakerLabel,
            mappedParticipantId: segment.mappedParticipantId,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            text: segment.text,
            orderIndex: segment.orderIndex,
          })),
        });
      }

      return updated;
    });

    if (recording.startedAt && recording.endedAt) {
      const minutes =
        (recording.endedAt.getTime() - recording.startedAt.getTime()) / 60000;
      await trackOpenAiTranscriptionMinutes(minutes, sessionId);
    }

    await trackOpenAiTranscriptionBytes(compression.compressedSizeBytes, sessionId);

    return NextResponse.json({
      transcriptId: saved.id,
      status: saved.status,
      text: saved.text,
      language: saved.language,
      model: saved.transcriptionModel,
      completedAt: saved.completedAt?.toISOString() ?? null,
    });
  } catch (error) {
    const classified = classifyExternalServiceError(
      ExternalService.APP,
      error,
      "transcription",
    );

    await logExternalServiceEvent({
      service: ExternalService.APP,
      severity: ExternalServiceEventSeverity.ERROR,
      errorCode: classified.errorCode,
      title: "Transcription failed",
      message: classified.message,
      rawError: classified.rawError,
      sessionId,
      recordingId: recording.id,
    });

    const message = error instanceof Error ? error.message : "Transcription failed.";
    await failTranscript(transcriptId, message);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
