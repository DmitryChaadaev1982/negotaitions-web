type SpeakerMappingDraftSyncParams = {
  currentTranscriptId: string | null;
  nextTranscriptId: string | null;
  isDirty: boolean;
  force?: boolean;
};

/**
 * Protects in-progress local speaker-mapping edits from background refreshes.
 * Always resync on transcript identity change or an explicit force (e.g. save success).
 */
export function shouldSyncSpeakerMappingDraft(params: SpeakerMappingDraftSyncParams): boolean {
  if (params.force) {
    return true;
  }

  if (params.currentTranscriptId !== params.nextTranscriptId) {
    return true;
  }

  return !params.isDirty;
}
