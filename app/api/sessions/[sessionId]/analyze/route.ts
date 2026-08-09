import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AiAnalysisStatus,
  ExternalService,
  ExternalServiceErrorCode,
  ExternalServiceEventSeverity,
  ParticipantType,
  Prisma,
} from "@/app/generated/prisma/client";
import {
  buildAnalysisPrompt,
  buildSessionAnalysisContext,
} from "@/lib/ai/session-analysis-context";
import {
  AiAnalysisProviderError,
  classifyAiAnalysisError,
  createMockAnalysisOutput,
  isAiAnalysisConfiguredForSelectedProvider,
  runNegotiationAnalysis,
  type AiAnalysisErrorCode,
  type AiAnalysisRunMetrics,
} from "@/lib/ai/negotiation-analysis";
import { evaluateAiAnalysisReadiness } from "@/lib/ai/analysis-readiness";
import {
  claimAiAnalysisRun,
  completeAiAnalysisRun,
  failAiAnalysisRun,
  persistAiAnalysisProviderResponseId,
  renewAiAnalysisLease,
  type AiAnalysisRunOwner,
} from "@/lib/ai/analysis-operation";
import {
  executeOwnedAnalysis,
  type OwnedAnalysisFailure,
} from "@/lib/ai/analysis-orchestration";
import { getOptionalCurrentUser } from "@/lib/auth";
import { isAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/prisma";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";
import {
  getMockExternalServiceError,
  isAiAnalysisMockMode,
} from "@/lib/test-mode";
import { resolveRoomParticipantFromParsedBody } from "@/lib/room-participant-resolver";
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
          preProviderDurationMs: params.metrics.preProviderDurationMs,
          generationPostDurationMs:
            params.metrics.generationPostDurationMs,
          pollingDurationMs: params.metrics.pollingDurationMs,
          parsingValidationDurationMs:
            params.metrics.parsingValidationDurationMs,
          optionalDepthDurationMs: params.metrics.optionalDepthDurationMs,
          promptChars: params.metrics.promptChars,
          estimatedPromptTokens: params.metrics.estimatedPromptTokens,
          instructionChars: params.metrics.instructionChars,
          inputChars: params.metrics.inputChars,
          estimatedInputTokens: params.metrics.estimatedInputTokens,
          outputSchemaInstructionChars:
            params.metrics.outputSchemaInstructionChars,
          primaryMaxOutputTokensConfigured:
            params.metrics.primaryMaxOutputTokensConfigured,
          operationAttemptCount: params.metrics.operationAttemptCount,
          outerRetryCount: params.metrics.outerRetryCount,
          maxOperationAttempts: params.metrics.maxOperationAttempts,
          generationCallCount: params.metrics.generationCallCount,
          compactFallbackCount: params.metrics.compactFallbackCount,
          optionalDepthCallCount: params.metrics.optionalDepthCallCount,
          pollingRequestCount: params.metrics.pollingRequestCount,
          retrievalRetryCount: params.metrics.retrievalRetryCount,
          operationTimeoutMs: params.metrics.operationTimeoutMs,
          httpTimeoutMs: params.metrics.httpTimeoutMs,
          responsePollTimeoutMs: params.metrics.responsePollTimeoutMs,
          optionalDepthOutcome: params.metrics.optionalDepthOutcome,
          optionalDepthFailureClass:
            params.metrics.optionalDepthFailureClass,
          responseLength: params.metrics.responseLength,
          outputChars: params.metrics.outputChars,
          calls: params.metrics.calls.map((call) => ({
            operationAttemptNumber: call.operationAttemptNumber,
            generationCallNumber: call.generationCallNumber,
            purpose: call.purpose,
            model: call.model,
            durationMs: call.durationMs,
            generationPostDurationMs: call.generationPostDurationMs,
            pollingDurationMs: call.pollingDurationMs,
            promptChars: call.promptChars,
            instructionChars: call.instructionChars,
            inputChars: call.inputChars,
            estimatedInputTokens: call.estimatedInputTokens,
            maxOutputTokens: call.maxOutputTokens,
            responseLength: call.responseLength,
            httpStatus: call.httpStatus,
            providerStatus: call.providerStatus,
            responseIdPresent: call.responseIdPresent,
            pollingRequestCount: call.pollingRequestCount,
            retrievalRetryCount: call.retrievalRetryCount,
            errorClass: call.errorClass,
          })),
        }
      : null,
  };
}

