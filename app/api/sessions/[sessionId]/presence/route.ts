import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { toParticipantPresenceSnapshot } from "@/lib/presence";
import { apiRequireSessionJoinTokenOrAdmin } from "@/lib/auth/api-guards";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

async function getSessionPresence(sessionId: string) {
  const session = await prisma.session.findFirst({
    where: { id: sessionId },
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

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  // Require joinToken belonging to this session OR admin.
  // Generic active users must not read arbitrary session presence —
  // no user↔session ownership relation exists yet (Phase C).
  const joinToken = new URL(request.url).searchParams.get("joinToken");
  const access = await apiRequireSessionJoinTokenOrAdmin(sessionId, joinToken);
  if (!access.ok) return access.response;

  const presence = await getSessionPresence(sessionId);

  if (!presence) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({ participants: presence });
}
