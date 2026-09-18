import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";
import { evaluateAiAnalysisReadiness } from "@/lib/ai/analysis-readiness";
import {
  FairGlobalLimiter,
  resetTranscriptEnhancementLimiterForTests,
} from "@/lib/services/transcript-enhancement-limiter";
import {
  computeEnhancementProgress,
  fenceEnhancementJobInMetadata,
  parseTranscriptEnhancementJob,
  projectTranscriptEnhancementStatus,
  type TranscriptEnhancementDurableChunk,
  type TranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";
import {
  checkpointEnhancementChunk,
  continueWithCurrentTranscript,
  publishEnhancementIfEligible,
  reconcileIllegalEnhancementJob,
  revokeEnhancementPublication,
} from "@/lib/services/transcript-enhancement-state";
import {
  classifyEnhancementRetry,
  executeTranscriptEnhancement,
  type TranscriptEnhancementDbClient,
} from "@/lib/services/transcript-enhancement-orchestration";
import { runTranscriptEnhancementRecoveryTick } from "@/lib/services/transcript-enhancement-recovery";
import {
  buildTranscriptEnhancementChunks,
  extractProviderUsage,
  type ChunkExecutionResult,
  type EnhancementChunk,
  type EnhanceTranscriptOptions,
  type TranscriptEnhancementInputSegment,
} from "@/lib/services/yandex-transcript-enhancement";
import { mergeProcessingMetadata } from "@/lib/transcription/processing-metadata";
import { parseTranscriptEnhancementPublication } from "@/lib/services/transcript-enhancement-publication";

type InMemorySegment = {
  id: string;
  orderIndex: number;
  speakerLabel: string | null;
  startSeconds: number | null;
  endSeconds: number | null;
  mappedParticipantId: string | null;
  text: string;
  qualityText: string | null;
};

type InMemoryTranscript = {
  id: string;
  sessionId: string;
  status: TranscriptStatus;
  text: string;
  diarizedText: string | null;
  updatedAt: Date;
  retranscribeCount: number;
  processingMetadata: Record<string, unknown>;
  speakerMapping?: Record<string, string> | null;
  session?: {
    participants: Array<{
      id: string;
      displayName: string;
      type: string;
      sessionRole: { name: string } | null;
    }>;
  };
  segments: InMemorySegment[];
};

function cloneTranscript(state: InMemoryTranscript) {
  return {
    id: state.id,
    sessionId: state.sessionId,
    status: state.status,
    text: state.text,
    diarizedText: state.diarizedText,
    updatedAt: state.updatedAt,
    retranscribeCount: state.retranscribeCount,
    processingMetadata: structuredClone(state.processingMetadata),
    segments: state.segments.map((segment) => ({ ...segment })),
  };
}

type InMemoryDbSeam = {
  transcript: {
    findUnique: (args?: unknown) => Promise<unknown>;
    update: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    updateMany: (args: {
      where: { updatedAt: Date };
      data: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  transcriptSegment: {
    update: (args: {
      where: { id: string };
      data: { text?: string; qualityText?: string | null };
    }) => Promise<void>;
  };
  $transaction: (callback: (tx: InMemoryDbSeam) => Promise<unknown>) => Promise<unknown>;
  aiAnalysis: {
    findUnique: () => Promise<unknown>;
  };
};

function createInMemoryDb(state: InMemoryTranscript): TranscriptEnhancementDbClient {
  const db: InMemoryDbSeam = {
    transcript: {
      findUnique: async () => ({
        ...cloneTranscript(state),
        speakerMapping: state.speakerMapping ?? null,
        session: state.session,
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        if ("text" in args.data && typeof args.data.text === "string") {
          state.text = args.data.text;
        }
        if ("diarizedText" in args.data) {
          state.diarizedText = (args.data.diarizedText as string | null) ?? null;
        }
        if (
          "processingMetadata" in args.data &&
          args.data.processingMetadata &&
          typeof args.data.processingMetadata === "object"
        ) {
          state.processingMetadata = args.data.processingMetadata as Record<string, unknown>;
        }
        state.updatedAt = new Date(state.updatedAt.getTime() + 1);
        return cloneTranscript(state);
      },
      updateMany: async (args: { where: { updatedAt: Date }; data: Record<string, unknown> }) => {
        if (state.updatedAt.getTime() !== args.where.updatedAt.getTime()) {
          return { count: 0 };
        }
        await db.transcript.update({ data: args.data });
        return { count: 1 };
      },
    },
    transcriptSegment: {
      update: async (args: {
        where: { id: string };
        data: { text?: string; qualityText?: string | null };
      }) => {
        const segment = state.segments.find((candidate) => candidate.id === args.where.id);
        if (!segment) throw new Error("Segment not found");
        if (typeof args.data.text === "string") segment.text = args.data.text;
        if ("qualityText" in args.data) segment.qualityText = args.data.qualityText ?? null;
      },
    },
    $transaction: async (callback) => callback(db),
    aiAnalysis: {
      findUnique: async () => null,
    },
  };
  return db as unknown as TranscriptEnhancementDbClient;
}

function baseTranscript(id: string): InMemoryTranscript {
  return {
    id,
    sessionId: `session-${id}`,
    status: TranscriptStatus.COMPLETED,
    text: "original transcript",
    diarizedText: "speaker_1: original transcript",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    retranscribeCount: 0,
    processingMetadata: { transcriptionProvider: "yandex_speechkit" },
    speakerMapping: { speaker_1: "buyer" },
    session: {
      participants: [
        {
          id: "buyer",
          displayName: "Buyer",
          type: "PARTICIPANT",
          sessionRole: { name: "Buyer" },
        },
      ],
    },
    segments: [
      {
        id: `${id}-seg`,
        orderIndex: 0,
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 1,
        mappedParticipantId: "buyer",
        text: "original transcript",
        qualityText: "original transcript",
      },
    ],
  };
}

function completedEnhance(cleanedText: string) {
  return {
    segments: [{ index: 0, cleanedText }],
    globalWarnings: [],
    meta: {
      mode: "single" as const,
      model: "deepseek-v4-flash",
      overallStatus: "COMPLETED" as const,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      totalLatencyMs: 1,
      originalSegmentCount: 1,
      originalCharacterCount: 10,
      chunkCount: 1,
      concurrency: 1,
      successfulChunkCount: 1,
      failedChunkCount: 0,
      fallbackSegmentCount: 0,
      changedSegmentCount: 1,
      unchangedSegmentCount: 0,
      retryCount: 0,
      perChunk: [],
      originalWordCount: 2,
      enhancedWordCount: 3,
      addedWordEstimate: 1,
      removedWordEstimate: 0,
      outputMode: "json_schema" as const,
      structuredOutputEnabled: true,
      schemaVersion: "v1",
      schemaChunkCount: 1,
    },
  };
}

async function waitUntil(predicate: () => boolean, label: string) {
  for (let i = 0; i < 4000; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function createProviderGate() {
  const gate: { release: ((value?: void) => void) | null } = { release: null };
  const promise = new Promise<void>((resolve) => {
    gate.release = resolve;
  });
  return { promise, gate };
}

function withEnhancementEnv<T>(fn: () => Promise<T>) {
  const previousAutoRun = process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
  const previousEnabled = process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = "true";
  process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = "true";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    "postgresql://user:password@localhost:5432/negotiations_test";
  return fn().finally(() => {
    if (previousAutoRun === undefined) delete process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
    else process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = previousAutoRun;
    if (previousEnabled === undefined) delete process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED;
    else process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = previousEnabled;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });
}

function chunk(
  index: number,
  status: TranscriptEnhancementDurableChunk["status"],
  extra?: Partial<TranscriptEnhancementDurableChunk>,
): TranscriptEnhancementDurableChunk {
  return {
    chunkIndex: index,
    status,
    targetIndexes: [index],
    attemptCount: status === "PENDING" ? 0 : 1,
    unpublishedByOrderIndex:
      status === "COMPLETED" ? { [String(index)]: `enhanced-${index}` } : {},
    lastErrorClass: status === "FAILED" ? "schema_invalid" : null,
    lastHttpClass: null,
    lastSchemaResult: status === "COMPLETED" ? "valid" : null,
    providerDurationMs: null,
    usageInputTokens: null,
    usageOutputTokens: null,
    usageTotalTokens: null,
    usageClassification: null,
    startedAt: null,
    finishedAt: status === "COMPLETED" || status === "FAILED" ? new Date().toISOString() : null,
    ...extra,
  };
}

function seedJob(state: InMemoryTranscript, job: TranscriptEnhancementJob) {
  state.processingMetadata = fenceEnhancementJobInMetadata(
    { transcriptionProvider: "yandex_speechkit" },
    "identity_mismatch",
  );
  state.processingMetadata = {
    transcriptionProvider: "yandex_speechkit",
    transcriptEnhancement: {
      ...job,
      schemaVersion: "d1-v1",
    },
  };
}

test("STATE-01 RUNNING k/n is not PARTIAL", () => {
  const chunks = {
    "0": chunk(0, "COMPLETED"),
    "1": chunk(1, "RUNNING"),
    "2": chunk(2, "PENDING"),
  };
  const progress = computeEnhancementProgress(chunks);
  const projection = projectTranscriptEnhancementStatus({
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      executionStatus: "RUNNING",
      publicationEligible: true,
      terminalQuality: null,
      progress,
      chunks,
      status: "RUNNING",
    },
  });
  assert.equal(projection.executionStatus, "RUNNING");
  assert.equal(projection.uiStatus, "IN_PROGRESS");
  assert.equal(projection.terminalQuality, null);
  assert.notEqual(projection.uiStatus, "PARTIAL");
  assert.equal(progress.completedChunks, 1);
  assert.equal(progress.totalChunks, 3);
});

test("STATE-02 terminal PARTIAL occurs only after processing ends", () => {
  const projectionRunning = projectTranscriptEnhancementStatus({
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      executionStatus: "RUNNING",
      publicationEligible: false,
      terminalQuality: "PARTIAL",
      cancelReason: "permanent_chunk_failure",
      chunks: { "0": chunk(0, "COMPLETED"), "1": chunk(1, "FAILED") },
      status: "RUNNING",
    },
  });
  assert.equal(projectionRunning.terminalQuality, null);
  const projectionDone = projectTranscriptEnhancementStatus({
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      executionStatus: "COMPLETED",
      publicationEligible: false,
      terminalQuality: "PARTIAL",
      chunks: { "0": chunk(0, "COMPLETED"), "1": chunk(1, "FAILED") },
      status: "PARTIAL",
    },
  });
  assert.equal(projectionDone.terminalQuality, "PARTIAL");
  assert.equal(projectionDone.uiStatus, "PARTIAL");
});

test("STATE-03 publicationEligible independently transitions false", () => {
  const before = projectTranscriptEnhancementStatus({
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      executionStatus: "RUNNING",
      publicationEligible: true,
      chunks: { "0": chunk(0, "RUNNING") },
    },
  });
  assert.equal(before.publicationEligible, true);
  const after = projectTranscriptEnhancementStatus({
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      executionStatus: "RUNNING",
      publicationEligible: false,
      cancelReason: "continue_with_current",
      chunks: { "0": chunk(0, "RUNNING") },
    },
  });
  assert.equal(after.executionStatus, "RUNNING");
  assert.equal(after.publicationEligible, false);
});

test("DUR-03 namespace merge preserves mapping + unknown siblings", () => {
  const merged = mergeProcessingMetadata(
    {
      transcriptionProvider: "yandex_speechkit",
      mappingSuggestion: { reason: "keep" },
      unknownSibling: { keep: true },
    },
    {
      transcriptEnhancement: { executionStatus: "RUNNING", publicationEligible: true },
    },
  );
  assert.deepEqual(merged.mappingSuggestion, { reason: "keep" });
  assert.deepEqual(merged.unknownSibling, { keep: true });
});

test("CONC-01/02/03 reserved_slot prevents large-job monopoly", async () => {
  resetTranscriptEnhancementLimiterForTests();
  const limiter = new FairGlobalLimiter(10, 8, "reserved_slot");
  assert.equal(limiter.maxPerJob(), 8);
  const held: Array<() => void> = [];
  const hold = () =>
    new Promise<void>((resolve) => {
      held.push(resolve);
    });
  const large = Array.from({ length: 8 }, () => limiter.withSlot("large", hold));
  await waitUntil(() => limiter.snapshot().globalInFlight === 8, "large job slots");
  assert.equal(limiter.snapshot().globalInFlight, 8);
  assert.ok(limiter.snapshot().globalInFlight <= 10);
  assert.ok((limiter.snapshot().perJobInFlight.large ?? 0) <= 8);
  const competing = limiter.withSlot("other", hold);
  await waitUntil(() => limiter.snapshot().perJobInFlight.other === 1, "reserved slot");
  assert.equal(limiter.snapshot().perJobInFlight.other, 1);
  for (const release of held) release();
  await Promise.all(large);
  assert.equal(await competing, undefined);
  assert.ok(limiter.samples.every((sample) => sample.globalInFlight <= 10));
  resetTranscriptEnhancementLimiterForTests();
});

test("COMPAT-01 old SKIPPED/timeout metadata is readable", () => {
  const job = parseTranscriptEnhancementJob({
    transcriptEnhancement: {
      status: "SKIPPED",
      skipReason: "timeout",
      startedAt: "2026-01-01T00:00:00.000Z",
    },
  });
  assert.equal(job.schemaVersion, "legacy");
  assert.equal(job.executionStatus, "NOT_STARTED");
  assert.equal(job.publicationEligible, false);
  assert.equal(job.skipReason, "timeout");
  const projection = projectTranscriptEnhancementStatus({
    transcriptEnhancement: { status: "SKIPPED", skipReason: "timeout" },
  });
  assert.equal(projection.uiStatus, "SKIPPED");
  assert.equal(projection.improveAvailable, true);
});

test("OBS-01 provider usage is real or unknown, never maxTokens masquerading", () => {
  assert.deepEqual(
    extractProviderUsage({ usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } }),
    { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
  );
  assert.deepEqual(extractProviderUsage({ usage: {} }), {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  });
  assert.notEqual(extractProviderUsage({ usage: { total_tokens: 18 } }).totalTokens, 6000);
});

test("DUR/PUB/MAP/AI/CONTINUE pipeline contracts", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-pipeline");
    const db = createInMemoryDb(state);
    const provider = createProviderGate();
    const run = executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      runInBackground: true,
      dependencies: {
        db,
        enhance: (async () => {
          await provider.promise;
          return completedEnhance("enhanced transcript");
        }) as never,
        schedule: (work) => {
          void work();
        },
      },
    });
    await waitUntil(() => {
      const running = parseTranscriptEnhancementJob(state.processingMetadata);
      return running.executionStatus === "QUEUED" || running.executionStatus === "RUNNING";
    }, "in-flight enhancement");
    const running = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(running.publicationEligible, true);
    assert.ok(running.executionStatus === "QUEUED" || running.executionStatus === "RUNNING");
    assert.equal(state.text, "original transcript");

    const mappingDuring = evaluateAiAnalysisReadiness({
      status: TranscriptStatus.COMPLETED,
      text: state.text,
      diarizedText: state.diarizedText,
      hasSpeakerDiarization: false,
      speakerMappingStatus: "NOT_REQUIRED",
      speakerMapping: state.speakerMapping,
      enhancementPublicationEligible: true,
      enhancementStatus: "RUNNING",
      segments: state.segments,
    });
    assert.equal(mappingDuring.reason, "ENHANCEMENT_RUNNING");
    state.speakerMapping = { speaker_1: "buyer" };

    const continued = await continueWithCurrentTranscript({
      db,
      transcriptId: state.id,
    });
    assert.equal(continued.outcome, "cancelled");
    const afterContinue = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(afterContinue.publicationEligible, false);
    assert.equal(afterContinue.executionStatus, "CANCELLED_FOR_PUBLICATION");
    assert.equal(state.speakerMapping?.speaker_1, "buyer");
    const secondContinue = await continueWithCurrentTranscript({
      db,
      transcriptId: state.id,
    });
    assert.equal(secondContinue.outcome, "already_not_eligible");
    const aiAfterContinue = evaluateAiAnalysisReadiness({
      status: TranscriptStatus.COMPLETED,
      text: state.text,
      diarizedText: state.diarizedText,
      hasSpeakerDiarization: false,
      speakerMappingStatus: "NOT_REQUIRED",
      speakerMapping: null,
      enhancementPublicationEligible: false,
      enhancementStatus: "RUNNING",
      segments: state.segments,
    });
    assert.equal(aiAfterContinue.ready, true);
    provider.gate.release?.();
    await run;
    assert.equal(state.text, "original transcript");
    assert.equal(state.segments[0]?.text, "original transcript");
  });
});

