import { NextResponse } from "next/server";

import { getSessionParticipantsNotesForFacilitatorByUserId } from "@/lib/participant-notes-access";
import { apiRequireSessionJoinTokenOrAdmin } from "@/lib/auth/api-guards";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  // Require facilitator joinToken for this session OR admin.
  // Generic active users must not read all session notes — no user↔session binding
  // exists yet (Phase C adds SessionParticipant.userId).
  const joinToken = new URL(request.url).searchParams.get("joinToken");
  const access = await apiRequireSessionJoinTokenOrAdmin(sessionId, joinToken);
  if (!access.ok) return access.response;

  // If authenticated via joinToken, enforce facilitator type.
  if (!access.isAdminAccess && access.participantType !== "FACILITATOR") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const result = await getSessionParticipantsNotesForFacilitatorByUserId(sessionId);

  if (!result.ok) {
    return NextResponse.json({ error: "Not found." }, { status: result.status });
  }

  return NextResponse.json({ participants: result.data });
}
