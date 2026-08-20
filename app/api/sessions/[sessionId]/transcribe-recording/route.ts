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
import {
  buildFailedRetranscriptionRestoreData,
  shouldRestoreArchivedTranscript,
} from "@/lib/services/retranscription-safety";
import {
  buildCompatibilitySuccessBody,
  loadCompatibilityTranscript,
} from "@/lib/services/transcribe-recording-compatibility";
import { transcriptionConflictBody } from "@/lib/services/transcription-ownership";
import { admitTranscriptionRun } from "@/lib/services/transcription-run-claim";
import { applyOwnedFailedRetranscriptionRestore } from "@/lib/services/transcription-generation-cas";
import { executeClaimedTranscription } from "@/lib/services/transcription-runner";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { isTranscriptionMockMode } from "@/lib/test-mode";

export const runtime = "nodejs";

const transcribeSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  recordingId: z.string().trim().min(1, "Recording id is required"),
  languageHint: z.enum(["ru", "en", "auto"]).default("auto"),
}).refine((data) => Boolean(data.joinToken || data.participantId), {
  message: "joinToken or participantId is required",
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = transcribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { recordingId, languageHint } = parsed.data;

  const participant = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);
  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const sessionRecord = await prisma.session.findFirst({
    where: { id: sessionId },
    select: { deletedAt: true },
  });

  if (sessionRecord?.deletedAt) {
    return NextResponse.json({ error: "Session is read-only." }, { status: 403 });
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

  const recording = await prisma.recording.findFirst({
    where: { id: recordingId, sessionId },
  });

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
    language: languageHint,
    mode: "compatibility",
  });

  if (claim.kind === "session_not_found") {
    return NextResponse.json({ error: "Session not found or deleted." }, { status: 404 });
  }
  if (claim.kind === "already_active" || claim.kind === "already_completed") {
    return NextResponse.json(transcriptionConflictBody(claim), { status: 409 });
  }

  const { transcript, generation, archiveEntry } = claim;
  const result = await executeClaimedTranscription({
    sessionId,
    recording,
    transcriptId: transcript.id,
    language: languageHint,
    generation,
  });

  if (
    archiveEntry &&
    shouldRestoreArchivedTranscript({
      runFailed: !result.ok,
      archiveStatus: archiveEntry.status,
      archiveText: archiveEntry.text,
    })
  ) {
    try {
      await prisma.$transaction(async (tx) => {
        await applyOwnedFailedRetranscriptionRestore({
          tx,
          generation,
          data: buildFailedRetranscriptionRestoreData({
            archiveEntry: {
              status: archiveEntry.status,
              text: archiveEntry.text ?? transcript.text,
              diarizedText: archiveEntry.diarizedText,
              language: archiveEntry.language,
              transcriptionModel: archiveEntry.transcriptionModel,
              hasSpeakerDiarization: archiveEntry.hasSpeakerDiarization,
              diarizationStatus: archiveEntry.diarizationStatus,
              speakerMapping: archiveEntry.speakerMapping,
              speakerMappingStatus: archiveEntry.speakerMappingStatus,
              completedAt: archiveEntry.completedAt
                ? new Date(archiveEntry.completedAt)
                : null,
              processingMetadata: archiveEntry.processingMetadata,
            },
          }),
        });
      });
    } catch {
      // Best-effort restore; do not shadow the original error.
    }
  }

  if (!result.ok) {
    return result;
  }

  const saved = await loadCompatibilityTranscript(transcript.id);
  if (!saved) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 500 });
  }

  const latestRecording = await prisma.recording.findUnique({
    where: { id: recording.id },
    select: { compressedSizeBytes: true, compressionStatus: true },
  });

  return NextResponse.json(
    buildCompatibilitySuccessBody({
      transcript: saved,
      compressedSizeBytes: latestRecording?.compressedSizeBytes ?? null,
      compressionStatus: latestRecording?.compressionStatus ?? null,
    }),
  );
}
