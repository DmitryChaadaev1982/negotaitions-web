import assert from "node:assert/strict";
import test from "node:test";

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
      findUnique: async (args: { select?: Record<string, unknown> }) => {
        const selectKeys = args.select ? Object.keys(args.select) : [];
        if (selectKeys.length === 1 && args.select?.processingMetadata) {
          return { processingMetadata: { ...state.processingMetadata } };
        }
        return cloneTranscript(state);
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
    $transaction: async <T>(callback: (tx: typeof db) => Promise<T>) => {
      return callback(db);
    },
  };

  return db;
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

test("simultaneous equivalent runs acquire lock once", async () => {
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
          triggerSource: "manual",
          dependencies: { db: db as never, enhance: enhance as never },
        }),
        executeTranscriptEnhancement({
          transcriptId: state.id,
          triggerSource: "manual",
          dependencies: { db: db as never, enhance: enhance as never },
        }),
      ]);

      assert.equal(providerCalls, 1);
      const outcomes = [first.outcome, second.outcome].sort();
      assert.deepEqual(outcomes, ["already_running", "started"]);
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
        dependencies: { db: db as never, enhance: enhance as never },
      });

      assert.equal(result.outcome, "started");
      assert.equal(providerStarted, true);
      assert.equal(state.text, "raw transcript");
      const enhancementMetadata = (state.processingMetadata.transcriptEnhancement ??
        {}) as Record<string, unknown>;
      assert.equal(enhancementMetadata.status, "RUNNING");

      resolveProvider?.();
      await new Promise((resolve) => setTimeout(resolve, 5));
      assert.equal(state.text, "raw transcript enhanced");
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
  });
});
