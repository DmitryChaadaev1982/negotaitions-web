import { NextResponse } from "next/server";

import {
  createEventLobbyLiveKitAccessToken,
  getLiveKitConfig,
} from "@/lib/livekit";
import { isEventUnavailable, resolveEventAccess } from "@/lib/event-auth";
import { prisma } from "@/lib/prisma";
import { handleExternalServiceFailure } from "@/lib/services/external-service-events";
import { ExternalService } from "@/app/generated/prisma/client";
import { eventLiveKitTokenSchema } from "@/lib/validations/event";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;
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

  const access = await resolveEventAccess(eventId, parsed.data);

  if (!access) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (isEventUnavailable(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  if (!access.currentParticipant) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  const identity = access.currentParticipant.id;
  const displayName = access.currentParticipant.displayName;

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

    if (access.currentParticipant) {
      await prisma.eventParticipant.update({
        where: { id: access.currentParticipant.id },
        data: {
          joinedAt: access.currentParticipant.joinedAt ?? new Date(),
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
