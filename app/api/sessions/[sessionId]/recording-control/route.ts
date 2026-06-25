import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  refreshRecordingStatus,
  startAudioOnlyRoomRecording,
  stopRecording,
} from "@/lib/livekit-egress";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";

export const runtime = "nodejs";

const actionSchema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  action: z.enum(["start", "stop", "refresh"]),
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

  const parsed = actionSchema.safeParse(body);
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

  if (!participant || participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, livekitRoomName: true, deletedAt: true },
  });

  if (!session || session.deletedAt) {
    return NextResponse.json({ error: "Session is read-only." }, { status: 403 });
  }

  if (parsed.data.action === "start") {
    const result = await startAudioOnlyRoomRecording(session);
    return NextResponse.json({
      ok: result.ok,
      warning: result.ok ? undefined : result.warning,
      recording: result.recording,
    });
  }

  const recording = await prisma.recording.findUnique({ where: { sessionId } });
  if (!recording) {
    return NextResponse.json({ error: "No recording available yet." }, { status: 404 });
  }

  if (parsed.data.action === "stop") {
    const result = await stopRecording(recording);
    return NextResponse.json({
      ok: result.ok,
      warning: result.ok ? undefined : result.warning,
      recording: result.recording,
    });
  }

  const updated = await refreshRecordingStatus(recording);
  return NextResponse.json({ recording: updated });
}
