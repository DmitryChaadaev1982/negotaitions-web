import {
  AiAnalysisStatus,
  ExternalService,
  ExternalServiceErrorCode,
  ExternalServiceEventSeverity,
  TranscriptStatus,
} from "@/app/generated/prisma/client";
import {
  buildAnalysisPrompt,
  buildSessionAnalysisContext,
} from "@/lib/ai/session-analysis-context";
import {
  createMockAnalysisOutput,
  isAiAnalysisConfiguredForSelectedProvider,
  runNegotiationAnalysis,
} from "@/lib/ai/negotiation-analysis";
import { getAiAnalysisProvider } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { classifyExternalServiceError } from "@/lib/services/error-classifier";
import { logExternalServiceEvent } from "@/lib/services/external-service-events";
import { isAiAnalysisMockMode, getMockExternalServiceError } from "@/lib/test-mode";
import { isSpeakerMappingReadyForAnalysis } from "@/lib/transcription/speaker-mapping-readiness";

const ACTIVE_AI_STATUSES = new Set<AiAnalysisStatus>([
  AiAnalysisStatus.QUEUED,
  AiAnalysisStatus.ANALYZING,
]);

export type AiAnalysisTriggerSource =
  | "manual"
  | "manual_retry"
  | "speaker_mapping_confirmed"
  | "enhancement_terminal";

export type AiAnalysisRequestResult =
  | { outcome: "started"; analysisId: string; status: AiAnalysisStatus }
  | { outcome: "already_running"; analysisId: string; status: AiAnalysisStatus }
  | { outcome: "already_completed"; analysisId: string; status: AiAnalysisStatus }
  | { outcome: "already_failed"; analysisId: string; status: AiAnalysisStatus }
  | { outcome: "session_not_found" }
  | { outcome: "provider_not_configured"; provider: "openai" | "yandex" }
  | { outcome: "transcript_not_ready" }
  | {
      outcome: "speaker_mapping_required";
      speakerMappingStatus: string | null;
    };

export function resolveExistingAiAnalysisOutcome(params: {
  existing: { id: string; status: AiAnalysisStatus } | null;
  forceRerun: boolean;
}):
  | {
      outcome: "already_running" | "already_completed" | "already_failed";
      analysisId: string;
      status: AiAnalysisStatus;
    }
  | null {
  const { existing, forceRerun } = params;
  if (!existing) return null;
  if (ACTIVE_AI_STATUSES.has(existing.status)) {
    return {
      outcome: "already_running",
      analysisId: existing.id,
      status: existing.status,
    };
  }
  if (existing.status === AiAnalysisStatus.COMPLETED && !forceRerun) {
    return {
      outcome: "already_completed",
      analysisId: existing.id,
      status: existing.status,
    };
  }
  if (existing.status === AiAnalysisStatus.FAILED && !forceRerun) {
    return {
      outcome: "already_failed",
      analysisId: existing.id,
      status: existing.status,
    };
  }
  return null;
}

export async function requestSessionAiAnalysis(params: {
  sessionId: string;
  language?: string;
  triggerSource: AiAnalysisTriggerSource;
  runInBackground: boolean;
  forceRerun?: boolean;
}): Promise<AiAnalysisRequestResult> {
  const {
    sessionId,
    language,
    runInBackground,
    forceRerun = false,
    triggerSource,
  } = params;

  if (!isAiAnalysisMockMode() && !isAiAnalysisConfiguredForSelectedProvider()) {
    return {
      outcome: "provider_not_configured",
      provider: getAiAnalysisProvider(),
    };
  }

  const session = await prisma.session.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true, snapshotCaseLanguage: true },
  });
  if (!session) {
    return { outcome: "session_not_found" };
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
    return { outcome: "transcript_not_ready" };
  }

  if (transcript.hasSpeakerDiarization && !isSpeakerMappingReadyForAnalysis(transcript)) {
    return {
      outcome: "speaker_mapping_required",
      speakerMappingStatus: transcript.speakerMappingStatus,
    };
  }

  const existing = await prisma.aiAnalysis.findUnique({
    where: { sessionId },
    select: { id: true, status: true },
  });

  const existingOutcome = resolveExistingAiAnalysisOutcome({
    existing,
    forceRerun,
  });
  if (existingOutcome) {
    return existingOutcome;
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

  const runPromise = runAiAnalysisExecution({
    sessionId,
    analysisId: analysis.id,
    language: analysisLanguage,
  });

  if (runInBackground) {
    void runPromise.catch((error) => {
      console.warn(
        `[ai-analysis] background execution failed (${triggerSource}) for session ${sessionId}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    });
  } else {
    await runPromise;
  }

  const latest = await prisma.aiAnalysis.findUnique({
    where: { id: analysis.id },
    select: { status: true },
  });

  return {
    outcome: "started",
    analysisId: analysis.id,
    status: latest?.status ?? AiAnalysisStatus.QUEUED,
  };
}

async function failAnalysis(analysisId: string, errorMessage: string): Promise<void> {
  await prisma.aiAnalysis.update({
    where: { id: analysisId },
    data: {
      status: AiAnalysisStatus.FAILED,
      errorMessage,
      completedAt: new Date(),
    },
  });
}

async function runAiAnalysisExecution(params: {
  sessionId: string;
  analysisId: string;
  language: string;
}): Promise<void> {
  const { sessionId, analysisId, language } = params;
  await prisma.aiAnalysis.update({
    where: { id: analysisId },
    data: { status: AiAnalysisStatus.ANALYZING },
  });

  if (isAiAnalysisMockMode()) {
    await processMockAnalysis(sessionId, analysisId, language);
    return;
  }
  await processRealAnalysis(sessionId, analysisId, language);
}

async function processMockAnalysis(
  sessionId: string,
  analysisId: string,
  language: string,
): Promise<void> {
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
    return;
  }

  const mockOutput = createMockAnalysisOutput(language);
  await prisma.aiAnalysis.update({
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
}

async function processRealAnalysis(
  sessionId: string,
  analysisId: string,
  language: string,
): Promise<void> {
  const provider = getAiAnalysisProvider();
  try {
    const analysisContext = await buildSessionAnalysisContext(sessionId);
    if (!analysisContext) {
      await failAnalysis(analysisId, "Session not found during analysis.");
      return;
    }

    const prompt = buildAnalysisPrompt(analysisContext);
    const { output, rawOutput, model } = await runNegotiationAnalysis(
      prompt,
      language,
    );

    await prisma.aiAnalysis.update({
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
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "AI analysis failed.";
    const classified = classifyExternalServiceError(
      provider === "yandex" ? ExternalService.APP : ExternalService.OPENAI,
      error,
      "ai_analysis",
    );
    const isJsonValidationError =
      errorMessage.includes("schema validation") ||
      errorMessage.includes("non-JSON response");

    await logExternalServiceEvent({
      service: provider === "yandex" ? ExternalService.APP : ExternalService.OPENAI,
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
  }
}
