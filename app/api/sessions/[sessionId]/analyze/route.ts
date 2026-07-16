import { NextResponse } from "next/server";
import { z } from "zod";

import { ParticipantType } from "@/app/generated/prisma/client";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { getAiAnalysisProvider } from "@/lib/env";
import { requestSessionAiAnalysis } from "@/lib/services/ai-analysis-orchestration";

export const runtime = "nodejs";

const schema = z.object({
  joinToken: z.string().trim().min(1).optional(),
  participantId: z.string().trim().min(1).optional(),
  language: z.string().optional(),
  // Caller must explicitly confirm AI processing consent in UI.
  aiProcessingConfirmed: z.boolean().optional(),
}).refine(
  (data) => Boolean(data.joinToken || data.participantId),
  { message: "joinToken or participantId is required." },
);

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  const { language, aiProcessingConfirmed } = parsed.data;

  if (!aiProcessingConfirmed) {
    return NextResponse.json(
      { error: "aiProcessingConfirmed is required to run AI analysis." },
      { status: 400 },
    );
  }

  let adminUser = false;
  let isEventHostOwner = false;
  if (parsed.data.participantId) {
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

  const participant = await resolveRoomParticipantFromParsedBody(parsed.data, sessionId);
  if (!participant) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (participant.type !== ParticipantType.FACILITATOR && !adminUser && !isEventHostOwner) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true, snapshotCaseLanguage: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const requested = await requestSessionAiAnalysis({
    sessionId,
    language,
    triggerSource: "manual",
    runInBackground: false,
    forceRerun: true,
  });

  if (requested.outcome === "provider_not_configured") {
    const provider = getAiAnalysisProvider();
    return NextResponse.json(
      {
        error:
          provider === "yandex"
            ? "Yandex AI configuration is missing."
            : "OpenAI API key is missing.",
      },
      { status: 503 },
    );
  }
  if (requested.outcome === "session_not_found") {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  if (requested.outcome === "transcript_not_ready") {
    return NextResponse.json(
      { error: "Transcript must be completed before running AI analysis." },
      { status: 400 },
    );
  }
  if (requested.outcome === "speaker_mapping_required") {
    return NextResponse.json(
      {
        error: "Confirm speaker mapping before AI analysis.",
        errorCode: "SPEAKER_MAPPING_REQUIRED",
        speakerMappingStatus: requested.speakerMappingStatus,
      },
      { status: 422 },
    );
  }
  if (requested.outcome === "already_running") {
    return NextResponse.json(
      {
        error: "An AI analysis is already in progress.",
        analysisId: requested.analysisId,
        status: requested.status,
      },
      { status: 409 },
    );
  }
  if (requested.outcome === "already_completed") {
    return NextResponse.json(
      {
        analysisId: requested.analysisId,
        status: requested.status,
        reused: true,
      },
      { status: 200 },
    );
  }
  if (requested.outcome === "already_failed") {
    return NextResponse.json(
      {
        error: "Previous AI analysis failed. Retry manually.",
        analysisId: requested.analysisId,
        status: requested.status,
      },
      { status: 409 },
    );
  }

  const analysis = await prisma.aiAnalysis.findUnique({
    where: { id: requested.analysisId },
    select: {
      id: true,
      status: true,
      executiveSummary: true,
      overallScore: true,
      completedAt: true,
      errorMessage: true,
    },
  });

  if (!analysis) {
    return NextResponse.json({ error: "AI analysis failed." }, { status: 500 });
  }
  if (analysis.status === "FAILED") {
    return NextResponse.json(
      { error: analysis.errorMessage ?? "AI analysis failed." },
      { status: 500 },
    );
  }
  return NextResponse.json({
    analysisId: analysis.id,
    status: analysis.status,
    executiveSummary: analysis.executiveSummary,
    overallScore: analysis.overallScore,
    completedAt: analysis.completedAt?.toISOString() ?? null,
  });
}
