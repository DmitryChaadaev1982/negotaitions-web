import { Prisma, TranscriptSource, TranscriptStatus } from "@/app/generated/prisma/client";

import { revokeActiveAiAnalysisPublicationInTransaction } from "@/lib/ai-publication-revoke";
import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";
import { prisma } from "@/lib/prisma";
import { buildRetranscriptionUpsertData } from "@/lib/services/retranscription-safety";
import {
  decideTranscriptionAdmit,
  isTranscriptionActiveStatus,
  type TranscriptionGenerationRef,
} from "@/lib/services/transcription-ownership";
import { mergeProcessingMetadata } from "@/lib/transcription/processing-metadata";

/**
 * Serializes transcription admission for one Session.
 *
 * The lock is held only while the caller checks the current Transcript and
 * writes its QUEUED claim. The provider call runs after the transaction
 * commits, so a competing request observes the active status and exits.
 */
export async function lockSessionTranscriptionClaim(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT s.id
    FROM "Session" s
    WHERE s.id = ${sessionId}
      AND s."deletedAt" IS NULL
    FOR UPDATE OF s
  `);

  return rows.length === 1;
}

export type TranscriptionAdmitMode = "initial" | "retranscribe" | "compatibility";

export type RetranscribeArchiveEntry = {
  archivedAt: string;
  reason: string | null;
  version: number;
  status: string | null;
  text: string | null;
  diarizedText: string | null;
  language: string | null;
  transcriptionModel: string | null;
  hasSpeakerDiarization: boolean;
  diarizationStatus: string | null;
  speakerMapping: unknown;
  speakerMappingStatus: string | null;
  completedAt: string | null;
  processingMetadata: unknown;
};

export type AdmitTranscriptionRunResult =
  | { kind: "session_not_found" }
  | {
      kind: "already_active";
      transcriptId: string;
      status: TranscriptStatus;
    }
  | {
      kind: "already_completed";
      transcriptId: string;
      status: TranscriptStatus;
    }
  | {
      kind: "claimed";
      transcript: {
        id: string;
        status: TranscriptStatus;
        text: string;
        startedAt: Date | null;
        retranscribeCount: number;
      };
      generation: TranscriptionGenerationRef;
      archiveEntry: RetranscribeArchiveEntry | null;
    };

type AdmitHold = () => Promise<void> | void;
let admitHoldForTests: AdmitHold | null = null;

function assertTranscriptionTestHooksAllowed(): void {
  if (parseServerRuntimeSetting("NODE_ENV") === "production") {
    throw new Error("Transcription test hooks are unavailable in production.");
  }
}

/** Test-only barrier after claim commit. Never call from production. */
export function setTranscriptionAdmitHoldForTests(hold: AdmitHold | null): void {
  assertTranscriptionTestHooksAllowed();
  admitHoldForTests = hold;
}

export function clearTranscriptionAdmitHoldForTests(): void {
  admitHoldForTests = null;
}

export async function awaitTranscriptionAdmitHoldForTests(): Promise<void> {
  if (admitHoldForTests) {
    await admitHoldForTests();
  }
}

export function shouldUseRetranscribeAdmission(input: {
  mode: TranscriptionAdmitMode;
  existing: { status: TranscriptStatus; text: string } | null;
}): boolean {
  if (input.mode === "retranscribe") {
    return true;
  }
  return (
    input.mode === "compatibility" &&
    input.existing?.status === TranscriptStatus.COMPLETED &&
    Boolean(input.existing.text.trim())
  );
}

export function resolveSharedTranscriptionAdmission(input: {
  mode: TranscriptionAdmitMode;
  existing: { id: string; status: TranscriptStatus; text: string } | null;
}): ReturnType<typeof decideTranscriptionAdmit> | { kind: "retranscribe" } {
  if (input.existing && isTranscriptionActiveStatus(input.existing.status)) {
    return {
      kind: "already_active",
      transcriptId: input.existing.id,
      status: input.existing.status,
    };
  }
  if (
    shouldUseRetranscribeAdmission({
      mode: input.mode,
      existing: input.existing,
    })
  ) {
    return { kind: "retranscribe" };
  }
  return decideTranscriptionAdmit({
    existing: input.existing,
    allowCompletedOverwrite: false,
  });
}

export async function admitTranscriptionRun(input: {
  sessionId: string;
  recordingId: string;
  language: "ru" | "en" | "auto";
  mode: TranscriptionAdmitMode;
  reason?: string;
}): Promise<AdmitTranscriptionRunResult> {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const sessionLocked = await lockSessionTranscriptionClaim(tx, input.sessionId);
    if (!sessionLocked) {
      return { kind: "session_not_found" } as const;
    }

    const existingTranscript = await tx.transcript.findUnique({
      where: { sessionId: input.sessionId },
      select: {
        id: true,
        status: true,
        text: true,
        diarizedText: true,
        language: true,
        transcriptionModel: true,
        hasSpeakerDiarization: true,
        diarizationStatus: true,
        speakerMapping: true,
        speakerMappingStatus: true,
        completedAt: true,
        processingMetadata: true,
        retranscribeCount: true,
        retranscribeHistory: true,
      },
    });

    const shared = resolveSharedTranscriptionAdmission({
      mode: input.mode,
      existing: existingTranscript
        ? {
            id: existingTranscript.id,
            status: existingTranscript.status,
            text: existingTranscript.text,
          }
        : null,
    });
    if (shared.kind === "already_active" || shared.kind === "already_completed") {
      return shared;
    }

    const useRetranscribe = shared.kind === "retranscribe";

    if (useRetranscribe) {
      const existingHistory = Array.isArray(existingTranscript?.retranscribeHistory)
        ? (existingTranscript.retranscribeHistory as RetranscribeArchiveEntry[])
        : [];
      const newVersion = (existingTranscript?.retranscribeCount ?? 0) + 1;
      const archiveEntry: RetranscribeArchiveEntry | null = existingTranscript
        ? {
            archivedAt: now.toISOString(),
            reason: input.reason ?? null,
            version: existingTranscript.retranscribeCount,
            status: existingTranscript.status,
            text: existingTranscript.text,
            diarizedText: existingTranscript.diarizedText,
            language: existingTranscript.language,
            transcriptionModel: existingTranscript.transcriptionModel,
            hasSpeakerDiarization: existingTranscript.hasSpeakerDiarization,
            diarizationStatus: existingTranscript.diarizationStatus,
            speakerMapping: existingTranscript.speakerMapping,
            speakerMappingStatus: existingTranscript.speakerMappingStatus,
            completedAt: existingTranscript.completedAt?.toISOString() ?? null,
            processingMetadata: existingTranscript.processingMetadata,
          }
        : null;
      const upsertData = buildRetranscriptionUpsertData({
        sessionId: input.sessionId,
        recordingId: input.recordingId,
        language: input.language,
        newVersion,
        history: (archiveEntry ? [...existingHistory, archiveEntry] : existingHistory) as object[],
        now,
        existingTranscript: existingTranscript
          ? {
              status: existingTranscript.status,
              text: existingTranscript.text,
              diarizedText: existingTranscript.diarizedText,
              language: existingTranscript.language,
              transcriptionModel: existingTranscript.transcriptionModel,
              hasSpeakerDiarization: existingTranscript.hasSpeakerDiarization,
              diarizationStatus: existingTranscript.diarizationStatus,
              speakerMapping: existingTranscript.speakerMapping,
              speakerMappingStatus: existingTranscript.speakerMappingStatus,
              completedAt: existingTranscript.completedAt,
              processingMetadata: existingTranscript.processingMetadata,
            }
          : null,
      });
      const transcript = await tx.transcript.upsert({
        where: { sessionId: input.sessionId },
        ...upsertData,
      });
      // Confirmed retranscription is one downstream invalidation boundary:
      // revoke any still-active publication now. Currentness follows the
      // new transcript generation without deleting the historical row.
      await revokeActiveAiAnalysisPublicationInTransaction(tx, input.sessionId);
      return {
        kind: "claimed" as const,
        transcript,
        generation: {
          transcriptId: transcript.id,
          startedAt: transcript.startedAt ?? now,
          retranscribeCount: transcript.retranscribeCount,
        },
        archiveEntry,
      };
    }

    const claimMetadata = mergeProcessingMetadata(
      existingTranscript?.processingMetadata,
      {
        transcriptionClaim: {
          source: input.mode,
          startedAt: now.toISOString(),
          retranscribeCount: existingTranscript?.retranscribeCount ?? 0,
        },
      },
    );

    const transcript = await tx.transcript.upsert({
      where: { sessionId: input.sessionId },
      create: {
        sessionId: input.sessionId,
        recordingId: input.recordingId,
        source: TranscriptSource.GENERATED,
        status: TranscriptStatus.QUEUED,
        text: existingTranscript?.text ?? "",
        language: input.language === "auto" ? null : input.language,
        startedAt: now,
        processingMetadata: claimMetadata as Prisma.InputJsonValue,
      },
      update: {
        recordingId: input.recordingId,
        source: TranscriptSource.GENERATED,
        status: TranscriptStatus.QUEUED,
        language: input.language === "auto" ? null : input.language,
        startedAt: now,
        completedAt: null,
        errorMessage: null,
        processingMetadata: claimMetadata as Prisma.InputJsonValue,
      },
    });

    return {
      kind: "claimed" as const,
      transcript,
      generation: {
        transcriptId: transcript.id,
        startedAt: transcript.startedAt ?? now,
        retranscribeCount: transcript.retranscribeCount,
      },
      archiveEntry: null,
    };
  });

  if (result.kind === "claimed") {
    await awaitTranscriptionAdmitHoldForTests();
  }

  return result;
}
