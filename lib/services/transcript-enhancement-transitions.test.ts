import assert from "node:assert/strict";
import test from "node:test";

import { buildCanonicalDiarizedText } from "@/lib/transcription/canonical-diarized-text";
import { getTranscriptEnhancementNamespace } from "@/lib/transcription/processing-metadata";
import {
  ENHANCEMENT_TIMEOUT_SKIP_REASON,
  isEnhancementRunTimedOut,
  persistEnhancementTimeoutSkip,
  reconcileTranscriptEnhancementTimeout,
} from "@/lib/services/transcript-enhancement-timeout";

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
    text: state.text,
    diarizedText: state.diarizedText,
    updatedAt: state.updatedAt,
    retranscribeCount: state.retranscribeCount,
    processingMetadata: { ...state.processingMetadata },
    segments: state.segments.map((segment) => ({ ...segment })),
  };
}

function createInMemoryDb(state: InMemoryTranscript) {
  const db = {
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
    $transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => callback(db),
  };
  return db;
}

function enhancementStatus(state: InMemoryTranscript): string | null {
  const status = getTranscriptEnhancementNamespace(state.processingMetadata).status;
  return typeof status === "string" ? status : null;
}

function baseTranscript(id: string): InMemoryTranscript {
  return {
    id,
    text: "original transcript",
    diarizedText: "speaker_1: original transcript",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    retranscribeCount: 0,
    processingMetadata: { transcriptionProvider: "yandex_speechkit" },
    speakerMapping: null,
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
        mappedParticipantId: null,
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

async function waitUntil(predicate: () => boolean, label: string) {
  for (let i = 0; i < 4000; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("isEnhancementRunTimedOut uses startedAt and the configured window", () => {
  const startedAt = "2026-01-01T00:00:00.000Z";
  const metadata = {
    transcriptEnhancement: { status: "RUNNING", startedAt },
  };
  assert.equal(
    isEnhancementRunTimedOut(metadata, Date.parse(startedAt) + 6999, 7000),
    false,
  );
  assert.equal(
    isEnhancementRunTimedOut(metadata, Date.parse(startedAt) + 7001, 7000),
    true,
  );
  assert.equal(
    isEnhancementRunTimedOut(
      { transcriptEnhancement: { status: "RUNNING" } },
      Date.now(),
      7000,
    ),
    true,
  );
  assert.equal(
    isEnhancementRunTimedOut(
      { transcriptEnhancement: { status: "COMPLETED", startedAt } },
      Date.parse(startedAt) + 60_000,
      7000,
    ),
    false,
  );
});

test("ET01_FAST_SUCCESS applies enhanced transcript and COMPLETED before timeout", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const state = baseTranscript("tr_et01");
    const db = createInMemoryDb(state);
    const result = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      dependencies: {
        db: db as never,
        enhance: (async () => completedEnhance("enhanced transcript")) as never,
        waitForTimeout: () => new Promise(() => {}),
      },
    });
    assert.equal(result.outcome, "started");
    assert.equal(state.text, "enhanced transcript");
    assert.equal(enhancementStatus(state), "COMPLETED");
  });
});

test("ET02_FAST_FAILURE keeps original transcript and unlocks as FAILED", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const state = baseTranscript("tr_et02");
    const db = createInMemoryDb(state);
    const result = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      dependencies: {
        db: db as never,
        enhance: (async () => {
          throw new Error("provider failed");
        }) as never,
        waitForTimeout: () => new Promise(() => {}),
      },
    });
    assert.equal(result.outcome, "started");
    assert.equal(state.text, "original transcript");
    assert.equal(enhancementStatus(state), "FAILED");
  });
});

test("ET03_TIMEOUT keeps original transcript and becomes non-authoritative SKIPPED", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const state = baseTranscript("tr_et03");
    const db = createInMemoryDb(state);
    let resolveTimeout: (() => void) | null = null;
    const timeoutGate = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    let resolveProvider: (() => void) | null = null;
    const run = executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      runInBackground: true,
      dependencies: {
        db: db as never,
        enhance: (async () => {
          await new Promise<void>((resolve) => {
            resolveProvider = resolve;
          });
          return completedEnhance("late enhanced transcript");
        }) as never,
        waitForTimeout: () => timeoutGate,
      },
    });
    await waitUntil(() => enhancementStatus(state) === "RUNNING", "RUNNING");
    resolveTimeout?.();
    await waitUntil(() => enhancementStatus(state) === "SKIPPED", "SKIPPED");
    await run;
    assert.equal(state.text, "original transcript");
    assert.equal(
      getTranscriptEnhancementNamespace(state.processingMetadata).skipReason,
      ENHANCEMENT_TIMEOUT_SKIP_REASON,
    );
    resolveProvider?.();
  });
});

