import { NextResponse } from "next/server";

import { leaveEventLobby } from "@/lib/event-presence";
import { eventPresenceSchema } from "@/lib/validations/event";

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

  const parsed = eventPresenceSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidToken" }, { status: 400 });
  }

  const updatedEventId = await leaveEventLobby(parsed.data.participantToken);

  if (!updatedEventId || updatedEventId !== eventId) {
    return NextResponse.json({ error: "invalidToken" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
