import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  buildFailedRetranscriptionRestoreData,
  shouldRestoreArchivedTranscript,
} from "@/lib/services/retranscription-safety";
import {
  isUnsafeRecordingFileKeyError,
  mapStorageReadToSourceUnavailable,
  sourceRecordingNotAvailableBody,
} from "@/lib/services/source-recording-not-available";
import {
  preloadRecordingSource,
  type PreloadedRecordingSource,
} from "@/lib/services/source-recording-preload";
import { applyOwnedFailedRetranscriptionRestore } from "@/lib/services/transcription-generation-cas";
import { transcriptionConflictBody } from "@/lib/services/transcription-ownership";
import {
  admitTranscriptionRun,
  type RetranscribeArchiveEntry,
} from "@/lib/services/transcription-run-claim";
import {
  getMockExternalServiceError,
  isTranscriptionMockMode,
} from "@/lib/test-mode";

type ExecuteClaimedTranscription = typeof import("@/lib/services/transcription-runner").executeClaimedTranscription;

export type RetranscribeRecordingInput = {
  id: string;
  recordingAttemptId: string | null;
  fileKey: string;
  fileName: string | null;
  mimeType: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
};

export type RetranscribeSessionDeps = {
  isMockMode?: () => boolean;
  getMockError?: () => string | null;
  preload?: typeof preloadRecordingSource;
  admit?: typeof admitTranscriptionRun;
  execute?: ExecuteClaimedTranscription;
  restoreFailedRetranscription?: typeof restoreFailedRetranscriptionIfNeeded;
};

export async function restoreFailedRetranscriptionIfNeeded(input: {
  result: NextResponse;
  archiveEntry: RetranscribeArchiveEntry | null;
  generation: {
    transcriptId: string;
    startedAt: Date;
    retranscribeCount: number;
  };
  fallbackText: string;
}): Promise<void> {
  const restoreEntry = input.archiveEntry;
  if (
    !restoreEntry ||
    !shouldRestoreArchivedTranscript({
      runFailed: !input.result.ok,
      archiveStatus: restoreEntry.status,
      archiveText: restoreEntry.text,
    })
  ) {
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await applyOwnedFailedRetranscriptionRestore({
        tx,
        generation: input.generation,
        data: buildFailedRetranscriptionRestoreData({
          archiveEntry: {
            status: restoreEntry.status,
            text: restoreEntry.text ?? input.fallbackText,
            diarizedText: restoreEntry.diarizedText,
            language: restoreEntry.language,
            transcriptionModel: restoreEntry.transcriptionModel,
            hasSpeakerDiarization: restoreEntry.hasSpeakerDiarization,
            diarizationStatus: restoreEntry.diarizationStatus,
            speakerMapping: restoreEntry.speakerMapping,
            speakerMappingStatus: restoreEntry.speakerMappingStatus,
            completedAt: restoreEntry.completedAt
              ? new Date(restoreEntry.completedAt)
              : null,
            processingMetadata: restoreEntry.processingMetadata,
          },
        }),
      });
    });
  } catch {
    // Best-effort restore; do not shadow the original error
  }
}

/**
 * Retranscribe after auth/load/validate.
 * Source bytes are acquired before admitTranscriptionRun so a missing
 * object cannot increment counters, revoke publication, or rewrite history.
 */
export async function executeAuthorizedRetranscribe(input: {
  sessionId: string;
  recording: RetranscribeRecordingInput;
  language: "ru" | "en" | "auto";
  reason?: string;
  deps?: RetranscribeSessionDeps;
}): Promise<NextResponse> {
  const isMockMode = input.deps?.isMockMode ?? isTranscriptionMockMode;
  const getMockError = input.deps?.getMockError ?? getMockExternalServiceError;
  const preload = input.deps?.preload ?? preloadRecordingSource;
  const admit = input.deps?.admit ?? admitTranscriptionRun;
  const execute =
    input.deps?.execute ??
    (await import("@/lib/services/transcription-runner")).executeClaimedTranscription;
  const restore =
    input.deps?.restoreFailedRetranscription ?? restoreFailedRetranscriptionIfNeeded;

  let preloaded: PreloadedRecordingSource | null = null;

  if (isMockMode()) {
    const mockError = getMockError();
    if (mockError === "SOURCE_RECORDING_NOT_AVAILABLE") {
      return NextResponse.json(sourceRecordingNotAvailableBody(), { status: 409 });
    }
  } else {
    try {
      preloaded = await preload({ fileKey: input.recording.fileKey });
    } catch (error) {
      const unavailable = mapStorageReadToSourceUnavailable(error);
      if (unavailable) {
        return NextResponse.json(sourceRecordingNotAvailableBody(), { status: 409 });
      }
      if (isUnsafeRecordingFileKeyError(error)) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      const message =
        error instanceof Error ? error.message : "Storage download failed.";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  const claim = await admit({
    sessionId: input.sessionId,
    recordingId: input.recording.id,
    language: input.language,
    mode: "retranscribe",
    reason: input.reason,
  });

  if (claim.kind === "session_not_found") {
    return NextResponse.json({ error: "Session not found or deleted." }, { status: 404 });
  }
  if (claim.kind === "already_active" || claim.kind === "already_completed") {
    return NextResponse.json(transcriptionConflictBody(claim), { status: 409 });
  }

  const result = await execute({
    sessionId: input.sessionId,
    recording: input.recording,
    transcriptId: claim.transcript.id,
    language: input.language,
    generation: claim.generation,
    preloadedRecordingSource: preloaded,
  });

  await restore({
    result,
    archiveEntry: claim.archiveEntry,
    generation: claim.generation,
    fallbackText: claim.transcript.text,
  });

  return result;
}
