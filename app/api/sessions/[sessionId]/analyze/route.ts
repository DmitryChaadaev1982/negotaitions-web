import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AiAnalysisStatus,
  ExternalService,
  ExternalServiceErrorCode,
  ExternalServiceEventSeverity,
  ParticipantType,
  Prisma,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import {
  buildAnalysisPrompt,
  buildSessionAnalysisContext,
} from "@/lib/ai/session-analysis-context";
import {
  classifyAiAnalysisError,
  createMockAnalysisOutput,
  isAiAnalysisConfiguredForSelectedProvider,
  runNegotiationAnalysis,
  type AiAnalysisErrorCode,
  type AiAnalysisRunMetrics,
} from "@/lib/ai/negotiation-analysis";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";
import {
  getMockExternalServiceError,
  isAiAnalysisMockMode,
} from "@/lib/test-mode";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";
import { getAiAnalysisProvider } from "@/lib/env";

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

type ClaimedAnalysisRun =
  | {
      state: "claimed";
      analysis: {
        id: string;
        status: AiAnalysisStatus;
      };
    }
  | {
      state: "active";
      analysis: {
        id: string;
        status: AiAnalysisStatus;
      };
    };

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

async function claimAiAnalysisRun(params: {
  sessionId: string;
  transcriptId: string;
  transcriptRetranscribeCount: number;
  language: string;
  now: Date;
}): Promise<ClaimedAnalysisRun> {
  const existing = await prisma.aiAnalysis.findUnique({
    where: { sessionId: params.sessionId },
    select: { id: true, status: true },
  });

  if (existing && ACTIVE_AI_STATUSES.has(existing.status)) {
    return { state: "active", analysis: existing };
  }

  const claimExisting = async (analysisId: string) => {
    const claimed = await prisma.aiAnalysis.updateMany({
      where: {
        id: analysisId,
        status: { notIn: [AiAnalysisStatus.QUEUED, AiAnalysisStatus.ANALYZING] },
      },
      data: {
        transcriptId: params.transcriptId,
        transcriptRetranscribeCount: params.transcriptRetranscribeCount,
        status: AiAnalysisStatus.ANALYZING,
        language: params.language,
        startedAt: params.now,
        completedAt: null,
        errorMessage: null,
      },
    });
    if (claimed.count === 0) {
      const active = await prisma.aiAnalysis.findUniqueOrThrow({
        where: { id: analysisId },
        select: { id: true, status: true },
      });
      return { state: "active", analysis: active } satisfies ClaimedAnalysisRun;
    }
    const analysis = await prisma.aiAnalysis.findUniqueOrThrow({
      where: { id: analysisId },
      select: { id: true, status: true },
    });
    return { state: "claimed", analysis } satisfies ClaimedAnalysisRun;
  };

  if (existing) {
    return claimExisting(existing.id);
  }

  try {
    const analysis = await prisma.aiAnalysis.create({
      data: {
        sessionId: params.sessionId,
        transcriptId: params.transcriptId,
        transcriptRetranscribeCount: params.transcriptRetranscribeCount,
        status: AiAnalysisStatus.ANALYZING,
        language: params.language,
        startedAt: params.now,
        errorMessage: null,
      },
      select: { id: true, status: true },
    });
    return { state: "claimed", analysis };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const raced = await prisma.aiAnalysis.findUniqueOrThrow({
      where: { sessionId: params.sessionId },
      select: { id: true, status: true },
    });
    if (ACTIVE_AI_STATUSES.has(raced.status)) {
      return { state: "active", analysis: raced };
    }
    return claimExisting(raced.id);
  }
}

function mapAiAnalysisErrorCodeToExternalServiceCode(
  code: AiAnalysisErrorCode,
): ExternalServiceErrorCode {
  switch (code) {
    case "CONFIG_MISSING":
      return ExternalServiceErrorCode.CONFIG_MISSING;
    case "NETWORK_TIMEOUT":
    case "NETWORK_ERROR":
      return ExternalServiceErrorCode.NETWORK_ERROR;
    case "PROVIDER_RATE_LIMIT":
      return ExternalServiceErrorCode.RATE_LIMIT;
    default:
      return ExternalServiceErrorCode.UNKNOWN;
  }
}

