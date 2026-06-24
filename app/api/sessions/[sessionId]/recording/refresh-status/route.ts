import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { refreshRecordingStatus } from "@/lib/livekit-egress";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
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

  const participant = await getSessionParticipantByJoinToken(
    parsed.data.joinToken,
    sessionId,
  );

  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
  });

  if (!recording) {
    return NextResponse.json({ error: "No recording available yet." }, { status: 404 });
  }

  const updated = await refreshRecordingStatus(recording);

  return NextResponse.json({
    recording: {
      id: updated.id,
      status: updated.status,
      fileKey: updated.fileKey,
      fileName: updated.fileName,
      originalSizeBytes: updated.originalSizeBytes,
      startedAt: updated.startedAt?.toISOString() ?? null,
      endedAt: updated.endedAt?.toISOString() ?? null,
      errorMessage: updated.errorMessage,
    },
  });
}
