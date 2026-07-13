import { Prisma, TranscriptSource, TranscriptStatus } from "@/app/generated/prisma/client";

type ExistingTranscriptSnapshot = {
  status: string | null;
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  diarizationStatus: string | null;
  speakerMapping: unknown;
  speakerMappingStatus: string | null;
  completedAt: Date | null;
  processingMetadata: unknown;
};

export function buildRetranscriptionUpsertData(params: {
  sessionId: string;
  recordingId: string;
  language: "ru" | "en" | "auto";
  newVersion: number;
  history: object[];
  now: Date;
  existingTranscript: ExistingTranscriptSnapshot | null;
}) {
  const { sessionId, recordingId, language, newVersion, history, now, existingTranscript } =
    params;
  return {
    create: {
      sessionId,
      recordingId,
      source: TranscriptSource.GENERATED,
      status: TranscriptStatus.QUEUED,
      text: existingTranscript?.text ?? "",
      diarizedText: existingTranscript?.diarizedText ?? null,
      language: language === "auto" ? null : language,
      retranscribeCount: newVersion,
      retranscribeHistory: history,
      startedAt: now,
      processingMetadata:
        (existingTranscript?.processingMetadata as Prisma.InputJsonValue | undefined) ?? {},
    },
    update: {
      recordingId,
      source: TranscriptSource.GENERATED,
      status: TranscriptStatus.QUEUED,
      retranscribeCount: newVersion,
      retranscribeHistory: history,
      errorMessage: null,
      startedAt: now,
      completedAt: null,
    },
  };
}

export function shouldRestoreArchivedTranscript(params: {
  runFailed: boolean;
  archiveStatus: string | null | undefined;
  archiveText: string | null | undefined;
}): boolean {
  return Boolean(params.runFailed && params.archiveStatus === "COMPLETED" && params.archiveText);
}

export function buildFailedRetranscriptionRestoreData(params: {
  archiveEntry: ExistingTranscriptSnapshot;
}): {
  status: TranscriptStatus;
  text: string;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  diarizationStatus: string | null;
  speakerMapping: Prisma.InputJsonValue;
  speakerMappingStatus: string;
  completedAt: Date | null;
  processingMetadata: Prisma.InputJsonValue;
  errorMessage: null;
} {
  const { archiveEntry } = params;
  return {
    status: TranscriptStatus.COMPLETED,
    text: archiveEntry.text,
    diarizedText: archiveEntry.diarizedText,
    language: archiveEntry.language,
    transcriptionModel: archiveEntry.transcriptionModel,
    hasSpeakerDiarization: archiveEntry.hasSpeakerDiarization,
    diarizationStatus: archiveEntry.diarizationStatus,
    speakerMapping: (archiveEntry.speakerMapping as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    speakerMappingStatus: archiveEntry.speakerMappingStatus ?? "NOT_REQUIRED",
    completedAt: archiveEntry.completedAt,
    processingMetadata:
      (archiveEntry.processingMetadata as Prisma.InputJsonValue | undefined) ?? {},
    errorMessage: null,
  };
}
