import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType, TranscriptStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  isTranscriptionActive,
  MANUAL_TRANSCRIPTION_STOP_SENTINEL,
} from "@/lib/services/transcription-runner";

export const runtime = "nodejs";

const stopSchema = z
  .object({
    joinToken: z.string().trim().min(1).optional(),
    participantId: z.string().trim().min(1).optional(),
  })
  .refine((data) => Boolean(data.joinToken || data.participantId), {
    message: "Authentication token is required.",
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

  const parsed = stopSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const participant = await resolveRoomParticipantFromBody(
    parsed.data as Record<string, unknown>,
    sessionId,
  );
  if (!participant) {
    return NextResponse.json({ error: "Invalid auth token." }, { status: 404 });
  }

  if (participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json(
      { error: "Only facilitators can stop transcription." },
      { status: 403 },
    );
  }

  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    select: { id: true, status: true },
  });

  if (!transcript) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }

  if (!isTranscriptionActive(transcript.status)) {
    return NextResponse.json(
      { error: "Transcription is not active.", status: transcript.status },
      { status: 409 },
    );
  }

  const stoppedAt = new Date();
  const message =
    "Transcription stopped manually. " + MANUAL_TRANSCRIPTION_STOP_SENTINEL;

  const updated = await prisma.transcript.update({
    where: { id: transcript.id },
    data: {
      status: TranscriptStatus.FAILED,
      errorMessage: message,
      completedAt: stoppedAt,
    },
    select: { id: true, status: true, completedAt: true },
  });

  return NextResponse.json({
    transcriptId: updated.id,
    status: updated.status,
    completedAt: updated.completedAt?.toISOString() ?? null,
    stopped: true,
  });
}
