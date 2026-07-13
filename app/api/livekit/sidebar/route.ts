import { NextResponse } from "next/server";
import { ParticipantType } from "@/app/generated/prisma/client";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { getRoomSidebarData, getRoomSidebarDataByParticipantId } from "@/lib/room-sidebar";
import { prisma } from "@/lib/prisma";
import {
  claimSessionRoomConnectionLease,
  validateSessionRoomConnectionLease,
} from "@/lib/session-room-connection-lease";

async function enforceConnectionLease(params: {
  sessionId: string;
  userId: string;
  role: ParticipantType;
  connectionId: string | null;
  claimLease: boolean;
}) {
  if (!params.connectionId) {
    return null;
  }
  if (params.claimLease) {
    const lease = await claimSessionRoomConnectionLease({
      sessionId: params.sessionId,
      userId: params.userId,
      connectionId: params.connectionId,
      role: params.role,
    });
    if (!lease.isCurrentConnectionActive) {
      return {
        error: "staleConnection",
        code: "STALE_CONNECTION",
        activeConnectionVersion: lease.version,
        status: 409 as const,
      };
    }
    return null;
  }
  const state = await validateSessionRoomConnectionLease({
    sessionId: params.sessionId,
    userId: params.userId,
    connectionId: params.connectionId,
  });
  if (state.version === 0) {
    const lease = await claimSessionRoomConnectionLease({
      sessionId: params.sessionId,
      userId: params.userId,
      connectionId: params.connectionId,
      role: params.role,
    });
    if (!lease.isCurrentConnectionActive) {
      return {
        error: "staleConnection",
        code: "STALE_CONNECTION",
        activeConnectionVersion: lease.version,
        status: 409 as const,
      };
    }
    return null;
  }
  if (!state.isCurrentConnectionActive) {
    return {
      error: "staleConnection",
      code: "STALE_CONNECTION",
      activeConnectionVersion: state.version,
      status: 409 as const,
    };
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const joinToken = url.searchParams.get("joinToken")?.trim() ?? null;
  const participantId = url.searchParams.get("participantId")?.trim() ?? null;
  const connectionId = url.searchParams.get("connectionId")?.trim() ?? null;
  const claimLease = url.searchParams.get("claimLease") === "1";

  if (!joinToken && !participantId) {
    return NextResponse.json({ error: "joinToken or participantId is required." }, { status: 400 });
  }

  // Phase 6.4.1: authentication is required for all paths — joinToken is no longer
  // a guest identity; it is an invite-claim secret that requires a valid session cookie.
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
    // Verify the user owns or may use this participant before returning sidebar data.
    const participantForToken = await prisma.sessionParticipant.findUnique({
      where: { joinToken },
      select: { id: true, joinToken: true, userId: true, sessionId: true, type: true },
    });

    if (!participantForToken) {
      return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
    }

    if (participantForToken.userId && participantForToken.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    if (participantForToken.userId) {
      const leaseError = await enforceConnectionLease({
        sessionId: participantForToken.sessionId,
        userId: participantForToken.userId,
        role: participantForToken.type,
        connectionId,
        claimLease,
      });
      if (leaseError) {
        return NextResponse.json(
          {
            error: leaseError.error,
            code: "code" in leaseError ? leaseError.code : undefined,
            activeConnectionVersion:
              "activeConnectionVersion" in leaseError
                ? leaseError.activeConnectionVersion
                : undefined,
          },
          { status: leaseError.status },
        );
      }
    }

    const sidebar = await getRoomSidebarData(participantForToken.joinToken);
    if (!sidebar) {
      return NextResponse.json({ error: "Sidebar data not found." }, { status: 404 });
    }
    return NextResponse.json(sidebar);
  }

  // Account mode: verify cookie ownership then get sidebar by participantId.
  const participant = await prisma.sessionParticipant.findUnique({
    where: { id: participantId! },
    select: {
      id: true,
      userId: true,
      sessionId: true,
      type: true,
    },
  });

  if (!participant) {
    return NextResponse.json({ error: "Participant not found." }, { status: 404 });
  }

  const isOwner = participant.userId === user.id;
  if (!isOwner) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (participant.userId) {
    const leaseError = await enforceConnectionLease({
      sessionId: participant.sessionId,
      userId: participant.userId,
      role: participant.type,
      connectionId,
      claimLease,
    });
    if (leaseError) {
      return NextResponse.json(
        {
          error: leaseError.error,
          code: "code" in leaseError ? leaseError.code : undefined,
          activeConnectionVersion:
            "activeConnectionVersion" in leaseError
              ? leaseError.activeConnectionVersion
              : undefined,
        },
        { status: leaseError.status },
      );
    }
  }

  const sidebar = await getRoomSidebarDataByParticipantId(participant.id);
  if (!sidebar) {
    return NextResponse.json({ error: "Sidebar data not found." }, { status: 404 });
  }

  return NextResponse.json(sidebar);
}
