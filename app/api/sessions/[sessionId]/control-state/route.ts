import { NextResponse } from "next/server";

import {
  buildControlState,
  shouldAutoFinish,
  getControlUpdateData,
} from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const joinToken = new URL(request.url).searchParams.get("joinToken")?.trim();

  if (!joinToken) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 400 });
  }

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);

  if (!participant) {
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
  }

  const now = new Date();
  let session = participant.session;

  if (shouldAutoFinish(session, now)) {
    const updateData = getControlUpdateData(session, "FINISH", now);
    session = await prisma.session.update({
      where: { id: sessionId },
      data: updateData,
      select: {
        id: true,
        negotiationState: true,
        durationSeconds: true,
        negotiationStartedAt: true,
        negotiationEndedAt: true,
        timerStartedAt: true,
        pausedAt: true,
        totalPausedSeconds: true,
      },
    });
  }

  return NextResponse.json(
    buildControlState(session, participant.type, now),
  );
}
