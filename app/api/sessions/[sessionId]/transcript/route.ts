import { NextResponse } from "next/server";
import { z } from "zod";

import { TranscriptSource } from "@/app/generated/prisma/client";
import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const transcriptSchema = z.object({
  joinToken: z.string().trim().optional(),
  text: z.string(),
});

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const facilitator = await getDemoFacilitator();

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
      facilitatorId: facilitator.id,
    },
    include: {
      recording: true,
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  if (session.deletedAt) {
    return NextResponse.json({ error: "Session is read-only." }, { status: 403 });
  }

  const transcript = await prisma.transcript.upsert({
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
  });

  return NextResponse.json({
    transcript: {
      id: transcript.id,
      source: transcript.source,
      text: transcript.text,
      diarizedText: transcript.diarizedText,
      hasSpeakerDiarization: transcript.hasSpeakerDiarization,
      updatedAt: transcript.updatedAt.toISOString(),
    },
  });
}
