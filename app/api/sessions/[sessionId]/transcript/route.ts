import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType, TranscriptSource } from "@/app/generated/prisma/client";
import {
  applyFacilitatorMaterialInputChange,
  materialChangeGuardErrorBody,
} from "@/lib/ai/material-input-invalidation";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { ENHANCEMENT_RUNNING_MATERIAL_LOCK_MESSAGE } from "@/lib/transcription/processing-metadata";
import { isAuthoritativeEnhancementLockActive } from "@/lib/services/transcript-enhancement-timeout";

export const runtime = "nodejs";

const transcriptSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  text: z.string(),
  confirmRewindPublication: z.boolean().optional(),
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

  const parsed = transcriptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      deletedAt: null,
    },
    include: {
      recording: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const participant = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);
  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const existingTranscript = await prisma.transcript.findUnique({
    where: { sessionId },
    select: { id: true, processingMetadata: true },
  });
  if (
    existingTranscript &&
    (await isAuthoritativeEnhancementLockActive({
      transcriptId: existingTranscript.id,
    }))
  ) {
    return NextResponse.json(
      { error: ENHANCEMENT_RUNNING_MATERIAL_LOCK_MESSAGE },
      { status: 409 },
    );
  }

  const change = await applyFacilitatorMaterialInputChange({
    sessionId,
    confirmRewindPublication: parsed.data.confirmRewindPublication,
    mutate: (tx) =>
      tx.transcript.upsert({
        where: { sessionId },
        create: {
          sessionId,
          source: TranscriptSource.MANUAL,
          text: parsed.data.text,
          recordingId: session.recording?.id,
        },
        update: {
          source: TranscriptSource.MANUAL,
          text: parsed.data.text,
          recordingId: session.recording?.id,
        },
      }),
  });
  if (!change.ok) {
    return NextResponse.json(materialChangeGuardErrorBody(change), {
      status: change.status,
    });
  }

  const transcript = change.result;
  return NextResponse.json({
    transcript: {
      id: transcript.id,
      source: transcript.source,
      text: transcript.text,
      diarizedText: transcript.diarizedText,
      hasSpeakerDiarization: transcript.hasSpeakerDiarization,
      updatedAt: transcript.updatedAt.toISOString(),
    },
    publicationRevoked: change.publicationRevoked,
  });
}
