import { NextResponse } from "next/server";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  buildControlState,
  getAutoFinishPreparationUpdateData,
  SESSION_CONTROL_SELECT,
  shouldAutoFinish,
  shouldAutoFinishPreparation,
} from "@/lib/negotiation-control";
import { prisma } from "@/lib/prisma";
import {
  claimSessionRoomConnectionLease,
  validateSessionRoomConnectionLease,
} from "@/lib/session-room-connection-lease";
import {
  buildSessionCloseState,
  isSessionClosedByOrganizer,
  SESSION_CLOSE_SELECT,
} from "@/lib/session-close-state";
import { completeSessionCanonical } from "@/lib/session-completion";
import { getStopRelayHintForSession } from "@/lib/session-recording-stop-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const connectionId = url.searchParams.get("connectionId")?.trim() ?? null;
  const claimLease = url.searchParams.get("claimLease") === "1";
  if (participant.userId && connectionId) {
    let isCurrentConnectionActive = true;
    let activeVersion = 0;
    if (claimLease) {
      const lease = await claimSessionRoomConnectionLease({
        sessionId,
        userId: participant.userId,
        connectionId,
        role: participant.type,
      });
      isCurrentConnectionActive = lease.isCurrentConnectionActive;
      activeVersion = lease.version;
    } else {
      const leaseState = await validateSessionRoomConnectionLease({
        sessionId,
        userId: participant.userId,
        connectionId,
      });
      if (leaseState.version === 0) {
        const firstLease = await claimSessionRoomConnectionLease({
          sessionId,
          userId: participant.userId,
          connectionId,
          role: participant.type,
        });
        isCurrentConnectionActive = firstLease.isCurrentConnectionActive;
        activeVersion = firstLease.version;
      } else {
        isCurrentConnectionActive = leaseState.isCurrentConnectionActive;
        activeVersion = leaseState.version;
      }
    }

    if (!isCurrentConnectionActive) {
      return NextResponse.json(
        {
          error: "staleConnection",
          code: "STALE_CONNECTION",
          activeConnectionVersion: activeVersion,
        },
        { status: 409 },
      );
    }
  }

  const now = new Date();
  let session = participant.session;

  if (!isSessionClosedByOrganizer(session)) {
    if (shouldAutoFinishPreparation(session, now)) {
      session = await prisma.session.update({
        where: { id: sessionId },
        data: getAutoFinishPreparationUpdateData(session, now),
        select: {
          facilitatorId: true,
          ...SESSION_CONTROL_SELECT,
          ...SESSION_CLOSE_SELECT,
        },
      });
    }

    if (shouldAutoFinish(session, now)) {
      await completeSessionCanonical({
        sessionId,
        mode: "ROOM_FACILITATOR_FINISH",
        reason: "AUTO_TIMER_FINISH",
      });
      session = await prisma.session.findUniqueOrThrow({
        where: { id: sessionId },
        select: {
          facilitatorId: true,
          ...SESSION_CONTROL_SELECT,
          ...SESSION_CLOSE_SELECT,
        },
      });
    }
  }

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: {
      status: true,
      errorMessage: true,
      startedAt: true,
      endedAt: true,
    },
  });

  const isFacilitator = participant.type === ParticipantType.FACILITATOR;
  const sessionCloseState = buildSessionCloseState(session);
  const stopRelayHint = await getStopRelayHintForSession({
    sessionId,
    participantType: participant.type,
  });

  return NextResponse.json(
    {
      ...buildControlState(session, participant.type, now),
      ...sessionCloseState,
      recording: recording
        ? {
            status: recording.status,
            errorMessage: isFacilitator ? recording.errorMessage : null,
            startedAt: recording.startedAt?.toISOString() ?? null,
            endedAt: recording.endedAt?.toISOString() ?? null,
          }
        : null,
      recordingStopRelay: stopRelayHint
        ? {
            operationId: stopRelayHint.operationId,
            requestId: stopRelayHint.requestId,
            operationState: stopRelayHint.operationState,
            recordingId: stopRelayHint.recordingId,
          }
        : null,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}
