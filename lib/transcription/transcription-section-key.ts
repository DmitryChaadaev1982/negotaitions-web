type TranscriptionSectionRefreshKeyParams = {
  sessionId: string;
  transcriptId?: string | null;
  recordingId?: string | null;
  retranscribeCount?: number | null;
  // Legacy volatile status fields are accepted for call-site compatibility
  // and must not participate in React identity.
  processingStage?: string | null;
  diarizationStatus?: string | null;
  speakerMappingRequired?: boolean;
  enhancementStatus?: string | null;
};

function generationSuffix(retranscribeCount?: number | null): string {
  return Number.isInteger(retranscribeCount) ? `:g${retranscribeCount}` : "";
}

/**
 * Stable identity for RecordingTranscriptionSection.
 * Conceptually recordingId:transcriptId:retranscribeCount for the current
 * generation. Volatile processing/enhancement/mapping flags must not remount
 * the tree.
 */
export function getTranscriptionSectionRefreshKey(
  params: TranscriptionSectionRefreshKeyParams,
): string {
  const generation = generationSuffix(params.retranscribeCount);
  if (params.transcriptId && params.recordingId) {
    return `${params.recordingId}:${params.transcriptId}${generation}`;
  }

  if (params.transcriptId) {
    return `${params.transcriptId}${generation}`;
  }

  if (params.recordingId) {
    return `${params.sessionId}:${params.recordingId}${generation}`;
  }

  return `${params.sessionId}${generation}`;
}