export async function POST(request: Request, context: RouteContext) {
  const operationStartedAtMonotonic = performance.now();
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
      text: true,
      diarizedText: true,
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

  if (!transcript) {
    return NextResponse.json(
      { error: "Transcript must be completed before running AI analysis." },
      { status: 400 },
    );
  }
  const readiness = evaluateAiAnalysisReadiness(transcript);
  if (readiness.reason === "TRANSCRIPT_NOT_COMPLETED") {
    return NextResponse.json(
      { error: "Transcript must be completed before running AI analysis." },
      { status: 400 },
    );
  }

  if (readiness.reason === "TRANSCRIPT_CONTENT_EMPTY") {
    return NextResponse.json(
      {
        error: "Transcript must contain usable text before running AI analysis.",
        errorCode: "TRANSCRIPT_CONTENT_EMPTY",
      },
      { status: 422 },
    );
  }

  if (readiness.reason === "SPEAKER_MAPPING_REQUIRED") {
    return NextResponse.json(
      {
        error: "Confirm speaker mapping before AI analysis.",
        errorCode: "SPEAKER_MAPPING_REQUIRED",
        speakerMappingStatus: transcript.speakerMappingStatus,
      },
      { status: 422 },
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
    return await processMockAnalysis(
      sessionId,
      claimedRun.owner,
      analysisLanguage,
    );
  }

  return await processRealAnalysis(
    sessionId,
    claimedRun.owner,
    analysisLanguage,
    request.signal,
    operationStartedAtMonotonic,
  );
}

async function processMockAnalysis(
  sessionId: string,
  owner: AiAnalysisRunOwner,
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

    const terminalized = await failAiAnalysisRun({
      owner,
      errorMessage: errorMsg,
    });
    if (!terminalized) {
      return NextResponse.json(
        { error: "AI analysis ownership changed." },
        { status: 409 },
      );
    }
    try {
      await logExternalServiceEvent({
        service: ExternalService.OPENAI,
        severity: ExternalServiceEventSeverity.ERROR,
        errorCode,
        title: "AI analysis failed (mock)",
        message: errorMsg,
        sessionId,
      });
    } catch {
      // The durable FAILED state is authoritative; mock logging is best-effort.
    }
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }

  const mockOutput = createMockAnalysisOutput(language);
  const completedAt = new Date();
  const terminalized = await completeAiAnalysisRun({
    owner,
    completedAt,
    fields: {
      model: "mock-analysis",
      executiveSummary: mockOutput.executiveSummary,
      overallScore: mockOutput.overallScore,
      analysisJson: mockOutput as Prisma.InputJsonValue,
      rawModelOutput: { mock: true },
    },
  });
  if (!terminalized) {
    return NextResponse.json(
      { error: "AI analysis ownership changed." },
      { status: 409 },
    );
  }

  return NextResponse.json({
    analysisId: owner.analysisId,
    status: AiAnalysisStatus.COMPLETED,
    executiveSummary: mockOutput.executiveSummary,
    overallScore: mockOutput.overallScore,
    completedAt: completedAt.toISOString(),
  });
}

