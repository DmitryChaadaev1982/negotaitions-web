type TranscriptionSectionRefreshKeyParams = {
  sessionId: string;
  transcriptId?: string | null;
  recordingId?: string | null;
  // Legacy volatile status fields intentionally ignored to avoid remounts.
  processingStage?: string | null;
  diarizationStatus?: string | null;
  speakerMappingRequired?: boolean;
};

export function getTranscriptionSectionRefreshKey(
  params: TranscriptionSectionRefreshKeyParams,
): string {
  if (params.transcriptId && params.recordingId) {
    return `${params.recordingId}:${params.transcriptId}`;
  }

  if (params.transcriptId) {
    return params.transcriptId;
  }

  return params.sessionId;
}
