import { NextResponse } from "next/server";

import { createLiveKitAccessToken, getLiveKitConfig } from "@/lib/livekit";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";

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
      session: { select: { id: true, livekitRoomName: true, event: { select: { hostUserId: true } } } },
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

  if (joinToken) {
    // joinToken path: user must own the participant or participant must be unclaimed.
    if (participant.userId && participant.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  } else {
    // participantId path: user must own the participant, be admin, or be the event host.
    const adminUser = isAdmin(user);
    const isOwner = participant.userId === user.id;
    const isEventHost = participant.session.event?.hostUserId === user.id;
    if (!isOwner && !adminUser && !isEventHost) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
