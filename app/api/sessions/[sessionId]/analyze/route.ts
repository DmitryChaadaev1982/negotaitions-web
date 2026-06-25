import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AiAnalysisStatus,
  ExternalService,
  ExternalServiceErrorCode,
  ExternalServiceEventSeverity,
  ParticipantType,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import {
  buildAnalysisPrompt,
  buildSessionAnalysisContext,
} from "@/lib/ai/session-analysis-context";
import {
  createMockAnalysisOutput,
  isOpenAiConfiguredForAnalysis,
  runNegotiationAnalysis,
} from "@/lib/ai/negotiation-analysis";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { classifyExternalServiceError } from "@/lib/services/error-classifier";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";
import {
  getMockExternalServiceError,
  isAiAnalysisMockMode,
} from "@/lib/test-mode";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";

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

const ACTIVE_AI_STATUSES = new Set<AiAnalysisStatus>([
  AiAnalysisStatus.QUEUED,
  AiAnalysisStatus.ANALYZING,
]);

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

  if (!isAiAnalysisMockMode() && !isOpenAiConfiguredForAnalysis()) {
    return NextResponse.json(
      { error: "OpenAI API key is missing." },
      { status: 503 },
    );
  }

  const transcript = await prisma.transcript.findUnique({
    where: { sessionId },
    select: {
      id: true,
      status: true,
      language: true,
      hasSpeakerDiarization: true,
      speakerMappingStatus: true,
      speakerMapping: true,
      retranscribeCount: true,
      segments: {
        select: {
          speakerLabel: true,
          mappedParticipantId: true,
          text: true,
        },
      },
    },
  });

  if (!transcript || transcript.status !== TranscriptStatus.COMPLETED) {
    return NextResponse.json(
      { error: "Transcript must be completed before running AI analysis." },
      { status: 400 },
    );
  }

  if (transcript.hasSpeakerDiarization && !isSpeakerMappingReadyForAnalysis(transcript)) {
    return NextResponse.json(
      {
        error: "Confirm speaker mapping before AI analysis.",
        errorCode: "SPEAKER_MAPPING_REQUIRED",
        speakerMappingStatus: transcript.speakerMappingStatus,
      },
      { status: 422 },
    );
  }

  const existingAnalysis = await prisma.aiAnalysis.findUnique({
    where: { sessionId },
    select: { id: true, status: true },
  });

  if (existingAnalysis && ACTIVE_AI_STATUSES.has(existingAnalysis.status)) {
    return NextResponse.json(
      {
        error: "An AI analysis is already in progress.",
        analysisId: existingAnalysis.id,
        status: existingAnalysis.status,
      },
      { status: 409 },
    );
  }

  const analysisLanguage =
    language ?? transcript.language ?? session.snapshotCaseLanguage.toLowerCase();

  const now = new Date();

  const analysis = await prisma.aiAnalysis.upsert({
    where: { sessionId },
    create: {
      sessionId,
      transcriptId: transcript.id,
      transcriptRetranscribeCount: transcript.retranscribeCount ?? 0,
      status: AiAnalysisStatus.QUEUED,
      language: analysisLanguage,
      startedAt: now,
      errorMessage: null,
    },
    update: {
      transcriptId: transcript.id,
      transcriptRetranscribeCount: transcript.retranscribeCount ?? 0,
      status: AiAnalysisStatus.QUEUED,
      language: analysisLanguage,
      startedAt: now,
      completedAt: null,
      errorMessage: null,
    },
  });

  await prisma.aiAnalysis.update({
    where: { id: analysis.id },
    data: { status: AiAnalysisStatus.ANALYZING },
  });

  if (isAiAnalysisMockMode()) {
    return await processMockAnalysis(sessionId, analysis.id, analysisLanguage);
  }

  return await processRealAnalysis(sessionId, analysis.id, analysisLanguage);
}

async function failAnalysis(
  analysisId: string,
  errorMessage: string,
): Promise<void> {
  await prisma.aiAnalysis.update({
    where: { id: analysisId },
    data: {
      status: AiAnalysisStatus.FAILED,
      errorMessage,
      completedAt: new Date(),
    },
  });
}

