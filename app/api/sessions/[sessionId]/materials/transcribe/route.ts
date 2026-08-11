import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ParticipantType,
  RecordingStatus,
  TranscriptSource,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getSelectedTranscriptionProvider,
  isTranscriptionConfiguredForSelectedProvider,
} from "@/lib/services/transcription-provider";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  isTranscriptionActive,
  runMockTranscription,
  runRealTranscription,
} from "@/lib/services/transcription-runner";
import { lockSessionTranscriptionClaim } from "@/lib/services/transcription-run-claim";
import { isTranscriptionMockMode } from "@/lib/test-mode";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  language: z.enum(["ru", "en", "auto"]).optional().default("auto"),
}).refine((data) => Boolean(data.joinToken || data.participantId), {
  message: "Authentication token is required",
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { language } = parsed.data;

  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );
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

  const now = new Date();
  const claim = await prisma.$transaction(async (tx) => {
    const sessionLocked = await lockSessionTranscriptionClaim(tx, sessionId);
    if (!sessionLocked) {
      return { kind: "session_not_found" } as const;
    }

    const existingTranscript = await tx.transcript.findUnique({
      where: { sessionId },
      select: { id: true, status: true, text: true },
    });

    if (existingTranscript && isTranscriptionActive(existingTranscript.status)) {
      return { kind: "already_active", transcript: existingTranscript } as const;
    }

    // A completed transcript must go through the explicit retranscription path.
    if (
      existingTranscript?.status === TranscriptStatus.COMPLETED &&
      existingTranscript.text.trim()
    ) {
      return { kind: "already_completed", transcript: existingTranscript } as const;
    }

    const transcript = await tx.transcript.upsert({
      where: { sessionId },
      create: {
        sessionId,
        recordingId: recording.id,
        source: TranscriptSource.GENERATED,
        status: TranscriptStatus.QUEUED,
        text: existingTranscript?.text ?? "",
        language: language === "auto" ? null : language,
        startedAt: now,
        processingMetadata: {},
      },
      update: {
        recordingId: recording.id,
        source: TranscriptSource.GENERATED,
        status: TranscriptStatus.QUEUED,
        language: language === "auto" ? null : language,
        startedAt: now,
        completedAt: null,
        errorMessage: null,
        processingMetadata: {},
      },
    });

    return { kind: "claimed", transcript } as const;
  });

  if (claim.kind === "session_not_found") {
    return NextResponse.json({ error: "Session not found or deleted." }, { status: 404 });
  }
  if (claim.kind === "already_active") {
    return NextResponse.json(
      {
        error: "A transcription is already in progress.",
        transcriptId: claim.transcript.id,
        status: claim.transcript.status,
      },
      { status: 409 },
    );
  }
  if (claim.kind === "already_completed") {
    return NextResponse.json(
      {
        error: "A completed transcript already exists for this session.",
        transcriptId: claim.transcript.id,
        status: claim.transcript.status,
      },
      { status: 409 },
    );
  }

  const { transcript } = claim;
  if (isTranscriptionMockMode()) {
    return await runMockTranscription(sessionId, recording, transcript.id, language);
  }

  if (!recording.fileKey) {
    return NextResponse.json({ error: "Recording file key is missing." }, { status: 400 });
  }

  return await runRealTranscription(
    sessionId,
    { ...recording, fileKey: recording.fileKey },
    transcript.id,
    language,
  );
}
