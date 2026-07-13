import { NextResponse } from "next/server";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Architecture: docs/architecture/06-recording-transcription-pipeline.md
 */

import {
  CompressionStatus,
  ExternalService,
  ExternalServiceEventSeverity,
  Prisma,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { compressAudioForTranscription } from "@/lib/audio/compress";
import {
  getAudioTranscriptionQualityProfile,
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
import {
  getPauseFilterCalibrationActiveMarkersRaw,
  getPauseFilterCalibrationDir,
  getPauseFilterCalibrationPausedMarkersRaw,
  isPauseFilterCalibrationAutoRunEnabled,
  isPauseFilterCalibrationEnabled,
  getPauseProcessingMode,
  getPauseSourceAudioDebugDir,
  getYandexSpeechKitModel,
  isYandexSpeechKitLiteratureTextEnabled,
  isYandexSpeechKitSpeakerLabelingEnabled,
  isYandexSpeechKitTextNormalizationEnabled,
  isYandexTranscriptEnhancementEnabled,
} from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";
import {
  getSelectedTranscriptionProvider,
  transcribeAudioBuffer,
  type TranscriptionLanguageHint,
} from "@/lib/services/transcription-provider";
import {
  trackOpenAiTranscriptionBytes,
  trackOpenAiTranscriptionMinutes,
} from "@/lib/services/usage-counters";
import {
  buildCompressedFileKey,
  downloadObjectToBuffer,
  headObject,
  uploadBufferToS3,
} from "@/lib/storage/s3";
import { classifyExternalServiceError } from "@/lib/services/error-classifier";
import { evaluateSpeechKitCompatibility } from "@/lib/audio/transcription-file-selection";
import { probeAudioBuffer } from "@/lib/observability/audio-metadata";
import {
  computeTranscriptQualityReport,
  logTranscriptionRun,
  sanitizeRawProviderSnapshot,
  type PreprocessingDecisionLog,
} from "@/lib/observability/transcription-observability";
import { resolveInitialQualityText } from "@/lib/services/transcript-enhancement-persistence";
import { executeTranscriptEnhancement } from "@/lib/services/transcript-enhancement-orchestration";
import { autoTriggerSpeakerMappingAfterTranscription } from "@/lib/transcription/auto-trigger-mapping";
import { applySpeakerMapping } from "@/lib/transcription/speaker-labels";
import { listPauseIntervals } from "@/lib/session-pause-intervals";
import {
  buildPauseOffsetIntervals,
} from "@/lib/transcription/pause-interval-filter";
import { applyPauseSegmentProcessingMode } from "@/lib/transcription/pause-segment-processing";
import {
  buildRawCalibrationInputArtifact,
  parseCalibrationMarkerList,
  runPauseFilterCalibration,
  writeCalibrationRunArtifacts,
  writeRawCalibrationInputArtifact,
} from "@/lib/transcription/pause-filter-calibration";
import { getMockExternalServiceError } from "@/lib/test-mode";
import { normalizeRecordingFileKey } from "@/lib/storage/recording-file-key";
import {
  buildActiveAudioTimeline,
  type ActiveTimelineInterval,
} from "@/lib/transcription/active-audio-timeline";
import { buildActiveAudioFromRecording } from "@/lib/transcription/active-audio-builder";
import { resolveSourceRecordingExtension } from "@/lib/transcription/source-recording-extension";

function resolveCompressedExtension(
  fileName: string,
): "webm" | "mp3" | "wav" | "ogg" | "opus" {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".mp3")) return "mp3";
  if (normalized.endsWith(".wav")) return "wav";
  if (normalized.endsWith(".ogg")) return "ogg";
  if (normalized.endsWith(".opus")) return "opus";
  if (normalized.endsWith(".webm")) return "webm";
  return "webm";
}

