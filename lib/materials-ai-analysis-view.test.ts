import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  createMockAnalysisOutput,
  NegotiationAnalysisOutputSchema,
} from "@/lib/ai/negotiation-analysis";
import { en } from "@/lib/i18n/dictionaries/en";
import { ru } from "@/lib/i18n/dictionaries/ru";
import { resolveAiAnalysisRenderState, parsePublishedViewerAnalysis } from "@/lib/materials-ai-analysis-view";

const VALID_ANALYSIS = createMockAnalysisOutput("en");

test("recording not ready keeps AI panel waiting", () => {
  const state = resolveAiAnalysisRenderState({
    recordingStage: "not_available",
    transcriptionStage: "waiting_for_recording",
    aiStage: "waiting_for_transcript",
    canViewAiAnalysis: false,
    analysisJson: null,
  });

  assert.equal(state.stage, "WAITING_FOR_RECORDING");
  assert.equal(state.showInvalidResultError, false);
});

test("transcript processing never emits invalid AI error", () => {
  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "transcribing",
    aiStage: "waiting_for_transcript",
    canViewAiAnalysis: true,
    analysisJson: null,
  });

  assert.equal(state.stage, "TRANSCRIPT_PROCESSING");
  assert.equal(state.showInvalidResultError, false);
});

test("transcript ready and analysis not started remains ready-to-start", () => {
  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "not_started",
    canViewAiAnalysis: true,
    analysisJson: null,
  });

  assert.equal(state.stage, "ANALYSIS_NOT_STARTED");
  assert.equal(state.showInvalidResultError, false);
});

test("queued and analyzing map to in-progress AI state", () => {
  const queued = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "queued",
    canViewAiAnalysis: true,
    analysisJson: null,
  });
  const analyzing = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "analyzing",
    canViewAiAnalysis: true,
    analysisJson: null,
  });

  assert.equal(queued.stage, "ANALYSIS_IN_PROGRESS");
  assert.equal(analyzing.stage, "ANALYSIS_IN_PROGRESS");
});

test("completed analysis with valid schema renders report", () => {
  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "ready",
    canViewAiAnalysis: true,
    analysisJson: VALID_ANALYSIS,
  });

  assert.equal(state.stage, "ANALYSIS_READY");
  assert.equal(state.showInvalidResultError, false);
  assert.equal(state.analysis?.overallScore, VALID_ANALYSIS.overallScore);
});

test("completed malformed analysis triggers invalid-result state", () => {
  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "ready",
    canViewAiAnalysis: true,
    analysisJson: { invalid: true },
  });

  assert.equal(state.stage, "ANALYSIS_INVALID");
  assert.equal(state.showInvalidResultError, true);
});

test("legacy completed null analysis is not treated as invalid", () => {
  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "ready",
    canViewAiAnalysis: true,
    analysisJson: null,
  });

  assert.equal(state.stage, "ANALYSIS_READY_WITHOUT_RESULT");
  assert.equal(state.showInvalidResultError, false);
});

test("failed analysis surfaces failed stage, not invalid", () => {
  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "failed",
    canViewAiAnalysis: true,
    analysisJson: null,
  });

  assert.equal(state.stage, "ANALYSIS_FAILED");
  assert.equal(state.showInvalidResultError, false);
});

test("participant shared payload passes with partial parser", () => {
  const participantPayload = {
    ...VALID_ANALYSIS,
    roleObjectivesAnalysis: undefined,
  };
  const participantParser = NegotiationAnalysisOutputSchema.partial({
    roleObjectivesAnalysis: true,
  });

  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "ready",
    canViewAiAnalysis: true,
    analysisJson: participantPayload,
    parseAnalysisJson: (value) =>
      participantParser.safeParse(value) as {
        success: boolean;
        data?: z.infer<typeof NegotiationAnalysisOutputSchema>;
      },
  });

  assert.equal(state.stage, "ANALYSIS_READY");
  assert.equal(state.showInvalidResultError, false);
});

test("invalid-result message is localized in RU and EN dictionaries", () => {
  assert.equal(
    en.sessionMaterials.aiAnalysisInvalidResult,
    "AI analysis result is invalid. Please rerun analysis.",
  );
  assert.equal(
    ru.sessionMaterials.aiAnalysisInvalidResult,
    "Результат ИИ-разбора некорректен. Запустите анализ повторно.",
  );
});

test("observer-safe projection is invalid under the full Participant/Facilitator schema", () => {
  const observerSafe = { ...VALID_ANALYSIS } as Record<string, unknown>;
  delete observerSafe.participantPersonalFeedback;
  const parsed = NegotiationAnalysisOutputSchema.safeParse(observerSafe);
  assert.equal(parsed.success, false);
});

test("authorized published analysis renders when recording is not available", () => {
  const observerSafe = { ...VALID_ANALYSIS } as Record<string, unknown>;
  delete observerSafe.participantPersonalFeedback;
  delete observerSafe.roleObjectivesAnalysis;

  const state = resolveAiAnalysisRenderState({
    recordingStage: "not_available",
    transcriptionStage: "waiting_for_recording",
    aiStage: "ready",
    canViewAiAnalysis: true,
    analysisJson: observerSafe,
    parseAnalysisJson: parsePublishedViewerAnalysis,
  });

  assert.equal(state.stage, "ANALYSIS_READY");
  assert.equal(state.showInvalidResultError, false);
  assert.equal(state.analysis?.executiveSummary, VALID_ANALYSIS.executiveSummary);
});

test("facilitator in-progress still hides a previous payload behind the pending outline", () => {
  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "analyzing",
    canViewAiAnalysis: true,
    analysisJson: VALID_ANALYSIS,
  });

  assert.equal(state.stage, "ANALYSIS_IN_PROGRESS");
  assert.equal(state.analysis, null);
});

test("observer-safe projection renders with the published-viewer parser", () => {
  const observerSafe = { ...VALID_ANALYSIS } as Record<string, unknown>;
  delete observerSafe.participantPersonalFeedback;
  delete observerSafe.roleObjectivesAnalysis;

  const state = resolveAiAnalysisRenderState({
    recordingStage: "ready",
    transcriptionStage: "ready",
    aiStage: "ready",
    canViewAiAnalysis: true,
    analysisJson: observerSafe,
    parseAnalysisJson: parsePublishedViewerAnalysis,
  });
  assert.equal(state.stage, "ANALYSIS_READY");
  assert.equal(state.showInvalidResultError, false);
  assert.equal(state.analysis?.executiveSummary, VALID_ANALYSIS.executiveSummary);
  assert.equal(state.analysis?.participantPersonalFeedback, undefined);
});

test("getAnalysisForObserver mock output parses after JSON round-trip", async () => {
  const { getAnalysisForObserver } = await import("@/lib/analysis-visibility");
  const observer = getAnalysisForObserver(VALID_ANALYSIS);
  const roundTrip = JSON.parse(JSON.stringify(observer));
  const parsed = parsePublishedViewerAnalysis(roundTrip);
  if (!parsed.success) {
    assert.fail(JSON.stringify(parsed, null, 2));
  }
  assert.equal(parsed.success, true);
});
