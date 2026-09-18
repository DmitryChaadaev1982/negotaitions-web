import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";

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
  aiAnalysis?: {
    status: string;
    runToken: string | null;
    leaseExpiresAt: Date | null;
    updatedAt: Date;
  } | null;
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
    processingMetadata: { ...state.processingMetadata },
    segments: state.segments.map((segment) => ({ ...segment })),
  };
}

function createInMemoryDb(state: InMemoryTranscript) {
  // Serialize transactions so concurrent admissions observe committed state,
  // the way a real Transcript FOR UPDATE boundary would.
  let transactionQueue: Promise<unknown> = Promise.resolve();
  const runInTransaction = async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => {
    const run = transactionQueue.then(() => callback(db));
    transactionQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const db = {
    transcript: {
      findUnique: async (args: { select?: Record<string, unknown> }) => {
        const selectKeys = args.select ? Object.keys(args.select) : [];
        if (selectKeys.length === 1 && args.select?.processingMetadata) {
          return { processingMetadata: { ...state.processingMetadata } };
        }
        return {
          ...cloneTranscript(state),
          speakerMapping: state.speakerMapping ?? null,
          session: state.session,
        };
      },
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
        const expectedUpdatedAt = args.where.updatedAt;
        if (state.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          return { count: 0 };
        }
        if ("text" in args.data && typeof args.data.text === "string") {
          state.text = args.data.text;
        }
        if ("diarizedText" in args.data) {
          state.diarizedText =
            (args.data.diarizedText as string | null) ?? null;
        }
        if (
          "processingMetadata" in args.data &&
          args.data.processingMetadata &&
          typeof args.data.processingMetadata === "object"
        ) {
          state.processingMetadata = args.data.processingMetadata as Record<string, unknown>;
        }
        state.updatedAt = new Date(state.updatedAt.getTime() + 1);
        return { count: 1 };
      },
    },
    transcriptSegment: {
      update: async (args: { where: { id: string }; data: { text?: string; qualityText?: string | null } }) => {
        const segment = state.segments.find((candidate) => candidate.id === args.where.id);
        if (!segment) {
          throw new Error("Segment not found");
        }
        if (typeof args.data.text === "string") {
          segment.text = args.data.text;
        }
        if ("qualityText" in args.data) {
          segment.qualityText = args.data.qualityText ?? null;
        }
      },
    },
    aiAnalysis: {
      findUnique: async () => state.aiAnalysis ?? null,
    },
    $transaction: runInTransaction,
  };

  return db;
}

