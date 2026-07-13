import { NextResponse } from "next/server";
import { ParticipantType } from "@/app/generated/prisma/client";

import { createLiveKitAccessToken, getLiveKitConfig } from "@/lib/livekit";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import {
  claimSessionRoomConnectionLease,
  validateSessionRoomConnectionLease,
} from "@/lib/session-room-connection-lease";
import {
  decideSessionRoomAccess,
  isRoomAccessAllowed,
} from "@/lib/session-room-access";

export async function POST(request: Request) {
  const config = getLiveKitConfig();

  if (!config) {
    return NextResponse.json(
      { error: "LiveKit is not configured." },
      { status: 503 },
    );
  }

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const joinToken = typeof body.joinToken === "string" ? body.joinToken.trim() : null;
  const participantId = typeof body.participantId === "string" ? body.participantId.trim() : null;
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const claimLease = body.claimLease === true;

  if (!joinToken && !participantId) {
    return NextResponse.json({ error: "joinToken or participantId is required." }, { status: 400 });
  }

  let whereClause: Parameters<typeof prisma.sessionParticipant.findUnique>[0]["where"];

  if (joinToken) {
    whereClause = { joinToken };
  } else {
    // Account mode: look up by participantId, then verify cookie ownership below.
    whereClause = { id: participantId! };
  }

  const participant = await prisma.sessionParticipant.findUnique({
    where: whereClause,
    include: {
      sessionRole: { select: { name: true } },
      session: {
        select: {
          id: true,
          livekitRoomName: true,
          negotiationState: true,
          roomLifecycle: true,
          deletedAt: true,
          closeReason: true,
          closedByEventAt: true,
          eventId: true,
          event: {
            select: {
              hostUserId: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!participant) {
    return NextResponse.json({ error: "Invalid join token or participant." }, { status: 404 });
  }

  // Phase 6.4.1: authentication is required regardless of joinToken or participantId.
  // joinToken is no longer a guest identity; it is an invite-claim secret only.
  const user = await getOptionalCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required.", code: "LOGIN_REQUIRED" },
      { status: 401 },
    );
  }

  if (!isAdmin(user) && user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (joinToken) {
    // joinToken path: user must own the participant or participant must be unclaimed.
    if (participant.userId && participant.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  } else {
    // participantId path: account room APIs must target the caller's own row.
    const isOwner = participant.userId === user.id;
    if (!isOwner) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  const accessDecision = decideSessionRoomAccess({
    user: {
      isAuthenticated: true,
      isAuthorizedMember: true,
    },
    session: {
      sessionId: participant.session.id,
      negotiationState: participant.session.negotiationState,
      roomLifecycle: participant.session.roomLifecycle ?? null,
      deletedAt: participant.session.deletedAt ?? null,
      closeReason: participant.session.closeReason ?? null,
      closedByEventAt: participant.session.closedByEventAt ?? null,
      eventId: participant.session.eventId ?? null,
      eventStatus: participant.session.event?.status ?? null,
    },
    redirect: {
      sessionId: participant.session.id,
      participantJoinToken: participant.joinToken,
      eventId: participant.session.eventId ?? null,
      eventStatus: participant.session.event?.status ?? null,
      preferEventResultsForEventOwner:
        participant.type === ParticipantType.FACILITATOR,
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

  if (participant.userId && connectionId) {
    if (claimLease) {
      const lease = await claimSessionRoomConnectionLease({
        sessionId: participant.session.id,
        userId: participant.userId,
        connectionId,
        role: participant.type,
      });
      if (!lease.isCurrentConnectionActive) {
        return NextResponse.json(
          {
            error: "staleConnection",
            code: "STALE_CONNECTION",
            activeConnectionVersion: lease.version,
          },
          { status: 409 },
        );
      }
    } else {
      const lease = await validateSessionRoomConnectionLease({
        sessionId: participant.session.id,
        userId: participant.userId,
        connectionId,
      });
      if (lease.version === 0) {
        const claimed = await claimSessionRoomConnectionLease({
          sessionId: participant.session.id,
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
      } else if (!lease.isCurrentConnectionActive) {
        return NextResponse.json(
          {
            error: "staleConnection",
            code: "STALE_CONNECTION",
            activeConnectionVersion: lease.version,
          },
          { status: 409 },
        );
      }
    }
  }

  const token = await createLiveKitAccessToken(
    participant,
    participant.session,
    config,
    participant.sessionRole?.name ?? null,
  );

  return NextResponse.json({
    token,
    serverUrl: config.serverUrl,
    sessionId: participant.session.id,
    participantId: participant.id,
    participantType: participant.type,
    displayName: participant.displayName,
  });
}