test("PUB-02 all-success current job atomically publishes latest mapping", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-publish");
    const db = createInMemoryDb(state);
    const result = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      dependencies: {
        db,
        enhance: (async () => completedEnhance("enhanced transcript")) as never,
      },
    });
    assert.equal(result.outcome, "started");
    assert.equal(state.text, "enhanced transcript");
    assert.equal(state.segments[0]?.text, "enhanced transcript");
    assert.equal(state.segments[0]?.qualityText, "original transcript");
    const job = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(job.executionStatus, "COMPLETED");
    assert.equal(job.terminalQuality, "COMPLETED");
    assert.equal(job.publicationEligible, false);
    assert.match(state.diarizedText ?? "", /Buyer/);
  });
});

test("PUB-03 terminal PARTIAL does not publish mixed text", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-partial");
    const db = createInMemoryDb(state);
    await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      dependencies: {
        db,
        enhance: (async () => ({
          ...completedEnhance("partial enhanced"),
          meta: { ...completedEnhance("partial enhanced").meta, overallStatus: "PARTIAL" },
        })) as never,
      },
    });
    assert.equal(state.text, "original transcript");
    assert.equal(state.segments[0]?.text, "original transcript");
    const job = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(job.publicationEligible, false);
    assert.ok(job.terminalQuality === "PARTIAL" || job.terminalQuality === "FAILED");
  });
});

