import { NextResponse } from "next/server";

import { AiAnalysisStatus, ParticipantType } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getSessionParticipantByJoinToken } from "@/lib/session-participant-auth";
import type { NegotiationAnalysisOutput } from "@/lib/ai/negotiation-analysis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

/**
 * Deterministic sanitizer: strips private role objectives and hidden/fallback
 * references from the full analysis JSON, producing a safe shared version.
 */
function sanitizeAnalysisForParticipants(
  analysis: NegotiationAnalysisOutput,
): NegotiationAnalysisOutput {
  return {
    ...analysis,
    // Remove per-role objectives analysis which contains private objective data
    roleObjectivesAnalysis: [],
    // Keep participantPersonalFeedback — per-participant filtering (each participant
    // sees only their own entry) is applied at delivery time in the status API.
    // Keep everything else: summary, scores, strengths, improvement areas,
    // tactics, questions analysis, listening, value creation, focus, debrief Qs.
  };
}

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: { joinToken?: string; aiAnalysisId?: string };
  try {
    body = (await request.json()) as { joinToken?: string; aiAnalysisId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { joinToken, aiAnalysisId } = body;

  if (!joinToken) {
    return NextResponse.json({ error: "joinToken is required." }, { status: 400 });
  }

  const participant = await getSessionParticipantByJoinToken(joinToken, sessionId);
  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  if (participant.type !== ParticipantType.FACILITATOR) {
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
