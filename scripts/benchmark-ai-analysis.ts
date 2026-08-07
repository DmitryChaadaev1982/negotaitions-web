import { performance } from "node:perf_hooks";

import {
  createMockAnalysisOutput,
  getAnalysisDepthIssues,
  getAiAnalysisPerformanceModel,
  getYandexAnalysisStaticProfile,
  getYandexAiModel,
  NegotiationAnalysisOutputSchema,
} from "@/lib/ai/negotiation-analysis";
import {
  buildAnalysisPrompt,
  type BuildAnalysisPromptContext,
} from "@/lib/ai/session-analysis-prompt";

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function buildSyntheticContext(): BuildAnalysisPromptContext {
  const transcriptText = [
    "[00:00:01-00:00:08] [Buyer] We need a reliable delivery date and a price that fits the project budget.",
    "[00:00:09-00:00:16] [Seller] We can hold the price if the order volume increases and payment terms are shorter.",
    "[00:00:17-00:00:25] [Buyer] Volume can move, but only if delivery risk is shared and service support is included.",
    "[00:00:26-00:00:34] [Seller] Let us package delivery priority, support, and a smaller discount as a trade.",
  ];

  return {
    session: {
      id: "benchmark-session",
      title: "AI analysis benchmark",
      roomLabel: "benchmark",
      status: "COMPLETED",
      caseTitle: "Benchmark case",
      caseLanguage: "EN",
      publicInstructions: "Negotiate price, delivery, and support terms.",
      businessContext:
        "A buyer and seller are negotiating a software implementation package.",
      preparationDurationSeconds: 600,
      durationSeconds: 900,
      startedAt: "2026-01-01T10:00:00.000Z",
      endedAt: "2026-01-01T10:15:00.000Z",
      negotiationStartedAt: "2026-01-01T10:00:00.000Z",
      negotiationEndedAt: "2026-01-01T10:15:00.000Z",
      sequenceNumber: 1,
    },
    event: {
      id: "benchmark-event",
      title: "Benchmark event",
      status: "COMPLETED",
    },
    roles: [
      {
        id: "role-buyer",
        name: "Buyer",
        privateInstructions: "Secure a reliable date and avoid excess price.",
        objectives: "Reduce implementation risk.",
        constraints: "Budget is capped.",
        hiddenInfo: "Can increase volume if support is included.",
        fallbackPosition: "Delay purchase.",
      },
      {
        id: "role-seller",
        name: "Seller",
        privateInstructions: "Protect margin and shorten payment terms.",
        objectives: "Close the package with acceptable margin.",
        constraints: "Delivery team capacity is limited.",
        hiddenInfo: "Support can be bundled cheaply.",
        fallbackPosition: "Offer standard delivery only.",
      },
    ],
    participants: [
      {
        id: "participant-buyer",
        displayName: "Buyer",
        type: "PARTICIPANT",
        roleName: "Buyer",
        notes: "",
      },
      {
        id: "participant-seller",
        displayName: "Seller",
        type: "PARTICIPANT",
        roleName: "Seller",
        notes: "",
      },
    ],
    transcript: {
      id: "benchmark-transcript",
      text: transcriptText.join(" "),
      diarizedText: transcriptText.join("\n\n"),
      language: "en",
      transcriptionModel: "benchmark",
      hasSpeakerDiarization: true,
      segments: transcriptText.map((line, index) => ({
        speakerLabel: index % 2 === 0 ? "Buyer" : "Seller",
        mappedParticipantName: index % 2 === 0 ? "Buyer" : "Seller",
        startSeconds: index * 8,
        endSeconds: index * 8 + 7,
        text: line.replace(/^\[[^\]]+\]\s\[[^\]]+\]\s/u, ""),
      })),
    },
  };
}

