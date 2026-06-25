import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";
import { apiRequireSessionJoinTokenOrAdmin } from "@/lib/auth/api-guards";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  // Require joinToken belonging to this session OR admin.
  // Generic active users must not read arbitrary session status —
  // no user↔session ownership relation exists yet (Phase C).
  const joinToken = new URL(request.url).searchParams.get("joinToken");
  const access = await apiRequireSessionJoinTokenOrAdmin(sessionId, joinToken);
  if (!access.ok) return access.response;

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
    },
    select: {
      status: true,
      negotiationState: true,
      participants: {
        select: {
          type: true,
          joinedAt: true,
        },
      },
    },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  return NextResponse.json({
    status: resolveSessionDisplayStatus(session, session.participants),
  });
}
