import { NextResponse } from "next/server";

import { flagsFromPreference } from "@/lib/event-assignment";
import { resolveEventAccess, isEventUnavailable } from "@/lib/event-auth";
import { buildEventState } from "@/lib/event-state";
import { prisma } from "@/lib/prisma";
import { updateEventParticipantSchema } from "@/lib/validations/event";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = updateEventParticipantSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidPayload" }, { status: 400 });
  }

  const access = await resolveEventAccess(eventId, {
    participantToken: parsed.data.participantToken,
  });

  if (!access?.currentParticipant) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (isEventUnavailable(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  const preferenceFlags = flagsFromPreference(parsed.data.preference);

  await prisma.eventParticipant.update({
    where: { id: access.currentParticipant.id },
    data: {
      preference: parsed.data.preference,
      ...preferenceFlags,
      lastSeenAt: new Date(),
    },
  });

  const state = await buildEventState({
    event: access.event,
    isHost: access.isHost,
    currentParticipant: {
      ...access.currentParticipant,
      preference: parsed.data.preference,
      ...preferenceFlags,
    },
  });

  return NextResponse.json(state);
}