async function waitUntil(predicate: () => boolean, label: string) {
  for (let i = 0; i < 4000; i++) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function withEnhancementEnv<T>(fn: () => Promise<T>) {
  const previousAutoRun = process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
  const previousEnabled = process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED;
  process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = "true";
  process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = "true";
  return fn().finally(() => {
    if (previousAutoRun === undefined) {
      delete process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN;
    } else {
      process.env.TRANSCRIPT_ENHANCEMENT_AUTO_RUN = previousAutoRun;
    }
    if (previousEnabled === undefined) {
      delete process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED;
    } else {
      process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = previousEnabled;
    }
  });
}

test("enhancement input identity is deterministic for same payload", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    "postgresql://user:password@localhost:5432/negotiations_test";
  const { buildTranscriptEnhancementInputIdentity } = await import(
    "@/lib/services/transcript-enhancement-orchestration"
  );
  const payload = {
    transcriptId: "tr_1",
    rawSegmentsHash:
      "d41d8cd98f00b204e9800998ecf8427e2f6f6f6f6f6f6f6f6f6f6f6f6f6f6f6",
    model: "deepseek-v4-flash",
    outputMode: "json_schema",
    schemaVersion: "v1",
    promptVersion: "stage-3.9f-auto-enhancement-v1",
  };
  const first = buildTranscriptEnhancementInputIdentity(payload);
  const second = buildTranscriptEnhancementInputIdentity(payload);
  assert.equal(first, second);
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("enhancement input identity changes when raw hash changes", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ??
    "postgresql://user:password@localhost:5432/negotiations_test";
  const { buildTranscriptEnhancementInputIdentity } = await import(
    "@/lib/services/transcript-enhancement-orchestration"
  );
  const base = {
    transcriptId: "tr_1",
    model: "deepseek-v4-flash",
    outputMode: "json_schema",
    schemaVersion: "v1",
    promptVersion: "stage-3.9f-auto-enhancement-v1",
  };
  const first = buildTranscriptEnhancementInputIdentity({
    ...base,
    rawSegmentsHash: "hash-a",
  });
  const second = buildTranscriptEnhancementInputIdentity({
    ...base,
    rawSegmentsHash: "hash-b",
  });
  assert.notEqual(first, second);
  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("simultaneous automatic initial enhancement runs execute provider once", async () => {
  await withEnhancementEnv(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/negotiations_test";
    try {
      const { executeTranscriptEnhancement } = await import(
        "@/lib/services/transcript-enhancement-orchestration"
      );

      const state: InMemoryTranscript = {
        id: "tr_concurrent",
        sessionId: "session-tr_concurrent",
        status: TranscriptStatus.COMPLETED,
        text: "raw transcript",
        diarizedText: "raw transcript",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        retranscribeCount: 0,
        processingMetadata: { transcriptionProvider: "yandex_speechkit" },
        segments: [
          {
            id: "seg-1",
            orderIndex: 0,
            speakerLabel: "speaker_1",
            startSeconds: 0,
            endSeconds: 1,
            mappedParticipantId: null,
            text: "raw transcript",
            qualityText: "raw transcript",
          },
        ],
      };
      const db = createInMemoryDb(state);
      let providerCalls = 0;

      const enhance = async (segments: Array<{ index: number; originalText: string }>) => {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          segments: segments.map((segment) => ({
            index: segment.index,
            cleanedText: `${segment.originalText} enhanced`,
          })),
          globalWarnings: [],
          meta: {
            mode: "single",
            model: "deepseek-v4-flash",
            overallStatus: "COMPLETED",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            totalLatencyMs: 25,
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
            outputMode: "json_schema",
            structuredOutputEnabled: true,
            schemaVersion: "v1",
            schemaChunkCount: 1,
          },
        };
      };

      const [first, second] = await Promise.all([
        executeTranscriptEnhancement({
          transcriptId: state.id,
          triggerSource: "automatic_initial_transcription",
          dependencies: { db: db as never, enhance: enhance as never },
        }),
        executeTranscriptEnhancement({
          transcriptId: state.id,
          triggerSource: "automatic_initial_transcription",
          dependencies: { db: db as never, enhance: enhance as never },
        }),
      ]);

      assert.equal(providerCalls, 1);
      const outcomes = [first.outcome, second.outcome].sort();
      assert.deepEqual(outcomes, ["already_running", "started"]);
      assert.equal(
        (
          state.processingMetadata
            .transcriptEnhancement as Record<string, unknown>
        ).triggerSource,
        "automatic_initial_transcription",
      );
      assert.equal(
        (
          state.processingMetadata
            .transcriptEnhancement as Record<string, unknown>
        ).status,
        "COMPLETED",
      );
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

test("background run exposes raw transcript with RUNNING enhancement state", async () => {
  await withEnhancementEnv(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/negotiations_test";
    try {
      const { executeTranscriptEnhancement } = await import(
        "@/lib/services/transcript-enhancement-orchestration"
      );

      const state: InMemoryTranscript = {
        id: "tr_background",
        sessionId: "session-tr_background",
        status: TranscriptStatus.COMPLETED,
        text: "raw transcript",
        diarizedText: "raw transcript",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        retranscribeCount: 0,
        processingMetadata: { transcriptionProvider: "yandex_speechkit" },
        segments: [
          {
            id: "seg-1",
            orderIndex: 0,
            speakerLabel: "speaker_1",
            startSeconds: 0,
            endSeconds: 1,
            mappedParticipantId: null,
            text: "raw transcript",
            qualityText: "raw transcript",
          },
        ],
      };
      const db = createInMemoryDb(state);
      let resolveProvider: (() => void) | null = null;
      let providerStarted = false;

      const enhance = async (segments: Array<{ index: number; originalText: string }>) => {
        providerStarted = true;
        await new Promise<void>((resolve) => {
          resolveProvider = resolve;
        });
        return {
          segments: segments.map((segment) => ({
            index: segment.index,
            cleanedText: `${segment.originalText} enhanced`,
          })),
          globalWarnings: [],
          meta: {
            mode: "single",
            model: "deepseek-v4-flash",
            overallStatus: "COMPLETED",
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
            outputMode: "json_schema",
            structuredOutputEnabled: true,
            schemaVersion: "v1",
            schemaChunkCount: 1,
          },
        };
      };

      const result = await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "manual",
        runInBackground: true,
        dependencies: {
          db: db as never,
          enhance: enhance as never,
          schedule: (work) => {
            void work();
          },
        },
      });

      assert.equal(result.outcome, "started");
      await waitUntil(() => providerStarted, "provider started");
      assert.equal(state.text, "raw transcript");
      const enhancementMetadata = (state.processingMetadata.transcriptEnhancement ??
        {}) as Record<string, unknown>;
      assert.equal(enhancementMetadata.status, "RUNNING");

      resolveProvider?.();
      await waitUntil(() => state.text === "raw transcript enhanced", "enhanced text");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

test("stale enhancement owner cannot overwrite a newer run", async () => {
  await withEnhancementEnv(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/negotiations_test";
    try {
      const { executeTranscriptEnhancement } = await import(
        "@/lib/services/transcript-enhancement-orchestration"
      );
      const state: InMemoryTranscript = {
        id: "tr_stale_owner",
        sessionId: "session-tr_stale_owner",
        status: TranscriptStatus.COMPLETED,
        text: "current transcript",
        diarizedText: "current transcript",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        retranscribeCount: 0,
        processingMetadata: { transcriptionProvider: "yandex_speechkit" },
        segments: [
          {
            id: "seg-stale",
            orderIndex: 0,
            speakerLabel: "speaker_1",
            startSeconds: 0,
            endSeconds: 1,
            mappedParticipantId: null,
            text: "current transcript",
            qualityText: "current transcript",
          },
        ],
      };
      const db = createInMemoryDb(state);
      let resolveProvider: (() => void) | null = null;
      const enhance = async (
        segments: Array<{ index: number; originalText: string }>,
      ) => {
        await new Promise<void>((resolve) => {
          resolveProvider = resolve;
        });
        return {
          segments: segments.map((segment) => ({
            index: segment.index,
            cleanedText: "stale enhanced transcript",
          })),
          globalWarnings: [],
          meta: {
            mode: "chunked",
            model: "deepseek-v4-flash",
            overallStatus: "COMPLETED",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            totalLatencyMs: 1,
            originalSegmentCount: 1,
            originalCharacterCount: 18,
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
          },
        };
      };

      await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "manual",
        runInBackground: true,
        dependencies: {
          db: db as never,
          enhance: enhance as never,
          schedule: (work) => {
            void work();
          },
        },
      });
      await waitUntil(() => resolveProvider !== null, "stale owner provider started");
      const running = state.processingMetadata
        .transcriptEnhancement as Record<string, unknown>;
      state.processingMetadata = {
        ...state.processingMetadata,
        transcriptEnhancement: {
          ...running,
          runId: "newer-run-owner",
          status: "RUNNING",
        },
      };
      state.updatedAt = new Date(state.updatedAt.getTime() + 1);

      resolveProvider?.();
      await new Promise((resolve) => setTimeout(resolve, 5));

      assert.equal(state.text, "current transcript");
      assert.equal(
        (
          state.processingMetadata
            .transcriptEnhancement as Record<string, unknown>
        ).runId,
        "newer-run-owner",
      );
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

test("same-identity completed enhancement does not regress to SKIPPED", async () => {
  await withEnhancementEnv(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/negotiations_test";
    try {
      const { executeTranscriptEnhancement } = await import(
        "@/lib/services/transcript-enhancement-orchestration"
      );
      const state: InMemoryTranscript = {
        id: "tr_completed",
        sessionId: "session-tr_completed",
        status: TranscriptStatus.COMPLETED,
        text: "already completed",
        diarizedText: "[00:00:00-00:00:01] [Speaker 1] already completed",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        retranscribeCount: 0,
        processingMetadata: {
          transcriptionProvider: "yandex_speechkit",
          mappingSuggestion: { reason: "keep-me" },
        },
        segments: [
          {
            id: "seg-completed",
            orderIndex: 0,
            speakerLabel: "speaker_1",
            startSeconds: 0,
            endSeconds: 1,
            mappedParticipantId: "buyer",
            text: "already completed",
            qualityText: "already completed",
          },
        ],
      };
      const db = createInMemoryDb(state);
      const enhance = async (segments: Array<{ index: number; originalText: string }>) => ({
        segments: segments.map((segment) => ({
          index: segment.index,
          cleanedText: segment.originalText,
        })),
        globalWarnings: [],
        meta: {
          mode: "single",
          model: "deepseek-v4-flash",
          overallStatus: "COMPLETED" as const,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          totalLatencyMs: 1,
          originalSegmentCount: 1,
          originalCharacterCount: 17,
          chunkCount: 1,
          concurrency: 1,
          successfulChunkCount: 1,
          failedChunkCount: 0,
          fallbackSegmentCount: 0,
          changedSegmentCount: 0,
          unchangedSegmentCount: 1,
          retryCount: 0,
          perChunk: [],
          originalWordCount: 2,
          enhancedWordCount: 2,
          addedWordEstimate: 0,
          removedWordEstimate: 0,
          outputMode: "json_schema",
          structuredOutputEnabled: true,
          schemaVersion: "v1",
          schemaChunkCount: 1,
        },
      });
      const first = await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "automatic_initial_transcription",
        dependencies: { db: db as never, enhance: enhance as never },
      });
      assert.equal(first.outcome, "started");
      assert.equal(
        (state.processingMetadata.transcriptEnhancement as { status: string }).status,
        "COMPLETED",
      );
      state.processingMetadata = {
        ...state.processingMetadata,
        mappingSuggestion: { reason: "keep-me" },
      };
      const second = await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "automatic_initial_transcription",
        dependencies: {
          db: db as never,
          enhance: async () => {
            throw new Error("provider must not run on same-identity completed");
          },
        },
      });
      assert.equal(second.outcome, "skipped");
      if (second.outcome === "skipped") {
        assert.equal(second.reason, "skip_completed_same_identity");
      }
      assert.equal(
        (state.processingMetadata.transcriptEnhancement as { status: string }).status,
        "COMPLETED",
      );
      assert.deepEqual(state.processingMetadata.mappingSuggestion, { reason: "keep-me" });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

test("enhancement completion preserves sibling mappingSuggestion and mapped names", async () => {
  await withEnhancementEnv(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/negotiations_test";
    try {
      const { executeTranscriptEnhancement } = await import(
        "@/lib/services/transcript-enhancement-orchestration"
      );
      const state: InMemoryTranscript = {
        id: "tr_names",
        sessionId: "session-tr_names",
        status: TranscriptStatus.COMPLETED,
        text: "hello buyer",
        diarizedText: "[00:00:00-00:00:01] [Lab Buyer / Buyer] hello buyer",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        retranscribeCount: 0,
        speakerMapping: { speaker_0: "buyer" },
        session: {
          participants: [
            {
              id: "buyer",
              displayName: "Lab Buyer",
              type: "PARTICIPANT",
              sessionRole: { name: "Buyer" },
            },
          ],
        },
        processingMetadata: { transcriptionProvider: "yandex_speechkit" },
        segments: [
          {
            id: "seg-name",
            orderIndex: 0,
            speakerLabel: "speaker_0",
            startSeconds: 0,
            endSeconds: 1,
            mappedParticipantId: "buyer",
            text: "hello buyer",
            qualityText: "hello buyer",
          },
        ],
      };
      const db = createInMemoryDb(state);
      let resolveProvider: (() => void) | null = null;
      const enhance = async (segments: Array<{ index: number; originalText: string }>) => {
        await new Promise<void>((resolve) => {
          resolveProvider = resolve;
        });
        return {
          segments: segments.map((segment) => ({
            index: segment.index,
            cleanedText: `${segment.originalText} enhanced`,
          })),
          globalWarnings: [],
          meta: {
            mode: "single",
            model: "deepseek-v4-flash",
            overallStatus: "COMPLETED",
            startedAt: new Date().toISOString(),
            finishedAt: new Date().toISOString(),
            totalLatencyMs: 1,
            originalSegmentCount: 1,
            originalCharacterCount: 11,
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
            outputMode: "json_schema",
            structuredOutputEnabled: true,
            schemaVersion: "v1",
            schemaChunkCount: 1,
          },
        };
      };

      const started = await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "manual",
        runInBackground: true,
        dependencies: {
          db: db as never,
          enhance: enhance as never,
          schedule: (work) => {
            void work();
          },
        },
      });
      assert.equal(started.outcome, "started");
      await waitUntil(() => resolveProvider !== null, "provider gate");
      state.processingMetadata = {
        ...state.processingMetadata,
        mappingSuggestion: { reason: "auto_suggested", keep: true },
      };
      state.updatedAt = new Date(state.updatedAt.getTime() + 5);
      resolveProvider?.();
      await waitUntil(
        () =>
          (state.processingMetadata.transcriptEnhancement as { status?: string } | undefined)
            ?.status === "COMPLETED",
        "COMPLETED",
      );

      assert.equal(
        (state.processingMetadata.transcriptEnhancement as { status: string }).status,
        "COMPLETED",
      );
      assert.deepEqual(state.processingMetadata.mappingSuggestion, {
        reason: "auto_suggested",
        keep: true,
      });
      assert.match(state.diarizedText ?? "", /Lab Buyer \/ Buyer/);
      assert.match(state.diarizedText ?? "", /hello buyer enhanced/);
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

test("R03 admission binds current generation input under Transcript lock", async () => {
  await withEnhancementEnv(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/negotiations_test";
    try {
      const { executeTranscriptEnhancement } = await import(
        "@/lib/services/transcript-enhancement-orchestration"
      );
      const { parseTranscriptEnhancementJob } = await import(
        "@/lib/services/transcript-enhancement-job"
      );
      const state: InMemoryTranscript = {
        id: "tr_generation",
        sessionId: "session-tr_generation",
        status: TranscriptStatus.COMPLETED,
        text: "stale outer snapshot",
        diarizedText: "stale outer snapshot",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        retranscribeCount: 5,
        processingMetadata: { transcriptionProvider: "yandex_speechkit" },
        segments: [
          {
            id: "seg-gen",
            orderIndex: 0,
            speakerLabel: "speaker_1",
            startSeconds: 0,
            endSeconds: 1,
            mappedParticipantId: null,
            text: "generation five text",
            qualityText: "generation five quality",
          },
        ],
      };
      const db = createInMemoryDb(state);
      const result = await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "manual",
        runInBackground: true,
        dependencies: {
          db: db as never,
          enhance: (async () => {
            await new Promise(() => {});
            return {
              segments: [],
              globalWarnings: [],
              meta: { overallStatus: "COMPLETED" },
            };
          }) as never,
          schedule: () => {},
        },
      });
      assert.equal(result.outcome, "started");
      const job = parseTranscriptEnhancementJob(state.processingMetadata);
      assert.equal(job.retranscribeCount, 5);
      assert.ok(job.runId);
      assert.ok(job.inputIdentity);
      assert.equal(job.publicationEligible, true);
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

test("R03 active retranscription rejects enhancement admission", async () => {
  await withEnhancementEnv(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/negotiations_test";
    try {
      const { executeTranscriptEnhancement } = await import(
        "@/lib/services/transcript-enhancement-orchestration"
      );
      const state: InMemoryTranscript = {
        id: "tr_transcribing",
        sessionId: "session-tr_transcribing",
        status: TranscriptStatus.TRANSCRIBING,
        text: "old generation",
        diarizedText: "old generation",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        retranscribeCount: 1,
        processingMetadata: { transcriptionProvider: "yandex_speechkit" },
        segments: [
          {
            id: "seg-old",
            orderIndex: 0,
            speakerLabel: "speaker_1",
            startSeconds: 0,
            endSeconds: 1,
            mappedParticipantId: null,
            text: "old generation",
            qualityText: "old generation",
          },
        ],
      };
      const db = createInMemoryDb(state);
      let scheduled = 0;
      const result = await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "manual",
        dependencies: {
          db: db as never,
          schedule: () => {
            scheduled += 1;
          },
        },
      });
      assert.equal(result.outcome, "conflict");
      if (result.outcome === "conflict") {
        assert.equal(result.reason, "skipped_transcript_not_completed");
      }
      assert.equal(scheduled, 0);
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});

test("R06 live AI lease rejects enhancement admission before provider schedule", async () => {
  await withEnhancementEnv(async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      "postgresql://user:password@localhost:5432/negotiations_test";
    try {
      const { executeTranscriptEnhancement } = await import(
        "@/lib/services/transcript-enhancement-orchestration"
      );
      const { AiAnalysisStatus } = await import("@/app/generated/prisma/client");
      const state: InMemoryTranscript = {
        id: "tr_ai_lock",
        sessionId: "session-tr_ai_lock",
        status: TranscriptStatus.COMPLETED,
        text: "ready",
        diarizedText: "ready",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        retranscribeCount: 0,
        processingMetadata: { transcriptionProvider: "yandex_speechkit" },
        aiAnalysis: {
          status: AiAnalysisStatus.ANALYZING,
          runToken: "live-ai",
          leaseExpiresAt: new Date(Date.now() + 60_000),
          updatedAt: new Date(),
        },
        segments: [
          {
            id: "seg-ai",
            orderIndex: 0,
            speakerLabel: "speaker_1",
            startSeconds: 0,
            endSeconds: 1,
            mappedParticipantId: null,
            text: "ready",
            qualityText: "ready",
          },
        ],
      };
      const db = createInMemoryDb(state);
      let scheduled = 0;
      const result = await executeTranscriptEnhancement({
        transcriptId: state.id,
        triggerSource: "manual",
        dependencies: {
          db: db as never,
          schedule: () => {
            scheduled += 1;
          },
        },
      });
      assert.equal(result.outcome, "conflict");
      if (result.outcome === "conflict") {
        assert.equal(result.reason, "skipped_ai_in_progress");
      }
      assert.equal(scheduled, 0);
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
