import assert from "node:assert/strict";
import test from "node:test";

import { AiAnalysisStatus } from "@/app/generated/prisma/client";
import {
  getEnhancementReadinessForAnalysis,
  getEnhancementReadinessForAnalysisFromMetadata,
  maybeRequestAutomaticAiAnalysis,
  resolveTranscriptEnhancementStatus,
} from "@/lib/services/auto-ai-analysis-trigger";

async function withEnhancementEnv(
  values: {
    enabled: "true" | "false";
    autoRun: "true" | "false";
  },
  fn: () => Promise<void>,
) {
  const previousEnabled = process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED;
  const previousAutoRun = process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
  process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = values.enabled;
  process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = values.autoRun;
  try {
    await fn();
  } finally {
    if (previousEnabled === undefined) {
      delete process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED;
    } else {
      process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = previousEnabled;
    }
    if (previousAutoRun === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = previousAutoRun;
    }
  }
}

test("resolves RUNNING enhancement as IN_PROGRESS", () => {
  const status = resolveTranscriptEnhancementStatus({
    transcriptEnhancement: { status: "RUNNING" },
    transcriptionProvider: "yandex_speechkit",
  });
  assert.equal(status, "IN_PROGRESS");
});

test("auto-run enabled waits for IDLE and SUGGESTED states", () => {
  const idle = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "IDLE",
    enhancementSkipReason: null,
    enhancementAttemptState: "NOT_STARTED",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: false,
  });
  const suggested = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "SUGGESTED",
    enhancementSkipReason: null,
    enhancementAttemptState: "NOT_STARTED",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: false,
  });
  assert.equal(idle.canRequestAnalysis, false);
  assert.equal(suggested.canRequestAnalysis, false);
});

test("auto-run disabled allows IDLE and SUGGESTED states", () => {
  const idle = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: false,
    enhancementStatus: "IDLE",
    enhancementSkipReason: null,
    enhancementAttemptState: "NOT_STARTED",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: false,
  });
  const suggested = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: false,
    enhancementStatus: "SUGGESTED",
    enhancementSkipReason: null,
    enhancementAttemptState: "NOT_STARTED",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: false,
  });
  assert.equal(idle.canRequestAnalysis, true);
  assert.equal(suggested.canRequestAnalysis, true);
});

test("readiness accepts completed/partial/failed with persistence", () => {
  const completed = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "COMPLETED",
    enhancementSkipReason: null,
    enhancementAttemptState: "TERMINAL",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: true,
  });
  const partial = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "PARTIAL",
    enhancementSkipReason: null,
    enhancementAttemptState: "TERMINAL",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: true,
  });
  const failed = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "FAILED",
    enhancementSkipReason: null,
    enhancementAttemptState: "TERMINAL",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: true,
  });
  assert.equal(completed.canRequestAnalysis, true);
  assert.equal(partial.canRequestAnalysis, true);
  assert.equal(failed.canRequestAnalysis, true);
});

test("failed state without persisted completion does not trigger analysis", () => {
  const failed = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "FAILED",
    enhancementSkipReason: null,
    enhancementAttemptState: "TERMINAL",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: false,
  });
  assert.equal(failed.canRequestAnalysis, false);
});

test("skip policy accepts terminal reasons and rejects transient reasons", () => {
  const terminal = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "SKIPPED",
    enhancementSkipReason: "skipped_auto_run_disabled",
    enhancementAttemptState: "TERMINAL",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: true,
  });
  const transient = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "SKIPPED",
    enhancementSkipReason: "coalesced_running_same_identity",
    enhancementAttemptState: "TERMINAL",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: true,
  });
  assert.equal(terminal.canRequestAnalysis, true);
  assert.equal(transient.canRequestAnalysis, false);
});

test("NOT_AVAILABLE is terminal only for non-yandex provider state", () => {
  const nonYandex = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "NOT_AVAILABLE",
    enhancementSkipReason: null,
    enhancementAttemptState: "NOT_STARTED",
    transcriptionProvider: "openai",
    failureStatePersisted: false,
  });
  const unresolved = getEnhancementReadinessForAnalysis({
    enhancementEnabled: true,
    enhancementAutoRun: true,
    enhancementStatus: "NOT_AVAILABLE",
    enhancementSkipReason: null,
    enhancementAttemptState: "UNKNOWN",
    transcriptionProvider: "yandex_speechkit",
    failureStatePersisted: false,
  });
  assert.equal(nonYandex.canRequestAnalysis, true);
  assert.equal(unresolved.canRequestAnalysis, false);
});

