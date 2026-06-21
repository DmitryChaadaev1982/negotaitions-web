import { NextResponse } from "next/server";

import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";
import { toParticipantPresenceSnapshot } from "@/lib/presence";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

async function getFacilitatorSessionPresence(sessionId: string) {
  const facilitator = await getDemoFacilitator();

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      facilitatorId: facilitator.id,
    },
    select: {
      participants: {
        select: {
          id: true,
          joinedAt: true,
          lastSeenAt: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) {
    return null;
  }

  return session.participants.map(toParticipantPresenceSnapshot);
}

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const presence = await getFacilitatorSessionPresence(sessionId);

  if (!presence) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ participants: presence });
}