test("PUB-06 lexical save fences late publication", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-lex");
    const db = createInMemoryDb(state);
    const gate: { release: ((value?: void) => void) | null } = { release: null };
    const run = executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      runInBackground: true,
      dependencies: {
        db,
        enhance: (async () => {
          await new Promise<void>((resolve) => {
            gate.release = resolve;
          });
          return completedEnhance("late enhanced");
        }) as never,
        schedule: (work) => {
          void work();
        },
      },
    });
    await waitUntil(() => gate.release !== null, "provider gate");
    await revokeEnhancementPublication({
      db,
      transcriptId: state.id,
      reason: "lexical_save",
    });
    state.text = "human edit";
    state.segments[0]!.text = "human edit";
    gate.release?.();
    await run;
    assert.equal(state.text, "human edit");
    assert.equal(state.segments[0]?.text, "human edit");
  });
});

test("REC-01/02/04 lease reclaim preserves completed chunks and skips cancelled jobs", async () => {
  const state = baseTranscript("tr-rec");
  const nowMs = Date.parse("2026-01-01T00:01:00.000Z");
  seedJob(state, {
    schemaVersion: "d1-v1",
    jobId: "job-1",
    runId: "job-1",
    leaseToken: "old-lease",
    leaseExpiresAt: "2026-01-01T00:00:30.000Z",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: "abc",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress: computeEnhancementProgress({
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "RUNNING"),
    }),
    chunks: {
      "0": chunk(0, "COMPLETED", { unpublishedByOrderIndex: { "0": "kept" } }),
      "1": chunk(1, "RUNNING"),
    },
    unpublishedByOrderIndex: { "0": "kept" },
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
  });
  const db = createInMemoryDb(state);
  const first = await runTranscriptEnhancementRecoveryTick({
    db,
    now: () => nowMs,
    transcriptIds: [state.id],
    resume: false,
  });
  assert.equal(first.claimed, 1);
  const afterClaim = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(afterClaim.chunks["0"]?.status, "COMPLETED");
  assert.equal(afterClaim.chunks["1"]?.status, "RETRYABLE_FAILED");
  assert.notEqual(afterClaim.leaseToken, "old-lease");

  const second = await runTranscriptEnhancementRecoveryTick({
    db,
    now: () => nowMs,
    transcriptIds: [state.id],
    resume: false,
  });
  assert.equal(second.claimed, 0);
  assert.equal(second.skippedActiveLease, 1);

  await continueWithCurrentTranscript({ db, transcriptId: state.id, nowMs });
  state.processingMetadata = fenceEnhancementJobInMetadata(
    state.processingMetadata,
    "continue_with_current",
    nowMs,
  );
  const cancelled = await runTranscriptEnhancementRecoveryTick({
    db,
    now: () => nowMs + 120_000,
    transcriptIds: [state.id],
    resume: true,
  });
  assert.ok(cancelled.skippedCancelled >= 1 || cancelled.claimed === 0);
  const finalJob = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(finalJob.publicationEligible, false);
});

