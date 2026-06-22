import { NextResponse } from "next/server";

import { ParticipantType } from "@/app/generated/prisma/client";
import { handleNegotiationFinishRecording } from "@/lib/livekit-egress";
import {
  buildControlState,
  getControlUpdateData,
  shouldAutoFinish,
} from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import { closeLatestPauseInterval } from "@/lib/session-pause-intervals";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";

export const runtime = "nodejs";

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

    await closeLatestPauseInterval(sessionId, now);
    await handleNegotiationFinishRecording(sessionId);
  }

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: {
      status: true,
      errorMessage: true,
    },
  });

  const isFacilitator = participant.type === ParticipantType.FACILITATOR;

  return NextResponse.json({
    ...buildControlState(session, participant.type, now),
    recording: recording
      ? {
          status: recording.status,
          errorMessage: isFacilitator ? recording.errorMessage : null,
        }
      : null,
  });
}