test("ET04_LATE_SUCCESS_AFTER_TIMEOUT discards the late provider result", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const state = baseTranscript("tr_et04");
    const db = createInMemoryDb(state);
    let resolveTimeout: (() => void) | null = null;
    const timeoutGate = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    let resolveProvider: (() => void) | null = null;
    let providerSettled = false;
    const run = executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      runInBackground: true,
      dependencies: {
        db: db as never,
        enhance: (async () => {
          await new Promise<void>((resolve) => {
            resolveProvider = resolve;
          });
          providerSettled = true;
          return completedEnhance("late enhanced transcript");
        }) as never,
        waitForTimeout: () => timeoutGate,
      },
    });
    await waitUntil(() => enhancementStatus(state) === "RUNNING", "RUNNING");
    resolveTimeout?.();
    await waitUntil(() => enhancementStatus(state) === "SKIPPED", "SKIPPED");
    await run;
    resolveProvider?.();
    await waitUntil(() => providerSettled, "late provider");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.text, "original transcript");
    assert.equal(enhancementStatus(state), "SKIPPED");
  });
});

test("ET05_TIMEOUT_THEN_MANUAL_EDIT preserves the manual edit against a late result", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const state = baseTranscript("tr_et05");
    const db = createInMemoryDb(state);
    let resolveTimeout: (() => void) | null = null;
    const timeoutGate = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    let resolveProvider: (() => void) | null = null;
    let providerSettled = false;
    const run = executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      runInBackground: true,
      dependencies: {
        db: db as never,
        enhance: (async () => {
          await new Promise<void>((resolve) => {
            resolveProvider = resolve;
          });
          providerSettled = true;
          return completedEnhance("late enhanced transcript");
        }) as never,
        waitForTimeout: () => timeoutGate,
      },
    });
    await waitUntil(() => enhancementStatus(state) === "RUNNING", "RUNNING");
    resolveTimeout?.();
    await waitUntil(() => enhancementStatus(state) === "SKIPPED", "SKIPPED");
    await run;
    state.text = "manual facilitator edit";
    state.segments[0]!.text = "manual facilitator edit";
    resolveProvider?.();
    await waitUntil(() => providerSettled, "late provider");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.text, "manual facilitator edit");
    assert.equal(state.segments[0]?.text, "manual facilitator edit");
  });
});

test("ET06_TIMEOUT_THEN_MAPPING preserves mapping and canonical diarizedText", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const state = baseTranscript("tr_et06");
    const db = createInMemoryDb(state);
    let resolveTimeout: (() => void) | null = null;
    const timeoutGate = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    let resolveProvider: (() => void) | null = null;
    let providerSettled = false;
    const run = executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      runInBackground: true,
      dependencies: {
        db: db as never,
        enhance: (async () => {
          await new Promise<void>((resolve) => {
            resolveProvider = resolve;
          });
          providerSettled = true;
          return completedEnhance("late enhanced transcript");
        }) as never,
        waitForTimeout: () => timeoutGate,
      },
    });
    await waitUntil(() => enhancementStatus(state) === "RUNNING", "RUNNING");
    resolveTimeout?.();
    await waitUntil(() => enhancementStatus(state) === "SKIPPED", "SKIPPED");
    await run;
    state.speakerMapping = { speaker_1: "buyer" };
    state.segments[0]!.mappedParticipantId = "buyer";
    state.diarizedText = buildCanonicalDiarizedText({
      segments: [
        {
          speakerLabel: "speaker_1",
          displaySpeakerLabel: null,
          startSeconds: 0,
          endSeconds: 1,
          text: "original transcript",
          orderIndex: 0,
        },
      ],
      speakerMapping: { speaker_1: "buyer" },
      participants: [{ id: "buyer", displayName: "Buyer", type: "PARTICIPANT" }],
    });
    const mappedDiarized = state.diarizedText;
    resolveProvider?.();
    await waitUntil(() => providerSettled, "late provider");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.speakerMapping?.speaker_1, "buyer");
    assert.equal(state.diarizedText, mappedDiarized);
    assert.equal(state.text, "original transcript");
  });
});

