import { NextResponse } from "next/server";

import {
  AiAnalysisPublicationProjection,
  AiAnalysisStatus,
  ParticipantType,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { autoTranscribeAfterRecording } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { appendRecordingDebugEvent } from "@/lib/debug/recording-debug";
import { evaluateAiAnalysisCurrentness, shouldPresentAnalysisFromOlderTranscript } from "@/lib/ai/analysis-currentness";
import { evaluateAiAnalysisReadiness } from "@/lib/ai/analysis-readiness";
import { computeCurrentMaterialInputFingerprint } from "@/lib/ai/session-analysis-context";
import { resolveTranscriptEnhancementStatus } from "@/lib/post-processing/enhancement-effective-state";
import { reconcileTranscriptEnhancementTimeout } from "@/lib/services/transcript-enhancement-timeout";
import {
  canContinueWithCurrentTranscript,
  isEnhancementStatusRunning,
  projectPostProcessingStages,
} from "@/lib/post-processing/projection";
import { isAiAnalysisRunLeaseActive } from "@/lib/ai/analysis-operation";
import type { NegotiationAnalysisOutput } from "@/lib/ai/negotiation-analysis";
import {
  getAnalysisForFacilitator,
  getAnalysisForObserver,
  getAnalysisForParticipant,
} from "@/lib/analysis-visibility";
import { isGrantProjectionCompatibleWithParticipant } from "@/lib/ai-publication";
import { getSignedDownloadUrl } from "@/lib/storage/s3";
import { isAiAnalysisOutdated } from "@/lib/transcription/speaker-mapping-readiness";
import { MANUAL_TRANSCRIPTION_STOP_SENTINEL } from "@/lib/services/transcription-runner";
import { headObject } from "@/lib/storage/s3";
import { normalizeRecordingFileKey } from "@/lib/storage/recording-file-key";
import { resolveMappingFailure } from "@/lib/transcription/mapping-failure-reasons";
import { getRecordingDisplayState } from "@/lib/recording-display-state";
import { isExternalServicesMockMode } from "@/lib/test-mode";
import {
  canOfferRetranscribe,
  computeShouldPoll,
  hasRunningRawTranscription,
  resolveMaterialsNextPollMs,
  isRecordingReadyForTranscription,
  resolveTranscriptProcessingStage,
} from "@/lib/materials-status-readiness";
import { maybeReconcileVoximplantRecordingAttempt } from "@/lib/voximplant/recording-reconciliation";
import {
  projectPostNegotiationParticipantPreparationNotes,
  resolveDebriefVisibleNotes,
} from "@/lib/debrief-visible-notes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function asMetadata(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
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

  try {
    await maybeReconcileVoximplantRecordingAttempt(sessionId);
  } catch (error) {
    console.warn(
      "[materials-status] provider recording reconciliation deferred:",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: {
      recording: {
        select: {
          id: true,
          recordingAttemptId: true,
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
      participants: {
        select: {
          id: true,
          displayName: true,
          type: true,
        },
      },
      aiAnalysis: {
        select: {
          id: true,
          status: true,
          transcriptId: true,
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
          inputFingerprint: true,
          runToken: true,
          leaseExpiresAt: true,
          updatedAt: true,
          publications: {
            where: { revokedAt: null },
            orderBy: { publicationEpoch: "desc" },
            take: 1,
            select: {
              id: true,
              analysisVersion: true,
              publicationEpoch: true,
              sharedAnalysisJson: true,
              sharedExecutiveSummary: true,
              publishedAt: true,
              publishedBy: true,
              grants: {
                where: {
                  sessionParticipantId: participant.id,
                  userId: participant.userId ?? "",
                  revokedAt: null,
                },
                select: {
                  projection: true,
                  userId: true,
                },
              },
            },
          },
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

  const recording = session.recording;
  const transcript = session.transcript;
  const aiAnalysis = session.aiAnalysis;
  if (transcript) {
    const reconciled = await reconcileTranscriptEnhancementTimeout({
      db: prisma as never,
      transcriptId: transcript.id,
    });
    transcript.processingMetadata = reconciled.metadata as typeof transcript.processingMetadata;
  }

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

  const aiAnalysisReadiness = evaluateAiAnalysisReadiness(
    transcript
      ? {
          ...transcript,
          enhancementStatus: transcriptEnhancementStatus,
          participants: session.participants,
        }
      : null,
  );
  const transcriptHasText = aiAnalysisReadiness.hasUsableContent;
  const hasRunningTranscription = hasRunningRawTranscription(transcriptStatus);
  const hasRunningTranscriptEnhancement = isEnhancementStatusRunning(
    transcriptEnhancementStatus,
  );

  const canViewRecording = true;
  const activePublication = aiAnalysis?.publications[0] ?? null;
  const viewerGrant = activePublication?.grants[0] ?? null;
  const hasValidPublicationGrant = Boolean(
    viewerGrant &&
      participant.userId &&
      viewerGrant.userId === participant.userId &&
      isGrantProjectionCompatibleWithParticipant(viewerGrant.projection, participant.type),
  );

  // Observer transcript access is publication-grant based. This keeps the
  // Observer privacy boundary (grant + OBSERVER projection) while following
  // historical room-entry eligibility: a grant from Publish or from first
  // room entry during an active publication authorizes transcript; lobby-only
  // membership and entry after Unshare do not.
  const canViewTranscript = isObserver
    ? hasValidPublicationGrant
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
  const speakerMappingConfirmed =
    isFacilitator &&
    speakerMappingReady &&
    transcript?.speakerMappingStatus === "CONFIRMED";

  const analysisOutdated = isAiAnalysisOutdated(
    transcript?.retranscribeCount,
    aiAnalysis?.transcriptRetranscribeCount,
  );
  const currentMaterialFingerprint = aiAnalysis
    ? await computeCurrentMaterialInputFingerprint(sessionId)
    : null;
  const analysisCurrentness = evaluateAiAnalysisCurrentness({
    analysis: aiAnalysis,
    currentFingerprint: currentMaterialFingerprint,
    transcriptId: transcript?.id,
    transcriptRetranscribeCount: transcript?.retranscribeCount,
  });
  const analysisCurrent = analysisCurrentness.current;
  if (aiAnalysis) {
    console.info("[materials-status] ai_currentness", {
      sessionId,
      current: analysisCurrent,
      reason: analysisCurrentness.reason,
      schemaVersion: 1,
      storedFingerprint: aiAnalysis.inputFingerprint ?? null,
    });
  }
  const hasCurrentPublishableAiAnalysis =
    aiStatus === AiAnalysisStatus.COMPLETED &&
    analysisCurrent &&
    aiAnalysis?.analysisJson != null;

  const canRunAiAnalysis =
    isFacilitator &&
    aiAnalysisReadiness.ready &&
    !hasRunningAiAnalysis &&
    !hasRunningTranscriptEnhancement &&
    (aiStatus === null ||
      aiStatus === AiAnalysisStatus.FAILED ||
      aiStatus === AiAnalysisStatus.QUEUED ||
      aiStatus === AiAnalysisStatus.ANALYZING ||
      analysisOutdated ||
      !analysisCurrent);
  const canRetryAiAnalysis =
    isFacilitator &&
    aiAnalysisReadiness.ready &&
    (aiStatus === AiAnalysisStatus.FAILED ||
      aiStatus === AiAnalysisStatus.QUEUED ||
      aiStatus === AiAnalysisStatus.ANALYZING) &&
    !hasRunningAiAnalysis &&
    !hasRunningTranscriptEnhancement &&
    speakerMappingReady;
  const canRerunAiAnalysis =
    isFacilitator &&
    aiAnalysisReadiness.ready &&
    !hasRunningAiAnalysis &&
    !hasRunningTranscriptEnhancement &&
    aiStatus === AiAnalysisStatus.COMPLETED &&
    analysisCurrent;
  const canShareAiAnalysis =
    isFacilitator &&
    aiStatus === AiAnalysisStatus.COMPLETED &&
    analysisCurrent;

  const aiVisibility = aiAnalysis?.visibility ?? "FACILITATOR_ONLY";
  const isSharedWithSession = Boolean(activePublication);

  // Processing status stays canonical on AiAnalysis. Access to a participant or
  // observer projection additionally requires that recipient's durable grant.
  const canViewAiAnalysis =
    isFacilitator || (hasValidPublicationGrant && analysisCurrent);
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

  const presentedAiStatus =
    aiStatus === AiAnalysisStatus.COMPLETED && !analysisCurrent
      ? null
      : aiStatus;
  const aiAnalysisStage = resolveAiAnalysisProcessingStage(
    presentedAiStatus,
    transcriptStatus,
    transcriptHasText,
    hasRunningAiAnalysis,
  );

  const postProcessing = projectPostProcessingStages({
    recordingStage,
    transcriptStage,
    enhancementStatus: transcriptEnhancementStatus,
    transcriptPresent: Boolean(transcript),
    mappingInput: {
      hasSpeakerDiarization: transcript?.hasSpeakerDiarization ?? false,
      speakerMappingStatus: transcript?.speakerMappingStatus ?? null,
      segments: transcript?.segments ?? [],
      participants: session.participants,
    },
    aiStage: aiAnalysisStage,
    conflictingOwnership: hasRunningAiAnalysis || hasRunningTranscription,
  });

  const isParticipantOrObserver = !isFacilitator;
  const sessionIsFinished = session.negotiationState === "FINISHED";
  const shouldPoll = computeShouldPoll(
    recordingStatus,
    recordingHasFileKey,
    transcriptStatus,
    hasRunningTranscriptEnhancement,
    aiStatus,
    isParticipantOrObserver,
    transcriptHasText,
    hasRunningTranscription,
    autoTranscribeAfterRecording,
    sessionIsFinished,
    hasValidPublicationGrant,
    speakerMappingRequired,
    hasCurrentPublishableAiAnalysis,
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

  // Re-run stays available when the physical object is gone. Recording
  // COMPLETED + fileKey is historical truth; missing storage is a
  // non-destructive retranscription outcome, not a hidden action.
  const canRerunTranscription = canOfferRetranscribe({
    canRunTranscription,
    hasRunningTranscription,
    transcriptCompleted,
    recordingLifecycleReady: recordingReadyByState,
    hasFileKey: Boolean(recording?.fileKey),
  });

  const sessionRoleRecord = await prisma.sessionRole.findUnique({
    where: { id: participant.sessionRoleId ?? "" },
    select: { name: true },
  });
  const participantRole = !isObserver ? (sessionRoleRecord?.name ?? null) : null;

  const presentCurrentAnalysis = analysisCurrent;
  const fullAnalysisJson =
    presentCurrentAnalysis
      ? ((aiAnalysis?.analysisJson as NegotiationAnalysisOutput | null) ?? null)
      : null;
  const sharedAnalysisJson =
    presentCurrentAnalysis
      ? ((activePublication?.sharedAnalysisJson as NegotiationAnalysisOutput | null) ?? null)
      : null;
  const analysisJsonForUser = isFacilitator
    ? getAnalysisForFacilitator(fullAnalysisJson)
    : hasValidPublicationGrant && presentCurrentAnalysis
      ? viewerGrant?.projection === AiAnalysisPublicationProjection.OBSERVER
        ? getAnalysisForObserver(sharedAnalysisJson)
        : getAnalysisForParticipant(sharedAnalysisJson, {
            participantId: participant.id,
            displayName: participant.displayName,
          }, session.participants)
      : null;

  const executiveSummaryForUser = isFacilitator
    ? presentCurrentAnalysis
      ? (aiAnalysis?.executiveSummary ?? null)
      : null
    : hasValidPublicationGrant && presentCurrentAnalysis
      ? (activePublication?.sharedExecutiveSummary ?? null)
      : null;

  const aiAnalysisResponse = {
    id: aiAnalysis?.id ?? null,
    status: presentCurrentAnalysis
      ? (aiAnalysis?.status ?? "NOT_STARTED")
      : "NOT_STARTED",
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
    analysisCurrent: isFacilitator ? analysisCurrent : undefined,
    historicalAnalysisExists: Boolean(aiAnalysis),
    speakerMappingRequired: isFacilitator ? speakerMappingRequired : false,
    participantPlaceholder: !isFacilitator && !canViewAiAnalysis,
    // Analysis version tracking
    analysisFromOlderTranscript: shouldPresentAnalysisFromOlderTranscript({
      isFacilitator,
      analysisCurrent,
      analysisOutdated,
    }),
    // Sharing metadata
    visibility: isFacilitator ? aiVisibility : null,
    isSharedWithSession,
    sharedAt: isFacilitator
      ? (activePublication?.publishedAt?.toISOString() ?? aiAnalysis?.sharedAt?.toISOString() ?? null)
      : null,
    sharedBy: isFacilitator
      ? (activePublication?.publishedBy ?? aiAnalysis?.sharedBy ?? null)
      : null,
    notSharedMessage:
      !isFacilitator && !canViewAiAnalysis && aiStatus !== null
        ? isSharedWithSession && !analysisCurrent
          ? "AI analysis is no longer current."
          : isSharedWithSession
            ? "AI analysis was not published for this recipient."
            : "AI analysis has not been shared yet."
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

  const notesRoster = await prisma.sessionParticipant.findMany({
    where: { sessionId },
    select: {
      id: true,
      userId: true,
      displayName: true,
      type: true,
      notes: true,
      updatedAt: true,
      sessionRole: {
        select: { name: true, sortOrder: true },
      },
    },
  });
  const postNegotiationNotes = {
    participantPreparation: projectPostNegotiationParticipantPreparationNotes(
      resolveDebriefVisibleNotes({
        roomLifecycle: session.roomLifecycle,
        negotiationState: session.negotiationState,
        viewerParticipantId: participant.id,
        viewerType: participant.type,
        participants: notesRoster,
      }),
    ),
  };

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
          speakerMappingConfirmed: isFacilitator ? speakerMappingConfirmed : null,
          processingMetadata: isFacilitator ? (transcript.processingMetadata ?? null) : null,
          enhancement: {
            // Completion/freshness is shared operational status, not access to
            // transcript content or private diagnostics. Observers receive the
            // safe status projection so they cannot fall back to NOT_STARTED.
            status: transcriptEnhancementStatus,
            available:
              asMetadata(transcript.processingMetadata).transcriptionProvider ===
              "yandex_speechkit",
            suggested: isFacilitator
              ? asMetadata(
                  asMetadata(transcript.processingMetadata)
                    .transcriptEnhancementRecommendation,
                ).suggested === true
              : false,
            reasons: isFacilitator
              ? (asMetadata(
                  asMetadata(transcript.processingMetadata)
                    .transcriptEnhancementRecommendation,
                ).reasons as string[] | undefined) ?? []
              : [],
            error: isFacilitator
              ? (asMetadata(asMetadata(transcript.processingMetadata).transcriptEnhancement)
                  .error as string | undefined) ?? null
              : null,
            skipReason: isFacilitator
              ? (asMetadata(asMetadata(transcript.processingMetadata).transcriptEnhancement)
                  .skipReason as string | undefined) ?? null
              : null,
            inProgress: hasRunningTranscriptEnhancement,
            canRetry: isFacilitator ? canRetryTranscriptEnhancement : false,
            canContinueWithCurrentTranscript: canContinueWithCurrentTranscript(
              transcriptEnhancementStatus,
            ),
          },
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
    postNegotiationNotes,
    postProcessing,
    processing: {
      shouldPoll,
      nextPollMs: resolveMaterialsNextPollMs(recordingStatus, shouldPoll),
      currentStage,
      message: shouldPoll ? "updating" : null,
      autoTranscribeEnabled: autoTranscribeAfterRecording,
    },
  });
}
