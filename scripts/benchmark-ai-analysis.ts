import { performance } from "node:perf_hooks";

import {
  createMockAnalysisOutput,
  getYandexAiModel,
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
  const output = createMockAnalysisOutput(context.session.caseLanguage.toLowerCase());
  const finishedAt = performance.now();
  const outputText = JSON.stringify(output);
  const promptChars = prompt.length;

  const report = {
    mode: "deterministic-local",
    providerCallsMade: 0,
    model: process.env.AI_ANALYSIS_PROVIDER === "yandex" ? getYandexAiModel() : "mock-analysis",
    totalWallClockMs: Math.round(finishedAt - startedAt),
    promptBuildMs: Math.round(promptBuiltAt - startedAt),
    modelCalls: 0,
    perCallDurationMs: [] as number[],
    promptChars,
    estimatedInputTokens: estimateTokensFromChars(promptChars),
    outputChars: outputText.length,
    retryCount: 0,
    timeoutMs: null,
    errorClass: null,
  };

  console.log(JSON.stringify(report, null, 2));
}

void main();