test("mapping confirmed + enhancement terminal triggers canonical analysis request", async () => {
  await withEnhancementEnv({ enabled: "true", autoRun: "true" }, async () => {
    let requestCalls = 0;
    const result = await maybeRequestAutomaticAiAnalysis({
      sessionId: "session-1",
      triggerSource: "speaker_mapping_confirmed",
      dependencies: {
        findTranscript: (async () => ({
          status: "COMPLETED",
          hasSpeakerDiarization: true,
          speakerMappingStatus: "CONFIRMED",
          speakerMapping: { speaker_1: "p1" },
          processingMetadata: {
            transcriptionProvider: "yandex_speechkit",
            transcriptEnhancement: { status: "COMPLETED" },
          },
          segments: [{ speakerLabel: "speaker_1", mappedParticipantId: "p1", text: "hello" }],
        })) as never,
        requestAnalysis: (async () => {
          requestCalls += 1;
          return {
            outcome: "already_running",
            analysisId: "ai-1",
            status: AiAnalysisStatus.ANALYZING,
          };
        }) as never,
      },
    });
    assert.equal(result.outcome, "started");
    assert.equal(requestCalls, 1);
  });
});

test("mapping-first flow waits while enhancement is pending/running", async () => {
  await withEnhancementEnv({ enabled: "true", autoRun: "true" }, async () => {
    const result = await maybeRequestAutomaticAiAnalysis({
      sessionId: "session-2",
      triggerSource: "speaker_mapping_confirmed",
      dependencies: {
        findTranscript: (async () => ({
          status: "COMPLETED",
          hasSpeakerDiarization: true,
          speakerMappingStatus: "CONFIRMED",
          speakerMapping: { speaker_1: "p1" },
          processingMetadata: {
            transcriptionProvider: "yandex_speechkit",
            transcriptEnhancement: { status: "QUEUED" },
          },
          segments: [{ speakerLabel: "speaker_1", mappedParticipantId: "p1", text: "hello" }],
        })) as never,
        requestAnalysis: (async () => {
          throw new Error("must not be called");
        }) as never,
      },
    });
    assert.equal(result.outcome, "skipped");
    assert.equal(result.reason, "enhancement_not_ready_for_analysis");
  });
});

test("auto-run disabled allows mapping-first analysis from original transcript", async () => {
  await withEnhancementEnv({ enabled: "true", autoRun: "false" }, async () => {
    let requestCalls = 0;
    const result = await maybeRequestAutomaticAiAnalysis({
      sessionId: "session-2b",
      triggerSource: "speaker_mapping_confirmed",
      dependencies: {
        findTranscript: (async () => ({
          status: "COMPLETED",
          hasSpeakerDiarization: true,
          speakerMappingStatus: "CONFIRMED",
          speakerMapping: { speaker_1: "p1" },
          processingMetadata: {
            transcriptionProvider: "yandex_speechkit",
            transcriptEnhancementRecommendation: { suggested: true, reasons: ["asr_artifacts"] },
          },
          segments: [{ speakerLabel: "speaker_1", mappedParticipantId: "p1", text: "hello" }],
        })) as never,
        requestAnalysis: (async () => {
          requestCalls += 1;
          return {
            outcome: "already_completed",
            analysisId: "ai-2b",
            status: AiAnalysisStatus.COMPLETED,
          };
        }) as never,
      },
    });
    assert.equal(result.outcome, "started");
    assert.equal(requestCalls, 1);
  });
});

test("enhancement-first flow waits until mapping is confirmed", async () => {
  const result = await maybeRequestAutomaticAiAnalysis({
    sessionId: "session-3",
    triggerSource: "enhancement_terminal",
    dependencies: {
      findTranscript: (async () => ({
        status: "COMPLETED",
        hasSpeakerDiarization: true,
        speakerMappingStatus: "REQUIRED",
        speakerMapping: { speaker_1: null },
        processingMetadata: {
          transcriptionProvider: "yandex_speechkit",
          transcriptEnhancement: { status: "COMPLETED" },
        },
        segments: [{ speakerLabel: "speaker_1", mappedParticipantId: null, text: "hello" }],
      })) as never,
      requestAnalysis: (async () => {
        throw new Error("must not be called");
      }) as never,
    },
  });
  assert.deepEqual(result, {
    outcome: "skipped",
    reason: "speaker_mapping_not_ready",
  });
});

test("metadata resolver keeps failed+persisted fallback as ready", () => {
  const readiness = getEnhancementReadinessForAnalysisFromMetadata({
    processingMetadata: {
      transcriptionProvider: "yandex_speechkit",
      transcriptEnhancement: {
        status: "FAILED",
        finishedAt: "2026-07-16T00:00:00.000Z",
      },
    },
    enhancementEnabled: true,
    enhancementAutoRun: true,
  });
  assert.equal(readiness.canRequestAnalysis, true);
});
