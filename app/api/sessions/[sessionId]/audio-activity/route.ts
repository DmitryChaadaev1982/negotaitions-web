import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1, "Join token is required"),
  event: z.enum(["SPEAKING_START", "SPEAKING_END"]),
  participantIdentity: z.string().trim().min(1).optional(),
  clientTimestamp: z.string().optional(),
  offsetSeconds: z.number().optional(),
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

  const { joinToken, event, participantIdentity, clientTimestamp, offsetSeconds } = parsed.data;

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const now = new Date();
  const eventTime = clientTimestamp ? new Date(clientTimestamp) : now;

  if (event === "SPEAKING_START") {
    await prisma.sessionParticipantAudioActivity.create({
      data: {
        sessionId,
        sessionParticipantId: participant.id,
        participantIdentity: participantIdentity ?? null,
        startedAt: eventTime,
        startedOffsetSeconds: offsetSeconds ?? null,
        source: "LIVEKIT_ACTIVE_SPEAKER",
      },
    });

    return NextResponse.json({ ok: true, event: "SPEAKING_START" });
  }

  if (event === "SPEAKING_END") {
    // Find the most recent open activity for this participant
    const openActivity = await prisma.sessionParticipantAudioActivity.findFirst({
      where: {
        sessionId,
        sessionParticipantId: participant.id,
        endedAt: null,
      },
      orderBy: { startedAt: "desc" },
    });

    if (openActivity) {
      await prisma.sessionParticipantAudioActivity.update({
        where: { id: openActivity.id },
        data: {
          endedAt: eventTime,
          endedOffsetSeconds: offsetSeconds ?? null,
        },
      });
    }

    return NextResponse.json({ ok: true, event: "SPEAKING_END" });
  }

  return NextResponse.json({ error: "Unknown event." }, { status: 400 });
}
