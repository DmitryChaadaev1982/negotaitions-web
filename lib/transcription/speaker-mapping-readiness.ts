import type { SpeakerMapping } from "@/lib/transcription/speaker-labels";

type TranscriptForMappingReadiness = {
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string | null;
  speakerMapping: unknown;
  segments: Array<{
    speakerLabel: string | null;
    mappedParticipantId?: string | null;
    text?: string;
  }>;
};

/**
 * Returns true when speaker-to-participant mapping is complete enough to run AI analysis.
 * Accepts CONFIRMED status, or a fully assigned cluster/segment mapping (AUTO_SUGGESTED).
 */
export function isSpeakerMappingReadyForAnalysis(
  transcript: TranscriptForMappingReadiness,
): boolean {
  // Explicit operator-review states are authoritative even if legacy metadata
  // has an inconsistent diarization flag.
  if (
    transcript.speakerMappingStatus === "REQUIRED" ||
    transcript.speakerMappingStatus === "NEEDS_REVIEW"
  ) {
    return false;
  }

  if (!transcript.hasSpeakerDiarization) {
    return true;
  }

  if (transcript.speakerMappingStatus === "CONFIRMED") {
    return true;
  }
  if (transcript.speakerMappingStatus === "AUTO_SUGGESTED") {
    return true;
  }

  const uniqueLabels = [
    ...new Set(
      transcript.segments
        .map((segment) => segment.speakerLabel)
        .filter((label): label is string => Boolean(label)),
    ),
  ];

  const mapping = (transcript.speakerMapping as SpeakerMapping | null) ?? {};

  if (
    uniqueLabels.length > 0 &&
    transcript.speakerMappingStatus === "AUTO_SUGGESTED"
  ) {
    const clusterMappingComplete = uniqueLabels.every((label) =>
      Boolean(mapping[label]),
    );
    if (clusterMappingComplete) {
      return true;
    }
  }

  const spokenSegments = transcript.segments.filter((segment) =>
    segment.text?.trim(),
  );
  if (spokenSegments.length === 0) {
    return true;
  }

  return spokenSegments.every((segment) => Boolean(segment.mappedParticipantId));
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
