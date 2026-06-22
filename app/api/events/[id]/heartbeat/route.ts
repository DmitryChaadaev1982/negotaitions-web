import { NextResponse } from "next/server";

import { updateEventLobbyPresence } from "@/lib/event-presence";
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

  if (!parsed.success || (!parsed.data.hostToken && !parsed.data.participantToken)) {
    return NextResponse.json({ error: "invalidToken" }, { status: 400 });
  }

  const updatedEventId = await updateEventLobbyPresence(eventId, parsed.data);

  if (!updatedEventId) {
    return NextResponse.json({ error: "invalidToken" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
