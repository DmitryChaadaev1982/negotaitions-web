import { NextResponse } from "next/server";

import {
  AiAnalysisStatus,
  ParticipantType,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { autoTranscribeAfterRecording } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { appendRecordingDebugEvent } from "@/lib/debug/recording-debug";
import { evaluateAiAnalysisReadiness } from "@/lib/ai/analysis-readiness";
import { isAiAnalysisRunLeaseActive } from "@/lib/ai/analysis-operation";
import type { NegotiationAnalysisOutput } from "@/lib/ai/negotiation-analysis";
import {
  getAnalysisForFacilitator,
  getAnalysisForObserver,
  getAnalysisForParticipant,
} from "@/lib/analysis-visibility";
import { getSignedDownloadUrl } from "@/lib/storage/s3";
import { isAiAnalysisOutdated } from "@/lib/transcription/speaker-mapping-readiness";
import { MANUAL_TRANSCRIPTION_STOP_SENTINEL } from "@/lib/services/transcription-runner";
import { headObject } from "@/lib/storage/s3";
import { normalizeRecordingFileKey } from "@/lib/storage/recording-file-key";
import { resolveMappingFailure } from "@/lib/transcription/mapping-failure-reasons";
import { getRecordingDisplayState } from "@/lib/recording-display-state";
import { isExternalServicesMockMode } from "@/lib/test-mode";
import {
  computeShouldPoll,
  hasRunningRawTranscription,
  isStaleStartingRecording,
  resolveMaterialsNextPollMs,
  isRecordingReadyForTranscription,
  resolveTranscriptProcessingStage,
  STALE_RECORDING_STARTING_FAILURE_CODE,
  STALE_RECORDING_STARTING_TIMEOUT_SECONDS,
} from "@/lib/materials-status-readiness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function resolveTranscriptEnhancementStatus(
  processingMetadata: unknown,
):
  | "NOT_AVAILABLE"
  | "IDLE"
  | "SUGGESTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED" {
  const metadata = asMetadata(processingMetadata);
  const enhancement = asMetadata(metadata.transcriptEnhancement);
  const recommendation = asMetadata(metadata.transcriptEnhancementRecommendation);
  const status = enhancement.status;
  if (status === "IN_PROGRESS" || status === "RUNNING") return "IN_PROGRESS";
  if (status === "FAILED") return "FAILED";
  if (status === "PARTIAL") return "PARTIAL";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "SKIPPED") return "SKIPPED";
  if (recommendation.suggested === true) return "SUGGESTED";
  if (metadata.transcriptionProvider === "yandex_speechkit") return "IDLE";
  return "NOT_AVAILABLE";
}

function resolveRecordingProcessingStage(input: {
  recordingStatus: RecordingStatus | null;
  stopOperationState: string | null;
  sessionStatus: string;
  negotiationState: string;
  roomLifecycle: string | null;
}) {
  const displayState = getRecordingDisplayState({
    recordingStatus: input.recordingStatus,
    stopOperationState: input.stopOperationState,
    sessionStatus: input.sessionStatus,
    negotiationState: input.negotiationState,
    roomLifecycle: input.roomLifecycle,
  });

  if (displayState === "active" || displayState === "paused") {
    return "in_progress";
  }
  if (displayState === "stopping") {
    return "finalizing";
  }
  if (displayState === "completed") {
    return "ready";
  }
  if (displayState === "failed") {
    return "failed";
  }
  return "not_available";
}

function resolveAiAnalysisProcessingStage(
  aiStatus: AiAnalysisStatus | null,
  transcriptStatus: TranscriptStatus | null,
  transcriptHasText: boolean,
  runActive: boolean,
): string {
  if (!aiStatus) {
    return transcriptHasText ? "not_started" : "waiting_for_transcript";
  }
  switch (aiStatus) {
    case AiAnalysisStatus.QUEUED:
      return runActive ? "queued" : "failed";
    case AiAnalysisStatus.ANALYZING:
      return runActive ? "analyzing" : "failed";
    case AiAnalysisStatus.COMPLETED:
      return "ready";
    case AiAnalysisStatus.FAILED:
      return "failed";
    default:
      return "not_started";
  }
}

