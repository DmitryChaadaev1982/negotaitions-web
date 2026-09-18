import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";
import {
  computeEnhancementProgress,
  parseTranscriptEnhancementJob,
  type TranscriptEnhancementDurableChunk,
} from "@/lib/services/transcript-enhancement-job";
import { resetTranscriptEnhancementLimiterForTests } from "@/lib/services/transcript-enhancement-limiter";
import { runAdmittedEnhancementJob } from "@/lib/services/transcript-enhancement-orchestration";
import {
  authorizeEnhancementChunkStart,
  continueWithCurrentTranscript,
} from "@/lib/services/transcript-enhancement-state";
import {
  enhanceTranscriptWithYandexAi,
  type TranscriptEnhancementInputSegment,
} from "@/lib/services/yandex-transcript-enhancement";

const RUN_ID = "run-early";
const LEASE_TOKEN = "lease-early";
const INPUT_IDENTITY = "identity-early";
const NOW_MS = Date.parse("2026-09-16T10:00:00.000Z");
const ORIGINAL_TEXT = "мы обсудили условия поставки и согласовали примерный график платежей";

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
  speakerMapping: Record<string, string> | null;
  session: { participants: [] };
  segments: InMemorySegment[];
};

function chunkText(index: number): string {
  return `${ORIGINAL_TEXT} ${index}`;
}

function makeSegments(count: number): InMemorySegment[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `seg-${index}`,
    orderIndex: index,
    speakerLabel: "speaker_1",
    startSeconds: index,
    endSeconds: index + 1,
    mappedParticipantId: null,
    text: chunkText(index),
    qualityText: chunkText(index),
  }));
}

function baseTranscript(id: string, segmentCount: number): InMemoryTranscript {
  const segments = makeSegments(segmentCount);
  return {
    id,
    sessionId: `session-${id}`,
    status: TranscriptStatus.COMPLETED,
    text: segments.map((segment) => segment.text).join(" "),
    diarizedText: segments.map((segment) => `speaker_1: ${segment.text}`).join("\n"),
    updatedAt: new Date(NOW_MS),
    retranscribeCount: 0,
    processingMetadata: { transcriptionProvider: "yandex_speechkit" },
    speakerMapping: null,
    session: { participants: [] },
    segments,
  };
}