test("RET-01 retranscription invalidates old enhancement job", () => {
  const fenced = fenceEnhancementJobInMetadata(
    {
      transcriptEnhancement: {
        schemaVersion: "d1-v1",
        executionStatus: "RUNNING",
        publicationEligible: true,
        runId: "old",
        retranscribeCount: 0,
        chunks: { "0": chunk(0, "COMPLETED") },
      },
    },
    "retranscription",
  );
  const job = parseTranscriptEnhancementJob(fenced);
  assert.equal(job.publicationEligible, false);
  assert.equal(job.executionStatus, "CANCELLED_FOR_PUBLICATION");
  assert.equal(job.cancelReason, "retranscription");
});

test("REC-03 periodic recovery is owned by maintenance oneshot, not status traffic", async () => {
  const { readFile } = await import("node:fs/promises");
  const cli = await readFile("scripts/ops/stage-3-10-maintenance.ts", "utf8");
  const maintenance = await readFile("lib/stage-3-10-maintenance.ts", "utf8");
  assert.match(cli, /enhancement-recovery/);
  assert.match(maintenance, /runTranscriptEnhancementRecoverySweep/);
});

test("LAB-18 recovery tick resumes without materials/status and does not rerun completed chunks", async () => {
  const state = baseTranscript("tr-rec-resume");
  const nowMs = Date.parse("2026-01-01T00:01:00.000Z");
  seedJob(state, {
    schemaVersion: "d1-v1",
    jobId: "job-resume",
    runId: "job-resume",
    leaseToken: "expired-lease",
    leaseExpiresAt: "2026-01-01T00:00:30.000Z",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: "abc",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress: computeEnhancementProgress({
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "PENDING"),
    }),
    chunks: {
      "0": chunk(0, "COMPLETED", { unpublishedByOrderIndex: { "0": "kept" } }),
      "1": chunk(1, "PENDING"),
    },
    unpublishedByOrderIndex: { "0": "kept" },
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
  });
  const db = createInMemoryDb(state);
  let resumeCalls = 0;
  const result = await runTranscriptEnhancementRecoveryTick({
    db,
    now: () => nowMs,
    transcriptIds: [state.id],
    resume: true,
    runJob: async () => {
      resumeCalls += 1;
    },
  });
  assert.equal(result.claimed, 1);
  assert.equal(result.resumed, 1);
  assert.equal(resumeCalls, 1);
  const job = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(job.chunks["0"]?.status, "COMPLETED");
  assert.equal(job.chunks["0"]?.unpublishedByOrderIndex?.["0"], "kept");
});

