import { TranscriptSource } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/prisma";
import { OLD_TRANSCRIBE_ROUTE_MODE } from "@/lib/transcription/transcription-routes";
import { resolveSpeakerMappingForUi } from "@/lib/transcription/speaker-mapping-state";

export const COMPATIBILITY_TRANSCRIBE_ROUTE_MODE = OLD_TRANSCRIBE_ROUTE_MODE;

export function serializeCompatibilityTranscript(transcript: {
  id: string;
  source: TranscriptSource;
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  speakerMappingStatus: string | null;
  speakerMapping: unknown;
  updatedAt: Date;
  segments: Array<{
    id: string;
    speakerLabel: string | null;
    mappedParticipantId: string | null;
    startSeconds: number | null;
    endSeconds: number | null;
    text: string;
    orderIndex: number;
  }>;
}) {
  return {
    id: transcript.id,
    source: transcript.source,
    text: transcript.text,
    diarizedText: transcript.diarizedText,
    language: transcript.language,
    transcriptionModel: transcript.transcriptionModel,
    hasSpeakerDiarization: transcript.hasSpeakerDiarization,
    speakerMappingStatus: transcript.speakerMappingStatus ?? "NOT_REQUIRED",
    speakerMapping: resolveSpeakerMappingForUi({
      speakerMapping: transcript.speakerMapping,
      speakerMappingStatus: transcript.speakerMappingStatus,
      processingMetadata: null,
    }),
    updatedAt: transcript.updatedAt.toISOString(),
    segments: transcript.segments
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map((segment) => ({
        id: segment.id,
        speakerLabel: segment.speakerLabel,
        mappedParticipantId: segment.mappedParticipantId,
        startSeconds: segment.startSeconds,
        endSeconds: segment.endSeconds,
        text: segment.text,
        orderIndex: segment.orderIndex,
      })),
  };
}

export async function loadCompatibilityTranscript(transcriptId: string) {
  return prisma.transcript.findUnique({
    where: { id: transcriptId },
    include: {
      segments: {
        orderBy: { orderIndex: "asc" },
      },
    },
  });
}

export function buildCompatibilitySuccessBody(input: {
  transcript: Parameters<typeof serializeCompatibilityTranscript>[0];
  compressedSizeBytes: number | null;
  compressionStatus: string | null;
}) {
  return {
    transcript: serializeCompatibilityTranscript(input.transcript),
    warnings: [] as string[],
    recording: {
      compressedSizeBytes: input.compressedSizeBytes ?? 1024,
      compressionStatus: input.compressionStatus ?? "SKIPPED",
    },
  };
}
