import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import {
  claimEventLobbyConnectionLease,
  validateEventLobbyConnectionLease,
} from "@/lib/event-lobby-connection-lease";
import { isEventDeletedOrCancelled, resolveEventAccess } from "@/lib/event-auth";
import { ensureUserEventParticipant } from "@/lib/ensure-event-participant";
import { buildEventState } from "@/lib/event-state";
import { eventAccessQuerySchema } from "@/lib/validations/event";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;
  const { searchParams } = new URL(request.url);

  const parsed = eventAccessQuerySchema.safeParse({
    hostToken: searchParams.get("hostToken") ?? undefined,
    participantToken: searchParams.get("participantToken") ?? undefined,
  });
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  const claimLease =
    searchParams.get("claimLease") === "1" ||
    searchParams.get("claimLease") === "true";

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 400 });
  }

  const user = await getOptionalCurrentUser();
  const access = await resolveEventAccess(eventId, parsed.data, user);

  if (!access) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (isEventDeletedOrCancelled(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  // Authenticated lobby identity must be resolved by eventId + currentUser.id.
  // If an authenticated user (admin, hostOwner, facilitatorOwner) has event access
  // but no EventParticipant row yet, auto-create one so their identity is correct.
  // Never represent them as host/first participant.
  let { currentParticipant } = access;
  const hasDirectMembership = Boolean(
    user &&
      (access.isEventOwner ||
        access.hasUserParticipant ||
        access.hasEmailInvite ||
        currentParticipant?.userId === user.id ||
        currentParticipant),
  );
  if (
    !currentParticipant &&
    hasDirectMembership &&
    user &&
    (isAdmin(user) || user.status === "ACTIVE")
  ) {
    currentParticipant = await ensureUserEventParticipant(eventId, user);
  }

  if (user && connectionId) {
    const lease = claimLease
      ? claimEventLobbyConnectionLease({
          eventId,
          userId: user.id,
          connectionId,
        })
      : validateEventLobbyConnectionLease({
          eventId,
          userId: user.id,
          connectionId,
        });
    if (!claimLease && lease.version === 0) {
      claimEventLobbyConnectionLease({
        eventId,
        userId: user.id,
        connectionId,
      });
    }
    if (!lease.isCurrentConnectionActive) {
      return NextResponse.json(
        {
          error: "staleConnection",
          code: "STALE_CONNECTION",
          activeConnectionId: lease.activeConnectionId,
          leaseVersion: lease.version,
        },
        { status: 409 },
      );
    }
  }

  const state = await buildEventState({
    event: access.event,
    isHost: access.isHost,
    isEventOwner: access.isEventOwner,
    isAdmin: access.isAdmin,
    currentParticipant,
    accountMode: Boolean(user),
    canJoinEventSessionsAsObserver: hasDirectMembership,
    userId: user?.id ?? null,
  });

  return NextResponse.json(state);
}
