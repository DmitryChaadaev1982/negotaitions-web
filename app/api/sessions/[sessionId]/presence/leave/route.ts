import { NextResponse } from "next/server";

import { resolveRoomParticipantFromBody } from "@/lib/room-participant-resolver";
import {
  disconnectSessionRoomConnectionLease,
  disconnectSessionRoomConnectionLeaseByConnectionId,
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
  if (!connectionId) {
    return NextResponse.json({
      ok: true,
      disconnected: false,
      alreadyFinalized: true,
      roomClosed: false,
      finalState: "NOT_FOUND",
    });
  }

  const result = participant.userId
    ? await disconnectSessionRoomConnectionLease({
        sessionId,
        userId: participant.userId,
        connectionId,
        reason: "EXPLICIT_LEAVE",
      })
    : await disconnectSessionRoomConnectionLeaseByConnectionId({
        sessionId,
        connectionId,
        reason: "EXPLICIT_LEAVE",
      });

  return NextResponse.json({
    ok: true,
    disconnected: result.disconnected,
    alreadyFinalized: result.alreadyFinalized,
    roomClosed: result.roomClosed,
    finalState: result.finalState,
  });
}
