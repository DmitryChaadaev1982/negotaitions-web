import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { flagsFromPreference } from "@/lib/event-assignment";
import { resolveEventAccess, isEventUnavailable } from "@/lib/event-auth";
import { ensureUserEventParticipant } from "@/lib/ensure-event-participant";
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

  const user = await getOptionalCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "loginRequired" }, { status: 401 });
  }

  if (!isAdmin(user) && user.status !== "ACTIVE") {
    return NextResponse.json({ error: "accountStatusRestricted" }, { status: 403 });
  }

  const access = await resolveEventAccess(eventId, {
    participantToken: parsed.data.participantToken,
  }, user);

  if (!access) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (isEventUnavailable(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  // Authenticated lobby identity must be resolved by eventId + currentUser.id.
  // If participant is missing, create it rather than returning 403 —
  // preference controls must update the current user's own row only.
  let currentParticipant = access.currentParticipant;
  if (!currentParticipant) {
    currentParticipant = await ensureUserEventParticipant(eventId, user);
  }

  const preferenceFlags = flagsFromPreference(parsed.data.preference);

  await prisma.eventParticipant.update({
    where: { id: currentParticipant.id },
    data: {
      preference: parsed.data.preference,
      ...preferenceFlags,
      lastSeenAt: new Date(),
    },
  });

  const state = await buildEventState({
    event: access.event,
    isHost: access.isHost,
    isEventOwner: access.isEventOwner,
    isAdmin: access.isAdmin,
    currentParticipant: {
      ...currentParticipant,
      preference: parsed.data.preference,
      ...preferenceFlags,
    },
    accountMode: true,
    userId: user.id,
  });

  return NextResponse.json(state);
}
