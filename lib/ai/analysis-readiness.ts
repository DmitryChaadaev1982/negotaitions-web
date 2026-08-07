import { TranscriptStatus } from "@/app/generated/prisma/client";
import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";

export type TranscriptForAiAnalysisReadiness = {
  status: TranscriptStatus | null;
  text: string | null;
  diarizedText?: string | null;
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string | null;
  speakerMapping: unknown;
  segments: Array<{
    speakerLabel: string | null;
    mappedParticipantId?: string | null;
    text?: string | null;
  }>;
};

export type AiAnalysisReadinessReason =
  | "READY"
  | "TRANSCRIPT_MISSING"
  | "TRANSCRIPT_NOT_COMPLETED"
  | "TRANSCRIPT_CONTENT_EMPTY"
  | "SPEAKER_MAPPING_REQUIRED";

export type AiAnalysisReadiness = {
  ready: boolean;
  reason: AiAnalysisReadinessReason;
  hasUsableContent: boolean;
  speakerMappingReady: boolean;
};

export function hasUsableTranscriptContent(
  transcript: Pick<
    TranscriptForAiAnalysisReadiness,
    "text" | "diarizedText" | "segments"
  >,
): boolean {
  return Boolean(
    transcript.text?.trim() ||
      transcript.diarizedText?.trim() ||
      transcript.segments.some((segment) => segment.text?.trim()),
  );
}

/**
 * Canonical server-side readiness contract used by the materials UI and the
 * authoritative analyze endpoint. Transcript enhancement status is
 * intentionally absent: enhancement is optional once the raw transcript is
 * complete, usable, and speaker mapping is ready.
 */
export function evaluateAiAnalysisReadiness(
  transcript: TranscriptForAiAnalysisReadiness | null,
): AiAnalysisReadiness {
  if (!transcript) {
    return {
      ready: false,
      reason: "TRANSCRIPT_MISSING",
      hasUsableContent: false,
      speakerMappingReady: false,
    };
  }

  const hasUsableContent = hasUsableTranscriptContent(transcript);
  const speakerMappingReady = isSpeakerMappingReadyForAnalysis({
    ...transcript,
    segments: transcript.segments.map((segment) => ({
      ...segment,
      text: segment.text ?? undefined,
    })),
  });

  if (transcript.status !== TranscriptStatus.COMPLETED) {
    return {
      ready: false,
      reason: "TRANSCRIPT_NOT_COMPLETED",
      hasUsableContent,
      speakerMappingReady,
    };
  }
  if (!hasUsableContent) {
    return {
      ready: false,
      reason: "TRANSCRIPT_CONTENT_EMPTY",
      hasUsableContent: false,
      speakerMappingReady,
    };
  }
  if (!speakerMappingReady) {
    return {
      ready: false,
      reason: "SPEAKER_MAPPING_REQUIRED",
      hasUsableContent: true,
      speakerMappingReady: false,
    };
  }

  return {
    ready: true,
    reason: "READY",
    hasUsableContent: true,
    speakerMappingReady: true,
  };
}
