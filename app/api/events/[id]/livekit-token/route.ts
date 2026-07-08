import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import {
  claimEventLobbyConnectionLease,
  validateEventLobbyConnectionLease,
} from "@/lib/event-lobby-connection-lease";
import { getVideoProvider } from "@/lib/env";
import {
  createEventLobbyLiveKitAccessToken,
  getLiveKitConfig,
} from "@/lib/livekit";
import { isEventUnavailable, resolveEventAccess } from "@/lib/event-auth";
import { ensureUserEventParticipant } from "@/lib/ensure-event-participant";
import { prisma } from "@/lib/prisma";
import { handleExternalServiceFailure } from "@/lib/services/external-service-events";
import { ExternalService } from "@/app/generated/prisma/client";
import { eventLiveKitTokenSchema } from "@/lib/validations/event";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;
  if (getVideoProvider() !== "livekit") {
    return NextResponse.json(
      { error: "providerMismatch", code: "LIVEKIT_LOBBY_DISABLED" },
      { status: 409 },
    );
  }
  const config = getLiveKitConfig();

  if (!config) {
    return NextResponse.json(
      { error: "livekitNotConfigured" },
      { status: 503 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = eventLiveKitTokenSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 400 });
  }

  const user = await getOptionalCurrentUser();
  const access = await resolveEventAccess(eventId, parsed.data, user);

  if (!access) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (user && parsed.data.connectionId) {
    const lease = parsed.data.claimLease
      ? claimEventLobbyConnectionLease({
          eventId,
          userId: user.id,
          connectionId: parsed.data.connectionId,
        })
      : validateEventLobbyConnectionLease({
          eventId,
          userId: user.id,
          connectionId: parsed.data.connectionId,
        });
    if (!parsed.data.claimLease && lease.version === 0) {
      claimEventLobbyConnectionLease({
        eventId,
        userId: user.id,
        connectionId: parsed.data.connectionId,
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

  if (isEventUnavailable(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  // Authenticated lobby identity must be resolved by eventId + currentUser.id.
  // Ensure participant exists before issuing a LiveKit token.
  let currentParticipant = access.currentParticipant;
  if (!currentParticipant && user && (isAdmin(user) || user.status === "ACTIVE")) {
    currentParticipant = await ensureUserEventParticipant(eventId, user);
  }

  if (!currentParticipant) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  const identity = currentParticipant.id;
  const displayName = currentParticipant.displayName;

  try {
    const { token, roomName } = await createEventLobbyLiveKitAccessToken(
      {
        identity,
        displayName,
        eventId: access.event.id,
        lobbyRoomName: access.event.lobbyRoomName,
      },
      config,
    );

    if (currentParticipant) {
      await prisma.eventParticipant.update({
        where: { id: currentParticipant.id },
        data: {
          joinedAt: currentParticipant.joinedAt ?? new Date(),
          lastSeenAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      token,
      serverUrl: config.serverUrl,
      roomName,
      eventId: access.event.id,
      displayName,
      isHost: access.isHost,
    });
  } catch (error) {
    await handleExternalServiceFailure(ExternalService.LIVEKIT, error, {
      context: "event-lobby-token",
    });

    return NextResponse.json(
      { error: "livekitTokenFailed" },
      { status: 502 },
    );
  }
}
