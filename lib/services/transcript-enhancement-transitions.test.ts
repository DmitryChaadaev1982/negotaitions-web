import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";
import { buildCanonicalDiarizedText } from "@/lib/transcription/canonical-diarized-text";
import { getTranscriptEnhancementNamespace } from "@/lib/transcription/processing-metadata";
import {
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
    aiAnalysis: {
      findUnique: async () => null,
    },
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
    sessionId: `session-${id}`,
    status: TranscriptStatus.COMPLETED,
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

test("healthy D1 work is not SKIPPED by the historical 7000 ms window", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const state = baseTranscript("tr_et03");
    const db = createInMemoryDb(state);
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
        schedule: (work) => {
          void work();
        },
        waitForTimeout: () => Promise.resolve(),
        timeoutMs: 7000,
      },
    });
    await waitUntil(() => {
      const status = enhancementStatus(state);
      return status === "RUNNING" || status === "QUEUED";
    }, "RUNNING");
    await waitUntil(() => resolveProvider !== null, "provider gate");
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.notEqual(enhancementStatus(state), "SKIPPED");
    assert.equal(state.text, "original transcript");
    resolveProvider?.();
    await waitUntil(() => state.text === "late enhanced transcript", "enhanced text");
    await run;
  });
});

test("Continue discards a late provider result without mixed publication", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const { continueWithCurrentTranscript } = await import(
      "@/lib/services/transcript-enhancement-state"
    );
    const state = baseTranscript("tr_et04");
    const db = createInMemoryDb(state);
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
        schedule: (work) => {
          void work();
        },
      },
    });
    await waitUntil(() => {
      const status = enhancementStatus(state);
      return status === "RUNNING" || status === "QUEUED";
    }, "RUNNING");
    state.speakerMapping = { speaker_1: "old-mapping" };
    await continueWithCurrentTranscript({ db: db as never, transcriptId: state.id });
    state.speakerMapping = { speaker_1: "latest-mapping" };
    resolveProvider?.();
    await waitUntil(() => providerSettled, "late provider");
    await run;
    assert.equal(state.text, "original transcript");
    assert.equal(state.speakerMapping?.speaker_1, "latest-mapping");
    assert.notEqual(enhancementStatus(state), "COMPLETED");
  });
});

test("LAB27-04 Skip preserves mapping saved while RUNNING", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const { continueWithCurrentTranscript } = await import(
      "@/lib/services/transcript-enhancement-state"
    );
    const state = baseTranscript("tr_lab27_skip_mapping");
    const db = createInMemoryDb(state);
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
        schedule: (work) => {
          void work();
        },
      },
    });
    await waitUntil(() => {
      const status = enhancementStatus(state);
      return status === "RUNNING" || status === "QUEUED";
    }, "RUNNING");
    state.speakerMapping = { speaker_1: "buyer" };
    const continued = await continueWithCurrentTranscript({
      db: db as never,
      transcriptId: state.id,
    });
    assert.equal(continued.outcome, "cancelled");
    assert.equal(state.speakerMapping?.speaker_1, "buyer");
    assert.equal(state.text, "original transcript");
    resolveProvider?.();
    await run;
    assert.equal(state.speakerMapping?.speaker_1, "buyer");
    assert.equal(state.text, "original transcript");
  });
});

test("mapping during RUNNING survives later successful publication", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const state = baseTranscript("tr_et06");
    const db = createInMemoryDb(state);
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
          return completedEnhance("enhanced transcript");
        }) as never,
        schedule: (work) => {
          void work();
        },
      },
    });
    await waitUntil(() => {
      const status = enhancementStatus(state);
      return status === "RUNNING" || status === "QUEUED";
    }, "RUNNING");
    await waitUntil(() => resolveProvider !== null, "provider gate");
    state.speakerMapping = { speaker_1: "buyer" };
    state.segments[0]!.mappedParticipantId = "buyer";
    resolveProvider?.();
    await waitUntil(() => state.text === "enhanced transcript", "published enhanced text");
    await run;
    assert.equal(state.speakerMapping?.speaker_1, "buyer");
    assert.match(state.diarizedText ?? "", /Buyer|enhanced transcript/);
    assert.equal(state.text, "enhanced transcript");
  });
});

test("historical SKIPPED timeout remains readable and Improve can start a new-format job", async () => {
  await withEnhancementEnv(async () => {
    const { executeTranscriptEnhancement } = await import(
      "@/lib/services/transcript-enhancement-orchestration"
    );
    const startedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const state = baseTranscript("tr_stale_timeout");
    state.processingMetadata = {
      transcriptionProvider: "yandex_speechkit",
      transcriptEnhancement: {
        status: "SKIPPED",
        skipReason: "timeout",
        runId: "old-run",
        startedAt,
      },
    };
    const db = createInMemoryDb(state);
    let enhanceCalled = false;
    const result = await executeTranscriptEnhancement({
      transcriptId: state.id,
      triggerSource: "manual",
      forceReenhancement: true,
      dependencies: {
        db: db as never,
        enhance: (async () => {
          enhanceCalled = true;
          return completedEnhance("new durable enhance");
        }) as never,
      },
    });
    assert.equal(result.outcome, "started");
    assert.equal(enhanceCalled, true);
    assert.equal(state.text, "new durable enhance");
    assert.equal(enhancementStatus(state), "COMPLETED");
  });
});

test("reconcileTranscriptEnhancementTimeout does not persist SKIPPED for D1 work", async () => {
  const startedAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
  const state = baseTranscript("tr_reconcile");
  state.processingMetadata = {
    transcriptionProvider: "yandex_speechkit",
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      executionStatus: "RUNNING",
      publicationEligible: true,
      status: "RUNNING",
      runId: "hung-run",
      startedAt,
      chunks: {
        "0": {
          chunkIndex: 0,
          status: "RUNNING",
          targetIndexes: [0],
          attemptCount: 1,
          unpublishedByOrderIndex: {},
        },
      },
    },
  };
  const db = createInMemoryDb(state);
  const result = await reconcileTranscriptEnhancementTimeout({
    db: db as never,
    transcriptId: state.id,
    nowMs: Date.parse(startedAt) + 8_000,
    timeoutMs: 7000,
  });
  assert.equal(result.timedOut, false);
  assert.notEqual(enhancementStatus(state), "SKIPPED");
  const lateWrite = await persistEnhancementTimeoutSkip({
    db: db as never,
    transcriptId: state.id,
    runId: "hung-run",
  });
  assert.equal(lateWrite, false);
});
