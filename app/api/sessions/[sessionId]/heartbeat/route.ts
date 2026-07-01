import { NextResponse } from "next/server";

import { updateParticipantPresence } from "@/lib/participant-presence";
import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  claimSessionRoomConnectionLease,
  validateSessionRoomConnectionLease,
} from "@/lib/session-room-connection-lease";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  if (!body.joinToken && !body.participantId) {
    return NextResponse.json({ error: "invalidToken" }, { status: 400 });
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

  // Update presence: for account mode, use joinToken from DB record.
  await updateParticipantPresence(participant.joinToken);

  return NextResponse.json({ ok: true });
}
