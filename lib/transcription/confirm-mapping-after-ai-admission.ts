import { evaluateSpeakerMappingStructuralCompleteness } from "@/lib/transcription/speaker-mapping-completeness";

export function shouldConfirmAutoSuggestedMappingAfterAiAdmission(input: {
  speakerMappingStatus: string | null | undefined;
  hasSpeakerDiarization: boolean;
  segments: Array<{
    text?: string | null;
    speakerLabel?: string | null;
    mappedParticipantId?: string | null;
  }>;
  participants: Array<{ id: string; type: string }>;
}): boolean {
  if (input.speakerMappingStatus !== "AUTO_SUGGESTED") {
    return false;
  }

  return evaluateSpeakerMappingStructuralCompleteness({
    hasSpeakerDiarization: input.hasSpeakerDiarization,
    speakerMappingStatus: input.speakerMappingStatus,
    segments: input.segments,
    participants: input.participants,
  }).structurallyComplete;
}
