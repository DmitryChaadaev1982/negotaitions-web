import { NextResponse } from "next/server";

import { getSessionParticipantsNotesForFacilitator } from "@/lib/participant-notes-access";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const result = await getSessionParticipantsNotesForFacilitator(sessionId);

  if (!result.ok) {
    return NextResponse.json({ error: "Not found." }, { status: result.status });
  }

  return NextResponse.json({ participants: result.data });
}
