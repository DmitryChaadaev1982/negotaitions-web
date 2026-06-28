import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ParticipantType,
  Prisma,
  RecordingStatus,
  TranscriptSource,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getSelectedTranscriptionProvider,
  isTranscriptionConfiguredForSelectedProvider,
} from "@/lib/services/transcription-provider";
import {
  isTranscriptionActive,
  runMockTranscription,
  runRealTranscription,
} from "@/lib/services/transcription-runner";
import { isTranscriptionMockMode } from "@/lib/test-mode";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";

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
    recording.status !== RecordingStatus.COMPLETED ||
    !recording.fileKey
  ) {
    return NextResponse.json(
      { error: "No recording file available yet." },
      { status: 400 },
    );
  }

  const existingTranscript = await prisma.transcript.findUnique({
    where: { sessionId },
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
      retranscribeCount: true,
      retranscribeHistory: true,
    },
  });

  if (existingTranscript && isTranscriptionActive(existingTranscript.status)) {
    return NextResponse.json(
      {
        error: "Transcription is already running.",
        transcriptId: existingTranscript.id,
        status: existingTranscript.status,
      },
      { status: 409 },
    );
  }

  const now = new Date();

  // Build archive entry from current transcript (if any)
  type HistoryEntry = {
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
  };

  const existingHistory = Array.isArray(existingTranscript?.retranscribeHistory)
    ? (existingTranscript.retranscribeHistory as HistoryEntry[])
    : [];

  const newVersion = (existingTranscript?.retranscribeCount ?? 0) + 1;

  const archiveEntry: HistoryEntry | null = existingTranscript
    ? {
        archivedAt: now.toISOString(),
        reason: reason ?? null,
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
      }
    : null;

  const updatedHistory = archiveEntry
    ? [...existingHistory, archiveEntry]
    : existingHistory;

  // Archive current segment data by deleting them — segments are re-created after transcription.
  // History only stores text-level data; segments from previous versions are not preserved.
  // Segment history could be added later if needed.

  const transcript = await prisma.transcript.upsert({
    where: { sessionId },
    create: {
      sessionId,
      recordingId: recording.id,
      source: TranscriptSource.GENERATED,
      status: TranscriptStatus.QUEUED,
      text: "",
      language: language === "auto" ? null : language,
      retranscribeCount: newVersion,
      retranscribeHistory: updatedHistory as object[],
      startedAt: now,
    },
    update: {
      recordingId: recording.id,
      source: TranscriptSource.GENERATED,
      status: TranscriptStatus.QUEUED,
      language: language === "auto" ? null : language,
      retranscribeCount: newVersion,
      retranscribeHistory: updatedHistory as object[],
      speakerMapping: Prisma.JsonNull,
      speakerMappingStatus: "NOT_REQUIRED",
      speakerMappingConfirmedAt: null,
      speakerMappingConfirmedBy: null,
      diarizationStatus: null,
      diarizationError: null,
      errorMessage: null,
      startedAt: now,
      completedAt: null,
    },
  });

  if (isTranscriptionMockMode()) {
    return await runMockTranscription(sessionId, recording, transcript.id, language);
  }

  if (!recording.fileKey) {
    return NextResponse.json({ error: "Recording file key is missing." }, { status: 400 });
  }

  const result = await runRealTranscription(
    sessionId,
    { ...recording, fileKey: recording.fileKey },
    transcript.id,
    language,
  );

  // If the new transcription failed and we had a previous completed transcript,
  // restore its text content so the old transcript is not lost.
  if (!result.ok && archiveEntry?.status === "COMPLETED" && archiveEntry.text) {
    try {
      await prisma.transcript.update({
        where: { id: transcript.id },
        data: {
          // Keep FAILED status and error, but restore text from previous completed version
          text: archiveEntry.text,
          diarizedText: archiveEntry.diarizedText,
          language: archiveEntry.language,
          transcriptionModel: archiveEntry.transcriptionModel,
          hasSpeakerDiarization: archiveEntry.hasSpeakerDiarization,
          diarizationStatus: archiveEntry.diarizationStatus,
          speakerMapping: (archiveEntry.speakerMapping as object) ?? Prisma.JsonNull,
          speakerMappingStatus: archiveEntry.speakerMappingStatus ?? "NOT_REQUIRED",
          completedAt: archiveEntry.completedAt ? new Date(archiveEntry.completedAt) : null,
        },
      });
    } catch {
      // Best-effort restore; do not shadow the original error
    }
  }

  return result;
}
