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
  const volatileSuffix = [
    params.processingStage ?? "",
    params.diarizationStatus ?? "",
    params.speakerMappingRequired ? "1" : "0",
  ].join("|");

  if (params.transcriptId && params.recordingId) {
    return `${params.recordingId}:${params.transcriptId}:${volatileSuffix}`;
  }

  if (params.transcriptId) {
    return `${params.transcriptId}:${volatileSuffix}`;
  }

  return `${params.sessionId}:${volatileSuffix}`;
}
