import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { continueWithCurrentTranscript } from "@/lib/services/transcript-enhancement-state";
import { projectTranscriptEnhancementStatus } from "@/lib/services/transcript-enhancement-job";

export const runtime = "nodejs";

const schema = z
  .object({
    joinToken: z.string().trim().min(1).optional(),
    participantId: z.string().trim().min(1).optional(),
  })
  .refine((data) => Boolean(data.joinToken || data.participantId), {
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const participant = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);
  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    select: { id: true, processingMetadata: true },
  });
  if (!transcript) {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }

  const result = await continueWithCurrentTranscript({
    db: prisma,
    transcriptId: transcript.id,
  });
  if (result.outcome === "not_found") {
    return NextResponse.json({ error: "Transcript not found." }, { status: 404 });
  }

  const latest = await prisma.transcript.findUnique({
    where: { id: transcript.id },
    select: { processingMetadata: true },
  });
  const projection = projectTranscriptEnhancementStatus(latest?.processingMetadata);

  return NextResponse.json({
    operation: "CONTINUE_WITH_CURRENT_TRANSCRIPT",
    outcome: result.outcome,
    executionStatus: projection.executionStatus,
    publicationEligible: projection.publicationEligible,
    terminalQuality: projection.terminalQuality,
    cancelReason: result.job?.cancelReason ?? projection.cancelReason,
  });
}
