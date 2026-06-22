import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CompressionStatus,
  ExternalService,
  ExternalServiceEventSeverity,
  ParticipantType,
  Prisma,
  TranscriptSource,
} from "@/app/generated/prisma/client";
import { compressAudioForTranscription } from "@/lib/audio/compress";
import { getAudioTranscriptionMaxFileBytes } from "@/lib/audio/config";
import { prisma } from "@/lib/prisma";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";
import {
  isOpenAiConfigured,
  transcribeAudioBuffer,
  type TranscriptionLanguageHint,
  type TranscriptionWarningCode,
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
import {
  applySpeakerMapping,
  type SpeakerMapping,
} from "@/lib/transcription/speaker-labels";

export const runtime = "nodejs";

const transcribeSchema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
  recordingId: z.string().trim().min(1, "Recording id is required"),
  languageHint: z.enum(["ru", "en", "auto"]).default("auto"),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function serializeTranscript(transcript: {
  id: string;
  source: TranscriptSource;
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  speakerMapping: unknown;
  updatedAt: Date;
  segments: Array<{
    id: string;
    speakerLabel: string | null;
    mappedParticipantId: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    text: string;
    orderIndex: number;
  }>;
}) {
  return {
    id: transcript.id,
    source: transcript.source,
    text: transcript.text,
    diarizedText: transcript.diarizedText,
    language: transcript.language,
    transcriptionModel: transcript.transcriptionModel,
    hasSpeakerDiarization: transcript.hasSpeakerDiarization,
    speakerMapping: (transcript.speakerMapping as SpeakerMapping | null) ?? null,
    updatedAt: transcript.updatedAt.toISOString(),
    segments: transcript.segments
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((segment) => ({
        id: segment.id,
        speakerLabel: segment.speakerLabel,
        mappedParticipantId: segment.mappedParticipantId,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
        orderIndex: segment.orderIndex,
      })),
  };
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = transcribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { joinToken, recordingId, languageHint } = parsed.data;

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const sessionRecord = await prisma.session.findFirst({
    where: { id: sessionId },
    select: { deletedAt: true },
  });

  if (sessionRecord?.deletedAt) {
    return NextResponse.json({ error: "Session is read-only." }, { status: 403 });
  }

  if (!isOpenAiConfigured()) {
    return NextResponse.json(
      { error: "OpenAI API key is missing." },
      { status: 503 },
    );
  }

  const recording = await prisma.recording.findFirst({
    where: { id: recordingId, sessionId },
  });

  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  if (!recording.fileKey) {
    return NextResponse.json(
      { error: "No recording file available yet." },
      { status: 400 },
    );
  }

  try {
    const originalBuffer = await downloadObjectToBuffer(recording.fileKey, {
      sessionId,
      recordingId: recording.id,
    });

    if (!recording.originalSizeBytes) {
      await prisma.recording.update({
        where: { id: recording.id },
        data: { originalSizeBytes: originalBuffer.length },
      });
    }

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

      return NextResponse.json({ error: classified.message }, { status: 413 });
    }

    const transcription = await transcribeAudioBuffer(
      compression.compressedBuffer,
      compression.compressedFileName,
      compression.compressedMimeType,
      languageHint as TranscriptionLanguageHint,
      { sessionId, recordingId: recording.id },
    );

    const mappedSegments = applySpeakerMapping(transcription.segments, {});

    const transcript = await prisma.$transaction(async (tx) => {
      const saved = await tx.transcript.upsert({
        where: { sessionId },
        create: {
          sessionId,
          recordingId: recording.id,
          source: TranscriptSource.GENERATED,
          text: transcription.text,
          diarizedText: transcription.diarizedText,
          language: transcription.language,
          originalFileName: compression.compressedFileName,
          originalMimeType: compression.compressedMimeType,
          transcriptionModel: transcription.model,
          hasSpeakerDiarization: transcription.hasSpeakerDiarization,
          speakerMapping: Prisma.JsonNull,
        },
        update: {
          recordingId: recording.id,
          source: TranscriptSource.GENERATED,
          text: transcription.text,
          diarizedText: transcription.diarizedText,
          language: transcription.language,
          originalFileName: compression.compressedFileName,
          originalMimeType: compression.compressedMimeType,
          transcriptionModel: transcription.model,
          hasSpeakerDiarization: transcription.hasSpeakerDiarization,
          speakerMapping: Prisma.JsonNull,
        },
      });

      await tx.transcriptSegment.deleteMany({
        where: { transcriptId: saved.id },
      });

      if (mappedSegments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: mappedSegments.map((segment) => ({
            transcriptId: saved.id,
            speakerLabel: segment.speakerLabel,
            mappedParticipantId: segment.mappedParticipantId,
            startSeconds: segment.startSeconds,
            endSeconds: segment.endSeconds,
            text: segment.text,
            orderIndex: segment.orderIndex,
          })),
        });
      }

      return tx.transcript.findUniqueOrThrow({
        where: { id: saved.id },
        include: {
          segments: {
            orderBy: { orderIndex: "asc" },
          },
        },
      });
    });

    if (recording.startedAt && recording.endedAt) {
      const minutes =
        (recording.endedAt.getTime() - recording.startedAt.getTime()) / 60000;
      await trackOpenAiTranscriptionMinutes(minutes, sessionId);
    }

    await trackOpenAiTranscriptionBytes(compression.compressedSizeBytes, sessionId);

    return NextResponse.json({
      transcript: serializeTranscript(transcript),
      warnings: transcription.warnings as TranscriptionWarningCode[],
      recording: {
        compressedSizeBytes: compression.compressedSizeBytes,
        compressionStatus: CompressionStatus.COMPLETED,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
