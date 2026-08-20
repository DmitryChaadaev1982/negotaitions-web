import { evaluateSpeakerMappingStructuralCompleteness } from "@/lib/transcription/speaker-mapping-completeness";

type TranscriptForMappingReadiness = {
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string | null;
  speakerMapping?: unknown;
  segments: Array<{
    speakerLabel: string | null;
    mappedParticipantId?: string | null;
    text?: string | null;
  }>;
  participants?: Array<{ id: string; type: string }>;
};

/**
 * Returns true when speaker-to-participant mapping is structurally complete
 * enough to run AI analysis. AUTO_SUGGESTED/CONFIRMED strings are not enough.
 */
export function isSpeakerMappingReadyForAnalysis(
  transcript: TranscriptForMappingReadiness,
): boolean {
  return evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: transcript.hasSpeakerDiarization,
    speakerMappingStatus: transcript.speakerMappingStatus,
    segments: transcript.segments,
    participants: transcript.participants ?? [],
  }).readyForAnalysis;
}

export function isAiAnalysisOutdated(
  transcriptRetranscribeCount: number | null | undefined,
  analysisRetranscribeCount: number | null | undefined,
): boolean {
  if (analysisRetranscribeCount == null) {
    return false;
  }
  const transcriptVersion = transcriptRetranscribeCount ?? 0;
  return analysisRetranscribeCount < transcriptVersion;
}

/** The persisted input identity required for a completed analysis to be current. */
export function isAiAnalysisCurrentForTranscript(input: {
  transcriptId: string | null | undefined;
  transcriptRetranscribeCount: number | null | undefined;
  analysisTranscriptId: string | null | undefined;
  analysisTranscriptRetranscribeCount: number | null | undefined;
}): boolean {
  return (
    Boolean(input.transcriptId) &&
    input.analysisTranscriptId === input.transcriptId &&
    (input.analysisTranscriptRetranscribeCount ?? 0) ===
      (input.transcriptRetranscribeCount ?? 0)
  );
}
