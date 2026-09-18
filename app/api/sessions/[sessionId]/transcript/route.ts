import { NextResponse } from "next/server";
import { z } from "zod";

import { TranscriptSource } from "@/app/generated/prisma/client";
import {
  applyFacilitatorMaterialInputChange,
  materialChangeGuardErrorBody,
} from "@/lib/ai/material-input-invalidation";
import { prisma } from "@/lib/prisma";
import {
  authorizeSessionManagementAccess,
  sessionAuthTokensFrom,
} from "@/lib/session-management-auth";

export const runtime = "nodejs";

const transcriptSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  text: z.string(),
  confirmRewindPublication: z.boolean().optional(),
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

  const authorization = await authorizeSessionManagementAccess(
    sessionId,
    sessionAuthTokensFrom(parsed.data),
  );
  if (!authorization.ok) {
    return authorization.response;
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
