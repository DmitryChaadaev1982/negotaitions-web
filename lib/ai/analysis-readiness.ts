import { TranscriptStatus } from "@/app/generated/prisma/client";
import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";

export type TranscriptForAiAnalysisReadiness = {
  status: TranscriptStatus | null;
  text: string | null;
  diarizedText?: string | null;
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string | null;
  speakerMapping: unknown;
  enhancementStatus?: string | null;
  enhancementPublicationEligible?: boolean | null;
  participants?: Array<{ id: string; type: string }>;
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
  | "SPEAKER_MAPPING_REQUIRED"
  | "ENHANCEMENT_RUNNING";

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
 * authoritative analyze endpoint. AI is blocked only while enhancement
 * publicationEligible is true. RUNNING leftover diagnostics after eligibility
 * is revoked do not block AI.
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
    participants: transcript.participants ?? [],
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
  const publicationEligible =
    transcript.enhancementPublicationEligible === true ||
    (transcript.enhancementPublicationEligible == null &&
      (transcript.enhancementStatus === "IN_PROGRESS" ||
        transcript.enhancementStatus === "RUNNING" ||
        transcript.enhancementStatus === "QUEUED"));
  if (publicationEligible) {
    return {
      ready: false,
      reason: "ENHANCEMENT_RUNNING",
      hasUsableContent: true,
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
