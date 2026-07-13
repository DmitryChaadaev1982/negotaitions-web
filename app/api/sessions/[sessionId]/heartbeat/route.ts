import { NextResponse } from "next/server";

import { updateParticipantPresence } from "@/lib/participant-presence";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  decideSessionRoomAccess,
  isRoomAccessAllowed,
} from "@/lib/session-room-access";
import {
  claimSessionRoomConnectionLease,
  touchSessionRoomConnectionLease,
  validateSessionRoomConnectionLease,
} from "@/lib/session-room-connection-lease";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  if (!body.joinToken && !body.participantId) {
    return NextResponse.json({ error: "invalidToken" }, { status: 400 });
  }

  const participant = await resolveRoomParticipantFromBody(body, sessionId);

  if (!participant) {
    return NextResponse.json({ error: "invalidToken" }, { status: 403 });
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
      preferEventResultsForEventOwner: participant.type === "FACILITATOR",
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

  const connectionId =
    typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  if (participant.userId && connectionId) {
    const leaseState = await validateSessionRoomConnectionLease({
      sessionId,
      userId: participant.userId,
      connectionId,
    });
    if (leaseState.version === 0) {
      const claimed = await claimSessionRoomConnectionLease({
        sessionId,
        userId: participant.userId,
        connectionId,
        role: participant.type,
      });
      if (!claimed.isCurrentConnectionActive) {
        return NextResponse.json(
          {
            error: "staleConnection",
            code: "STALE_CONNECTION",
            activeConnectionVersion: claimed.version,
          },
          { status: 409 },
        );
      }
    } else if (!leaseState.isCurrentConnectionActive) {
      return NextResponse.json(
        {
          error: "staleConnection",
          code: "STALE_CONNECTION",
          activeConnectionVersion: leaseState.version,
        },
        { status: 409 },
      );
    } else {
      await touchSessionRoomConnectionLease({
        sessionId,
        userId: participant.userId,
        connectionId,
      });
    }
  }

  // Update presence: for account mode, use joinToken from DB record.
  await updateParticipantPresence(participant.joinToken);

  return NextResponse.json({ ok: true });
}
