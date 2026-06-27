import { NextResponse } from "next/server";

import {
  CompressionStatus,
  ExternalService,
  ExternalServiceEventSeverity,
  Prisma,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { compressAudioForTranscription } from "@/lib/audio/compress";
import {
  getAudioRecordingTargetBitrateKbps,
  getAudioTranscriptionChannels,
  getAudioTranscriptionMaxFileBytes,
  getAudioTranscriptionSampleRate,
  getAudioTranscriptionTargetBitrateKbps,
} from "@/lib/audio/config";
import { getOpenAiTranscriptionConfig } from "@/lib/audio/openai-transcription-config";
import { getTranscriptionStrategy } from "@/lib/audio/two-pass-transcription-config";
import { AudioFileTooLargeError } from "@/lib/audio/validate";
import { buildTranscriptionPrompt } from "@/lib/ai/transcription-prompt";
import { prisma } from "@/lib/prisma";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";
import {
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
import { classifyExternalServiceError } from "@/lib/services/error-classifier";
import { applySpeakerMapping } from "@/lib/transcription/speaker-labels";
import { getMockExternalServiceError } from "@/lib/test-mode";

export const MANUAL_TRANSCRIPTION_STOP_SENTINEL = "__MANUAL_TRANSCRIPTION_STOP__";

class TranscriptionCancelledError extends Error {
  constructor() {
    super("Transcription was stopped manually.");
    this.name = "TranscriptionCancelledError";
  }
}

async function throwIfTranscriptionStoppedManually(
  transcriptId: string,
): Promise<void> {
  const transcript = await prisma.transcript.findUnique({
    where: { id: transcriptId },
    select: { status: true, errorMessage: true },
  });

  const manuallyStopped =
    transcript?.status === TranscriptStatus.FAILED &&
    Boolean(
      transcript.errorMessage?.includes(MANUAL_TRANSCRIPTION_STOP_SENTINEL),
    );

  if (manuallyStopped) {
    throw new TranscriptionCancelledError();
  }
}

export async function setTranscriptStatus(
  transcriptId: string,
  status: TranscriptStatus,
): Promise<void> {
  await throwIfTranscriptionStoppedManually(transcriptId);
  await prisma.transcript.update({
    where: { id: transcriptId },
    data: { status },
  });
}

export async function failTranscript(
  transcriptId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.transcript.update({
    where: { id: transcriptId },
    data: {
      status: TranscriptStatus.FAILED,
      errorMessage,
      completedAt: new Date(),
    },
  });
}

type RecordingForTranscription = {
  id: string;
  fileKey: string | null;
  fileName: string | null;
  mimeType: string | null;
};

type RecordingForRealTranscription = RecordingForTranscription & {
  fileKey: string;
  startedAt: Date | null;
  endedAt: Date | null;
};

export async function runMockTranscription(
  sessionId: string,
  recording: RecordingForTranscription,
  transcriptId: string,
  language: string,
): Promise<NextResponse> {
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

  const mockStrategy = getTranscriptionStrategy();
  const isTwoPass = mockStrategy === "diarize_plus_quality";

  const saved = await prisma.transcript.update({
    where: { id: transcriptId },
    data: {
      status: TranscriptStatus.COMPLETED,
      text: isTwoPass
        ? "Mock speaker 1 enhanced line. Mock speaker 2 enhanced line."
        : "Mock speaker 1 line. Mock speaker 2 line.",
      diarizedText: isTwoPass
        ? "[00:00:00-00:00:03] [Speaker 1] Mock speaker 1 enhanced line.\n\n[00:00:04-00:00:07] [Speaker 2] Mock speaker 2 enhanced line."
        : "[00:00:00-00:00:03] [Speaker 1] Mock speaker 1 line.\n\n[00:00:04-00:00:07] [Speaker 2] Mock speaker 2 line.",
      language: language === "auto" ? "en" : language,
      originalFileName: recording.fileName ?? "mock-audio.mp4",
      originalMimeType: recording.mimeType ?? "audio/mp4",
      transcriptionModel: "mock-transcription",
      hasSpeakerDiarization: true,
      diarizationStatus: "COMPLETED",
      diarizationProvider: "mock-transcription",
      speakerMapping: Prisma.JsonNull,
      speakerMappingStatus: "REQUIRED",
      completedAt: new Date(),
      strategy: mockStrategy,
      diarizationPassStatus: "COMPLETED",
      qualityPassStatus: isTwoPass ? "OK" : null,
      qualityModel: isTwoPass ? "mock-quality-transcription" : null,
      alignmentStatus: isTwoPass ? "ALIGNED" : null,
      alignmentConfidence: isTwoPass ? 0.92 : null,
    },
  });

  await prisma.transcriptSegment.deleteMany({ where: { transcriptId } });
  await prisma.transcriptSegment.createMany({
    data: [
      {
        transcriptId,
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 3,
        text: isTwoPass ? "Mock speaker 1 enhanced line." : "Mock speaker 1 line.",
        orderIndex: 0,
        mappingSource: "PROVIDER_DIARIZATION",
        qualityText: isTwoPass ? "Mock speaker 1 enhanced line." : null,
        alignmentConfidence: isTwoPass ? 0.92 : null,
        textSource: isTwoPass ? "QUALITY" : null,
      },
      {
        transcriptId,
        speakerLabel: "speaker_2",
        startSeconds: 4,
        endSeconds: 7,
        text: isTwoPass ? "Mock speaker 2 enhanced line." : "Mock speaker 2 line.",
        orderIndex: 1,
        mappingSource: "PROVIDER_DIARIZATION",
        qualityText: isTwoPass ? "Mock speaker 2 enhanced line." : null,
        alignmentConfidence: isTwoPass ? 0.88 : null,
        textSource: isTwoPass ? "QUALITY" : null,
      },
    ],
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

export async function runRealTranscription(
  sessionId: string,
  recording: RecordingForRealTranscription,
  transcriptId: string,
  language: string,
): Promise<NextResponse> {
  try {
    await throwIfTranscriptionStoppedManually(transcriptId);
    await setTranscriptStatus(transcriptId, TranscriptStatus.DOWNLOADING_RECORDING);
    const originalBuffer = await downloadObjectToBuffer(recording.fileKey, {
      sessionId,
      recordingId: recording.id,
    });
    await throwIfTranscriptionStoppedManually(transcriptId);

    await prisma.recording.update({
      where: { id: recording.id },
      data: { originalSizeBytes: originalBuffer.length },
    });

    await setTranscriptStatus(transcriptId, TranscriptStatus.COMPRESSING_AUDIO);
    const compression = await compressAudioForTranscription(
      originalBuffer,
      recording.fileName ?? "recording.mp4",
      { recordingId: recording.id, sessionId },
    );
    await throwIfTranscriptionStoppedManually(transcriptId);

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
        new AudioFileTooLargeError(compression.compressedSizeBytes, maxBytes),
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

    const txConfig = getOpenAiTranscriptionConfig();
    // Build prompt: used by quality pass (diarize_plus_quality / quality_only)
    // and also offered to plain fallback path (currently unused there but harmless)
    const transcriptionPrompt = txConfig.promptEnabled
      ? (await buildTranscriptionPrompt(sessionId)) ?? undefined
      : undefined;

    await setTranscriptStatus(transcriptId, TranscriptStatus.TRANSCRIBING);
    const transcription = await transcribeAudioBuffer(
      compression.compressedBuffer,
      compression.compressedFileName,
      compression.compressedMimeType,
      language as TranscriptionLanguageHint,
      { sessionId, recordingId: recording.id, prompt: transcriptionPrompt },
    );
    await throwIfTranscriptionStoppedManually(transcriptId);

    const mappedSegments = applySpeakerMapping(transcription.segments, {});

    // Two-pass alignment data (present when strategy=diarize_plus_quality)
    const alignmentResult = transcription.alignmentResult;
    const segmentAlignmentMap = new Map(
      alignmentResult?.segments.map((s) => [s.orderIndex, s]) ?? [],
    );

    const processingMetadata = {
      recordingBitrateKbps: getAudioRecordingTargetBitrateKbps(),
      transcriptionBitrateKbps: getAudioTranscriptionTargetBitrateKbps(),
      sampleRate: getAudioTranscriptionSampleRate(),
      channels: getAudioTranscriptionChannels(),
      maxFileMb: getAudioTranscriptionMaxFileBytes() / (1024 * 1024),
      openaiModel: txConfig.model,
      responseFormat: txConfig.responseFormat,
      timestampsEnabled: txConfig.useTimestamps,
      promptEnabled: txConfig.promptEnabled,
      promptLength: transcriptionPrompt?.length ?? 0,
      codecUsed: compression.codecUsed,
      compressedSizeBytes: compression.compressedSizeBytes,
      // Two-pass metadata
      strategy: transcription.strategy ?? "diarize_only",
      qualityModel: transcription.qualityModel ?? null,
      qualityPassStatus: transcription.qualityPassStatus ?? null,
      alignmentStatus: alignmentResult?.alignmentStatus ?? null,
      alignmentOverallConfidence: alignmentResult?.overallConfidence ?? null,
      lowConfidenceSegmentCount: alignmentResult?.lowConfidenceSegmentCount ?? 0,
      qualityPromptMetadata: transcription.qualityPromptMetadata ?? null,
    };

    const speakerMappingStatus = transcription.hasSpeakerDiarization
      ? "REQUIRED"
      : transcription.diarizationStatus === "SINGLE_SPEAKER_ONLY"
        ? "NEEDS_REVIEW"
        : "NOT_REQUIRED";

    // Resolve diarization pass status for storage
    const diarizationPassStatus =
      transcription.diarizationStatus === "COMPLETED" ||
      transcription.diarizationStatus === "SINGLE_SPEAKER_ONLY"
        ? "COMPLETED"
        : transcription.diarizationStatus === "FAILED"
          ? "FAILED"
          : null;

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
          diarizationStatus: transcription.diarizationStatus,
          diarizationProvider: transcription.diarizationProvider,
          diarizationError: null,
          speakerMapping: Prisma.JsonNull,
          speakerMappingStatus,
          processingMetadata,
          completedAt: new Date(),
          errorMessage: null,
          // Two-pass fields
          strategy: transcription.strategy ?? "diarize_only",
          qualityModel: transcription.qualityModel ?? null,
          diarizationPassStatus,
          qualityPassStatus: transcription.qualityPassStatus ?? null,
          alignmentStatus: alignmentResult?.alignmentStatus ?? null,
          alignmentConfidence: alignmentResult?.overallConfidence ?? null,
        },
      });

      await tx.transcriptSegment.deleteMany({ where: { transcriptId } });

      if (mappedSegments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: mappedSegments.map((segment) => {
            const aligned = segmentAlignmentMap.get(segment.orderIndex);
            return {
              transcriptId,
              speakerLabel: segment.speakerLabel,
              mappedParticipantId: segment.mappedParticipantId,
              startSeconds: segment.startSeconds,
              endSeconds: segment.endSeconds,
              text: segment.text,
              orderIndex: segment.orderIndex,
              mappingSource: segment.speakerLabel ? "PROVIDER_DIARIZATION" : null,
              // Two-pass segment fields
              qualityText: aligned?.qualityText ?? null,
              alignmentConfidence: aligned?.alignmentConfidence ?? null,
              textSource: aligned?.alignmentSource ?? null,
            };
          }),
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
    if (error instanceof TranscriptionCancelledError) {
      return NextResponse.json(
        { cancelled: true, message: error.message },
        { status: 409 },
      );
    }

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

export function isTranscriptionActive(status: TranscriptStatus): boolean {
  return (
    status === TranscriptStatus.QUEUED ||
    status === TranscriptStatus.DOWNLOADING_RECORDING ||
    status === TranscriptStatus.COMPRESSING_AUDIO ||
    status === TranscriptStatus.TRANSCRIBING
  );
}