test("COMPAT-02 Improve after historical timeout starts a new-format job", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-compat-improve");
    state.processingMetadata = {
      transcriptionProvider: "yandex_speechkit",
      transcriptEnhancement: {
        status: "SKIPPED",
        skipReason: "timeout",
      },
    };
    const db = createInMemoryDb(state);
    const result = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      forceReenhancement: true,
      dependencies: {
        db,
        enhance: (async () => completedEnhance("fresh durable")) as never,
      },
    });
    assert.equal(result.outcome, "started");
    const job = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(job.schemaVersion, "d1-v1");
    assert.equal(job.executionStatus, "COMPLETED");
    assert.equal(state.text, "fresh durable");
  });
});

function chunkResult(
  chunk: EnhancementChunk,
  ok: boolean,
  errorCategory: string | null,
): ChunkExecutionResult {
  const enhancedByIndex = new Map<number, string>();
  if (ok) {
    for (const target of chunk.targets) {
      enhancedByIndex.set(target.sourceIndex, `enhanced-${target.sourceIndex}`);
    }
  }
  return {
    chunkIndex: chunk.chunkIndex,
    enhancedByIndex,
    retryCount: 0,
    modelUsed: "test-model",
    fallbackTriggered: false,
    fallbackReason: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    latencyMs: 1,
    status: ok ? "COMPLETED" : "FAILED_FALLBACK",
    errorCategory,
    warnings: [],
    primaryModel: "test-model",
    fallbackModel: null,
    attempts: [],
    schemaValidationPassed: ok,
    usageClassification: "unknown",
  };
}

function twoSegmentTranscript(id: string): InMemoryTranscript {
  const state = baseTranscript(id);
  state.segments.push({
    id: `${id}-seg-1`,
    orderIndex: 1,
    speakerLabel: "speaker_1",
    startSeconds: 1,
    endSeconds: 2,
    mappedParticipantId: "buyer",
    text: "second original",
    qualityText: "second original",
  });
  state.text = "original transcript second original";
  return state;
}

test("RETRY-01/02/03 DUR-01/02 PUB-01/04 sibling checkpoints and bounded retry", async () => {
  assert.equal(classifyEnhancementRetry(new Error("http 429")).retryable, true);
  assert.equal(classifyEnhancementRetry(new Error("http 503")).retryable, true);
  assert.equal(classifyEnhancementRetry(new Error("network failure")).retryable, true);
  assert.equal(classifyEnhancementRetry(new Error("schema invalid")).retryable, true);
  assert.equal(classifyEnhancementRetry(new Error("catastrophic shrink")).retryable, false);

  await withEnhancementEnv(async () => {
    const previousSegments = process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS;
    process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS = "1";
    try {
      const state = twoSegmentTranscript("tr-retry");
      const db = createInMemoryDb(state);
      const invoked: number[][] = [];
      const seenPublishedDuringRun: string[] = [];
      await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "manual",
        dependencies: {
          db,
          sleep: async () => {},
          runChunkedEnhancement: (async (
            segments: TranscriptEnhancementInputSegment[],
            options?: EnhanceTranscriptOptions,
          ) => {
            const pass = invoked.length;
            const thisPass: number[] = [];
            const planned = buildTranscriptEnhancementChunks(segments);
            for (const plannedChunk of planned) {
              if (options?.skipChunkIndexes?.has(plannedChunk.chunkIndex)) {
                continue;
              }
              thisPass.push(plannedChunk.chunkIndex);
              await options?.onChunkStart?.(plannedChunk);
              const ok = plannedChunk.chunkIndex === 0 || pass >= 1;
              await options?.onChunkFinish?.(
                chunkResult(
                  plannedChunk,
                  ok,
                  ok ? null : "http 429",
                ),
                plannedChunk,
              );
              seenPublishedDuringRun.push(state.text);
            }
            invoked.push(thisPass);
            return completedEnhance("should-not-publish-incrementally");
          }) as never,
        },
      });
      assert.equal(invoked[0]?.includes(0), true);
      assert.equal(invoked[0]?.includes(1), true);
      assert.equal(invoked[1]?.includes(0), false);
      assert.equal(invoked[1]?.includes(1), true);
      assert.ok(seenPublishedDuringRun.every((text) => text.includes("original transcript")));
      const job = parseTranscriptEnhancementJob(state.processingMetadata);
      assert.equal(job.chunks["0"]?.status, "COMPLETED");
      assert.equal(job.chunks["1"]?.status, "COMPLETED");
      assert.equal(job.executionStatus, "COMPLETED");
      assert.equal(state.segments[0]?.qualityText, "original transcript");
    } finally {
      if (previousSegments === undefined) {
        delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS;
      } else {
        process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS = previousSegments;
      }
    }
  });

  await withEnhancementEnv(async () => {
    const previousSegments = process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS;
    process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS = "1";
    try {
      const state = twoSegmentTranscript("tr-schema");
      const db = createInMemoryDb(state);
      await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "manual",
        dependencies: {
          db,
          sleep: async () => {},
          runChunkedEnhancement: (async (
            segments: TranscriptEnhancementInputSegment[],
            options?: EnhanceTranscriptOptions,
          ) => {
            const planned = buildTranscriptEnhancementChunks(segments);
            for (const plannedChunk of planned) {
              if (options?.skipChunkIndexes?.has(plannedChunk.chunkIndex)) continue;
              await options?.onChunkStart?.(plannedChunk);
              const ok = plannedChunk.chunkIndex === 0;
              await options?.onChunkFinish?.(
                chunkResult(
                  plannedChunk,
                  ok,
                  ok ? null : "schema invalid",
                ),
                plannedChunk,
              );
            }
            return completedEnhance("unused");
          }) as never,
        },
      });
      assert.equal(state.text, "original transcript second original");
      const job = parseTranscriptEnhancementJob(state.processingMetadata);
      assert.equal(job.chunks["0"]?.status, "COMPLETED");
      assert.equal(job.chunks["1"]?.status, "FAILED");
      assert.equal(job.publicationEligible, false);
      assert.ok(job.terminalQuality === "PARTIAL" || job.terminalQuality === "FAILED");
      assert.notEqual(job.executionStatus, "RUNNING");
    } finally {
      if (previousSegments === undefined) {
        delete process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS;
      } else {
        process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS = previousSegments;
      }
    }
  });
});