function buildAiAnalysisLogPayload(params: {
  errorClass: AiAnalysisErrorCode;
  provider: string;
  model: string | null;
  httpStatus: number | null;
  retryable: boolean;
  metrics?: AiAnalysisRunMetrics;
  diagnostics: Record<string, unknown>;
}) {
  return {
    errorClass: params.errorClass,
    provider: params.provider,
    model: params.model,
    httpStatus: params.httpStatus,
    retryable: params.retryable,
    diagnostics: params.diagnostics,
    metrics: params.metrics
      ? {
          totalDurationMs: params.metrics.totalDurationMs,
          promptChars: params.metrics.promptChars,
          estimatedInputTokens: params.metrics.estimatedInputTokens,
          modelCallCount: params.metrics.modelCallCount,
          retryCount: params.metrics.retryCount,
          maxAttempts: params.metrics.maxAttempts,
          timeoutMs: params.metrics.timeoutMs,
          responseLength: params.metrics.responseLength,
          outputChars: params.metrics.outputChars,
          calls: params.metrics.calls.map((call) => ({
            attemptNumber: call.attemptNumber,
            callNumber: call.callNumber,
            purpose: call.purpose,
            model: call.model,
            durationMs: call.durationMs,
            promptChars: call.promptChars,
            estimatedInputTokens: call.estimatedInputTokens,
            maxOutputTokens: call.maxOutputTokens,
            responseLength: call.responseLength,
            httpStatus: call.httpStatus,
            providerStatus: call.providerStatus,
            responseIdPresent: call.responseIdPresent,
            pollingAttemptCount: call.pollingAttemptCount,
            errorClass: call.errorClass,
          })),
        }
      : null,
  };
}

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

  if (!isAiAnalysisMockMode() && !isAiAnalysisConfiguredForSelectedProvider()) {
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

  const claimedRun = await claimAiAnalysisRun({
    sessionId,
    transcriptId: transcript.id,
    transcriptRetranscribeCount: transcript.retranscribeCount ?? 0,
    language: analysisLanguage,
    now,
  });

  if (claimedRun.state === "active") {
    return NextResponse.json(
      {
        error: "An AI analysis is already in progress.",
        analysisId: claimedRun.analysis.id,
        status: claimedRun.analysis.status,
      },
      { status: 409 },
    );
  }

  if (isAiAnalysisMockMode()) {
    return await processMockAnalysis(sessionId, claimedRun.analysis.id, analysisLanguage);
  }

  return await processRealAnalysis(sessionId, claimedRun.analysis.id, analysisLanguage);
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
  const provider = getAiAnalysisProvider();
  try {
    const analysisContext = await buildSessionAnalysisContext(sessionId);
    if (!analysisContext) {
      await failAnalysis(analysisId, "Session not found during analysis.");
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const prompt = buildAnalysisPrompt(analysisContext);

    const { output, rawOutput, model, metrics } = await runNegotiationAnalysis(
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
        analysisJson: output as Prisma.InputJsonValue,
        rawModelOutput: {
          providerEnvelope: rawOutput as Prisma.InputJsonValue,
          diagnostics: {
            totalDurationMs: metrics.totalDurationMs,
            promptChars: metrics.promptChars,
            estimatedInputTokens: metrics.estimatedInputTokens,
            modelCallCount: metrics.modelCallCount,
            retryCount: metrics.retryCount,
            responseLength: metrics.responseLength,
            outputChars: metrics.outputChars,
          },
        } as Prisma.InputJsonValue,
        completedAt: new Date(),
        errorMessage: null,
      },
    });

    console.info("[AI analysis] completed", {
      sessionId,
      analysisId,
      provider,
      model,
      durationMs: metrics.totalDurationMs,
      promptChars: metrics.promptChars,
      estimatedInputTokens: metrics.estimatedInputTokens,
      modelCallCount: metrics.modelCallCount,
      retryCount: metrics.retryCount,
      responseLength: metrics.responseLength,
      outputChars: metrics.outputChars,
      finalStatus: saved.status,
    });

    return NextResponse.json({
      analysisId: saved.id,
      status: saved.status,
      executiveSummary: saved.executiveSummary,
      overallScore: saved.overallScore,
      completedAt: saved.completedAt?.toISOString() ?? null,
    });
  } catch (error) {
    const classifiedAiError = classifyAiAnalysisError(error);
    const userMessage = classifiedAiError.userMessage;
    const detailedMessage =
      error instanceof Error ? error.message : "AI analysis failed.";

    await logExternalServiceEvent({
      service: provider === "yandex" ? ExternalService.APP : ExternalService.OPENAI,
      severity: ExternalServiceEventSeverity.ERROR,
      errorCode: mapAiAnalysisErrorCodeToExternalServiceCode(classifiedAiError.code),
      title: `AI analysis failed: ${classifiedAiError.code}`,
      message: userMessage,
      rawError: buildAiAnalysisLogPayload({
        errorClass: classifiedAiError.code,
        provider,
        model: classifiedAiError.model,
        httpStatus: classifiedAiError.httpStatus,
        retryable: classifiedAiError.retryable,
        metrics: classifiedAiError.metrics,
        diagnostics: {
          ...classifiedAiError.diagnostics,
          detail: detailedMessage,
        },
      }),
      sessionId,
    });

    await failAnalysis(analysisId, userMessage);

    return NextResponse.json(
      { error: userMessage, errorClass: classifiedAiError.code },
      { status: 500 },
    );
  }
}