async function main() {
  const context = buildSyntheticContext();
  const startedAt = performance.now();
  const prompt = buildAnalysisPrompt(context);
  const promptBuiltAt = performance.now();
  const baseOutput = createMockAnalysisOutput(
    context.session.caseLanguage.toLowerCase(),
  );
  const output = {
    ...baseOutput,
    executiveSummary:
      "The parties exchanged priorities and constraints. They created a conditional package across price, delivery, and support. The structure produced a workable agreement while preserving room for sharper diagnostic questions. Future practice should focus on explicit reciprocal concessions.",
    strengths: [
      ...baseOutput.strengths,
      { ...baseOutput.strengths[0]!, title: "Conditional packaging" },
    ],
    improvementAreas: [
      ...baseOutput.improvementAreas,
      { ...baseOutput.improvementAreas[0]!, title: "Question sequencing" },
      { ...baseOutput.improvementAreas[0]!, title: "Reciprocal concessions" },
    ],
    detectedTactics: [
      ...baseOutput.detectedTactics,
      { ...baseOutput.detectedTactics[0]!, name: "Conditional trade" },
    ],
    nextTrainingFocus: [
      ...baseOutput.nextTrainingFocus,
      { ...baseOutput.nextTrainingFocus[0]!, focusArea: "Question sequencing" },
    ],
    facilitatorDebriefQuestions: [
      ...baseOutput.facilitatorDebriefQuestions,
      "Which concession should have been conditional?",
    ],
  };
  const validationStartedAt = performance.now();
  const validated = NegotiationAnalysisOutputSchema.parse(output);
  const validationFinishedAt = performance.now();
  const finishedAt = performance.now();
  const outputText = JSON.stringify(validated);
  const promptChars = prompt.length;
  const performanceModel = getAiAnalysisPerformanceModel();
  const staticProfile = getYandexAnalysisStaticProfile(
    context.session.caseLanguage,
  );
  const depthIssues = getAnalysisDepthIssues(validated);
  const baseInputChars = promptChars + staticProfile.baseInstructionChars;

  const report = {
    mode: "deterministic-local",
    providerCallsMade: 0,
    model: process.env.AI_ANALYSIS_PROVIDER === "yandex" ? getYandexAiModel() : "mock-analysis",
    totalWallClockMs: Math.round(finishedAt - startedAt),
    successfulNormalPath: {
      assumption: "primary response is completed, schema-valid, and depth-complete",
      generationPosts: depthIssues.length === 0 ? 1 : 2,
      primaryGenerationPosts: 1,
      compactFallbackCalls: 0,
      optionalDepthCalls: depthIssues.length === 0 ? 0 : 1,
      depthIssueCount: depthIssues.length,
      promptChars,
      estimatedPromptTokens: estimateTokensFromChars(promptChars),
      baseInstructionChars: staticProfile.baseInstructionChars,
      baseInputChars,
      estimatedInputTokens: estimateTokensFromChars(baseInputChars),
      outputSchemaInstructionChars:
        staticProfile.outputSchemaInstructionChars,
      coachingInstructionChars: staticProfile.coachingInstructionChars,
      systemInstructionChars: staticProfile.systemInstructionChars,
      languageInstructionChars:
        staticProfile.languageInstructionChars,
      primaryMaxOutputTokensConfigured:
        staticProfile.primaryMaxOutputTokensConfigured,
      syntheticOutputChars: outputText.length,
      preProviderLocalWorkMs: Math.round(promptBuiltAt - startedAt),
      generationPostDurationMs: null,
      pollingDurationMs: null,
      parsingSchemaValidationMs:
        validationFinishedAt - validationStartedAt,
      optionalDepthDurationMs: null,
      providerTotalDurationMs: null,
    },
    promptBuildMs: Math.round(promptBuiltAt - startedAt),
    generationCallCount: 0,
    perCallDurationMs: [] as number[],
    promptChars,
    estimatedPromptTokens: estimateTokensFromChars(promptChars),
    baseInstructionChars: staticProfile.baseInstructionChars,
    inputChars: baseInputChars,
    estimatedInputTokens: estimateTokensFromChars(baseInputChars),
    outputChars: outputText.length,
    operationAttemptCount: 0,
    outerRetryCount: 0,
    compactFallbackCount: 0,
    optionalDepthCallCount: 0,
    pollingRequestCount: 0,
    operationTimeoutMs: performanceModel.operationTimeoutMs,
    errorClass: null,
    theoreticalPerformanceModel: {
      beforeReviewWorstCaseMs:
        performanceModel.beforeReviewTheoreticalWorstCaseMs,
      afterRemediationWorstCaseMs:
        performanceModel.theoreticalDefaultWorstCaseMs,
      maxOperationAttempts: performanceModel.maxOperationAttempts,
      maxGenerationPosts: performanceModel.maxGenerationPosts,
      maxPrimaryGenerationPosts:
        performanceModel.maxPrimaryGenerationPosts,
      maxCompactFallbackCalls:
        performanceModel.maxCompactFallbackCalls,
      maxOptionalDepthCalls: performanceModel.maxOptionalDepthCalls,
      maxPollingRequests: performanceModel.maxPollingRequests,
      perResponsePollTimeoutMs:
        performanceModel.perResponsePollTimeoutMs,
      removedMultiplicativePath:
        "compact fallback and optional depth no longer run inside every outer attempt",
    },
    safeNormalPathOptimizationsApplied: [
      "provider base instructions are constructed once per operation",
      "compact generation remains exclusive to truncated JSON fallback",
      "optional depth is skipped when the primary output already satisfies depth criteria",
      "parsing and schema-validation timing is measured separately",
    ],
    liveBenchmarkCandidates: [
      "right-size max output tokens from observed output-token percentiles",
      "deduplicate overlapping coaching and schema prose",
      "tune polling interval from Yandex lifecycle latency and rate-limit evidence",
      "measure how often valid primary output still triggers optional depth",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
}

void main();
