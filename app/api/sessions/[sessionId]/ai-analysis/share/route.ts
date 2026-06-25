import { NextResponse } from "next/server";

import { AiAnalysisStatus, ParticipantType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import type { NegotiationAnalysisOutput } from "@/lib/ai/negotiation-analysis";
import { sanitizeSharedAiReport } from "@/lib/privacy/serializers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

/**
 * Sanitize the full analysis for sharing with session participants.
 *
 * Strips all fields that could reveal private role data:
 *   - roleObjectivesAnalysis (contains private objectives/fallback analysis)
 *   - rawPrompt (raw AI prompt including private role instructions)
 *   - analysisContext (raw context including all role briefings)
 *   - facilitatorNotes (facilitator-only notes)
 *
 * participantPersonalFeedback is retained; it is filtered per-participant
 * at delivery time in the materials/status API.
 */
function sanitizeAnalysisForParticipants(
  analysis: NegotiationAnalysisOutput,
): NegotiationAnalysisOutput {
  return sanitizeSharedAiReport({
    ...analysis,
    // Explicitly zero out the objectives array (most critical private data)
    roleObjectivesAnalysis: [],
  }) as NegotiationAnalysisOutput;
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: { joinToken?: string; participantId?: string; aiAnalysisId?: string };
  try {
    body = (await request.json()) as { joinToken?: string; participantId?: string; aiAnalysisId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { joinToken, participantId, aiAnalysisId } = body;

  if (!joinToken && !participantId) {
    return NextResponse.json({ error: "joinToken or participantId is required." }, { status: 400 });
  }

  let participant: Awaited<ReturnType<typeof getSessionParticipantByJoinToken>> | null = null;
  let isEventHostOwner = false;
  let adminUser = false;

  if (joinToken) {
    participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  } else {
    // Account mode: verify cookie ownership
    const user = await getOptionalCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    adminUser = isAdmin(user);
    const { resolveRoomParticipantFromBody } = await import("@/lib/room-participant-resolver");
    participant = await resolveRoomParticipantFromBody(
      body as Record<string, unknown>,
      sessionId,
    );
    if (participant) {
      // Check if user is event host (can manage even without FACILITATOR participant type)
      const session = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { event: { select: { hostUserId: true } } },
      });
      isEventHostOwner = session?.event?.hostUserId === user.id;
    }
  }

  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const isFacilitatorType = participant.type === ParticipantType.FACILITATOR;
  if (!isFacilitatorType && !isEventHostOwner && !adminUser) {
    return NextResponse.json(
      { error: "Only facilitators can share AI analysis." },
      { status: 403 },
    );
  }

  const aiAnalysis = await prisma.aiAnalysis.findUnique({
    where: { sessionId },
    select: {
      id: true,
      status: true,
      analysisJson: true,
      executiveSummary: true,
      visibility: true,
    },
  });

  if (!aiAnalysis) {
    return NextResponse.json({ error: "AI analysis not found." }, { status: 404 });
  }

  if (aiAnalysisId && aiAnalysis.id !== aiAnalysisId) {
    return NextResponse.json({ error: "AI analysis ID mismatch." }, { status: 400 });
  }

  if (aiAnalysis.status !== AiAnalysisStatus.COMPLETED) {
    return NextResponse.json(
      { error: "AI analysis must be completed before sharing." },
      { status: 409 },
    );
  }

  const fullAnalysis = aiAnalysis.analysisJson as NegotiationAnalysisOutput | null;
  const sanitized = fullAnalysis ? sanitizeAnalysisForParticipants(fullAnalysis) : null;

  const updated = await prisma.aiAnalysis.update({
    where: { id: aiAnalysis.id },
    data: {
      visibility: "SHARED_WITH_SESSION",
      sharedAnalysisJson: sanitized ?? undefined,
      sharedExecutiveSummary: aiAnalysis.executiveSummary,
      sharedAt: new Date(),
      sharedBy: participant.displayName,
      unsharedAt: null,
    },
    select: {
      id: true,
      visibility: true,
      sharedAt: true,
      sharedBy: true,
    },
  });

  return NextResponse.json({
    success: true,
    visibility: updated.visibility,
    sharedAt: updated.sharedAt?.toISOString() ?? null,
    sharedBy: updated.sharedBy,
  });
}