test("ET07_TIMEOUT_THEN_AI keeps the accepted snapshot against a late result", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const { evaluateAiAnalysisReadiness } = await import("@/lib/ai/analysis-readiness");
    const { TranscriptStatus } = await import("@/app/generated/prisma/client");
    const state = baseTranscript("tr_et07");
    const db = createInMemoryDb(state);
    let resolveTimeout: (() => void) | null = null;
    const timeoutGate = new Promise<void>((resolve) => {
      resolveTimeout = resolve;
    });
    let resolveProvider: (() => void) | null = null;
    let providerSettled = false;
    const run = executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      runInBackground: true,
      dependencies: {
        db: db as never,
        enhance: (async () => {
          await new Promise<void>((resolve) => {
            resolveProvider = resolve;
          });
          providerSettled = true;
          return completedEnhance("late enhanced transcript");
        }) as never,
        waitForTimeout: () => timeoutGate,
      },
    });
    await waitUntil(() => enhancementStatus(state) === "RUNNING", "RUNNING");
    resolveTimeout?.();
    await waitUntil(() => enhancementStatus(state) === "SKIPPED", "SKIPPED");
    await run;
    const aiSnapshot = {
      text: state.text,
      diarizedText: state.diarizedText,
    };
    const readiness = evaluateAiAnalysisReadiness({
      status: TranscriptStatus.COMPLETED,
      text: state.text,
      diarizedText: state.diarizedText,
      hasSpeakerDiarization: false,
      speakerMappingStatus: "NOT_REQUIRED",
      speakerMapping: null,
      enhancementStatus: enhancementStatus(state),
      segments: state.segments,
    });
    assert.equal(readiness.ready, true);
    assert.notEqual(readiness.reason, "ENHANCEMENT_RUNNING");
    resolveProvider?.();
    await waitUntil(() => providerSettled, "late provider");
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(state.text, aiSnapshot.text);
    assert.equal(state.diarizedText, aiSnapshot.diarizedText);
  });
});

test("stale RUNNING recovery writes SKIPPED timeout instead of starting a new run", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const startedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const state = baseTranscript("tr_stale_timeout");
    state.processingMetadata = {
      transcriptionProvider: "yandex_speechkit",
      transcriptEnhancement: {
        status: "RUNNING",
        runId: "old-run",
        inputIdentity: "will-not-match-new-identity-until-hash",
        startedAt,
      },
    };
    const db = createInMemoryDb(state);
    let enhanceCalled = false;
    const result = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      dependencies: {
        db: db as never,
        now: () => Date.parse(startedAt) + 8_000,
        timeoutMs: 7000,
        enhance: (async () => {
          enhanceCalled = true;
          return completedEnhance("should not run");
        }) as never,
        waitForTimeout: () => new Promise(() => {}),
      },
    });
    assert.equal(result.outcome, "skipped");
    assert.equal(enhanceCalled, false);
    assert.equal(enhancementStatus(state), "SKIPPED");
    assert.equal(
      getTranscriptEnhancementNamespace(state.processingMetadata).skipReason,
      ENHANCEMENT_TIMEOUT_SKIP_REASON,
    );
  });
});

test("reconcileTranscriptEnhancementTimeout persists SKIPPED for a hung RUNNING run", async () => {
  const startedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const state = baseTranscript("tr_reconcile");
  state.processingMetadata = {
    transcriptEnhancement: {
      status: "RUNNING",
      runId: "hung-run",
      startedAt,
    },
  };
  const db = createInMemoryDb(state);
  const result = await reconcileTranscriptEnhancementTimeout({
    db: db as never,
    transcriptId: state.id,
    nowMs: Date.parse(startedAt) + 8_000,
    timeoutMs: 7000,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.running, false);
  assert.equal(enhancementStatus(state), "SKIPPED");
  const lateWrite = await persistEnhancementTimeoutSkip({
    db: db as never,
    transcriptId: state.id,
    runId: "hung-run",
  });
  assert.equal(lateWrite, false);
});
