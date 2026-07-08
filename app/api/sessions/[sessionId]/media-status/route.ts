import { NextResponse } from "next/server";

import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  claimSessionRoomConnectionLease,
  validateSessionRoomConnectionLease,
} from "@/lib/session-room-connection-lease";
import { upsertSessionParticipantMediaStatus } from "@/lib/voximplant/media-status-store";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function parseBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

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

  const participant = await resolveRoomParticipantFromBody(body, sessionId);
  if (!participant) {
    return NextResponse.json({ error: "invalidToken" }, { status: 403 });
  }

  const connectionId =
    typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  if (participant.userId && connectionId) {
    const leaseState = validateSessionRoomConnectionLease({
      sessionId,
      userId: participant.userId,
      connectionId,
    });
    if (leaseState.version === 0) {
      claimSessionRoomConnectionLease({
        sessionId,
        userId: participant.userId,
        connectionId,
      });
    } else if (!leaseState.isCurrentConnectionActive) {
      return NextResponse.json(
        {
          error: "staleConnection",
          code: "STALE_CONNECTION",
          activeConnectionVersion: leaseState.version,
        },
        { status: 409 },
      );
    }
  }

  const saved = await upsertSessionParticipantMediaStatus({
    sessionId,
    participantId: participant.id,
    connectionId: connectionId || null,
    micEnabled,
    cameraEnabled,
  });

  return NextResponse.json({
    ok: true,
    mediaStatus: saved,
  });
}
