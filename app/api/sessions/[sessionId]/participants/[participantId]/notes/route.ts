import { NextResponse } from "next/server";

import {
  getParticipantNotesWithJoinToken,
  getSessionParticipantsNotesForFacilitatorByUserId,
} from "@/lib/participant-notes-access";
import { apiRequireSessionJoinTokenOrAdmin } from "@/lib/auth/api-guards";

type RouteContext = {
  params: Promise<{ sessionId: string; participantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId, participantId } = await context.params;
  const joinToken = new URL(request.url).searchParams.get("joinToken");

  // Require joinToken (self or facilitator) OR admin.
  // Generic active users without a proven session relation must be rejected —
  // SessionParticipant.userId binding does not exist yet (Phase C).
  const access = await apiRequireSessionJoinTokenOrAdmin(sessionId, joinToken);
  if (!access.ok) return access.response;

  if (access.isAdminAccess) {
    // Admin: pull notes via facilitator helper (no token required).
    const snapshot = await getSessionParticipantsNotesForFacilitatorByUserId(sessionId);
    if (!snapshot.ok) {
      return NextResponse.json({ error: "Not found." }, { status: snapshot.status });
    }
    const participantSnapshot = snapshot.data.find((p) => p.id === participantId);
    if (!participantSnapshot) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    return NextResponse.json({
      participant: { id: participantSnapshot.id },
      notes: participantSnapshot.notes,
      notesCount: participantSnapshot.notesCount,
    });
  }

  const result = await getParticipantNotesWithJoinToken(sessionId, participantId, joinToken!);

  if (!result.ok) {
    return NextResponse.json(
      {
        error:
          result.status === 403
            ? "You do not have permission to view these notes."
            : "Not found.",
      },
      { status: result.status },
    );
  }

  return NextResponse.json(result.data);
}
