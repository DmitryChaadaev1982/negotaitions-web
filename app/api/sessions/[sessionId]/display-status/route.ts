import { NextResponse } from "next/server";

import { getDemoFacilitator } from "@/lib/demo-user";
import { prisma } from "@/lib/prisma";
import { resolveSessionDisplayStatus } from "@/lib/session-display-status";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const facilitator = await getDemoFacilitator();

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      facilitatorId: facilitator.id,
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
