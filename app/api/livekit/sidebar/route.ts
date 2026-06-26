import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { getRoomSidebarData } from "@/lib/room-sidebar";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const joinToken = url.searchParams.get("joinToken")?.trim() ?? null;
  const participantId = url.searchParams.get("participantId")?.trim() ?? null;

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

  if (joinToken) {
    // Verify the user owns or may use this participant before returning sidebar data.
    const participantForToken = await prisma.sessionParticipant.findUnique({
      where: { joinToken },
      select: { id: true, joinToken: true, userId: true },
    });

    if (!participantForToken) {
      return NextResponse.json({ error: "Invalid join token." }, { status: 404 });
    }

    if (participantForToken.userId && participantForToken.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
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
      joinToken: true,
      userId: true,
      session: { select: { event: { select: { hostUserId: true } } } },
    },
  });

  if (!participant) {
    return NextResponse.json({ error: "Participant not found." }, { status: 404 });
  }

  const adminUser = isAdmin(user);
  const isOwner = participant.userId === user.id;
  const isEventHost = participant.session.event?.hostUserId === user.id;
  if (!isOwner && !adminUser && !isEventHost) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const sidebar = await getRoomSidebarData(participant.joinToken);
  if (!sidebar) {
    return NextResponse.json({ error: "Sidebar data not found." }, { status: 404 });
  }

  return NextResponse.json(sidebar);
}
