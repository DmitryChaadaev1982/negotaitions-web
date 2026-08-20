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
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import { executeClaimedTranscription } from "@/lib/services/transcription-runner";
import { admitTranscriptionRun } from "@/lib/services/transcription-run-claim";
import {
  transcriptionConflictBody,
} from "@/lib/services/transcription-ownership";
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

  const claim = await admitTranscriptionRun({
    sessionId,
    recordingId: recording.id,
    language,
    mode: "initial",
  });

  if (claim.kind === "session_not_found") {
    return NextResponse.json({ error: "Session not found or deleted." }, { status: 404 });
  }
  if (claim.kind === "already_active" || claim.kind === "already_completed") {
    return NextResponse.json(transcriptionConflictBody(claim), { status: 409 });
  }

  return executeClaimedTranscription({
    sessionId,
    recording,
    transcriptId: claim.transcript.id,
    language,
    generation: claim.generation,
  });
}
