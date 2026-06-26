import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { updateEventLobbyPresence } from "@/lib/event-presence";
import { prisma } from "@/lib/prisma";
import { eventHeartbeatSchema } from "@/lib/validations/rejoin";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = eventHeartbeatSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidToken" }, { status: 400 });
  }

  // Account-mode heartbeat: authenticated user with no token.
  // Authenticated lobby identity is resolved by eventId + currentUser.id.
  if (!parsed.data.hostToken && !parsed.data.participantToken) {
    const user = await getOptionalCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "invalidToken" }, { status: 400 });
    }

    const participant = await prisma.eventParticipant.findFirst({
      where: { eventId, userId: user.id },
      select: { id: true, eventId: true, joinedAt: true },
    });

    if (!participant) {
      return NextResponse.json({ error: "participantNotFound" }, { status: 404 });
    }

    await prisma.eventParticipant.update({
      where: { id: participant.id },
      data: {
        lastSeenAt: new Date(),
        ...(participant.joinedAt ? {} : { joinedAt: new Date() }),
      },
    });

    return NextResponse.json({ ok: true });
  }

  // Token-based presence (existing path: hostToken or participantToken).
  const updatedEventId = await updateEventLobbyPresence(eventId, parsed.data);

  if (!updatedEventId) {
    return NextResponse.json({ error: "invalidToken" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
