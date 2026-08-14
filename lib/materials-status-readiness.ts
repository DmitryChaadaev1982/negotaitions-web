import {
  AiAnalysisStatus,
  RecordingStatus,
  TranscriptStatus,
} from "@/app/generated/prisma/client";

export const ACTIVE_RECORDING_STATUSES = new Set<RecordingStatus>([
  RecordingStatus.STARTING,
  RecordingStatus.RECORDING,
  RecordingStatus.PROCESSING,
]);

export const ACTIVE_TRANSCRIPT_STATUSES = new Set<TranscriptStatus>([
  TranscriptStatus.QUEUED,
  TranscriptStatus.DOWNLOADING_RECORDING,
  TranscriptStatus.COMPRESSING_AUDIO,
  TranscriptStatus.TRANSCRIBING,
]);

export const ACTIVE_AI_STATUSES = new Set<AiAnalysisStatus>([
  AiAnalysisStatus.QUEUED,
  AiAnalysisStatus.ANALYZING,
]);

export const MATERIALS_POLL_INTERVAL_DEFAULT_MS = 3500;
export const MATERIALS_POLL_INTERVAL_FAST_STARTING_MS = 1000;

export const STALE_RECORDING_STARTING_TIMEOUT_SECONDS = 90;
export const STALE_RECORDING_STARTING_FAILURE_CODE =
  "RECORDING_STARTING_TIMEOUT_RECONCILED";

export function isStaleStartingRecording(input: {
  status: RecordingStatus | null;
  startedAt: Date | null;
  egressId: string | null;
  now?: Date;
  timeoutSeconds?: number;
}): boolean {
  if (input.status !== RecordingStatus.STARTING) {
    return false;
  }
  if (input.egressId) {
    return false;
  }
  if (!input.startedAt) {
    return false;
  }
  const timeoutSeconds =
    input.timeoutSeconds ?? STALE_RECORDING_STARTING_TIMEOUT_SECONDS;
  const now = input.now ?? new Date();
  return (
    now.getTime() - input.startedAt.getTime() >= timeoutSeconds * 1000
  );
}

export function isRecordingReadyForTranscription(
  status: RecordingStatus | null,
  hasFileKey: boolean,
): boolean {
  if (!status || !hasFileKey) {
    return false;
  }
  return status === RecordingStatus.COMPLETED || status === RecordingStatus.STOPPED;
}

export function hasRunningRawTranscription(
  transcriptStatus: TranscriptStatus | null,
): boolean {
  return transcriptStatus !== null && ACTIVE_TRANSCRIPT_STATUSES.has(transcriptStatus);
}

export function resolveTranscriptProcessingStage(
  transcriptStatus: TranscriptStatus | null,
  recordingStatus: RecordingStatus | null,
  recordingHasFileKey: boolean,
  transcriptHasText: boolean,
  enhancementStatus:
    | "NOT_AVAILABLE"
    | "IDLE"
    | "SUGGESTED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "PARTIAL"
    | "FAILED"
    | "SKIPPED",
): string {
  if (transcriptStatus === TranscriptStatus.COMPLETED) {
    return transcriptHasText ? "ready" : "not_started";
  }
  if (enhancementStatus === "IN_PROGRESS") {
    return "enhancing";
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
    (!isRecordingReadyForTranscription(recordingStatus, recordingHasFileKey) &&
      !ACTIVE_RECORDING_STATUSES.has(recordingStatus))
  ) {
    return "waiting_for_recording";
  }

  if (!isRecordingReadyForTranscription(recordingStatus, recordingHasFileKey)) {
    return "waiting_for_recording";
  }

  return "not_started";
}

export function computeShouldPoll(
  recordingStatus: RecordingStatus | null,
  recordingHasFileKey: boolean,
  transcriptStatus: TranscriptStatus | null,
  transcriptEnhancementInProgress: boolean,
  aiStatus: AiAnalysisStatus | null,
  isParticipantOrObserver = false,
  transcriptHasText = false,
  hasRunningTranscription = false,
  autoTranscribeEnabled = false,
  sessionIsFinished = false,
  hasValidPublicationGrant = false,
  speakerMappingRequired = false,
  hasCurrentPublishableAiAnalysis = false,
): boolean {
  if (
    recordingStatus &&
    (ACTIVE_RECORDING_STATUSES.has(recordingStatus) ||
      (recordingStatus === RecordingStatus.STOPPED && !recordingHasFileKey))
  ) {
    return true;
  }
  if (
    autoTranscribeEnabled &&
    isRecordingReadyForTranscription(recordingStatus, recordingHasFileKey) &&
    !transcriptHasText &&
    !hasRunningTranscription &&
    transcriptStatus !== TranscriptStatus.FAILED
  ) {
    return true;
  }
  if (transcriptStatus && ACTIVE_TRANSCRIPT_STATUSES.has(transcriptStatus)) {
    return true;
  }
  if (transcriptEnhancementInProgress) {
    return true;
  }
  if (aiStatus && ACTIVE_AI_STATUSES.has(aiStatus)) {
    return true;
  }
  if (!isParticipantOrObserver && speakerMappingRequired) {
    return true;
  }
  const terminalProcessingFailure =
    !hasCurrentPublishableAiAnalysis &&
    (recordingStatus === RecordingStatus.FAILED ||
      transcriptStatus === TranscriptStatus.FAILED ||
      aiStatus === AiAnalysisStatus.FAILED);
  if (
    isParticipantOrObserver &&
    sessionIsFinished &&
    !hasValidPublicationGrant &&
    !terminalProcessingFailure
  ) {
    return true;
  }
  return false;
}

export function resolveMaterialsNextPollMs(
  recordingStatus: RecordingStatus | null,
  shouldPoll: boolean,
): number | null {
  if (!shouldPoll) {
    return null;
  }

  if (recordingStatus === RecordingStatus.STARTING) {
    return MATERIALS_POLL_INTERVAL_FAST_STARTING_MS;
  }

  return MATERIALS_POLL_INTERVAL_DEFAULT_MS;
}