async function processMockAnalysis(
  sessionId: string,
  analysisId: string,
  language: string,
) {
  const simulatedError = getMockExternalServiceError();

  if (
    simulatedError === "OPENAI_AI_ANALYSIS_FAILED" ||
    simulatedError === "OPENAI_QUOTA_EXCEEDED" ||
    simulatedError === "OPENAI_BILLING_LIMIT" ||
    simulatedError === "OPENAI_RATE_LIMIT"
  ) {
    const errorMsg =
      simulatedError === "OPENAI_RATE_LIMIT"
        ? "OpenAI rate limit reached. Try again later."
        : simulatedError === "OPENAI_BILLING_LIMIT"
          ? "OpenAI billing or payment limit may have been reached."
          : simulatedError === "OPENAI_AI_ANALYSIS_FAILED"
            ? "Mock AI analysis failure for testing."
            : "OpenAI quota or billing limit may have been reached.";

    const errorCode =
      simulatedError === "OPENAI_RATE_LIMIT"
        ? ExternalServiceErrorCode.RATE_LIMIT
        : simulatedError === "OPENAI_BILLING_LIMIT"
          ? ExternalServiceErrorCode.BILLING_LIMIT
          : ExternalServiceErrorCode.QUOTA_EXCEEDED;

    await logExternalServiceEvent({
      service: ExternalService.OPENAI,
      severity: ExternalServiceEventSeverity.ERROR,
      errorCode,
      title: "AI analysis failed (mock)",
      message: errorMsg,
      sessionId,
    });

    await failAnalysis(analysisId, errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }

  const mockOutput = createMockAnalysisOutput(language);

  const saved = await prisma.aiAnalysis.update({
    where: { id: analysisId },
    data: {
      status: AiAnalysisStatus.COMPLETED,
      model: "mock-analysis",
      executiveSummary: mockOutput.executiveSummary,
      overallScore: mockOutput.overallScore,
      analysisJson: mockOutput as object,
      rawModelOutput: { mock: true },
      completedAt: new Date(),
      errorMessage: null,
    },
  });

  return NextResponse.json({
    analysisId: saved.id,
    status: saved.status,
    executiveSummary: saved.executiveSummary,
    overallScore: saved.overallScore,
    completedAt: saved.completedAt?.toISOString() ?? null,
  });
}

async function processRealAnalysis(
  sessionId: string,
  analysisId: string,
  language: string,
) {
  try {
    const analysisContext = await buildSessionAnalysisContext(sessionId);
    if (!analysisContext) {
      await failAnalysis(analysisId, "Session not found during analysis.");
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const prompt = buildAnalysisPrompt(analysisContext);

    const { output, rawOutput, model } = await runNegotiationAnalysis(
      prompt,
      language,
    );

    const saved = await prisma.aiAnalysis.update({
      where: { id: analysisId },
      data: {
        status: AiAnalysisStatus.COMPLETED,
        model,
        executiveSummary: output.executiveSummary,
        overallScore: output.overallScore,
        analysisJson: output as object,
        rawModelOutput: rawOutput as object,
        completedAt: new Date(),
        errorMessage: null,
      },
    });

    return NextResponse.json({
      analysisId: saved.id,
      status: saved.status,
      executiveSummary: saved.executiveSummary,
      overallScore: saved.overallScore,
      completedAt: saved.completedAt?.toISOString() ?? null,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "AI analysis failed.";

    const classified = classifyExternalServiceError(
      ExternalService.OPENAI,
      error,
      "ai_analysis",
    );

    const isJsonValidationError =
      errorMessage.includes("schema validation") ||
      errorMessage.includes("non-JSON response");

    await logExternalServiceEvent({
      service: ExternalService.OPENAI,
      severity: ExternalServiceEventSeverity.ERROR,
      errorCode: isJsonValidationError
        ? ExternalServiceErrorCode.UNKNOWN
        : classified.errorCode,
      title: isJsonValidationError
        ? "AI analysis: invalid model response"
        : "AI analysis failed",
      message: errorMessage,
      rawError: isJsonValidationError ? { validationError: errorMessage } : classified.rawError,
      sessionId,
    });

    await failAnalysis(analysisId, errorMessage);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
