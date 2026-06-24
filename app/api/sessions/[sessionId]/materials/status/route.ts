import { NextResponse } from "next/server";

import {
  AiAnalysisStatus,
  ParticipantType,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import { getSignedDownloadUrl } from "@/lib/storage/s3";

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

function computeShouldPoll(
  recordingStatus: RecordingStatus | null,
  transcriptStatus: TranscriptStatus | null,
  aiStatus: AiAnalysisStatus | null,
  isParticipantOrObserver = false,
  transcriptHasText = false,
  hasRunningTranscription = false,
): boolean {
  if (
    recordingStatus &&
    (ACTIVE_RECORDING_STATUSES.has(recordingStatus) ||
      recordingStatus === RecordingStatus.STOPPED)
  ) {
    return true;
  }
  if (
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
  // Participants/observers need to poll to detect when analysis gets shared
  if (isParticipantOrObserver && aiStatus === AiAnalysisStatus.COMPLETED) {
    return true;
  }
  return false;
}

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const url = new URL(request.url);
  const joinToken = url.searchParams.get("joinToken");

  if (!joinToken) {
    return NextResponse.json({ error: "joinToken is required." }, { status: 400 });
  }

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
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
  const canViewTranscript = true;
  const canRunTranscription = isFacilitator;
  const canRetryFailedProcessing = isFacilitator;

  const transcriptCompleted =
    transcriptStatus === TranscriptStatus.COMPLETED && transcriptHasText;
  const hasRunningAiAnalysis = aiStatus !== null && ACTIVE_AI_STATUSES.has(aiStatus);

  const canRunAiAnalysis =
    isFacilitator && transcriptCompleted && !hasRunningAiAnalysis;
  const canRetryAiAnalysis =
    isFacilitator &&
    transcriptCompleted &&
    aiStatus === AiAnalysisStatus.FAILED &&
    !hasRunningAiAnalysis;
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
  const shouldPoll = computeShouldPoll(
    recordingStatus,
    transcriptStatus,
    aiStatus,
    isParticipantOrObserver,
    transcriptHasText,
    hasRunningTranscription,
  );

  const canStartTranscription =
    canRunTranscription &&
    !hasRunningTranscription &&
    recording?.status === RecordingStatus.COMPLETED &&
    Boolean(recording.fileKey) &&
    !transcriptHasText;

  const canRetryTranscription =
    canRunTranscription &&
    !hasRunningTranscription &&
    transcript?.status === TranscriptStatus.FAILED &&
    recording?.status === RecordingStatus.COMPLETED &&
    Boolean(recording?.fileKey);

  const sessionRoleRecord = await prisma.sessionRole.findUnique({
    where: { id: participant.sessionRoleId ?? "" },
    select: { name: true },
  });
  const participantRole = !isObserver ? (sessionRoleRecord?.name ?? null) : null;

  // For facilitators: full analysis. For participants/observers: shared sanitized version only.
  const analysisJsonForUser = isFacilitator
    ? (aiAnalysis?.analysisJson ?? null)
    : isSharedWithSession
      ? (aiAnalysis?.sharedAnalysisJson ?? null)
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
    canView: canViewAiAnalysis,
    canShare: canShareAiAnalysis,
    participantPlaceholder: !isFacilitator && !isSharedWithSession,
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
          fileKey: recording.fileKey,
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
          errorMessage: isFacilitator ? transcript.errorMessage : null,
          canStart: canStartTranscription,
          canRetry: canRetryTranscription,
          processingStage: transcriptStage,
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
          processingStage: transcriptStage,
        },
    aiAnalysis: aiAnalysisResponse,
    processing: {
      shouldPoll,
      nextPollMs: shouldPoll ? 3500 : null,
      currentStage,
      message: shouldPoll ? "updating" : null,
    },
  });
}