function sanitizeTranscriptErrorMessage(message: string | null): string | null {
  if (!message) {
    return null;
  }

  return message.replace(MANUAL_TRANSCRIPTION_STOP_SENTINEL, "").trim();
}

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const url = new URL(request.url);
  const joinToken = url.searchParams.get("joinToken");
  const participantId = url.searchParams.get("participantId");

  if (!joinToken && !participantId) {
    return NextResponse.json({ error: "joinToken is required." }, { status: 400 });
  }

  const { resolveRoomParticipantFromQuery } = await import("@/lib/room-participant-resolver");
  const participant = await resolveRoomParticipantFromQuery(url, sessionId);
  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const isFacilitator = participant.type === ParticipantType.FACILITATOR;
  const isObserver = participant.type === ParticipantType.OBSERVER;
  const isEventHostOwner = Boolean(
    participant.userId &&
      participant.session.eventId &&
      (
        await prisma.eventParticipant.findFirst({
          where: {
            eventId: participant.session.eventId,
            userId: participant.userId,
            isHost: true,
          },
          select: { id: true },
        })
      )?.id,
  );

  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: {
      recording: {
        select: {
          id: true,
          status: true,
          fileKey: true,
          fileName: true,
          originalSizeBytes: true,
          startedAt: true,
          endedAt: true,
          errorMessage: true,
          egressId: true,
          stopOperation: {
            select: {
              state: true,
            },
          },
        },
      },
      transcript: {
        select: {
          id: true,
          status: true,
          text: true,
          diarizedText: true,
          language: true,
          transcriptionModel: true,
          errorMessage: true,
          startedAt: true,
          completedAt: true,
          source: true,
          recordingId: true,
          hasSpeakerDiarization: true,
          diarizationStatus: true,
          retranscribeCount: true,
          processingMetadata: true,
          speakerMappingStatus: true,
          speakerMappingConfirmedAt: true,
          speakerMapping: true,
          segments: {
            select: {
              speakerLabel: true,
              mappedParticipantId: true,
              text: true,
            },
          },
        },
      },
      aiAnalysis: {
        select: {
          id: true,
          status: true,
          model: true,
          executiveSummary: true,
          overallScore: true,
          analysisJson: true,
          startedAt: true,
          completedAt: true,
          errorMessage: true,
          visibility: true,
          sharedAnalysisJson: true,
          sharedExecutiveSummary: true,
          sharedAt: true,
          sharedBy: true,
          transcriptRetranscribeCount: true,
          runToken: true,
          leaseExpiresAt: true,
          updatedAt: true,
        },
      },
      event: {
        select: { id: true, title: true, status: true },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  let recording = session.recording;
  if (
    recording &&
    isStaleStartingRecording({
      status: recording.status,
      startedAt: recording.startedAt,
      egressId: recording.egressId,
    })
  ) {
    const reconciledAt = new Date();
    const staleCutoff = new Date(
      reconciledAt.getTime() -
        STALE_RECORDING_STARTING_TIMEOUT_SECONDS * 1000,
    );
    const reconciled = await prisma.recording.updateMany({
      where: {
        id: recording.id,
        status: RecordingStatus.STARTING,
        egressId: null,
        startedAt: { lte: staleCutoff },
      },
      data: {
        status: RecordingStatus.FAILED,
        endedAt: recording.endedAt ?? reconciledAt,
        errorMessage: STALE_RECORDING_STARTING_FAILURE_CODE,
      },
    });
    if (reconciled.count > 0) {
      recording = {
        ...recording,
        status: RecordingStatus.FAILED,
        endedAt: recording.endedAt ?? reconciledAt,
        errorMessage: STALE_RECORDING_STARTING_FAILURE_CODE,
      };
      appendRecordingDebugEvent({
        sessionId,
        source: "materials-status",
        level: "warn",
        step: "materials-status:starting-timeout-reconciled",
        message:
          "stale STARTING reconciled to FAILED after timeout threshold",
        data: {
          recordingId: recording.id,
          timeoutSeconds: STALE_RECORDING_STARTING_TIMEOUT_SECONDS,
          failureCode: STALE_RECORDING_STARTING_FAILURE_CODE,
        },
      });
    }
  }
  const transcript = session.transcript;
  const aiAnalysis = session.aiAnalysis;

  const recordingStatus = recording?.status ?? null;
  const recordingHasFileKey = Boolean(recording?.fileKey);
  const fileKeyNormalization = recording?.fileKey
    ? normalizeRecordingFileKey(recording.fileKey)
    : null;
  let storageObjectExists: boolean | null = null;
  if (
    recording?.fileKey &&
    isRecordingReadyForTranscription(recordingStatus, true) &&
    fileKeyNormalization &&
    !fileKeyNormalization.containsRawUrl &&
    !fileKeyNormalization.containsEncodedUrl
  ) {
    if (isExternalServicesMockMode()) {
      storageObjectExists = true;
    } else {
      try {
        const head = await headObject(fileKeyNormalization.normalizedKey);
        storageObjectExists = head.exists;
      } catch {
        storageObjectExists = null;
      }
    }
  }

  const recordingReadyByState = isRecordingReadyForTranscription(
    recordingStatus,
    recordingHasFileKey,
  );
  const recordingReadyForTranscription =
    recordingReadyByState &&
    storageObjectExists !== false &&
    !fileKeyNormalization?.containsRawUrl &&
    !fileKeyNormalization?.containsEncodedUrl;
  const transcriptStatus = transcript?.status ?? null;
  const aiStatus = aiAnalysis?.status ?? null;

  appendRecordingDebugEvent({
    sessionId,
    source: "materials-status",
    level: "info",
    step: "materials-status:polled",
    message: `materials/status polled: recordingFound=${Boolean(recording)} status=${recordingStatus ?? "null"}`,
    data: {
      recordingFound: Boolean(recording),
      recordingStatus: recordingStatus ?? null,
      fileKeyPresent: Boolean(recording?.fileKey),
      transcriptStatus: transcriptStatus ?? null,
    },
  });
  const transcriptEnhancementStatus = resolveTranscriptEnhancementStatus(
    transcript?.processingMetadata,
  );
  const mappingFailure = resolveMappingFailure({
    speakerMappingStatus: transcript?.speakerMappingStatus ?? null,
    processingMetadata: transcript?.processingMetadata ?? null,
  });

  const aiAnalysisReadiness = evaluateAiAnalysisReadiness(transcript);
  const transcriptHasText = aiAnalysisReadiness.hasUsableContent;
  const hasRunningTranscription = hasRunningRawTranscription(transcriptStatus);
  const hasRunningTranscriptEnhancement =
    transcriptEnhancementStatus === "IN_PROGRESS";

  const canViewRecording = true;
  // Phase 5 observer transcript decision (Part 7):
  // Observer sees transcript only if the facilitator has published a shared AI analysis
  // (shared debrief). This prevents silent exposure of potentially private discussion
  // to observers before the facilitator reviews and publishes the debrief.
  // Participants and facilitators always have access to transcripts.
  const aiVisibilityForObserver = isObserver
    ? (await prisma.aiAnalysis.findUnique({
        where: { sessionId },
        select: { visibility: true },
      }))?.visibility ?? "FACILITATOR_ONLY"
    : "N/A";
  const canViewTranscript = isObserver
    ? aiVisibilityForObserver === "SHARED_WITH_SESSION"
    : true;
  const canRunTranscription = isFacilitator;
  const canRetryFailedProcessing = isFacilitator;

  const transcriptCompleted =
    transcriptStatus === TranscriptStatus.COMPLETED && transcriptHasText;
  const hasRunningAiAnalysis =
    (aiStatus === AiAnalysisStatus.QUEUED ||
      aiStatus === AiAnalysisStatus.ANALYZING) &&
    Boolean(aiAnalysis && isAiAnalysisRunLeaseActive(aiAnalysis));

  const speakerMappingReady = transcript
    ? aiAnalysisReadiness.speakerMappingReady
    : true;

  const speakerMappingRequired =
    Boolean(transcript) && !speakerMappingReady;

  const analysisOutdated = isAiAnalysisOutdated(
    transcript?.retranscribeCount,
    aiAnalysis?.transcriptRetranscribeCount,
  );

  const canRunAiAnalysis =
    isFacilitator &&
    aiAnalysisReadiness.ready &&
    !hasRunningAiAnalysis &&
    (aiStatus === null ||
      aiStatus === AiAnalysisStatus.FAILED ||
      aiStatus === AiAnalysisStatus.QUEUED ||
      aiStatus === AiAnalysisStatus.ANALYZING ||
      analysisOutdated);
  const canRetryAiAnalysis =
    isFacilitator &&
    aiAnalysisReadiness.ready &&
    (aiStatus === AiAnalysisStatus.FAILED ||
      aiStatus === AiAnalysisStatus.QUEUED ||
      aiStatus === AiAnalysisStatus.ANALYZING) &&
    !hasRunningAiAnalysis &&
    speakerMappingReady;
  const canRerunAiAnalysis =
    isFacilitator &&
    aiAnalysisReadiness.ready &&
    !hasRunningAiAnalysis &&
    aiStatus === AiAnalysisStatus.COMPLETED;
  const canShareAiAnalysis =
    isFacilitator && aiStatus === AiAnalysisStatus.COMPLETED;

  const aiVisibility = aiAnalysis?.visibility ?? "FACILITATOR_ONLY";
  const isSharedWithSession = aiVisibility === "SHARED_WITH_SESSION";

  // Facilitator sees full analysis; participants see shared version if published
  const canViewAiAnalysis = isFacilitator || isSharedWithSession;
  const canOpenMaterials = isObserver
    ? isEventHostOwner || canViewTranscript || canViewAiAnalysis
    : true;

  let downloadUrl: string | null = null;
  if (
    canViewRecording &&
    recording?.fileKey &&
    recordingReadyForTranscription
  ) {
    downloadUrl = await getSignedDownloadUrl(recording.fileKey, 900);
  }

  const recordingStage = recordingStatus
    ? recordingReadyForTranscription
      ? "ready"
      : (storageObjectExists === false ||
            fileKeyNormalization?.containsRawUrl ||
            fileKeyNormalization?.containsEncodedUrl)
        ? "failed"
        : resolveRecordingProcessingStage({
            recordingStatus,
            stopOperationState: recording?.stopOperation?.state ?? null,
            sessionStatus: session.status,
            negotiationState: session.negotiationState,
            roomLifecycle: session.roomLifecycle,
          })
    : "not_available";

  const transcriptStage = resolveTranscriptProcessingStage(
    transcriptStatus,
    recordingStatus,
    recordingHasFileKey,
    transcriptHasText,
    transcriptEnhancementStatus,
  );

  const aiAnalysisStage = resolveAiAnalysisProcessingStage(
    aiStatus,
    transcriptStatus,
    transcriptHasText,
    hasRunningAiAnalysis,
  );

  const isParticipantOrObserver = !isFacilitator;
  const sessionIsFinished = session.negotiationState === "FINISHED";
  const shouldPoll = computeShouldPoll(
    recordingStatus,
    recordingHasFileKey,
    transcriptStatus,
    hasRunningTranscriptEnhancement,
    hasRunningAiAnalysis ? aiStatus : null,
    isParticipantOrObserver,
    transcriptHasText,
    hasRunningTranscription,
    autoTranscribeAfterRecording,
    sessionIsFinished,
    isSharedWithSession,
    speakerMappingRequired,
  );

  const canStartTranscription =
    canRunTranscription &&
    !hasRunningTranscription &&
    !transcriptCompleted &&
    transcript?.status !== TranscriptStatus.FAILED &&
    recordingReadyForTranscription &&
    Boolean(recording?.fileKey) &&
    !transcriptHasText;

  const canRetryTranscription =
    canRunTranscription &&
    !hasRunningTranscription &&
    transcript?.status === TranscriptStatus.FAILED &&
    recordingReadyForTranscription &&
    Boolean(recording?.fileKey);

  const canStopTranscription = canRunTranscription && hasRunningTranscription;
  const canRetryTranscriptEnhancement =
    isFacilitator &&
    transcriptCompleted &&
    transcriptHasText &&
    !hasRunningTranscriptEnhancement &&
    (transcriptEnhancementStatus === "FAILED" ||
      transcriptEnhancementStatus === "PARTIAL");

  // Re-run is allowed when a completed transcript exists and recording is available
  const canRerunTranscription =
    canRunTranscription &&
    !hasRunningTranscription &&
    transcriptCompleted &&
    recordingReadyForTranscription &&
    Boolean(recording?.fileKey);

  const sessionRoleRecord = await prisma.sessionRole.findUnique({
    where: { id: participant.sessionRoleId ?? "" },
    select: { name: true },
  });
  const participantRole = !isObserver ? (sessionRoleRecord?.name ?? null) : null;

  const fullAnalysisJson =
    (aiAnalysis?.analysisJson as NegotiationAnalysisOutput | null) ?? null;
  const sharedAnalysisJson =
    (aiAnalysis?.sharedAnalysisJson as NegotiationAnalysisOutput | null) ?? null;
  const analysisJsonForUser = isFacilitator
    ? getAnalysisForFacilitator(fullAnalysisJson)
    : isSharedWithSession
      ? isObserver
        ? getAnalysisForObserver(sharedAnalysisJson)
        : getAnalysisForParticipant(sharedAnalysisJson, {
            participantId: participant.id,
            displayName: participant.displayName,
          })
      : null;

  const executiveSummaryForUser = isFacilitator
    ? (aiAnalysis?.executiveSummary ?? null)
    : isSharedWithSession
      ? (aiAnalysis?.sharedExecutiveSummary ?? null)
      : null;

  const aiAnalysisResponse = {
    id: aiAnalysis?.id ?? null,
    status: aiAnalysis?.status ?? "NOT_STARTED",
    model: isFacilitator ? (aiAnalysis?.model ?? null) : null,
    executiveSummary: canViewAiAnalysis ? executiveSummaryForUser : null,
    overallScore:
      canViewAiAnalysis && isFacilitator ? (aiAnalysis?.overallScore ?? null) : null,
    analysisJson: canViewAiAnalysis ? analysisJsonForUser : null,
    startedAt: aiAnalysis?.startedAt?.toISOString() ?? null,
    completedAt: aiAnalysis?.completedAt?.toISOString() ?? null,
    errorMessage: isFacilitator ? (aiAnalysis?.errorMessage ?? null) : null,
    processingStage: aiAnalysisStage,
    canStart: canRunAiAnalysis,
    canRetry: canRetryAiAnalysis,
    canRerun: canRerunAiAnalysis,
    canView: canViewAiAnalysis,
    canShare: canShareAiAnalysis,
    speakerMappingRequired: isFacilitator ? speakerMappingRequired : false,
    participantPlaceholder: !isFacilitator && !isSharedWithSession,
    // Analysis version tracking
    analysisFromOlderTranscript: isFacilitator && analysisOutdated,
    // Sharing metadata
    visibility: isFacilitator ? aiVisibility : null,
    isSharedWithSession,
    sharedAt: isFacilitator ? (aiAnalysis?.sharedAt?.toISOString() ?? null) : null,
    sharedBy: isFacilitator ? (aiAnalysis?.sharedBy ?? null) : null,
    notSharedMessage:
      !isFacilitator && !isSharedWithSession && aiStatus !== null
        ? "AI analysis has not been shared yet."
        : null,
  };

  let currentStage: string;
  if (hasRunningAiAnalysis) {
    currentStage = aiAnalysisStage;
  } else if (hasRunningTranscription) {
    currentStage = transcriptStage;
  } else if (recordingStage !== "ready" && recordingStage !== "not_available") {
    currentStage = recordingStage;
  } else {
    currentStage = transcriptStage;
  }

  return NextResponse.json({
    session: {
      id: session.id,
      title: session.title,
      roomLabel: session.roomLabel,
      status: session.status,
      isFinished: session.negotiationState === "FINISHED",
      eventId: session.eventId,
      eventTitle: session.event?.title ?? null,
      caseTitle: session.snapshotCaseTitle,
      participantRole,
      participantType: participant.type,
    },
    permissions: {
      canViewRecording,
      canViewTranscript,
      canRunTranscription,
      canRetryFailedProcessing,
      canViewAiAnalysis,
      canRunAiAnalysis,
      canShareAiAnalysis,
      canOpenMaterials,
    },
    recording: recording
      ? {
          id: recording.id,
          status: recording.status,
          // Do not expose raw storage object keys to participant/observer clients.
          fileKey: isFacilitator ? recording.fileKey : null,
          fileName: recording.fileName,
          fileSizeBytes: recording.originalSizeBytes,
          startedAt: recording.startedAt?.toISOString() ?? null,
          endedAt: recording.endedAt?.toISOString() ?? null,
          errorMessage: isFacilitator
            ? (fileKeyNormalization?.containsRawUrl ||
                fileKeyNormalization?.containsEncodedUrl)
              ? "Запись сохранена у провайдера, но файл ещё не загружен в хранилище"
              : storageObjectExists === false
                ? "Файл записи не найден в хранилище"
                : recording.errorMessage
            : null,
          downloadUrl,
          streamUrl: downloadUrl,
          canRefreshStatus: isFacilitator,
          processingStage: recordingStage,
          readyByFilePresenceFallback:
            recording.status === RecordingStatus.STOPPED && Boolean(recording.fileKey),
        }
      : null,
    transcription: transcript
      ? {
          id: transcript.id,
          status: transcript.status,
          text: canViewTranscript ? (transcriptHasText ? transcript.text : null) : null,
          language: transcript.language,
          model: transcript.transcriptionModel,
          startedAt: transcript.startedAt?.toISOString() ?? null,
          completedAt: transcript.completedAt?.toISOString() ?? null,
          errorMessage: isFacilitator
            ? sanitizeTranscriptErrorMessage(transcript.errorMessage)
            : null,
          canStart: canStartTranscription,
          canRetry: canRetryTranscription,
          canStop: isFacilitator ? canStopTranscription : false,
          canRerun: isFacilitator ? canRerunTranscription : false,
          processingStage: transcriptStage,
          hasSpeakerDiarization: transcript.hasSpeakerDiarization ?? false,
          diarizationStatus: isFacilitator ? (transcript.diarizationStatus ?? null) : null,
          retranscribeCount: isFacilitator ? (transcript.retranscribeCount ?? 0) : null,
          speakerMappingStatus: isFacilitator
            ? (transcript.speakerMappingStatus ?? "NOT_REQUIRED")
            : null,
          mappingFailureReason: isFacilitator ? mappingFailure.mappingFailureReason : null,
          mappingFailureI18nKey: isFacilitator ? mappingFailure.mappingFailureI18nKey : null,
          mappingFailureCompactI18nKey: isFacilitator
            ? mappingFailure.mappingFailureCompactI18nKey
            : null,
          mappingFailureDetails: isFacilitator ? mappingFailure.mappingFailureDetails : null,
          mappingSuggestionDiagnostics: isFacilitator
            ? mappingFailure.mappingSuggestionDiagnostics
            : null,
          speakerMappingRequired: isFacilitator ? speakerMappingRequired : false,
          speakerMappingConfirmed: isFacilitator ? speakerMappingReady : null,
          processingMetadata: isFacilitator ? (transcript.processingMetadata ?? null) : null,
          enhancement: isFacilitator
            ? {
                status: transcriptEnhancementStatus,
                available:
                  asMetadata(transcript.processingMetadata).transcriptionProvider ===
                  "yandex_speechkit",
                suggested:
                  asMetadata(
                    asMetadata(transcript.processingMetadata)
                      .transcriptEnhancementRecommendation,
                  ).suggested === true,
                reasons:
                  (asMetadata(
                    asMetadata(transcript.processingMetadata)
                      .transcriptEnhancementRecommendation,
                  ).reasons as string[] | undefined) ?? [],
                error:
                  (asMetadata(asMetadata(transcript.processingMetadata).transcriptEnhancement)
                    .error as string | undefined) ?? null,
                skipReason:
                  (asMetadata(asMetadata(transcript.processingMetadata).transcriptEnhancement)
                    .skipReason as string | undefined) ?? null,
                inProgress: hasRunningTranscriptEnhancement,
                canRetry: canRetryTranscriptEnhancement,
              }
            : null,
        }
      : {
          id: null,
          status: null,
          text: null,
          language: null,
          model: null,
          startedAt: null,
          completedAt: null,
          errorMessage: null,
          canStart: canStartTranscription,
          canRetry: false,
          canStop: false,
          processingStage: transcriptStage,
          hasSpeakerDiarization: false,
          speakerMappingStatus: null,
          speakerMappingRequired: false,
          speakerMappingConfirmed: null,
          enhancement: null,
        },
    aiAnalysis: aiAnalysisResponse,
    processing: {
      shouldPoll,
      nextPollMs: resolveMaterialsNextPollMs(recordingStatus, shouldPoll),
      currentStage,
      message: shouldPoll ? "updating" : null,
      autoTranscribeEnabled: autoTranscribeAfterRecording,
    },
  });
}
