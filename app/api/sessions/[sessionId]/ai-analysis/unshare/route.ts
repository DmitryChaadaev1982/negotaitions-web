import { NextResponse } from "next/server";

import { ParticipantType, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { revokeActiveAiAnalysisPublicationInTransaction } from "@/lib/ai-publication-revoke";
import {
  isAiPublicationSerializationConflict,
  retryAiPublicationTransaction,
} from "@/lib/ai-publication-transaction";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: { joinToken?: string; participantId?: string };
  try {
    body = (await request.json()) as { joinToken?: string; participantId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { joinToken, participantId } = body;

  if (!joinToken && !participantId) {
    return NextResponse.json({ error: "joinToken or participantId is required." }, { status: 400 });
  }

  let adminUser = false;
  let isEventHostOwner = false;
  if (participantId) {
    const user = await getOptionalCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    adminUser = isAdmin(user);
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { event: { select: { hostUserId: true } } },
    });
    isEventHostOwner = session?.event?.hostUserId === user.id;
  }

  const participant = await resolveRoomParticipantFromParsedBody(
    { joinToken: joinToken ?? null, participantId: participantId ?? null },
    sessionId,
  );
  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (participant.type !== ParticipantType.FACILITATOR && !adminUser && !isEventHostOwner) {
    return NextResponse.json(
      { error: "Only facilitators can change AI analysis visibility." },
      { status: 403 },
    );
  }

  let result;
  try {
    result = await retryAiPublicationTransaction(() =>
      prisma.$transaction(
        async (tx) => {
          // This canonical row lock must precede every publication lookup,
          // revocation, and legacy mutable-field clear so Publish and Unshare
          // have one serializable order.
          const revoked = await revokeActiveAiAnalysisPublicationInTransaction(
            tx,
            sessionId,
          );
          if (!revoked.analysisId) {
            return { state: "analysis_not_found" as const };
          }
          const updated = await tx.aiAnalysis.findUniqueOrThrow({
            where: { id: revoked.analysisId },
            select: {
              id: true,
              visibility: true,
              unsharedAt: true,
            },
          });
          return { state: "unshared" as const, updated };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    if (isAiPublicationSerializationConflict(error)) {
      return NextResponse.json(
        { error: "AI analysis publication is busy. Please retry." },
        { status: 409 },
      );
    }
    throw error;
  }

  if (result.state === "analysis_not_found") {
    return NextResponse.json({ error: "AI analysis not found." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    visibility: result.updated.visibility,
    unsharedAt: result.updated.unsharedAt?.toISOString() ?? null,
  });
}
