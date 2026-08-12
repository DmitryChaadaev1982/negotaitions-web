import { NextResponse } from "next/server";

import { ParticipantType } from "@/app/generated/prisma/client";
import {
  claimSessionRoomConnectionLease,
  validateSessionRoomConnectionLease,
} from "@/lib/session-room-connection-lease";
import {
  buildSessionCloseState,
} from "@/lib/session-close-state";
import {
  decideSessionRoomAccess,
  isRoomAccessAllowed,
} from "@/lib/session-room-access";
import { getStopRelayHintForSession } from "@/lib/session-recording-stop-relay";
import { triggerStage310ExpiryReconciliation } from "@/lib/stage-3-10-maintenance-trigger";
import { reconcileSessionControlAutoTransitions } from "@/lib/session-control-auto-transitions";
import { buildControlStateResponse } from "@/lib/session-control-response";
import { prisma } from "@/lib/prisma";
import { maybeReconcileVoximplantRecordingAttempt } from "@/lib/voximplant/recording-reconciliation";

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

  const accessDecision = decideSessionRoomAccess({
    user: {
      isAuthenticated: true,
      isAuthorizedMember: true,
    },
    session: {
      sessionId,
      negotiationState: participant.session.negotiationState,
      roomLifecycle: participant.session.roomLifecycle ?? null,
      deletedAt: participant.session.deletedAt ?? null,
      closeReason: participant.session.closeReason ?? null,
      closedByEventAt: participant.session.closedByEventAt ?? null,
      eventId: participant.session.eventId ?? null,
      eventStatus: participant.session.event?.status ?? null,
    },
    redirect: {
      sessionId,
      participantJoinToken: participant.joinToken,
      eventId: participant.session.eventId ?? null,
      eventStatus: participant.session.event?.status ?? null,
      preferEventResultsForEventOwner: participant.type === ParticipantType.FACILITATOR,
    },
  });
  if (!isRoomAccessAllowed(accessDecision.output)) {
    if (accessDecision.output === "DENY_DELETED") {
      return NextResponse.json({ error: "sessionDeleted" }, { status: 404 });
    }
    if (accessDecision.output === "DENY_UNAUTHORIZED") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    return NextResponse.json(
      {
        error:
          accessDecision.output === "EVENT_CLOSED" ? "eventClosed" : "roomClosed",
        code:
          accessDecision.output === "EVENT_CLOSED"
            ? "EVENT_CLOSED"
            : "ROOM_CLOSED",
        redirectTo: accessDecision.redirectTo,
      },
      { status: 409 },
    );
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
  await triggerStage310ExpiryReconciliation();

  const now = new Date();
  const session = await reconcileSessionControlAutoTransitions(sessionId, now);
  try {
    await maybeReconcileVoximplantRecordingAttempt(sessionId);
  } catch (error) {
    console.warn(
      "[control-state] provider recording reconciliation deferred:",
      error instanceof Error ? error.message : "unknown error",
    );
  }

  const recording = await prisma.recording.findUnique({
    where: { sessionId },
    select: {
      status: true,
      recordingAttemptId: true,
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
      ...buildControlStateResponse(session, participant.type, now),
      ...sessionCloseState,
      recording: recording
        ? {
            status: recording.status,
            recordingAttemptId: recording.recordingAttemptId,
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
