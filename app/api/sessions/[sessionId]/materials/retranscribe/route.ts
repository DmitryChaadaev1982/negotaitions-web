import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ParticipantType,
  RecordingStatus,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getSelectedTranscriptionProvider,
  isTranscriptionConfiguredForSelectedProvider,
} from "@/lib/services/transcription-provider";
import { executeClaimedTranscription } from "@/lib/services/transcription-runner";
import {
  buildFailedRetranscriptionRestoreData,
  shouldRestoreArchivedTranscript,
} from "@/lib/services/retranscription-safety";
import { transcriptionConflictBody } from "@/lib/services/transcription-ownership";
import { admitTranscriptionRun } from "@/lib/services/transcription-run-claim";
import { applyOwnedFailedRetranscriptionRestore } from "@/lib/services/transcription-generation-cas";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { isTranscriptionMockMode } from "@/lib/test-mode";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  language: z.enum(["ru", "en", "auto"]).optional().default("auto"),
  reason: z.string().optional(),
}).refine((data) => Boolean(data.joinToken || data.participantId), {
  message: "joinToken or participantId is required",
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

/**
 * POST /api/sessions/[sessionId]/materials/retranscribe
 *
 * Forces a new transcription attempt even if a completed transcript exists.
 * Archives the current transcript content to retranscribeHistory before starting.
 * If the new attempt fails, the old content is restored from the archive.
 * Facilitator/host/admin only.
 */
export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { language, reason } = parsed.data;

  const participant = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);
  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found or deleted." }, { status: 404 });
  }

  if (
    !isTranscriptionMockMode() &&
    !isTranscriptionConfiguredForSelectedProvider()
  ) {
    const provider = getSelectedTranscriptionProvider();
    return NextResponse.json(
      {
        error:
          provider === "yandex_speechkit"
            ? "Yandex SpeechKit configuration is missing."
            : "OpenAI API key is missing.",
      },
      { status: 503 },
    );
  }

  const recording = await prisma.recording.findUnique({ where: { sessionId } });

  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  if (
    (recording.status !== RecordingStatus.COMPLETED &&
      recording.status !== RecordingStatus.STOPPED) ||
    !recording.fileKey
  ) {
    return NextResponse.json(
      { error: "No recording file available yet." },
      { status: 400 },
    );
  }

  const claim = await admitTranscriptionRun({
    sessionId,
    recordingId: recording.id,
    language,
    mode: "retranscribe",
    reason,
  });

  if (claim.kind === "session_not_found") {
    return NextResponse.json({ error: "Session not found or deleted." }, { status: 404 });
  }
  if (claim.kind === "already_active" || claim.kind === "already_completed") {
    return NextResponse.json(transcriptionConflictBody(claim), { status: 409 });
  }

  const { transcript, archiveEntry, generation } = claim;
  const result = await executeClaimedTranscription({
    sessionId,
    recording,
    transcriptId: transcript.id,
    language,
    generation,
  });

  // If the new transcription failed and we had a previous completed transcript,
  // restore its text content so the old transcript is not lost.
  const restoreEntry = archiveEntry;
  if (
    restoreEntry &&
    shouldRestoreArchivedTranscript({
      runFailed: !result.ok,
      archiveStatus: restoreEntry.status,
      archiveText: restoreEntry.text,
    })
  ) {
    try {
      await prisma.$transaction(async (tx) => {
        await applyOwnedFailedRetranscriptionRestore({
          tx,
          generation,
          data: buildFailedRetranscriptionRestoreData({
            archiveEntry: {
              status: restoreEntry.status,
              text: restoreEntry.text ?? transcript.text,
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

  return result;
}