function createInMemoryDb(state: InMemoryTranscript) {
  const runInTransaction = async <T,>(callback: (tx: unknown) => Promise<T>): Promise<T> =>
    callback(db);
  const db = {
    transcript: {
      findUnique: async () => ({
        ...state,
        processingMetadata: { ...state.processingMetadata },
        segments: state.segments.map((segment) => ({ ...segment })),
      }),
      update: async (args: { data: Record<string, unknown> }) => {
        if (typeof args.data.text === "string") state.text = args.data.text;
        if ("diarizedText" in args.data) {
          state.diarizedText = (args.data.diarizedText as string | null) ?? null;
        }
        if (
          args.data.processingMetadata &&
          typeof args.data.processingMetadata === "object"
        ) {
          state.processingMetadata = args.data.processingMetadata as Record<string, unknown>;
        }
        state.updatedAt = new Date(state.updatedAt.getTime() + 1);
        return state;
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
    aiAnalysis: { findUnique: async () => null },
    $transaction: runInTransaction,
  };
  return db;
}

function durableChunk(
  index: number,
  overrides?: Partial<TranscriptEnhancementDurableChunk>,
): TranscriptEnhancementDurableChunk {
  return {
    chunkIndex: index,
    status: "PENDING",
    targetIndexes: [index],
    attemptCount: 0,
    unpublishedByOrderIndex: {},
    lastErrorClass: null,
    lastHttpClass: null,
    lastSchemaResult: null,
    providerDurationMs: null,
    usageInputTokens: null,
    usageOutputTokens: null,
    usageTotalTokens: null,
    usageClassification: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function seedAdmittedJob(state: InMemoryTranscript, chunkCount: number) {
  const chunks = Object.fromEntries(
    Array.from({ length: chunkCount }, (_unused, index) => [String(index), durableChunk(index)]),
  );
  state.processingMetadata = {
    transcriptionProvider: "yandex_speechkit",
    transcriptEnhancement: {
      schemaVersion: "d1-v1",
      jobId: RUN_ID,
      runId: RUN_ID,
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: new Date(NOW_MS + 3_600_000).toISOString(),
      executionStatus: "RUNNING",
      publicationEligible: true,
      terminalQuality: null,
      inputIdentity: INPUT_IDENTITY,
      retranscribeCount: 0,
      triggerSource: "manual",
      cancelReason: null,
      cancelledAt: null,
      publicationOutcome: null,
      progress: computeEnhancementProgress(chunks),
      chunks,
      unpublishedByOrderIndex: {},
      queuedAt: new Date(NOW_MS).toISOString(),
      startedAt: new Date(NOW_MS).toISOString(),
      finishedAt: null,
      safetyDeadlineAt: null,
      skipReason: null,
      status: "RUNNING",
    },
  };
}

function enhancementInput(count: number): TranscriptEnhancementInputSegment[] {
  return Array.from({ length: count }, (_unused, index) => ({
    index,
    speakerLabel: "speaker_1",
    startMs: index * 1_000,
    endMs: (index + 1) * 1_000,
    originalText: chunkText(index),
    segmentId: `seg-${index}`,
    mappedParticipantId: null,
  }));
}

function extractChunkIndex(body: string): number {
  try {
    const parsed = JSON.parse(body) as { input?: string };
    const input = String(parsed.input ?? "");
    const marker = "Input JSON:\n";
    const start = input.indexOf(marker);
    const payload = start >= 0 ? input.slice(start + marker.length).trim() : input;
    const jsonStart = payload.indexOf("{");
    const envelope = JSON.parse(payload.slice(jsonStart)) as {
      targetSegments?: Array<{ index?: number }>;
    };
    const index = envelope.targetSegments?.[0]?.index;
    if (typeof index === "number") return index;
  } catch {
    // Fall through.
  }
  return 0;
}

function schemaOutput(index: number, text: string): Response {
  return new Response(
    JSON.stringify({
      id: `resp-${index}`,
      status: "completed",
      output_text: JSON.stringify({ segments: { [String(index)]: text } }),
      usage: { input_text_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function withEarlyTermEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    apiKey: process.env.YANDEX_API_KEY,
    folderId: process.env.YANDEX_FOLDER_ID,
    enabled: process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED,
    heartbeat: process.env.TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS,
    concurrency: process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY,
    segments: process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS,
    chars: process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS,
  };
  process.env.YANDEX_API_KEY = "test-key";
  process.env.YANDEX_FOLDER_ID = "test-folder";
  process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = "true";
  process.env.TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS = "600000";
  process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = "2";
  process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS = "1";
  process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS = "1800";
  resetTranscriptEnhancementLimiterForTests();
  try {
    return await fn();
  } finally {
    resetTranscriptEnhancementLimiterForTests();
    for (const [key, value] of [
      ["YANDEX_API_KEY", previous.apiKey],
      ["YANDEX_FOLDER_ID", previous.folderId],
      ["YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED", previous.enabled],
      ["TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS", previous.heartbeat],
      ["TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY", previous.concurrency],
      ["TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS", previous.segments],
      ["TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS", previous.chars],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

test("EARLY-TERM-01 queued chunks do not start after a permanent failure terminalizes the job", async () => {
  await withEarlyTermEnv(async () => {
    const state = baseTranscript("tr-early-01", 5);
    seedAdmittedJob(state, 5);
    const db = createInMemoryDb(state);
    const posted: number[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      if (init?.method !== "POST" || !href.endsWith("/responses")) {
        throw new Error(`unexpected request: ${init?.method ?? "GET"} ${href}`);
      }
      const index = extractChunkIndex(String(init.body ?? ""));
      posted.push(index);
      await delay(20);
      if (index === 0) {
        return schemaOutput(index, "да");
      }
      return schemaOutput(index, `${chunkText(index)}.`);
    }) as typeof globalThis.fetch;
    try {
      await runAdmittedEnhancementJob({
        transcriptId: state.id,
        runId: RUN_ID,
        leaseToken: LEASE_TOKEN,
        inputIdentity: INPUT_IDENTITY,
        retranscribeCount: 0,
        enhancementInput: enhancementInput(5),
        dependencies: {
          db: db as never,
          now: () => NOW_MS,
          sleep: async () => {},
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.ok(posted.includes(0), "the failing chunk may start");
    assert.equal(
      posted.filter((index) => index >= 2).length,
      0,
      `queued chunks must not start after terminalization: ${posted.join(",")}`,
    );
    assert.ok(posted.length <= 2, `only the in-flight wave may POST, got ${posted.join(",")}`);
    const job = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(job.executionStatus, "FAILED");
    assert.equal(state.text.includes("да") === false, true);
  });
});

test("EARLY-TERM-02 Skip commits: queued chunks make zero later POSTs", async () => {
  await withEarlyTermEnv(async () => {
    const state = baseTranscript("tr-early-02", 5);
    seedAdmittedJob(state, 5);
    const db = createInMemoryDb(state);
    const posted: number[] = [];
    let firstWaveStarted = 0;
    let releaseFirstWave: (() => void) | null = null;
    const firstWaveGate = new Promise<void>((resolve) => {
      releaseFirstWave = resolve;
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      if (init?.method !== "POST" || !href.endsWith("/responses")) {
        throw new Error(`unexpected request: ${init?.method ?? "GET"} ${href}`);
      }
      const index = extractChunkIndex(String(init.body ?? ""));
      posted.push(index);
      firstWaveStarted += 1;
      if (firstWaveStarted === 2) releaseFirstWave?.();
      await firstWaveGate;
      await delay(10);
      return schemaOutput(index, `${chunkText(index)}.`);
    }) as typeof globalThis.fetch;
    try {
      const running = runAdmittedEnhancementJob({
        transcriptId: state.id,
        runId: RUN_ID,
        leaseToken: LEASE_TOKEN,
        inputIdentity: INPUT_IDENTITY,
        retranscribeCount: 0,
        enhancementInput: enhancementInput(5),
        dependencies: {
          db: db as never,
          now: () => NOW_MS,
          sleep: async () => {},
        },
      });
      await firstWaveGate;
      await continueWithCurrentTranscript({
        db: db as never,
        transcriptId: state.id,
        nowMs: NOW_MS,
      });
      await running;
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(posted.length, 2, `only in-flight POSTs may exist, got ${posted.join(",")}`);
    assert.equal(posted.filter((index) => index >= 2).length, 0);
    const job = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(job.executionStatus, "CANCELLED_FOR_PUBLICATION");
    assert.equal(job.publicationEligible, false);
    assert.equal(state.text, baseTranscript("tr-early-02", 5).text);
  });
});

test("EARLY-TERM-03 stale ownership before queued start performs no stale POST", async () => {
  await withEarlyTermEnv(async () => {
    const state = baseTranscript("tr-early-03", 4);
    seedAdmittedJob(state, 4);
    const db = createInMemoryDb(state);
    const posted: number[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      if (init?.method !== "POST" || !href.endsWith("/responses")) {
        throw new Error(`unexpected request: ${init?.method ?? "GET"} ${href}`);
      }
      const index = extractChunkIndex(String(init.body ?? ""));
      posted.push(index);
      const job = state.processingMetadata.transcriptEnhancement as Record<string, unknown>;
      job.runId = "other-owner";
      job.leaseToken = "other-lease";
      await delay(15);
      return schemaOutput(index, `${chunkText(index)}.`);
    }) as typeof globalThis.fetch;
    try {
      await runAdmittedEnhancementJob({
        transcriptId: state.id,
        runId: RUN_ID,
        leaseToken: LEASE_TOKEN,
        inputIdentity: INPUT_IDENTITY,
        retranscribeCount: 0,
        enhancementInput: enhancementInput(4),
        dependencies: {
          db: db as never,
          now: () => NOW_MS,
          sleep: async () => {},
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.ok(posted.length >= 1);
    assert.ok(posted.length <= 2, `stale worker must not drain the queue: ${posted.join(",")}`);
    const job = parseTranscriptEnhancementJob(state.processingMetadata);
    const unfinished = Object.values(job.chunks).filter((item) => item.status === "PENDING");
    assert.ok(unfinished.length >= 2, "ownership loss must not globally fail remaining chunks");
  });
});

test("EARLY-TERM-04 already-in-flight late finish is rejected and does not publish", async () => {
  await withEarlyTermEnv(async () => {
    const state = baseTranscript("tr-early-04", 1);
    seedAdmittedJob(state, 1);
    const db = createInMemoryDb(state);
    let releasePost: (() => void) | null = null;
    const postStarted = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    let holdPost: () => void = () => {};
    const postHold = new Promise<void>((resolve) => {
      holdPost = resolve;
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const href = String(url);
      if (init?.method !== "POST" || !href.endsWith("/responses")) {
        throw new Error(`unexpected request: ${init?.method ?? "GET"} ${href}`);
      }
      releasePost?.();
      await postHold;
      return schemaOutput(0, `${chunkText(0)}.`);
    }) as typeof globalThis.fetch;
    try {
      const running = runAdmittedEnhancementJob({
        transcriptId: state.id,
        runId: RUN_ID,
        leaseToken: LEASE_TOKEN,
        inputIdentity: INPUT_IDENTITY,
        retranscribeCount: 0,
        enhancementInput: enhancementInput(1),
        dependencies: {
          db: db as never,
          now: () => NOW_MS,
          sleep: async () => {},
        },
      });
      await postStarted;
      await continueWithCurrentTranscript({
        db: db as never,
        transcriptId: state.id,
        nowMs: NOW_MS,
      });
      holdPost();
      await running;
    } finally {
      globalThis.fetch = originalFetch;
    }
    const job = parseTranscriptEnhancementJob(state.processingMetadata);
    assert.equal(job.executionStatus, "CANCELLED_FOR_PUBLICATION");
    assert.equal(job.publicationEligible, false);
    assert.equal(state.text, chunkText(0));
  });
});

test("EARLY-TERM-05 rejected start authority does not consume attemptCount", async () => {
  await withEarlyTermEnv(async () => {
    const state = baseTranscript("tr-early-05", 1);
    seedAdmittedJob(state, 1);
    const jobMeta = state.processingMetadata.transcriptEnhancement as Record<string, unknown>;
    jobMeta.executionStatus = "FAILED";
    jobMeta.publicationEligible = false;
    const db = createInMemoryDb(state);
    let posts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      posts += 1;
      return schemaOutput(0, `${chunkText(0)}.`);
    }) as typeof globalThis.fetch;
    try {
      await runAdmittedEnhancementJob({
        transcriptId: state.id,
        runId: RUN_ID,
        leaseToken: LEASE_TOKEN,
        inputIdentity: INPUT_IDENTITY,
        retranscribeCount: 0,
        enhancementInput: enhancementInput(1),
        dependencies: {
          db: db as never,
          now: () => NOW_MS,
          sleep: async () => {},
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(posts, 0);
    assert.equal(parseTranscriptEnhancementJob(state.processingMetadata).chunks["0"]?.attemptCount, 0);
  });
});

test("EARLY-TERM-06 rejected start after slot acquisition releases immediately and makes no POST", async () => {
  await withEarlyTermEnv(async () => {
    let acquired = 0;
    let released = 0;
    let posts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      posts += 1;
      return schemaOutput(0, `${chunkText(0)}.`);
    }) as typeof globalThis.fetch;
    process.env.YANDEX_API_KEY = "test-key";
    process.env.YANDEX_FOLDER_ID = "test-folder";
    try {
      await enhanceTranscriptWithYandexAi(enhancementInput(1), {
        onChunkStart: async () => ({ status: "REJECTED", reason: "JOB_TERMINAL" }),
        withProviderSlot: async (fn) => {
          acquired += 1;
          try {
            return await fn();
          } finally {
            released += 1;
          }
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(posts, 0);
    assert.equal(acquired, 1);
    assert.equal(released, 1);
  });
});

test("authorizeEnhancementChunkStart returns typed rejections without persisting attempts", async () => {
  const state = baseTranscript("tr-auth", 1);
  seedAdmittedJob(state, 1);
  const db = createInMemoryDb(state);
  const rejectedOwner = await authorizeEnhancementChunkStart({
    db: db as never,
    transcriptId: state.id,
    owner: {
      runId: "stale",
      leaseToken: LEASE_TOKEN,
      inputIdentity: INPUT_IDENTITY,
      retranscribeCount: 0,
    },
    nowMs: NOW_MS,
    chunk: durableChunk(0, { status: "RUNNING", attemptCount: 1 }),
  });
  assert.deepEqual(rejectedOwner, { status: "REJECTED", reason: "OWNER_STALE" });
  assert.equal(parseTranscriptEnhancementJob(state.processingMetadata).chunks["0"]?.attemptCount, 0);

  const accepted = await authorizeEnhancementChunkStart({
    db: db as never,
    transcriptId: state.id,
    owner: {
      runId: RUN_ID,
      leaseToken: LEASE_TOKEN,
      inputIdentity: INPUT_IDENTITY,
      retranscribeCount: 0,
    },
    nowMs: NOW_MS,
    chunk: durableChunk(0, { status: "RUNNING", attemptCount: 1 }),
  });
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(parseTranscriptEnhancementJob(state.processingMetadata).chunks["0"]?.attemptCount, 1);
});