test("DUR-01 chunk completion persists and PUB-04 stale generation cannot publish", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-dur-01");
    seedJob(state, {
      schemaVersion: "d1-v1",
      jobId: "job-dur",
      runId: "job-dur",
      leaseToken: "lease-dur",
      leaseExpiresAt: "2026-01-01T00:10:00.000Z",
      executionStatus: "RUNNING",
      publicationEligible: true,
      terminalQuality: null,
      inputIdentity: "abc",
      retranscribeCount: 0,
      triggerSource: "manual",
      cancelReason: null,
      cancelledAt: null,
      publicationOutcome: null,
      progress: computeEnhancementProgress({ "0": chunk(0, "PENDING") }),
      chunks: { "0": chunk(0, "PENDING") },
      unpublishedByOrderIndex: {},
      queuedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: null,
      safetyDeadlineAt: null,
      skipReason: null,
      status: "RUNNING",
    });
    const db = createInMemoryDb(state);
    await checkpointEnhancementChunk({
      db,
      transcriptId: state.id,
      owner: {
        runId: "job-dur",
        leaseToken: "lease-dur",
        inputIdentity: "abc",
        retranscribeCount: 0,
      },
      chunk: chunk(0, "COMPLETED", { unpublishedByOrderIndex: { "0": "kept-checkpoint" } }),
    });
    const afterCheckpoint = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(afterCheckpoint.chunks["0"]?.status, "COMPLETED");
    assert.equal(afterCheckpoint.unpublishedByOrderIndex["0"], "kept-checkpoint");

    const stale = twoSegmentTranscript("tr-stale-gen");
    const staleDb = createInMemoryDb(stale);
    await executeTranscriptEnhancement({
      transcriptId: stale.id,
      triggerSource: "manual",
      dependencies: {
        db: staleDb as never,
        sleep: async () => {},
        runChunkedEnhancement: (async (
          segments: TranscriptEnhancementInputSegment[],
          options?: EnhanceTranscriptOptions,
        ) => {
          const planned = buildTranscriptEnhancementChunks(segments);
          for (const plannedChunk of planned) {
            await options?.onChunkStart?.(plannedChunk);
            await options?.onChunkFinish?.(chunkResult(plannedChunk, true, null), plannedChunk);
          }
          stale.retranscribeCount = 1;
          return completedEnhance("late-stale");
        }) as never,
      },
    });
    assert.equal(stale.text, "original transcript second original");
    const staleJob = parseTranscriptEnhancementJob(stale.processingMetadata);
    assert.notEqual(staleJob.publicationOutcome, "published");
  });
});

test("AI-03 analyze does not consume unpublished chunk checkpoints", async () => {
  const { readFile } = await import("node:fs/promises");
  const analyze = await readFile("app/api/sessions/[sessionId]/analyze/route.ts", "utf8");
  assert.doesNotMatch(analyze, /unpublishedByOrderIndex/);
});

test("R05 Skip before final checkpoint rejects the late checkpoint and does not publish", async () => {
  const state = baseTranscript("tr-r05-a");
  const nowMs = Date.parse("2026-01-01T00:01:00.000Z");
  seedJob(state, {
    schemaVersion: "d1-v1",
    jobId: "job-skip-a",
    runId: "job-skip-a",
    leaseToken: "lease-skip-a",
    leaseExpiresAt: "2026-01-01T01:00:00.000Z",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: "abc",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress: computeEnhancementProgress({
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "RUNNING"),
    }),
    chunks: {
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "RUNNING"),
    },
    unpublishedByOrderIndex: { "0": "enhanced-0" },
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
  });
  const db = createInMemoryDb(state);
  const skipped = await continueWithCurrentTranscript({ db, transcriptId: state.id, nowMs });
  assert.equal(skipped.outcome, "cancelled");
  const late = await checkpointEnhancementChunk({
    db,
    transcriptId: state.id,
    owner: {
      runId: "job-skip-a",
      leaseToken: "lease-skip-a",
      inputIdentity: "abc",
      retranscribeCount: 0,
    },
    chunk: chunk(1, "COMPLETED"),
    nowMs,
  });
  assert.equal(late, null);
  const after = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(after.executionStatus, "CANCELLED_FOR_PUBLICATION");
  assert.equal(after.publicationEligible, false);
  assert.notEqual(after.executionStatus, "COMPLETED");
  const published = await publishEnhancementIfEligible({
    db,
    transcriptId: state.id,
    owner: {
      runId: "job-skip-a",
      leaseToken: "lease-skip-a",
      inputIdentity: "abc",
      retranscribeCount: 0,
    },
    nowMs,
  });
  assert.equal(published.published, false);
  assert.equal(state.text, "original transcript");
});

