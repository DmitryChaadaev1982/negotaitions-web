import { NextResponse } from "next/server";

import { ParticipantType } from "@/app/generated/prisma/client";
import { handleNegotiationFinishRecording } from "@/lib/livekit-egress";
import {
  buildControlState,
  getAutoFinishPreparationUpdateData,
  getControlUpdateData,
  SESSION_CONTROL_SELECT,
  shouldAutoFinish,
  shouldAutoFinishPreparation,
} from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import {
  buildSessionCloseState,
  SESSION_CLOSE_SELECT,
} from "@/lib/session-close-state";
import { closeLatestPauseInterval } from "@/lib/session-pause-intervals";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const url = new URL(request.url);

  const { resolveRoomParticipantFromQuery } = await import("@/lib/room-participant-resolver");
  const participant = await resolveRoomParticipantFromQuery(url, sessionId);

  if (!participant) {
    const joinToken = url.searchParams.get("joinToken");
    const participantId = url.searchParams.get("participantId");
    if (!joinToken && !participantId) {
      return NextResponse.json({ error: "Invalid join token." }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
  }

  const now = new Date();
  let session = participant.session;

  const closeInfo = buildSessionCloseState({
    negotiationState: session.negotiationState,
    negotiationStartedAt: session.negotiationStartedAt,
    closedByEventAt: session.closedByEventAt,
    closeReason: session.closeReason,
    event: session.event,
  });

  if (!closeInfo.isClosed) {
    if (shouldAutoFinishPreparation(session, now)) {
      session = await prisma.session.update({
        where: { id: sessionId },
        data: getAutoFinishPreparationUpdateData(session, now),
        select: {
          ...SESSION_CONTROL_SELECT,
          ...SESSION_CLOSE_SELECT,
        },
      });
    }

    if (shouldAutoFinish(session, now)) {
      const updateData = getControlUpdateData(session, "FINISH", now);
      session = await prisma.session.update({
        where: { id: sessionId },
        data: updateData,
        select: {
          ...SESSION_CONTROL_SELECT,
          ...SESSION_CLOSE_SELECT,
        },
      });

      await closeLatestPauseInterval(sessionId, now);
      await handleNegotiationFinishRecording(sessionId);
    }
  }

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: {
      status: true,
      errorMessage: true,
    },
  });

  const isFacilitator = participant.type === ParticipantType.FACILITATOR;
  const sessionCloseState = buildSessionCloseState(session);

  return NextResponse.json({
    ...buildControlState(session, participant.type, now),
    ...sessionCloseState,
    recording: recording
      ? {
          status: recording.status,
          errorMessage: isFacilitator ? recording.errorMessage : null,
        }
      : null,
  });
}
