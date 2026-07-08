import { NextResponse } from "next/server";

import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { validateEventLobbyConnectionLease } from "@/lib/event-lobby-connection-lease";
import { isEventDeletedOrCancelled, resolveEventAccess } from "@/lib/event-auth";
import { ensureUserEventParticipant } from "@/lib/ensure-event-participant";
import { upsertEventParticipantMediaStatus } from "@/lib/voximplant/media-status-store";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export async function POST(request: Request, context: RouteContext) {
  const { id: eventId } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const micEnabled = parseBoolean(body.micEnabled);
  const cameraEnabled = parseBoolean(body.cameraEnabled);
  if (micEnabled === null || cameraEnabled === null) {
    return NextResponse.json({ error: "invalidPayload" }, { status: 400 });
  }

  const hostToken = typeof body.hostToken === "string" ? body.hostToken : undefined;
  const participantToken =
    typeof body.participantToken === "string" ? body.participantToken : undefined;
  const connectionId =
    typeof body.connectionId === "string" ? body.connectionId.trim() : undefined;

  const user = await getOptionalCurrentUser();
  const access = await resolveEventAccess(eventId, { hostToken, participantToken }, user);
  if (!access) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }
  if (isEventDeletedOrCancelled(access.event)) {
    return NextResponse.json({ error: "eventUnavailable" }, { status: 410 });
  }

  let currentParticipant = access.currentParticipant;
  if (!currentParticipant && user && (isAdmin(user) || user.status === "ACTIVE")) {
    currentParticipant = await ensureUserEventParticipant(eventId, user);
  }
  if (!currentParticipant) {
    return NextResponse.json({ error: "invalidAccess" }, { status: 403 });
  }

  if (user?.id && connectionId) {
    const lease = validateEventLobbyConnectionLease({
      eventId,
      userId: user.id,
      connectionId,
    });
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

  const saved = await upsertEventParticipantMediaStatus({
    eventId,
    participantId: currentParticipant.id,
    connectionId: connectionId ?? null,
    micEnabled,
    cameraEnabled,
  });

  return NextResponse.json({
    ok: true,
    mediaStatus: saved,
  });
}
