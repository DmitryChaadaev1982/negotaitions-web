import { NextResponse } from "next/server";

import { ParticipantType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: { joinToken?: string };
  try {
    body = (await request.json()) as { joinToken?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { joinToken } = body;

  if (!joinToken) {
    return NextResponse.json({ error: "joinToken is required." }, { status: 400 });
  }

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (participant.type !== ParticipantType.FACILITATOR) {
    return NextResponse.json(
      { error: "Only facilitators can change AI analysis visibility." },
      { status: 403 },
    );
  }

  const aiAnalysis = await prisma.aiAnalysis.findUnique({
    where: { sessionId },
    select: { id: true, visibility: true },
  });

  if (!aiAnalysis) {
    return NextResponse.json({ error: "AI analysis not found." }, { status: 404 });
  }

  const updated = await prisma.aiAnalysis.update({
    where: { id: aiAnalysis.id },
    data: {
      visibility: "FACILITATOR_ONLY",
      unsharedAt: new Date(),
    },
    select: {
      id: true,
      visibility: true,
      unsharedAt: true,
    },
  });

  return NextResponse.json({
    success: true,
    visibility: updated.visibility,
    unsharedAt: updated.unsharedAt?.toISOString() ?? null,
  });
}
