export type ProcessingRecordingStatus =
  | "not_available"
  | "in_progress"
  | "finalizing"
  | "processing"
  | "ready"
  | "failed";

export type ProcessingTranscriptionStatus =
  | "waiting_for_recording"
  | "not_started"
  | "queued"
  | "downloading"
  | "compressing"
  | "transcribing"
  | "enhancing"
  | "ready"
  | "failed";

export type ProcessingAiAnalysisStatus =
  | "waiting_for_transcript"
  | "not_started"
  | "queued"
  | "analyzing"
  | "ready"
  | "failed";

export type SessionMaterialsRecordingSnapshot = {
  status: string;
  fileUrl: string | null;
  updatedAt: string | null;
  errorMessage: string | null;
} | null;

export type SessionMaterialsTranscriptSnapshot = {
  text: string;
  diarizedText: string | null;
  updatedAt: string;
} | null;

export type SessionMaterialsProcessingSnapshot = {
  recording: ProcessingRecordingStatus;
  transcription: ProcessingTranscriptionStatus;
  aiAnalysis: ProcessingAiAnalysisStatus;
  recordingUpdatedAt: string | null;
  transcriptionUpdatedAt: string | null;
  recordingError: string | null;
};

function isRecordingReady(status: string) {
  return status === "COMPLETED";
}

function isRecordingInProgress(status: string) {
  return (
    status === "STARTING" ||
    status === "RECORDING" ||
    status === "PAUSED"
  );
}

export function resolveRecordingProcessingStatus(
  recording: SessionMaterialsRecordingSnapshot,
): ProcessingRecordingStatus {
  if (!recording || recording.status === "NOT_STARTED") {
    return "not_available";
  }

  switch (recording.status) {
    case "STARTING":
    case "RECORDING":
    case "PAUSED":
      return "in_progress";
    case "STOPPED":
      return "finalizing";
    case "PROCESSING":
      return "processing";
    case "COMPLETED":
      return "ready";
    case "FAILED":
      return "failed";
    default:
      return "not_available";
  }
}

export function resolveTranscriptionProcessingStatus(
  recording: SessionMaterialsRecordingSnapshot,
  transcript: SessionMaterialsTranscriptSnapshot,
): ProcessingTranscriptionStatus {
  if (transcript?.text.trim()) {
    return "ready";
  }

  if (!recording || !isRecordingReady(recording.status)) {
    return "waiting_for_recording";
  }

  return "not_started";
}

export function resolveAiAnalysisProcessingStatus(
  transcript: SessionMaterialsTranscriptSnapshot,
): ProcessingAiAnalysisStatus {
  if (!transcript?.text.trim()) {
    return "waiting_for_transcript";
  }

  return "not_started";
}

export function buildSessionMaterialsProcessingSnapshot(
  recording: SessionMaterialsRecordingSnapshot,
  transcript: SessionMaterialsTranscriptSnapshot,
): SessionMaterialsProcessingSnapshot {
  return {
    recording: resolveRecordingProcessingStatus(recording),
    transcription: resolveTranscriptionProcessingStatus(recording, transcript),
    aiAnalysis: resolveAiAnalysisProcessingStatus(transcript),
    recordingUpdatedAt: recording?.updatedAt ?? null,
    transcriptionUpdatedAt: transcript?.updatedAt ?? null,
    recordingError: recording?.errorMessage ?? null,
  };
}

export function hasUsableTranscript(transcript: SessionMaterialsTranscriptSnapshot) {
  return Boolean(transcript?.text.trim() || transcript?.diarizedText?.trim());
}

export function getTranscriptDisplayText(transcript: SessionMaterialsTranscriptSnapshot) {
  if (!transcript) {
    return null;
  }

  return transcript.diarizedText?.trim() || transcript.text.trim() || null;
}

export function isRecordingAvailableForDisplay(
  recording: SessionMaterialsRecordingSnapshot,
) {
  if (!recording) {
    return false;
  }

  return (
    isRecordingReady(recording.status) ||
    isRecordingInProgress(recording.status) ||
    recording.status === "PROCESSING" ||
    recording.status === "STOPPED" ||
    recording.status === "FAILED"
  );
}

/** Statuses that require active polling */
export function shouldPollForUpdates(
  recordingStatus: string | null | undefined,
  transcriptStatus: string | null | undefined,
  aiAnalysisStatus?: string | null,
): boolean {
  const activeRecordingStatuses = new Set([
    "STARTING",
    "RECORDING",
    "STOPPING",
    "PROCESSING",
    "STOPPED",
  ]);
  const activeTranscriptStatuses = new Set([
    "QUEUED",
    "DOWNLOADING_RECORDING",
    "COMPRESSING_AUDIO",
    "TRANSCRIBING",
  ]);
  const activeAiAnalysisStatuses = new Set(["QUEUED", "ANALYZING"]);

  if (recordingStatus && activeRecordingStatuses.has(recordingStatus)) {
    return true;
  }
  if (transcriptStatus && activeTranscriptStatuses.has(transcriptStatus)) {
    return true;
  }
  if (aiAnalysisStatus && activeAiAnalysisStatuses.has(aiAnalysisStatus)) {
    return true;
  }
  return false;
}