async function processRealAnalysis(
  sessionId: string,
  initialOwner: AiAnalysisRunOwner,
  language: string,
  signal: AbortSignal,
  operationStartedAtMonotonic: number,
) {
  const provider = getAiAnalysisProvider();
  let owner = initialOwner;
  const completion = { completedAt: null as Date | null };

  const renewLease = async (checkpoint: string): Promise<boolean> => {
    void checkpoint;
    const renewed = await renewAiAnalysisLease({ owner });
    if (!renewed) return false;
    owner = renewed;
    return true;
  };

  const result = await executeOwnedAnalysis({
    run: async () => {
      if (!(await renewLease("before_context_load"))) {
        throw new AiAnalysisProviderError({
          code: "OWNERSHIP_LOST",
          provider,
          message: "AI analysis ownership was lost before context loading.",
          allowsRegeneration: false,
        });
      }
      const analysisContext = await buildSessionAnalysisContext(sessionId);
      if (!analysisContext) {
        throw new AiAnalysisProviderError({
          code: "INTERNAL_ERROR",
          provider,
          message: "Session not found during analysis.",
          userMessage: "Session not found.",
          allowsRegeneration: false,
        });
      }
      const prompt = buildAnalysisPrompt(analysisContext);
      return runNegotiationAnalysis(prompt, language, {
        signal,
        renewLease,
        operationStartedAtMonotonic,
        existingProviderResponseId: owner.providerResponseId,
        persistProviderResponseId: async (providerResponseId) => {
          const persisted = await persistAiAnalysisProviderResponseId({
            owner,
            providerResponseId,
          });
          if (!persisted) {
            return false;
          }
          owner = persisted;
          return true;
        },
      });
    },
    complete: async ({ output, rawOutput, model, metrics }) => {
      if (signal.aborted) {
        throw new AiAnalysisProviderError({
          code: "CANCELLED",
          provider,
          model,
          message: "AI analysis request was cancelled before terminalization.",
          diagnostics: { cancellationSource: "request" },
          allowsRegeneration: false,
        });
      }
      if (!(await renewLease("before_success_terminalization"))) {
        return false;
      }
      completion.completedAt = new Date();
      return completeAiAnalysisRun({
        owner,
        completedAt: completion.completedAt,
        fields: {
          model,
          executiveSummary: output.executiveSummary,
          overallScore: output.overallScore,
          analysisJson: output as Prisma.InputJsonValue,
          rawModelOutput: {
            providerEnvelope: rawOutput as Prisma.InputJsonValue,
            diagnostics: {
              totalDurationMs: metrics.totalDurationMs,
              preProviderDurationMs: metrics.preProviderDurationMs,
              generationPostDurationMs: metrics.generationPostDurationMs,
              pollingDurationMs: metrics.pollingDurationMs,
              parsingValidationDurationMs:
                metrics.parsingValidationDurationMs,
              optionalDepthDurationMs: metrics.optionalDepthDurationMs,
              promptChars: metrics.promptChars,
              estimatedPromptTokens: metrics.estimatedPromptTokens,
              instructionChars: metrics.instructionChars,
              inputChars: metrics.inputChars,
              estimatedInputTokens: metrics.estimatedInputTokens,
              outputSchemaInstructionChars:
                metrics.outputSchemaInstructionChars,
              primaryMaxOutputTokensConfigured:
                metrics.primaryMaxOutputTokensConfigured,
              operationAttemptCount: metrics.operationAttemptCount,
              outerRetryCount: metrics.outerRetryCount,
              generationCallCount: metrics.generationCallCount,
              compactFallbackCount: metrics.compactFallbackCount,
              optionalDepthCallCount: metrics.optionalDepthCallCount,
              pollingRequestCount: metrics.pollingRequestCount,
              retrievalRetryCount: metrics.retrievalRetryCount,
              optionalDepthOutcome: metrics.optionalDepthOutcome,
              optionalDepthFailureClass: metrics.optionalDepthFailureClass,
              responseLength: metrics.responseLength,
              outputChars: metrics.outputChars,
            },
          } as Prisma.InputJsonValue,
        },
      });
    },
    fail: (failure: OwnedAnalysisFailure) =>
      failAiAnalysisRun({
        owner,
        errorMessage: failure.userMessage,
      }),
    classifyFailure: (error) => {
      const classified = classifyAiAnalysisError(error);
      return {
        errorClass: classified.code,
        userMessage: classified.userMessage,
        originalError: error,
      };
    },
    isOwnershipLost: (error) =>
      classifyAiAnalysisError(error).code === "OWNERSHIP_LOST",
    observeSuccess: ({ model, metrics }) => {
      console.info("[AI analysis] completed", {
        sessionId,
        analysisId: owner.analysisId,
        provider,
        model,
        totalDurationMs: metrics.totalDurationMs,
        preProviderDurationMs: metrics.preProviderDurationMs,
        generationPostDurationMs: metrics.generationPostDurationMs,
        pollingDurationMs: metrics.pollingDurationMs,
        parsingValidationDurationMs: metrics.parsingValidationDurationMs,
        optionalDepthDurationMs: metrics.optionalDepthDurationMs,
        promptChars: metrics.promptChars,
        estimatedPromptTokens: metrics.estimatedPromptTokens,
        instructionChars: metrics.instructionChars,
        inputChars: metrics.inputChars,
        estimatedInputTokens: metrics.estimatedInputTokens,
        outputSchemaInstructionChars: metrics.outputSchemaInstructionChars,
        primaryMaxOutputTokensConfigured:
          metrics.primaryMaxOutputTokensConfigured,
        operationAttemptCount: metrics.operationAttemptCount,
        outerRetryCount: metrics.outerRetryCount,
        generationCallCount: metrics.generationCallCount,
        compactFallbackCount: metrics.compactFallbackCount,
        optionalDepthCallCount: metrics.optionalDepthCallCount,
        pollingRequestCount: metrics.pollingRequestCount,
        retrievalRetryCount: metrics.retrievalRetryCount,
        optionalDepthOutcome: metrics.optionalDepthOutcome,
        optionalDepthFailureClass: metrics.optionalDepthFailureClass,
        finalStatus: AiAnalysisStatus.COMPLETED,
      });
    },
    observeFailure: async (failure) => {
      const classified = classifyAiAnalysisError(failure.originalError);
      await logExternalServiceEvent({
        service:
          provider === "yandex" ? ExternalService.APP : ExternalService.OPENAI,
        severity: ExternalServiceEventSeverity.ERROR,
        errorCode: mapAiAnalysisErrorCodeToExternalServiceCode(classified.code),
        title: `AI analysis failed: ${classified.code}`,
        message: classified.userMessage,
        rawError: buildAiAnalysisLogPayload({
          errorClass: classified.code,
          provider,
          model: classified.model,
          httpStatus: classified.httpStatus,
          retryable: classified.retryable,
          metrics: classified.metrics,
          diagnostics: classified.diagnostics,
        }),
        sessionId,
      });
    },
    observeInstrumentationFailure: (phase) => {
      try {
        console.warn("[AI analysis] observability failed", {
          sessionId,
          analysisId: owner.analysisId,
          phase,
        });
      } catch {
        // Durable analysis state is already terminal.
      }
    },
  });

  if (result.state === "ownership_lost") {
    return NextResponse.json(
      {
        error: "AI analysis ownership changed.",
        errorClass: "OWNERSHIP_LOST",
      },
      { status: 409 },
    );
  }
  if (result.state === "failed") {
    return NextResponse.json(
      {
        error: result.failure.userMessage,
        errorClass: result.failure.errorClass,
      },
      { status: result.failure.errorClass === "CANCELLED" ? 499 : 500 },
    );
  }

  return NextResponse.json({
    analysisId: owner.analysisId,
    status: AiAnalysisStatus.COMPLETED,
    executiveSummary: result.value.output.executiveSummary,
    overallScore: result.value.output.overallScore,
    completedAt: completion.completedAt?.toISOString() ?? null,
  });
}
