import { NextResponse } from "next/server";

import {
  getParticipantNotesForFacilitator,
  getParticipantNotesWithJoinToken,
} from "@/lib/participant-notes-access";

type RouteContext = {
  params: Promise<{ sessionId: string; participantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId, participantId } = await context.params;
  const joinToken = new URL(request.url).searchParams.get("joinToken");

  const result = joinToken
    ? await getParticipantNotesWithJoinToken(
        sessionId,
        participantId,
        joinToken,
      )
    : await getParticipantNotesForFacilitator(sessionId, participantId);

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