test("R05 Skip after all chunks are checkpointed still beats later publication", async () => {
  const state = baseTranscript("tr-r05-b");
  const nowMs = Date.parse("2026-01-01T00:01:00.000Z");
  seedJob(state, {
    schemaVersion: "d1-v1",
    jobId: "job-skip-b",
    runId: "job-skip-b",
    leaseToken: "lease-skip-b",
    leaseExpiresAt: "2026-01-01T01:00:00.000Z",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: "abc",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress: computeEnhancementProgress({ "0": chunk(0, "COMPLETED") }),
    chunks: { "0": chunk(0, "COMPLETED") },
    unpublishedByOrderIndex: { "0": "enhanced-0" },
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
  });
  const db = createInMemoryDb(state);
  const skipped = await continueWithCurrentTranscript({ db, transcriptId: state.id, nowMs });
  assert.equal(skipped.outcome, "cancelled");
  const published = await publishEnhancementIfEligible({
    db,
    transcriptId: state.id,
    owner: {
      runId: "job-skip-b",
      leaseToken: "lease-skip-b",
      inputIdentity: "abc",
      retranscribeCount: 0,
    },
    nowMs,
  });
  assert.equal(published.published, false);
  const after = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(after.executionStatus, "CANCELLED_FOR_PUBLICATION");
  assert.equal(state.text, "original transcript");
});

test("R05 publication first makes later Skip already-not-eligible and cannot unpublish", async () => {
  const state = baseTranscript("tr-r05-c");
  const nowMs = Date.parse("2026-01-01T00:01:00.000Z");
  seedJob(state, {
    schemaVersion: "d1-v1",
    jobId: "job-skip-c",
    runId: "job-skip-c",
    leaseToken: "lease-skip-c",
    leaseExpiresAt: "2026-01-01T01:00:00.000Z",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: "abc",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress: computeEnhancementProgress({
      "0": chunk(0, "COMPLETED", { unpublishedByOrderIndex: { "0": "enhanced published" } }),
    }),
    chunks: {
      "0": chunk(0, "COMPLETED", { unpublishedByOrderIndex: { "0": "enhanced published" } }),
    },
    unpublishedByOrderIndex: { "0": "enhanced published" },
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
  });
  const db = createInMemoryDb(state);
  const published = await publishEnhancementIfEligible({
    db,
    transcriptId: state.id,
    owner: {
      runId: "job-skip-c",
      leaseToken: "lease-skip-c",
      inputIdentity: "abc",
      retranscribeCount: 0,
    },
    nowMs,
  });
  assert.equal(published.published, true);
  assert.equal(state.text, "enhanced published");
  assert.equal(state.segments[0]?.qualityText, "original transcript");
  const publication = parseTranscriptEnhancementPublication(state.processingMetadata);
  assert.equal(publication?.runId, "job-skip-c");
  assert.equal(publication?.retranscribeCount, 0);
  assert.equal(
    publication?.segmentDigestByOrderIndex["0"] != null,
    true,
  );
  const skipped = await continueWithCurrentTranscript({ db, transcriptId: state.id, nowMs });
  assert.equal(skipped.outcome, "already_not_eligible");
  const after = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(after.executionStatus, "COMPLETED");
  assert.equal(after.publicationEligible, false);
  assert.equal(state.text, "enhanced published");
});

test("R07 permanent chunk failure terminalizes instead of leaving RUNNING+ineligible", async () => {
  const state = baseTranscript("tr-r07-perm");
  const nowMs = Date.parse("2026-01-01T00:01:00.000Z");
  seedJob(state, {
    schemaVersion: "d1-v1",
    jobId: "job-perm",
    runId: "job-perm",
    leaseToken: "lease-perm",
    leaseExpiresAt: "2026-01-01T01:00:00.000Z",
    executionStatus: "RUNNING",
    publicationEligible: true,
    terminalQuality: null,
    inputIdentity: "abc",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: null,
    cancelledAt: null,
    publicationOutcome: null,
    progress: computeEnhancementProgress({
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "RUNNING"),
    }),
    chunks: {
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "RUNNING"),
    },
    unpublishedByOrderIndex: { "0": "enhanced-0" },
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
  });
  const db = createInMemoryDb(state);
  await checkpointEnhancementChunk({
    db,
    transcriptId: state.id,
    owner: {
      runId: "job-perm",
      leaseToken: "lease-perm",
      inputIdentity: "abc",
      retranscribeCount: 0,
    },
    chunk: chunk(1, "FAILED"),
    nowMs,
  });
  const after = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.equal(after.executionStatus, "FAILED");
  assert.equal(after.publicationEligible, false);
  assert.equal(after.terminalQuality, "PARTIAL");
  assert.equal(state.text, "original transcript");
});

