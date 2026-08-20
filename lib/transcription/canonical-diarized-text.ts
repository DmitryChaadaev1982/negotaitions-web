import {
  buildDiarizedText,
  type NormalizedSegment,
  type ParticipantDisplayInfo,
  type SpeakerMapping,
} from "@/lib/transcription/speaker-labels";

/**
 * Canonical persisted diarizedText projection:
 * current lexical segment.text + current speaker identity/mapping.
 * Enhancement must pass enhanced lexical text with the existing mapping.
 * Mapping writers must pass current lexical text with the new mapping.
 */
export function buildCanonicalDiarizedText(params: {
  segments: NormalizedSegment[];
  speakerMapping?: SpeakerMapping | null;
  participants?: ParticipantDisplayInfo[];
}): string {
  return buildDiarizedText(
    params.segments,
    params.speakerMapping,
    params.participants,
  );
}

export function toParticipantDisplayInfo(participant: {
  id: string;
  displayName: string;
  type: string;
  sessionRole?: { name: string } | null;
  roleName?: string | null;
}): ParticipantDisplayInfo {
  return {
    id: participant.id,
    displayName: participant.displayName,
    type: participant.type,
    roleName: participant.roleName ?? participant.sessionRole?.name ?? null,
  };
}