function mapPauseOffsetsToMs(
  pauseIntervals: Array<{ startSeconds: number; endSeconds: number }>,
): Array<{ startMs: number; endMs: number }> {
  return pauseIntervals.map((interval) => ({
    startMs: Math.max(0, Math.round(interval.startSeconds * 1000)),
    endMs: Math.max(0, Math.round(interval.endSeconds * 1000)),
  }));
}

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
  const transcriptionProvider = getSelectedTranscriptionProvider();
  try {
    const keyNormalization = normalizeRecordingFileKey(recording.fileKey);
    if (keyNormalization.containsRawUrl || keyNormalization.containsEncodedUrl) {
      const missingMessage =
        "Запись сохранена у провайдера, но файл ещё не загружен в хранилище";
      await prisma.recording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.FAILED,
          errorMessage: missingMessage,
        },
      });
      throw new Error(missingMessage);
    }

    const effectiveFileKey = keyNormalization.normalizedKey;
    if (effectiveFileKey !== recording.fileKey) {
      await prisma.recording.update({
        where: { id: recording.id },
        data: { fileKey: effectiveFileKey },
      });
    }

    const objectHead = await headObject(effectiveFileKey);
    if (!objectHead.exists) {
      const missingMessage = "Файл записи не найден в хранилище";
      await prisma.recording.update({
        where: { id: recording.id },
        data: {
          status: RecordingStatus.FAILED,
          errorMessage: missingMessage,
        },
      });
      throw new Error(missingMessage);
    }

    await throwIfTranscriptionStoppedManually(transcriptId);
    await setTranscriptStatus(transcriptId, TranscriptStatus.DOWNLOADING_RECORDING);
    const originalBuffer = await downloadObjectToBuffer(effectiveFileKey, {
      sessionId,
      recordingId: recording.id,
    });
    await throwIfTranscriptionStoppedManually(transcriptId);

    await prisma.recording.update({
      where: { id: recording.id },
      data: { originalSizeBytes: originalBuffer.length },
    });

    // Phase 7: capture actual source audio metadata (codec/sample-rate/channels)
    // to document where the "mono 8 kHz" characteristic originates and to feed
    // real values into the transcript quality warnings. Graceful if ffprobe is
    // unavailable.
    const sourceAudioMetadata = await probeAudioBuffer(
      originalBuffer,
      recording.fileName ?? "recording",
    );

    const pauseProcessingMode = getPauseProcessingMode();
    const pauseIntervals = await listPauseIntervals(sessionId);
    const pauseOffsetIntervals = buildPauseOffsetIntervals({
      recordingStartedAt: recording.startedAt,
      recordingEndedAt: recording.endedAt,
      pauseIntervals,
    });

    const recordingDurationMsFromDb =
      recording.startedAt && recording.endedAt
        ? Math.max(0, recording.endedAt.getTime() - recording.startedAt.getTime())
        : null;
    const sourceRecordingDurationMs =
      recordingDurationMsFromDb ??
      (sourceAudioMetadata.durationSeconds != null
        ? Math.round(sourceAudioMetadata.durationSeconds * 1000)
        : null);

    let activeTimeline: ActiveTimelineInterval[] | null = null;
    let sourceAudioArtifactPath: string | null = null;
    let ffmpegDiagnostics: Record<string, unknown> | null = null;
    let activeAudioDurationMs: number | null = null;
    let removedPauseDurationMs = 0;

    let transcriptionSourceBuffer = originalBuffer;
    let transcriptionSourceFileName = recording.fileName ?? "recording";
    let transcriptionSourceMimeType = recording.mimeType ?? "application/octet-stream";
    let transcriptionSourceMetadata = sourceAudioMetadata;

    if (pauseProcessingMode === "source_audio_cut" && sourceRecordingDurationMs == null) {
      throw new Error(
        "Cannot determine recording duration for source_audio_cut pause processing.",
      );
    }

    if (pauseProcessingMode === "source_audio_cut" && sourceRecordingDurationMs != null) {
      const timelineResult = buildActiveAudioTimeline({
        recordingDurationMs: sourceRecordingDurationMs,
        pauseIntervals: mapPauseOffsetsToMs(pauseOffsetIntervals),
      });
      activeTimeline = timelineResult.activeIntervals;
      activeAudioDurationMs = timelineResult.diagnostics.activeDurationMs;
      removedPauseDurationMs = timelineResult.diagnostics.removedPauseDurationMs;

      if (pauseOffsetIntervals.length > 0) {
        const debugOutputDir = join(getPauseSourceAudioDebugDir(), sessionId);
        const tempSourceDir = await mkdtemp(join(tmpdir(), "pause-source-audio-"));
        try {
          const sourceExtension = resolveSourceRecordingExtension(recording);
          const sourcePath = join(tempSourceDir, `source-recording${sourceExtension}`);
          await writeFile(sourcePath, originalBuffer);
          const built = await buildActiveAudioFromRecording({
            sourceFilePath: sourcePath,
            activeIntervals: timelineResult.activeIntervals,
            outputDir: debugOutputDir,
            sessionId,
            recordingId: recording.id,
          });
          sourceAudioArtifactPath = built.activeAudioPath;
          ffmpegDiagnostics = built.diagnostics as Record<string, unknown>;
          transcriptionSourceBuffer = await readFile(built.activeAudioPath);
          transcriptionSourceFileName = "active-audio.wav";
          transcriptionSourceMimeType = "audio/wav";
          transcriptionSourceMetadata = await probeAudioBuffer(
            transcriptionSourceBuffer,
            transcriptionSourceFileName,
          );
        } finally {
          await rm(tempSourceDir, { recursive: true, force: true });
        }
      } else {
        ffmpegDiagnostics = {
          status: "not_run",
          reason: "no_pause_intervals",
        };
      }
    }

    const maxBytes = getAudioTranscriptionMaxFileBytes();
    const maxFileMb = maxBytes / (1024 * 1024);
    const compatibility = evaluateSpeechKitCompatibility({
      inputFileName: transcriptionSourceFileName ?? null,
      probe: transcriptionSourceMetadata,
    });
    const shouldTranscode =
      transcriptionSourceBuffer.length > maxBytes || !compatibility.isCompatible;
    const preprocessingTriggerReason = shouldTranscode
      ? transcriptionSourceBuffer.length > maxBytes
        ? "size_exceeds_threshold"
        : compatibility.reason
      : "not_required";
    let selectedBuffer = transcriptionSourceBuffer;
    let selectedFileName = transcriptionSourceFileName;
    let selectedMimeType = transcriptionSourceMimeType;
    let fallbackToOriginal = false;
    let ffmpegOutputSizeBytes: number | null = null;
    let ffmpegSizeDeltaBytes: number | null = null;
    let ffmpegSizeDeltaPercent: number | null = null;
    let compression:
      | Awaited<ReturnType<typeof compressAudioForTranscription>>
      | null = null;

    if (shouldTranscode) {
      await setTranscriptStatus(transcriptId, TranscriptStatus.COMPRESSING_AUDIO);
      compression = await compressAudioForTranscription(
        transcriptionSourceBuffer,
        transcriptionSourceFileName ?? "recording",
        {
          recordingId: recording.id,
          sessionId,
          forceTranscode: true,
          probe: transcriptionSourceMetadata,
        },
      );
      await throwIfTranscriptionStoppedManually(transcriptId);

      ffmpegOutputSizeBytes = compression.compressedSizeBytes;
      ffmpegSizeDeltaBytes =
        compression.compressedSizeBytes - transcriptionSourceBuffer.length;
      ffmpegSizeDeltaPercent =
        transcriptionSourceBuffer.length > 0
          ? Math.round(
              (ffmpegSizeDeltaBytes / transcriptionSourceBuffer.length) * 10000,
            ) / 100
          : null;

      if (
        compression.compressedSizeBytes > transcriptionSourceBuffer.length &&
        compatibility.isCompatible
      ) {
        fallbackToOriginal = true;
      } else {
        selectedBuffer = compression.compressedBuffer;
        selectedFileName = compression.compressedFileName;
        selectedMimeType = compression.compressedMimeType;
      }

      const timestamp = Date.now();
      const extension = resolveCompressedExtension(compression.compressedFileName);
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
    } else {
      await prisma.recording.update({
        where: { id: recording.id },
        data: {
          compressedFileKey: null,
          compressedFileName: null,
          compressedMimeType: null,
          compressedSizeBytes: transcriptionSourceBuffer.length,
          compressionStatus: CompressionStatus.SKIPPED,
          compressionError: null,
        },
      });
    }

    if (selectedBuffer.length > maxBytes) {
      const classified = classifyExternalServiceError(
        ExternalService.OPENAI,
        new AudioFileTooLargeError(selectedBuffer.length, maxBytes),
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
      selectedBuffer,
      selectedFileName,
      selectedMimeType,
      language as TranscriptionLanguageHint,
      { sessionId, recordingId: recording.id, prompt: transcriptionPrompt },
    );
    await throwIfTranscriptionStoppedManually(transcriptId);

    const mappedSegments = applySpeakerMapping(transcription.segments, {});
    const pauseFilterCalibrationEnabled = isPauseFilterCalibrationEnabled();
    const calibrationActiveMarkers = pauseFilterCalibrationEnabled
      ? parseCalibrationMarkerList(getPauseFilterCalibrationActiveMarkersRaw())
      : [];
    const calibrationPausedMarkers = pauseFilterCalibrationEnabled
      ? parseCalibrationMarkerList(getPauseFilterCalibrationPausedMarkersRaw())
      : [];

    if (
      pauseFilterCalibrationEnabled &&
      pauseProcessingMode === "transcript_interval_filter"
    ) {
      try {
        const recordingDurationSeconds =
          recording.startedAt && recording.endedAt
            ? Math.max(
                0,
                (recording.endedAt.getTime() - recording.startedAt.getTime()) / 1000,
              )
            : null;
        const rawCalibrationInput = buildRawCalibrationInputArtifact({
          sessionId,
          recordingId: recording.id,
          transcriptId,
          recordingStartedAt: recording.startedAt,
          recordingEndedAt: recording.endedAt,
          recordingDurationSeconds,
          transcriptTextBeforeFiltering: transcription.text,
          diarizedTextBeforeFiltering: transcription.diarizedText,
          providerNormalizedSegments: transcription.segments,
          mappedSegmentsBeforeFiltering: mappedSegments,
          pauseIntervalsAbsolute: pauseIntervals,
          pauseIntervalsOffsets: pauseOffsetIntervals,
          activeMarkers: calibrationActiveMarkers,
          pausedMarkers: calibrationPausedMarkers,
        });
        const calibrationDir = getPauseFilterCalibrationDir();
        await writeRawCalibrationInputArtifact({
          calibrationDir,
          sessionId,
          artifact: rawCalibrationInput,
        });

        if (
          isPauseFilterCalibrationAutoRunEnabled() &&
          calibrationActiveMarkers.length > 0 &&
          calibrationPausedMarkers.length > 0
        ) {
          const calibrationRun = runPauseFilterCalibration({
            input: rawCalibrationInput,
            activeMarkers: calibrationActiveMarkers,
            pausedMarkers: calibrationPausedMarkers,
          });
          await writeCalibrationRunArtifacts({
            calibrationDir,
            sessionId,
            input: rawCalibrationInput,
            runResult: calibrationRun,
          });
        }
      } catch (calibrationError) {
        console.warn(
          `[pause-filter-calibration] failed for session ${sessionId}: ${
            calibrationError instanceof Error
              ? calibrationError.message
              : "unknown error"
          }`,
        );
      }
    }

    const pauseFilteringResult = applyPauseSegmentProcessingMode(
      pauseProcessingMode,
      mappedSegments,
      pauseOffsetIntervals,
    );
    const filteredSegments = pauseFilteringResult.keptSegments;
    const pauseFilteringApplied =
      pauseFilteringResult.diagnostics.filteredSegmentCount > 0;
    const normalizedTranscriptionText = pauseFilteringApplied
      ? filteredSegments.map((segment) => segment.text.trim()).filter(Boolean).join(" ")
      : transcription.text.trim().length > 0
        ? transcription.text
        : mappedSegments.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
    const normalizedDiarizedText = pauseFilteringApplied
      ? filteredSegments.length > 0
        ? filteredSegments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n")
        : null
      : transcription.diarizedText?.trim().length
        ? transcription.diarizedText
        : mappedSegments.length > 0
          ? mappedSegments.map((segment) => segment.text.trim()).filter(Boolean).join("\n\n")
          : null;

    if (
      normalizedTranscriptionText.trim().length === 0 &&
      (normalizedDiarizedText?.trim().length ?? 0) === 0
    ) {
      throw new Error("Transcription returned empty content.");
    }

    // Two-pass alignment data (present when strategy=diarize_plus_quality)
    const alignmentResult = transcription.alignmentResult;
    const segmentAlignmentMap = new Map(
      alignmentResult?.segments.map((s) => [s.orderIndex, s]) ?? [],
    );

    // ── Stage-1 observability: preprocessing decision, raw snapshot, quality ──
    const sourceFileName = transcriptionSourceFileName ?? "recording";
    const compatibleContainer = compatibility.isCompatible;
    const wasSkipped = !shouldTranscode || fallbackToOriginal;
    const preprocessDecision: PreprocessingDecisionLog = {
      audioTranscriptionMaxFileMb: maxFileMb,
      originalSizeBytes: originalBuffer.length,
      thresholdBytes: maxBytes,
      mimeType: transcriptionSourceMimeType ?? null,
      transcriptionInputSizeBytes: selectedBuffer.length,
      preprocessingSkipped: wasSkipped,
      preprocessingTriggered: shouldTranscode,
      preprocessingTriggerReason: preprocessingTriggerReason,
      selectedInputForSpeechKit: fallbackToOriginal ? "original" : shouldTranscode ? "preprocessed" : "original",
      originalCompatibleWithSpeechKit: compatibility.isCompatible,
      ffmpegOutputSizeBytes,
      ffmpegSizeDeltaBytes,
      ffmpegSizeDeltaPercent,
      fallbackToOriginal,
      sourceContainer: transcriptionSourceMetadata.container,
      sourceCodec: transcriptionSourceMetadata.codec,
      sourceSampleRate: transcriptionSourceMetadata.sampleRate,
      sourceChannels: transcriptionSourceMetadata.channels,
      container: sourceFileName.includes(".")
        ? sourceFileName.slice(sourceFileName.lastIndexOf(".") + 1).toLowerCase()
        : null,
      compatibleContainer,
      skipped: wasSkipped,
      reason: preprocessingTriggerReason,
      outputCodec: compression?.codecUsed ?? null,
      outputFormat: compression?.compressedFileName.includes(".")
        ? compression.compressedFileName
            .slice(compression.compressedFileName.lastIndexOf(".") + 1)
            .toLowerCase()
        : null,
    };

    const durationSeconds =
      recording.startedAt && recording.endedAt
        ? Math.max(
            0,
            (recording.endedAt.getTime() - recording.startedAt.getTime()) / 1000,
          )
        : (() => {
            const ends = transcription.segments
              .map((segment) => segment.endSeconds)
              .filter((value): value is number => typeof value === "number");
            return ends.length > 0 ? Math.max(...ends) : null;
          })();

    const rawProviderSnapshot =
      transcription.rawProviderSnapshot !== undefined
        ? sanitizeRawProviderSnapshot(transcription.rawProviderSnapshot)
        : null;

    const audioActivityCount = await prisma.sessionParticipantAudioActivity.count({
      where: { sessionId },
    });

    const qualityReport = computeTranscriptQualityReport({
      segments: filteredSegments,
      text: normalizedTranscriptionText,
      durationSeconds:
        (pauseProcessingMode === "source_audio_cut" && activeAudioDurationMs != null
          ? activeAudioDurationMs / 1000
          : durationSeconds) ?? transcriptionSourceMetadata.durationSeconds,
      sourceSampleRate: transcriptionSourceMetadata.sampleRate,
      sourceChannels: transcriptionSourceMetadata.channels,
      hasRawProviderSnapshot: Boolean(rawProviderSnapshot),
      hasSpeakerActivity: audioActivityCount > 0,
    });

    const segmentQuality = filteredSegments.slice(0, 2000).map((segment) => ({
      orderIndex: segment.orderIndex,
      speakerLabel: segment.speakerLabel,
      rawSpeakerLabel: segment.rawSpeakerLabel ?? null,
      confidence: segment.confidence ?? null,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      chars: segment.text.trim().length,
    }));

    const processingMetadata = {
      transcriptionProvider,
      recordingBitrateKbps: getAudioRecordingTargetBitrateKbps(),
      transcriptionQualityProfile: getAudioTranscriptionQualityProfile(),
      transcriptionBitrateKbps: getAudioTranscriptionTargetBitrateKbps(),
      sampleRate: getAudioTranscriptionSampleRate(),
      channels: getAudioTranscriptionChannels(),
      maxFileMb: getAudioTranscriptionMaxFileBytes() / (1024 * 1024),
      openaiModel: transcriptionProvider === "openai" ? txConfig.model : null,
      responseFormat: transcriptionProvider === "openai" ? txConfig.responseFormat : null,
      timestampsEnabled: transcriptionProvider === "openai" ? txConfig.useTimestamps : null,
      promptEnabled: transcriptionProvider === "openai" ? txConfig.promptEnabled : false,
      promptLength: transcriptionPrompt?.length ?? 0,
      codecUsed: compression?.codecUsed ?? "passthrough",
      compressedSizeBytes: selectedBuffer.length,
      audioTranscriptionMaxFileMb: maxFileMb,
      thresholdBytes: maxBytes,
      originalSizeBytes: originalBuffer.length,
      transcriptionInputSizeBytes: selectedBuffer.length,
      preprocessingSkipped: wasSkipped,
      preprocessingTriggered: shouldTranscode,
      preprocessingTriggerReason,
      selectedInputForSpeechKit: fallbackToOriginal
        ? "original"
        : shouldTranscode
          ? "preprocessed"
          : "original",
      originalCompatibleWithSpeechKit: compatibility.isCompatible,
      ffmpegOutputSizeBytes,
      ffmpegSizeDeltaBytes,
      ffmpegSizeDeltaPercent,
      fallbackToOriginal,
      sourceContainer: transcriptionSourceMetadata.container,
      sourceCodec: transcriptionSourceMetadata.codec,
      sourceSampleRate: transcriptionSourceMetadata.sampleRate,
      sourceChannels: transcriptionSourceMetadata.channels,
      yandexSpeechKitModel:
        transcriptionProvider === "yandex_speechkit" ? getYandexSpeechKitModel() : null,
      yandexTextNormalizationEnabled:
        transcriptionProvider === "yandex_speechkit"
          ? isYandexSpeechKitTextNormalizationEnabled()
          : null,
      yandexLiteratureTextEnabled:
        transcriptionProvider === "yandex_speechkit"
          ? isYandexSpeechKitLiteratureTextEnabled()
          : null,
      yandexSpeakerLabelingEnabled:
        transcriptionProvider === "yandex_speechkit"
          ? isYandexSpeechKitSpeakerLabelingEnabled()
          : null,
      yandexTranscriptEnhancementEnabled:
        transcriptionProvider === "yandex_speechkit"
          ? isYandexTranscriptEnhancementEnabled()
          : null,
      transcriptionProcessingTimings: transcription.processingTimings ?? null,
      transcriptEnhancementRecommendation:
        transcription.enhancementRecommendation ?? null,
      pauseFiltering: {
        totalPausedIntervals: pauseIntervals.length,
        appliedIntervals: pauseOffsetIntervals.length,
        filteredSegmentCount: pauseFilteringResult.diagnostics.filteredSegmentCount,
        fullyPausedDroppedCount:
          pauseFilteringResult.diagnostics.fullyPausedDroppedCount,
        boundaryOverlapKeptCount:
          pauseFilteringResult.diagnostics.boundaryOverlapKeptCount,
        boundaryOverlapDroppedCount:
          pauseFilteringResult.diagnostics.boundaryOverlapDroppedCount,
        significantOverlapDroppedCount:
          pauseFilteringResult.diagnostics.significantOverlapDroppedCount,
        maxKeptPauseOverlapSeconds:
          pauseFilteringResult.diagnostics.maxKeptPauseOverlapSeconds,
        maxDroppedPauseOverlapSeconds:
          pauseFilteringResult.diagnostics.maxDroppedPauseOverlapSeconds,
      },
      pauseProcessing: {
        mode: pauseProcessingMode,
        sourceRecordingDurationMs,
        activeAudioDurationMs:
          pauseProcessingMode === "source_audio_cut"
            ? activeAudioDurationMs ??
              sourceRecordingDurationMs ??
              (transcriptionSourceMetadata.durationSeconds != null
                ? Math.round(transcriptionSourceMetadata.durationSeconds * 1000)
                : null)
            : null,
        pauseIntervalCount: pauseIntervals.length,
        activeIntervalCount: activeTimeline?.length ?? null,
        removedPauseDurationMs:
          pauseProcessingMode === "source_audio_cut" ? removedPauseDurationMs : null,
        activeTimelineMap: activeTimeline
          ? {
              activeIntervals: activeTimeline,
            }
          : null,
        sourceAudioArtifactPath,
        ffmpegDiagnostics,
      },
      // Two-pass metadata
      strategy: transcription.strategy ?? "diarize_only",
      qualityModel: transcription.qualityModel ?? null,
      qualityPassStatus: transcription.qualityPassStatus ?? null,
      alignmentStatus: alignmentResult?.alignmentStatus ?? null,
      alignmentOverallConfidence: alignmentResult?.overallConfidence ?? null,
      lowConfidenceSegmentCount: alignmentResult?.lowConfidenceSegmentCount ?? 0,
      qualityPromptMetadata: transcription.qualityPromptMetadata ?? null,
      // Stage-1 observability
      preprocessDecision,
      sourceAudioMetadata: transcriptionSourceMetadata,
      qualityReport,
      segmentQuality,
      rawProviderSnapshot,
      rawResultCount: transcription.rawResultCount ?? null,
      speechkitRequestMode: transcription.requestMode ?? null,
      audioActivityRowCount: audioActivityCount,
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
          text: normalizedTranscriptionText,
          diarizedText: normalizedDiarizedText,
          language: transcription.language,
          originalFileName: selectedFileName,
          originalMimeType: selectedMimeType,
          transcriptionModel: transcription.model,
          hasSpeakerDiarization: transcription.hasSpeakerDiarization,
          diarizationStatus: transcription.diarizationStatus,
          diarizationProvider: transcription.diarizationProvider,
          diarizationError: null,
          speakerMapping: Prisma.JsonNull,
          speakerMappingStatus,
          processingMetadata: processingMetadata as Prisma.InputJsonValue,
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

      if (filteredSegments.length > 0) {
        await tx.transcriptSegment.createMany({
          data: filteredSegments.map((segment) => {
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
              qualityText: resolveInitialQualityText(segment.text, null),
              alignmentConfidence: aligned?.alignmentConfidence ?? null,
              textSource: aligned?.alignmentSource ?? null,
            };
          }),
        });
      }

      return updated;
    });

    // Stage 3.9F: auto-trigger transcript enhancement after raw persistence.
    // Non-fatal by design: completed transcription must remain usable.
    if (transcriptionProvider === "yandex_speechkit") {
      const autoEnhancementTriggerSource =
        (saved.retranscribeCount ?? 0) > 0
          ? "automatic_retranscription"
          : "automatic_initial_transcription";
      try {
        await executeTranscriptEnhancement({
          transcriptId: saved.id,
          triggerSource: autoEnhancementTriggerSource,
        });
      } catch (enhancementError) {
        console.warn(
          `[transcription-run] auto transcript enhancement failed for session ${sessionId}: ${
            enhancementError instanceof Error
              ? enhancementError.message
              : "unknown error"
          }`,
        );
      }
    }

    // Phase 4: auto-trigger speaker mapping suggestion after transcription.
    // Resilient — a failure here must not fail the completed transcription.
    let mappingStatusForLog = speakerMappingStatus;
    if (transcription.hasSpeakerDiarization) {
      try {
        const mappingDiag = await autoTriggerSpeakerMappingAfterTranscription(sessionId);
        if (mappingDiag.appliedStatus) {
          mappingStatusForLog = mappingDiag.appliedStatus;
        }
      } catch (mappingError) {
        console.warn(
          `[transcription-run] auto speaker mapping trigger failed for session ${sessionId}: ${
            mappingError instanceof Error ? mappingError.message : "unknown error"
          }`,
        );
      }
    }

    logTranscriptionRun({
      event: "transcription_run",
      sessionId,
      recordingId: recording.id,
      transcriptId,
      provider: transcriptionProvider,
      sourceFile: {
        fileName: transcriptionSourceFileName ?? null,
        mimeType: transcriptionSourceMimeType ?? null,
        originalSizeBytes: originalBuffer.length,
        compressedSizeBytes: selectedBuffer.length,
        codecUsed: compression?.codecUsed ?? "passthrough",
        sourceContainer: transcriptionSourceMetadata.container,
        sourceCodec: transcriptionSourceMetadata.codec,
        sourceSampleRate: transcriptionSourceMetadata.sampleRate,
        sourceChannels: transcriptionSourceMetadata.channels,
        sourceProbeAvailable: transcriptionSourceMetadata.probeAvailable,
      },
      preprocessing: preprocessDecision,
      speechkitRequestMode: transcription.requestMode ?? null,
      diarizationEnabled: transcription.hasSpeakerDiarization,
      diarizationStatus: transcription.diarizationStatus,
      rawResultCount: transcription.rawResultCount ?? null,
      normalizedSegmentCount: filteredSegments.length,
      transcriptChars: qualityReport.transcriptChars,
      speakerLabelCount: qualityReport.speakerCount,
      mappingStatus: mappingStatusForLog,
      aiAnalysisReady:
        !transcription.hasSpeakerDiarization ||
        mappingStatusForLog === "CONFIRMED" ||
        mappingStatusForLog === "AUTO_SUGGESTED",
      rawProviderSnapshotStored: Boolean(rawProviderSnapshot),
      qualityWarnings: qualityReport.warnings,
    });

    if (
      transcriptionProvider === "openai" &&
      recording.startedAt &&
      recording.endedAt
    ) {
      const minutes =
        (recording.endedAt.getTime() - recording.startedAt.getTime()) / 60000;
      await trackOpenAiTranscriptionMinutes(minutes, sessionId);
    }

    if (transcriptionProvider === "openai") {
      await trackOpenAiTranscriptionBytes(selectedBuffer.length, sessionId);
    }

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
