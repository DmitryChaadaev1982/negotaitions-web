import { NextResponse } from "next/server";

import { updateParticipantPresence } from "@/lib/participant-presence";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import { sessionHeartbeatSchema } from "@/lib/validations/rejoin";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalidJson" }, { status: 400 });
  }

  const parsed = sessionHeartbeatSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "invalidToken" }, { status: 400 });
  }

  const participant = await getSessionParticipantByJoinToken(
    parsed.data.joinToken,
    sessionId,
  );

  if (!participant) {
    return NextResponse.json({ error: "invalidToken" }, { status: 403 });
  }

  await updateParticipantPresence(parsed.data.joinToken);

  return NextResponse.json({ ok: true });
}
