import { TranscriptStatus } from "@/app/generated/prisma/client";

export const TRANSCRIPTION_IN_PROGRESS_ERROR =
  "A transcription is already in progress.";
export const TRANSCRIPTION_ALREADY_COMPLETED_ERROR =
  "A completed transcript already exists for this session.";
export const TRANSCRIPTION_GENERATION_CONFLICT_ERROR =
  "A newer transcription generation is already current.";

export const TRANSCRIPTION_IN_PROGRESS_CODE = "TRANSCRIPTION_IN_PROGRESS";
export const TRANSCRIPTION_ALREADY_COMPLETED_CODE =
  "TRANSCRIPTION_ALREADY_COMPLETED";
export const TRANSCRIPTION_GENERATION_CONFLICT_CODE =
  "TRANSCRIPTION_GENERATION_CONFLICT";

export type TranscriptionGenerationRef = {
  transcriptId: string;
  startedAt: Date;
  retranscribeCount: number;
};

export type TranscriptionAdmitDecision =
  | { kind: "already_active"; transcriptId: string; status: TranscriptStatus }
  | { kind: "already_completed"; transcriptId: string; status: TranscriptStatus }
  | { kind: "admit" };

const ACTIVE_STATUSES = new Set<TranscriptStatus>([
  TranscriptStatus.QUEUED,
  TranscriptStatus.DOWNLOADING_RECORDING,
  TranscriptStatus.COMPRESSING_AUDIO,
  TranscriptStatus.TRANSCRIBING,
]);

export function isTranscriptionActiveStatus(
  status: TranscriptStatus | string | null | undefined,
): boolean {
  return ACTIVE_STATUSES.has(status as TranscriptStatus);
}

export function decideTranscriptionAdmit(input: {
  existing:
    | {
        id: string;
        status: TranscriptStatus;
        text: string | null;
      }
    | null;
  allowCompletedOverwrite: boolean;
}): TranscriptionAdmitDecision {
  if (!input.existing) {
    return { kind: "admit" };
  }

  if (isTranscriptionActiveStatus(input.existing.status)) {
    return {
      kind: "already_active",
      transcriptId: input.existing.id,
      status: input.existing.status,
    };
  }

  if (
    !input.allowCompletedOverwrite &&
    input.existing.status === TranscriptStatus.COMPLETED &&
    Boolean(input.existing.text?.trim())
  ) {
    return {
      kind: "already_completed",
      transcriptId: input.existing.id,
      status: input.existing.status,
    };
  }

  return { kind: "admit" };
}

export function isSameTranscriptionGeneration(
  row: {
    id: string;
    startedAt: Date | null;
    retranscribeCount: number;
  },
  generation: TranscriptionGenerationRef,
): boolean {
  return (
    row.id === generation.transcriptId &&
    row.startedAt != null &&
    row.startedAt.getTime() === generation.startedAt.getTime() &&
    row.retranscribeCount === generation.retranscribeCount
  );
}

export function isOwnedTranscriptionGeneration(
  row: {
    id: string;
    startedAt: Date | null;
    retranscribeCount: number;
    status: TranscriptStatus;
  },
  generation: TranscriptionGenerationRef,
): boolean {
  return (
    isSameTranscriptionGeneration(row, generation) &&
    isTranscriptionActiveStatus(row.status)
  );
}

export function shouldBindDownstreamToGeneration(input: {
  applied: boolean;
  generationMatches: boolean;
}): boolean {
  return input.applied && input.generationMatches;
}

export function transcriptionConflictBody(
  decision: Extract<
    TranscriptionAdmitDecision,
    { kind: "already_active" | "already_completed" }
  >,
): {
  error: string;
  code: string;
  transcriptId: string;
  status: TranscriptStatus;
} {
  if (decision.kind === "already_active") {
    return {
      error: TRANSCRIPTION_IN_PROGRESS_ERROR,
      code: TRANSCRIPTION_IN_PROGRESS_CODE,
      transcriptId: decision.transcriptId,
      status: decision.status,
    };
  }

  return {
    error: TRANSCRIPTION_ALREADY_COMPLETED_ERROR,
    code: TRANSCRIPTION_ALREADY_COMPLETED_CODE,
    transcriptId: decision.transcriptId,
    status: decision.status,
  };
}
