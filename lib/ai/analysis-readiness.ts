import { TranscriptStatus } from "@/app/generated/prisma/client";
import { isEnhancementStatusRunning } from "@/lib/post-processing/projection";
import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";

export type TranscriptForAiAnalysisReadiness = {
  status: TranscriptStatus | null;
  text: string | null;
  diarizedText?: string | null;
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string | null;
  speakerMapping: unknown;
  enhancementStatus?: string | null;
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
 * authoritative analyze endpoint. Enhancement RUNNING blocks only while the
 * authoritative run is still inside the configured timeout window; other
 * enhancement states remain optional once the raw transcript is usable and
 * mapping is structurally complete.
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
  if (isEnhancementStatusRunning(transcript.enhancementStatus)) {
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
