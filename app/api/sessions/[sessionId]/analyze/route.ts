import { after, NextResponse } from "next/server";
import { z } from "zod";

import {
  AiAnalysisStatus,
  ExternalService,
  ExternalServiceErrorCode,
  ExternalServiceEventSeverity,
  ParticipantType,
  Prisma,
} from "@/app/generated/prisma/client";
import { MATERIAL_INPUT_SCHEMA_VERSION } from "@/lib/ai/material-input-envelope";
import {
  buildAnalysisPrompt,
  buildSessionAnalysisContext,
  fingerprintSessionAnalysisContext,
  type SessionAnalysisContext,
} from "@/lib/ai/session-analysis-context";
import { buildBoundedAiAnalysisLogPayload } from "@/lib/ai/analysis-failure-diagnostics";
import {
  AiAnalysisProviderError,
  bindParticipantPersonalFeedback,
  canRecoverProviderResponseAfterFailure,
  classifyAiAnalysisError,
  createMockAnalysisOutput,
  isAiAnalysisConfiguredForSelectedProvider,
  runNegotiationAnalysis,
  type AiAnalysisErrorCode,
} from "@/lib/ai/negotiation-analysis";
import { evaluateAiAnalysisReadiness } from "@/lib/ai/analysis-readiness";
import { ENHANCEMENT_RUNNING_AI_LOCK_MESSAGE } from "@/lib/transcription/processing-metadata";
import { isAuthoritativeEnhancementLockActive } from "@/lib/services/transcript-enhancement-timeout";
import {
  claimAiAnalysisRun,
  completeAiAnalysisRunWithCurrentParticipants,
  failAiAnalysisRun,
  persistAiAnalysisProviderResponseId,
  renewAiAnalysisLease,
  startAiAnalysisRun,
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
import { shouldConfirmAutoSuggestedMappingAfterAiAdmission } from "@/lib/transcription/confirm-mapping-after-ai-admission";

export const runtime = "nodejs";
export const maxDuration = 610;

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

  const [transcript, sessionParticipants] = await Promise.all([
    prisma.transcript.findUnique({
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
        processingMetadata: true,
        retranscribeCount: true,
        segments: {
          select: {
            speakerLabel: true,
            mappedParticipantId: true,
            text: true,
          },
        },
      },
    }),
    prisma.sessionParticipant.findMany({
      where: { sessionId },
      select: { id: true, type: true },
    }),
  ]);

  if (!transcript) {
    return NextResponse.json(
      { error: "Transcript must be completed before running AI analysis." },
      { status: 400 },
    );
  }
  const enhancementLockActive = await isAuthoritativeEnhancementLockActive({
    transcriptId: transcript.id,
  });
  if (enhancementLockActive) {
    return NextResponse.json(
      {
        error: ENHANCEMENT_RUNNING_AI_LOCK_MESSAGE,
        errorCode: "ENHANCEMENT_RUNNING",
      },
      { status: 409 },
    );
  }

  const readiness = evaluateAiAnalysisReadiness({
    ...transcript,
    participants: sessionParticipants,
    enhancementStatus: enhancementLockActive ? "IN_PROGRESS" : null,
  });
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

  if (readiness.reason === "ENHANCEMENT_RUNNING") {
    return NextResponse.json(
      {
        error: ENHANCEMENT_RUNNING_AI_LOCK_MESSAGE,
        errorCode: "ENHANCEMENT_RUNNING",
      },
      { status: 409 },
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

  const analysisContext = await buildSessionAnalysisContext(sessionId);
  if (!analysisContext) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  const inputFingerprint = fingerprintSessionAnalysisContext(analysisContext);
  console.info("[AI analysis] material_input_fingerprint", {
    sessionId,
    schemaVersion: MATERIAL_INPUT_SCHEMA_VERSION,
    inputFingerprint,
  });

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

  if (
    shouldConfirmAutoSuggestedMappingAfterAiAdmission({
      speakerMappingStatus: transcript.speakerMappingStatus,
      hasSpeakerDiarization: transcript.hasSpeakerDiarization,
      segments: transcript.segments,
      participants: sessionParticipants,
    })
  ) {
    await prisma.transcript.update({
      where: { id: transcript.id },
      data: {
        speakerMappingStatus: "CONFIRMED",
        speakerMappingConfirmedAt: now,
        speakerMappingConfirmedBy: participant.id,
      },
    });
  }

  await prisma.aiAnalysis.update({
    where: { id: claimedRun.owner.analysisId },
    data: { inputFingerprint },
  });

  const mockMode = isAiAnalysisMockMode();
  const simulatedError = mockMode ? getMockExternalServiceError() : null;
  after(async () => {
    let owner = claimedRun.owner;
    try {
      const startedOwner = await startAiAnalysisRun({ owner });
      if (!startedOwner) return;
      owner = startedOwner;
      if (mockMode) {
        await processMockAnalysis(
          sessionId,
          owner,
          analysisLanguage,
          simulatedError,
        );
      } else {
        await processRealAnalysis(
          sessionId,
          owner,
          analysisLanguage,
          operationStartedAtMonotonic,
          analysisContext,
        );
      }
    } catch (error) {
      console.error("[AI analysis] detached execution failed", {
        sessionId,
        analysisId: owner.analysisId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  });

  return NextResponse.json(
    {
      analysisId: claimedRun.owner.analysisId,
      status: AiAnalysisStatus.QUEUED,
    },
    { status: 202 },
  );
}

async function processMockAnalysis(
  sessionId: string,
  owner: AiAnalysisRunOwner,
  language: string,
  simulatedError: string | null,
) {
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
      return;
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
    return;
  }

  const mockOutput = createMockAnalysisOutput(language);
  if (simulatedError === "AI_ANALYSIS_HOLD") {
    // Test-only hold used to exercise durable queued/analyzing UI and refresh.
    await new Promise((resolve) => setTimeout(resolve, 6_000));
  }
  const completedAt = new Date();
  const terminalized = await completeAiAnalysisRunWithCurrentParticipants({
    sessionId,
    owner,
    completedAt,
    buildFields: (currentParticipants) => {
      const boundMockOutput = bindParticipantPersonalFeedback(
        mockOutput,
        currentParticipants,
      );
      return {
        model: "mock-analysis",
        executiveSummary: boundMockOutput.executiveSummary,
        overallScore: boundMockOutput.overallScore,
        analysisJson: boundMockOutput as Prisma.InputJsonValue,
        rawModelOutput: { mock: true },
      };
    },
  });
  if (!terminalized) {
    return;
  }
}

async function processRealAnalysis(
  sessionId: string,
  initialOwner: AiAnalysisRunOwner,
  language: string,
  operationStartedAtMonotonic: number,
  analysisContext: SessionAnalysisContext,
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
      const prompt = buildAnalysisPrompt(analysisContext);
      return runNegotiationAnalysis(prompt, language, {
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
      if (!(await renewLease("before_success_terminalization"))) {
        return false;
      }
      completion.completedAt = new Date();
      return completeAiAnalysisRunWithCurrentParticipants({
        sessionId,
        owner,
        completedAt: completion.completedAt,
        buildFields: (currentParticipants) => {
          const boundOutput = bindParticipantPersonalFeedback(
            output,
            currentParticipants,
          );
          return {
            model,
            executiveSummary: boundOutput.executiveSummary,
            overallScore: boundOutput.overallScore,
            analysisJson: boundOutput as Prisma.InputJsonValue,
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
          };
        },
      });
    },
    fail: (failure: OwnedAnalysisFailure) =>
      failAiAnalysisRun({
        owner,
        errorMessage: failure.userMessage,
        clearProviderResponseId: !canRecoverProviderResponseAfterFailure(
          classifyAiAnalysisError(failure.originalError).code,
        ),
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
        rawError: buildBoundedAiAnalysisLogPayload({
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
    return;
  }
  if (result.state === "failed") {
    return;
  }
}
