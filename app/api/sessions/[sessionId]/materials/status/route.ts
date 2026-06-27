import { NextResponse } from "next/server";

import {
  AiAnalysisStatus,
  ParticipantType,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { autoTranscribeAfterRecording } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { NegotiationAnalysisOutput } from "@/lib/ai/negotiation-analysis";
import { getSignedDownloadUrl } from "@/lib/storage/s3";
import {
  isAiAnalysisOutdated,
  isSpeakerMappingReadyForAnalysis,
} from "@/lib/transcription/speaker-mapping-readiness";
import { MANUAL_TRANSCRIPTION_STOP_SENTINEL } from "@/lib/services/transcription-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

const ACTIVE_RECORDING_STATUSES = new Set<RecordingStatus>([
  RecordingStatus.STARTING,
  RecordingStatus.RECORDING,
  RecordingStatus.PROCESSING,
]);

const ACTIVE_TRANSCRIPT_STATUSES = new Set<TranscriptStatus>([
  TranscriptStatus.QUEUED,
  TranscriptStatus.DOWNLOADING_RECORDING,
  TranscriptStatus.COMPRESSING_AUDIO,
  TranscriptStatus.TRANSCRIBING,
]);

const ACTIVE_AI_STATUSES = new Set<AiAnalysisStatus>([
  AiAnalysisStatus.QUEUED,
  AiAnalysisStatus.ANALYZING,
]);

function resolveRecordingProcessingStage(status: RecordingStatus): string {
  switch (status) {
    case RecordingStatus.NOT_STARTED:
      return "not_available";
    case RecordingStatus.STARTING:
    case RecordingStatus.RECORDING:
    case RecordingStatus.PAUSED:
      return "in_progress";
    case RecordingStatus.STOPPED:
      return "finalizing";
    case RecordingStatus.PROCESSING:
      return "processing";
    case RecordingStatus.COMPLETED:
      return "ready";
    case RecordingStatus.FAILED:
      return "failed";
    default:
      return "not_available";
  }
}

function resolveTranscriptProcessingStage(
  transcriptStatus: TranscriptStatus | null,
  recordingStatus: RecordingStatus | null,
  transcriptHasText: boolean,
): string {
  if (transcriptStatus === TranscriptStatus.COMPLETED) {
    return transcriptHasText ? "ready" : "not_started";
  }
  if (transcriptStatus === TranscriptStatus.FAILED) {
    return "failed";
  }
  if (transcriptStatus === TranscriptStatus.QUEUED) {
    return "queued";
  }
  if (transcriptStatus === TranscriptStatus.DOWNLOADING_RECORDING) {
    return "downloading";
  }
  if (transcriptStatus === TranscriptStatus.COMPRESSING_AUDIO) {
    return "compressing";
  }
  if (transcriptStatus === TranscriptStatus.TRANSCRIBING) {
    return "transcribing";
  }

  if (
    !recordingStatus ||
    recordingStatus === RecordingStatus.NOT_STARTED ||
    (recordingStatus !== RecordingStatus.COMPLETED &&
      !ACTIVE_RECORDING_STATUSES.has(recordingStatus))
  ) {
    return "waiting_for_recording";
  }

  if (recordingStatus !== RecordingStatus.COMPLETED) {
    return "waiting_for_recording";
  }

  return "not_started";
}

function resolveAiAnalysisProcessingStage(
  aiStatus: AiAnalysisStatus | null,
  transcriptStatus: TranscriptStatus | null,
  transcriptHasText: boolean,
): string {
  if (!aiStatus) {
    return transcriptHasText ? "not_started" : "waiting_for_transcript";
  }
  switch (aiStatus) {
    case AiAnalysisStatus.QUEUED:
      return "queued";
    case AiAnalysisStatus.ANALYZING:
      return "analyzing";
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

function computeShouldPoll(
  recordingStatus: RecordingStatus | null,
  transcriptStatus: TranscriptStatus | null,
  aiStatus: AiAnalysisStatus | null,
  isParticipantOrObserver = false,
  transcriptHasText = false,
  hasRunningTranscription = false,
  autoTranscribeEnabled = false,
  sessionIsFinished = false,
  isSharedWithSession = false,
): boolean {
  if (
    recordingStatus &&
    (ACTIVE_RECORDING_STATUSES.has(recordingStatus) ||
      recordingStatus === RecordingStatus.STOPPED)
  ) {
    return true;
  }
  // Only poll waiting-for-auto-transcription when auto-transcription is enabled.
  // When disabled, the recording-ready state is stable and no auto-job will start.
  if (
    autoTranscribeEnabled &&
    recordingStatus === RecordingStatus.COMPLETED &&
    !transcriptHasText &&
    !hasRunningTranscription
  ) {
    return true;
  }
  if (transcriptStatus && ACTIVE_TRANSCRIPT_STATUSES.has(transcriptStatus)) {
    return true;
  }
  if (aiStatus && ACTIVE_AI_STATUSES.has(aiStatus)) {
    return true;
  }
  // Participants/observers on a finished session need to poll to detect:
  // - when facilitator starts and completes analysis (aiStatus null → QUEUED → COMPLETED)
  // - when facilitator shares/unshares the completed analysis
  // Stop polling only once analysis is confirmed shared (stable state).
  if (isParticipantOrObserver && sessionIsFinished && !isSharedWithSession) {
    return true;
  }
  return false;
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
        },
      },
      transcript: {
        select: {
          id: true,
          status: true,
          text: true,
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

  const recordingStatus = recording?.status ?? null;
  const transcriptStatus = transcript?.status ?? null;
  const aiStatus = aiAnalysis?.status ?? null;

  const transcriptHasText = Boolean(transcript?.text?.trim());
  const hasRunningTranscription =
    transcriptStatus !== null &&
    ACTIVE_TRANSCRIPT_STATUSES.has(transcriptStatus);

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
  const hasRunningAiAnalysis = aiStatus !== null && ACTIVE_AI_STATUSES.has(aiStatus);

  const speakerMappingReady = transcript
    ? isSpeakerMappingReadyForAnalysis(transcript)
    : true;

  const speakerMappingRequired =
    Boolean(transcript?.hasSpeakerDiarization) && !speakerMappingReady;

  const analysisOutdated = isAiAnalysisOutdated(
    transcript?.retranscribeCount,
    aiAnalysis?.transcriptRetranscribeCount,
  );

  const canRunAiAnalysis =
    isFacilitator &&
    transcriptCompleted &&
    !hasRunningAiAnalysis &&
    speakerMappingReady &&
    (aiStatus === null ||
      aiStatus === AiAnalysisStatus.FAILED ||
      analysisOutdated);
  const canRetryAiAnalysis =
    isFacilitator &&
    transcriptCompleted &&
    aiStatus === AiAnalysisStatus.FAILED &&
    !hasRunningAiAnalysis &&
    speakerMappingReady;
  const canRerunAiAnalysis =
    isFacilitator &&
    transcriptCompleted &&
    !hasRunningAiAnalysis &&
    speakerMappingReady &&
    aiStatus === AiAnalysisStatus.COMPLETED;
  const canShareAiAnalysis =
    isFacilitator && aiStatus === AiAnalysisStatus.COMPLETED;

  const aiVisibility = aiAnalysis?.visibility ?? "FACILITATOR_ONLY";
  const isSharedWithSession = aiVisibility === "SHARED_WITH_SESSION";

  // Facilitator sees full analysis; participants see shared version if published
  const canViewAiAnalysis = isFacilitator || isSharedWithSession;

  let downloadUrl: string | null = null;
  if (
    canViewRecording &&
    recording?.fileKey &&
    recording.status === RecordingStatus.COMPLETED
  ) {
    downloadUrl = await getSignedDownloadUrl(recording.fileKey, 900);
  }

  const recordingStage = recordingStatus
    ? resolveRecordingProcessingStage(recordingStatus)
    : "not_available";

  const transcriptStage = resolveTranscriptProcessingStage(
    transcriptStatus,
    recordingStatus,
    transcriptHasText,
  );

  const aiAnalysisStage = resolveAiAnalysisProcessingStage(
    aiStatus,
    transcriptStatus,
    transcriptHasText,
  );

  const isParticipantOrObserver = !isFacilitator;
  const sessionIsFinished = session.negotiationState === "FINISHED";
  const shouldPoll = computeShouldPoll(
    recordingStatus,
    transcriptStatus,
    aiStatus,
    isParticipantOrObserver,
    transcriptHasText,
    hasRunningTranscription,
    autoTranscribeAfterRecording,
    sessionIsFinished,
    isSharedWithSession,
  );

  const canStartTranscription =
    canRunTranscription &&
    !hasRunningTranscription &&
    !transcriptCompleted &&
    recording?.status === RecordingStatus.COMPLETED &&
    Boolean(recording.fileKey) &&
    !transcriptHasText;

  const canRetryTranscription =
    canRunTranscription &&
    !hasRunningTranscription &&
    transcript?.status === TranscriptStatus.FAILED &&
    recording?.status === RecordingStatus.COMPLETED &&
    Boolean(recording?.fileKey);

  const canStopTranscription = canRunTranscription && hasRunningTranscription;

  // Re-run is allowed when a completed transcript exists and recording is available
  const canRerunTranscription =
    canRunTranscription &&
    !hasRunningTranscription &&
    transcriptCompleted &&
    recording?.status === RecordingStatus.COMPLETED &&
    Boolean(recording?.fileKey);

  const sessionRoleRecord = await prisma.sessionRole.findUnique({
    where: { id: participant.sessionRoleId ?? "" },
    select: { name: true },
  });
  const participantRole = !isObserver ? (sessionRoleRecord?.name ?? null) : null;

  // For facilitators: full analysis. For participants/observers: shared sanitized version only.
  const rawAnalysisJsonForUser = isFacilitator
    ? (aiAnalysis?.analysisJson ?? null)
    : isSharedWithSession
      ? (aiAnalysis?.sharedAnalysisJson ?? null)
      : null;

  // Filter participantPersonalFeedback: each participant sees only their own section;
  // facilitators see all sections.
  let analysisJsonForUser = rawAnalysisJsonForUser;
  if (!isFacilitator && rawAnalysisJsonForUser) {
    const {
      filterPersonalFeedbackForParticipant,
      sanitizeSharedAiAnalysisForParticipant,
    } = await import("@/lib/privacy/serializers");
    const sanitizedShared = sanitizeSharedAiAnalysisForParticipant(
      rawAnalysisJsonForUser as NegotiationAnalysisOutput,
    );

    if (isObserver) {
      const observerSafe = {
        ...(sanitizedShared as NegotiationAnalysisOutput),
      };
      delete (observerSafe as { participantPersonalFeedback?: unknown })
        .participantPersonalFeedback;
      analysisJsonForUser = observerSafe as NegotiationAnalysisOutput;
    } else {
      analysisJsonForUser = filterPersonalFeedbackForParticipant(
        sanitizedShared,
        { participantId: participant.id, displayName: participant.displayName },
      );
    }
  }

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
          errorMessage: isFacilitator ? recording.errorMessage : null,
          downloadUrl,
          streamUrl: downloadUrl,
          canRefreshStatus: isFacilitator,
          processingStage: recordingStage,
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
          speakerMappingRequired: isFacilitator ? speakerMappingRequired : false,
          speakerMappingConfirmed: isFacilitator ? speakerMappingReady : null,
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
        },
    aiAnalysis: aiAnalysisResponse,
    processing: {
      shouldPoll,
      nextPollMs: shouldPoll ? 3500 : null,
      currentStage,
      message: shouldPoll ? "updating" : null,
      autoTranscribeEnabled: autoTranscribeAfterRecording,
    },
  });
}