test("R07 historical RUNNING+ineligible is reconciled without re-enabling publication", async () => {
  const state = baseTranscript("tr-r07-hist");
  const nowMs = Date.parse("2026-01-01T00:01:00.000Z");
  seedJob(state, {
    schemaVersion: "d1-v1",
    jobId: "job-hist",
    runId: "job-hist",
    leaseToken: "lease-hist",
    leaseExpiresAt: "2026-01-01T00:00:30.000Z",
    executionStatus: "RUNNING",
    publicationEligible: false,
    terminalQuality: null,
    inputIdentity: "abc",
    retranscribeCount: 0,
    triggerSource: "manual",
    cancelReason: "permanent_chunk_failure",
    cancelledAt: null,
    publicationOutcome: null,
    progress: computeEnhancementProgress({
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "FAILED"),
      "2": chunk(2, "PENDING"),
    }),
    chunks: {
      "0": chunk(0, "COMPLETED"),
      "1": chunk(1, "FAILED"),
      "2": chunk(2, "PENDING"),
    },
    unpublishedByOrderIndex: { "0": "enhanced-0" },
    queuedAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    safetyDeadlineAt: null,
    skipReason: null,
    status: "RUNNING",
  });
  const db = createInMemoryDb(state);
  const recovered = await runTranscriptEnhancementRecoveryTick({
    db,
    now: () => nowMs,
    transcriptIds: [state.id],
    resume: false,
  });
  assert.equal(recovered.reconciledIllegal, 1);
  const after = parseTranscriptEnhancementJob(state.processingMetadata);
  assert.notEqual(after.executionStatus, "RUNNING");
  assert.equal(after.publicationEligible, false);
  assert.equal(after.terminalQuality, "PARTIAL");
  const direct = await reconcileIllegalEnhancementJob({
    db,
    transcriptId: state.id,
    nowMs,
  });
  assert.equal(direct, null);
});

test("Repeat Improve after Skip admits a new runId and fences the old callback", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-repeat");
    const nowMs = Date.parse("2026-01-01T00:01:00.000Z");
    seedJob(state, {
      schemaVersion: "d1-v1",
      jobId: "old-run",
      runId: "old-run",
      leaseToken: "old-lease",
      leaseExpiresAt: "2026-01-01T01:00:00.000Z",
      executionStatus: "CANCELLED_FOR_PUBLICATION",
      publicationEligible: false,
      terminalQuality: null,
      inputIdentity: "old-identity",
      retranscribeCount: 0,
      triggerSource: "manual",
      cancelReason: "continue_with_current",
      cancelledAt: "2026-01-01T00:00:30.000Z",
      publicationOutcome: "cancelled_continue",
      progress: computeEnhancementProgress({ "0": chunk(0, "COMPLETED") }),
      chunks: { "0": chunk(0, "COMPLETED") },
      unpublishedByOrderIndex: { "0": "old-enhanced" },
      queuedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:30.000Z",
      safetyDeadlineAt: null,
      skipReason: null,
      status: "SKIPPED",
    });
    const db = createInMemoryDb(state);
    const started = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual_reenhancement",
      forceReenhancement: true,
      runInBackground: true,
      dependencies: {
        db,
        enhance: (async () => {
          await new Promise(() => {});
          return completedEnhance("should-not-finish");
        }) as never,
        schedule: () => {},
      },
    });
    assert.equal(started.outcome, "started");
    const admitted = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.notEqual(admitted.runId, "old-run");
    assert.equal(admitted.publicationEligible, true);
    assert.equal(admitted.progress.completedChunks, 0);
    const staleCallback = await checkpointEnhancementChunk({
      db,
      transcriptId: state.id,
      owner: {
        runId: "old-run",
        leaseToken: "old-lease",
        inputIdentity: "old-identity",
        retranscribeCount: 0,
      },
      chunk: chunk(0, "COMPLETED"),
      nowMs,
    });
    assert.equal(staleCallback, null);
    const afterStale = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(afterStale.runId, admitted.runId);
    assert.notEqual(afterStale.runId, "old-run");
  });
});

test("MRAW manual segment keeps qualityText null through enhancement and Repeat Improve", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-mraw-manual");
    state.segments[0] = {
      ...state.segments[0]!,
      text: "manual text",
      qualityText: null,
    };
    state.text = "manual text";
    const db = createInMemoryDb(state);
    const firstInputs: string[] = [];
    const first = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      dependencies: {
        db,
        enhance: (async (segments: TranscriptEnhancementInputSegment[]) => {
          firstInputs.push(...segments.map((segment) => segment.originalText));
          return completedEnhance("enhanced manual");
        }) as never,
      },
    });
    assert.equal(first.outcome, "started");
    assert.deepEqual(firstInputs, ["manual text"]);
    assert.equal(state.segments[0]?.text, "enhanced manual");
    assert.equal(state.segments[0]?.qualityText, null);
    const firstPublication = parseTranscriptEnhancementPublication(state.processingMetadata);
    assert.equal(firstPublication?.segmentDigestByOrderIndex["0"] != null, true);

    const secondInputs: string[] = [];
    const second = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual_reenhancement",
      forceReenhancement: true,
      dependencies: {
        db,
        enhance: (async (segments: TranscriptEnhancementInputSegment[]) => {
          secondInputs.push(...segments.map((segment) => segment.originalText));
          return completedEnhance("second enhance");
        }) as never,
      },
    });
    assert.equal(second.outcome, "started");
    assert.deepEqual(secondInputs, ["enhanced manual"]);
    assert.equal(state.segments[0]?.text, "second enhance");
    assert.equal(state.segments[0]?.qualityText, null);
    const secondPublication = parseTranscriptEnhancementPublication(state.processingMetadata);
    assert.equal(secondPublication?.segmentDigestByOrderIndex["0"] != null, true);
  });
});

test("MRAW copy-through manual segment publishes a digest and keeps qualityText null", async () => {
  await withEnhancementEnv(async () => {
    const state = baseTranscript("tr-mraw-copy");
    state.segments[0] = {
      ...state.segments[0]!,
      text: "manual copy through",
      qualityText: null,
    };
    state.text = "manual copy through";
    const db = createInMemoryDb(state);
    const result = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      dependencies: {
        db,
        enhance: (async () => completedEnhance("manual copy through")) as never,
      },
    });
    assert.equal(result.outcome, "started");
    assert.equal(state.segments[0]?.text, "manual copy through");
    assert.equal(state.segments[0]?.qualityText, null);
    const publication = parseTranscriptEnhancementPublication(state.processingMetadata);
    assert.equal(publication?.segmentDigestByOrderIndex["0"] != null, true);
  });
});
