import { NextResponse } from "next/server";

import { apiRequireSessionJoinTokenOrAdmin } from "@/lib/auth/api-guards";
import { loadSessionCurrentPresenceSnapshots } from "@/lib/session-current-presence-read";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  // Require joinToken belonging to this session OR admin.
  // Generic active users must not read arbitrary session presence —
  // no user↔session ownership relation exists yet (Phase C).
  const searchParams = new URL(request.url).searchParams;
  const joinToken = searchParams.get("joinToken");
  const participantId = searchParams.get("participantId");
  const access = await apiRequireSessionJoinTokenOrAdmin(sessionId, joinToken, participantId);
  if (!access.ok) return access.response;

  const presence = await loadSessionCurrentPresenceSnapshots(sessionId);

  if (!presence) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ participants: presence });
}
