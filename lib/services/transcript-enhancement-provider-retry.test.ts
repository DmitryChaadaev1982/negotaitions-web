import assert from "node:assert/strict";
import test from "node:test";

import { TranscriptStatus } from "@/app/generated/prisma/client";
import {
  computeEnhancementProgress,
  parseTranscriptEnhancementJob,
  type TranscriptEnhancementDurableChunk,
} from "@/lib/services/transcript-enhancement-job";
import { runAdmittedEnhancementJob } from "@/lib/services/transcript-enhancement-orchestration";
import type { TranscriptEnhancementInputSegment } from "@/lib/services/yandex-transcript-enhancement";

/**
 * Exact provider POST accounting for the single retry owner.
 *
 * These tests drive the real provider module through the real D1 orchestration
 * with a mocked `fetch`, an injected clock and an injected sleep. No test may
 * accept three or more POSTs for one chunk in one run.
 */

const RUN_ID = "run-retry";
const LEASE_TOKEN = "lease-retry";
const INPUT_IDENTITY = "identity-retry";
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

function baseTranscript(id: string): InMemoryTranscript {
  return {
    id,
    sessionId: `session-${id}`,
    status: TranscriptStatus.COMPLETED,
    text: ORIGINAL_TEXT,
    diarizedText: `speaker_1: ${ORIGINAL_TEXT}`,
    updatedAt: new Date(NOW_MS),
    retranscribeCount: 0,
    processingMetadata: { transcriptionProvider: "yandex_speechkit" },
    speakerMapping: null,
    session: { participants: [] },
    segments: [
      {
        id: `${id}-seg`,
        orderIndex: 0,
        speakerLabel: "speaker_1",
        startSeconds: 0,
        endSeconds: 5,
        mappedParticipantId: null,
        text: ORIGINAL_TEXT,
        qualityText: ORIGINAL_TEXT,
      },
    ],
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

function chunk(overrides: Partial<TranscriptEnhancementDurableChunk>): TranscriptEnhancementDurableChunk {
  return {
    chunkIndex: 0,
    status: "PENDING",
    targetIndexes: [0],
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

function seedAdmittedJob(
  state: InMemoryTranscript,
  chunkOverrides?: Partial<TranscriptEnhancementDurableChunk>,
) {
  const seeded = chunk(chunkOverrides ?? {});
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
      progress: computeEnhancementProgress({ "0": seeded }),
      chunks: { "0": seeded },
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

const enhancementInput: TranscriptEnhancementInputSegment[] = [
  {
    index: 0,
    speakerLabel: "speaker_1",
    startMs: 0,
    endMs: 5_000,
    originalText: ORIGINAL_TEXT,
    segmentId: "seg",
    mappedParticipantId: null,
  },
];

type PostRecord = { maxOutputTokens: number; body: string };

type FetchPlan = (attempt: number) => Promise<Response> | Response;

function installFetch(plan: FetchPlan) {
  const posts: PostRecord[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (init?.method === "POST" && href.endsWith("/responses")) {
      const body = String(init.body ?? "");
      let maxOutputTokens = 0;
      try {
        maxOutputTokens = Number(JSON.parse(body).max_output_tokens ?? 0);
      } catch {
        maxOutputTokens = 0;
      }
      posts.push({ maxOutputTokens, body });
      return plan(posts.length);
    }
    throw new Error(`unexpected request: ${init?.method ?? "GET"} ${href}`);
  }) as typeof globalThis.fetch;
  return {
    posts,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function schemaOutput(text: string): Response {
  return jsonResponse({
    id: "resp-1",
    status: "completed",
    output_text: JSON.stringify({ segments: { "0": text } }),
    usage: { input_text_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  });
}

function errorResponse(status: number, headers?: Record<string, string>): Response {
  return new Response("provider error", { status, headers });
}

async function withProviderEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = {
    apiKey: process.env.YANDEX_API_KEY,
    folderId: process.env.YANDEX_FOLDER_ID,
    enabled: process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED,
    heartbeat: process.env.TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS,
  };
  process.env.YANDEX_API_KEY = "test-key";
  process.env.YANDEX_FOLDER_ID = "test-folder";
  process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED = "true";
  process.env.TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS = "600000";
  try {
    return await fn();
  } finally {
    for (const [key, value] of [
      ["YANDEX_API_KEY", previous.apiKey],
      ["YANDEX_FOLDER_ID", previous.folderId],
      ["YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED", previous.enabled],
      ["TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS", previous.heartbeat],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

type RunOutcome = {
  posts: PostRecord[];
  sleeps: number[];
  state: InMemoryTranscript;
};

async function runJob(params: {
  id: string;
  plan: FetchPlan;
  chunkOverrides?: Partial<TranscriptEnhancementDurableChunk>;
}): Promise<RunOutcome> {
  return withProviderEnv(async () => {
    const state = baseTranscript(params.id);
    seedAdmittedJob(state, params.chunkOverrides);
    const db = createInMemoryDb(state);
    const sleeps: number[] = [];
    const fetchMock = installFetch(params.plan);
    try {
      await runAdmittedEnhancementJob({
        transcriptId: state.id,
        runId: RUN_ID,
        leaseToken: LEASE_TOKEN,
        inputIdentity: INPUT_IDENTITY,
        retranscribeCount: 0,
        enhancementInput,
        dependencies: {
          db: db as never,
          now: () => NOW_MS,
          sleep: async (ms: number) => {
            sleeps.push(ms);
          },
        },
      });
    } finally {
      fetchMock.restore();
    }
    return { posts: fetchMock.posts, sleeps, state };
  });
}

function durableChunk(state: InMemoryTranscript) {
  return parseTranscriptEnhancementJob(state.processingMetadata).chunks["0"];
}

test("RETRY-01 429 without Retry-After performs exactly 2 POSTs and uses normal backoff", async () => {
  const outcome = await runJob({
    id: "tr-retry-01",
    plan: () => errorResponse(429),
  });
  assert.equal(outcome.posts.length, 2);
  assert.equal(durableChunk(outcome.state)?.attemptCount, 2);
  assert.equal(durableChunk(outcome.state)?.status, "FAILED");
  const retryDelays = outcome.sleeps.filter((ms) => ms > 0);
  assert.equal(retryDelays.length, 1);
  assert.ok(retryDelays[0]! > 0 && retryDelays[0]! <= 8_000, `backoff was ${retryDelays[0]}`);
});

test("RETRY-02 429 Retry-After: 5 performs exactly 2 POSTs and waits at least 5s", async () => {
  const outcome = await runJob({
    id: "tr-retry-02",
    plan: () => errorResponse(429, { "retry-after": "5" }),
  });
  assert.equal(outcome.posts.length, 2);
  const retryDelays = outcome.sleeps.filter((ms) => ms > 0);
  assert.equal(retryDelays.length, 1);
  assert.ok(retryDelays[0]! >= 5_000, `delay was ${retryDelays[0]}`);
});

test("RETRY-03 malformed Retry-After performs exactly 2 POSTs with normal backoff", async () => {
  const outcome = await runJob({
    id: "tr-retry-03",
    plan: () => errorResponse(429, { "retry-after": "soon" }),
  });
  assert.equal(outcome.posts.length, 2);
  const retryDelays = outcome.sleeps.filter((ms) => ms > 0);
  assert.equal(retryDelays.length, 1);
  assert.ok(retryDelays[0]! <= 8_000, `delay was ${retryDelays[0]}`);
});

test("RETRY-04 429 HTTP-date Retry-After is honoured and capped at 30s", async () => {
  const honoured = await runJob({
    id: "tr-retry-04a",
    plan: () => errorResponse(429, { "retry-after": "Wed, 16 Sep 2026 10:00:12 GMT" }),
  });
  assert.equal(honoured.posts.length, 2);
  assert.equal(honoured.sleeps.filter((ms) => ms > 0)[0], 12_000);

  const capped = await runJob({
    id: "tr-retry-04b",
    plan: () => errorResponse(429, { "retry-after": "Wed, 16 Sep 2026 10:05:00 GMT" }),
  });
  assert.equal(capped.posts.length, 2);
  assert.equal(capped.sleeps.filter((ms) => ms > 0)[0], 30_000);
});

test("RETRY-05 5xx performs exactly 2 POSTs", async () => {
  const outcome = await runJob({
    id: "tr-retry-05",
    plan: () => errorResponse(503),
  });
  assert.equal(outcome.posts.length, 2);
  assert.equal(durableChunk(outcome.state)?.lastErrorClass, "provider_http_5xx");
});

test("RETRY-06 network failure performs exactly 2 POSTs", async () => {
  const outcome = await runJob({
    id: "tr-retry-06",
    plan: () => {
      throw new Error("network request failed");
    },
  });
  assert.equal(outcome.posts.length, 2);
  assert.equal(durableChunk(outcome.state)?.lastErrorClass, "network");
});

test("RETRY-07 timeout performs exactly 2 POSTs", async () => {
  const outcome = await runJob({
    id: "tr-retry-07",
    plan: () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      throw abort;
    },
  });
  assert.equal(outcome.posts.length, 2);
  assert.equal(durableChunk(outcome.state)?.lastErrorClass, "timeout");
});

test("RETRY-08 schema-invalid retries once with the strict flavor then fails durably", async () => {
  const outcome = await runJob({
    id: "tr-retry-08",
    plan: () => jsonResponse({ id: "resp-1", status: "completed", output_text: "not json at all" }),
  });
  assert.equal(outcome.posts.length, 2);
  assert.ok(
    outcome.posts[1]!.maxOutputTokens > outcome.posts[0]!.maxOutputTokens,
    "attempt 2 must use the escalated strict flavor",
  );
  const chunkState = durableChunk(outcome.state);
  assert.equal(chunkState?.status, "FAILED");
  assert.equal(chunkState?.attemptCount, 2);
  assert.equal(outcome.state.text, ORIGINAL_TEXT);
});

test("RETRY-09 nonretryable validation failure performs exactly 1 POST", async () => {
  const outcome = await runJob({
    id: "tr-retry-09",
    plan: () => schemaOutput("да"),
  });
  assert.equal(outcome.posts.length, 1);
  const chunkState = durableChunk(outcome.state);
  assert.equal(chunkState?.status, "FAILED");
  assert.equal(chunkState?.lastErrorClass, "catastrophic_shrinkage");
  assert.equal(outcome.sleeps.filter((ms) => ms > 0).length, 0);
});

test("RETRY-10 recovery with attemptCount=1 performs only the one remaining POST", async () => {
  const outcome = await runJob({
    id: "tr-retry-10",
    chunkOverrides: {
      status: "RETRYABLE_FAILED",
      attemptCount: 1,
      lastErrorClass: "provider_rate_limit",
    },
    plan: () => errorResponse(429),
  });
  assert.equal(outcome.posts.length, 1);
  assert.equal(durableChunk(outcome.state)?.attemptCount, 2);
  assert.equal(durableChunk(outcome.state)?.status, "FAILED");
});

test("RETRY-11 recovery with attemptCount=2 performs zero POSTs and terminalizes", async () => {
  const outcome = await runJob({
    id: "tr-retry-11",
    chunkOverrides: {
      status: "RETRYABLE_FAILED",
      attemptCount: 2,
      lastErrorClass: "provider_rate_limit",
    },
    plan: () => errorResponse(429),
  });
  assert.equal(outcome.posts.length, 0);
  const job = parseTranscriptEnhancementJob(outcome.state.processingMetadata);
  assert.equal(job.executionStatus, "FAILED");
  assert.equal(job.publicationEligible, false);
  assert.equal(job.chunks["0"]?.attemptCount, 2);
  assert.equal(outcome.state.text, ORIGINAL_TEXT);
});

test("a successful first attempt performs exactly 1 POST and publishes", async () => {
  const outcome = await runJob({
    id: "tr-retry-success",
    plan: () => schemaOutput(`${ORIGINAL_TEXT}.`),
  });
  assert.equal(outcome.posts.length, 1);
  const job = parseTranscriptEnhancementJob(outcome.state.processingMetadata);
  assert.equal(job.executionStatus, "COMPLETED");
  assert.equal(job.terminalQuality, "COMPLETED");
  assert.equal(outcome.state.text, `${ORIGINAL_TEXT}.`);
});

test("a retryable first attempt that succeeds on attempt 2 performs exactly 2 POSTs", async () => {
  const outcome = await runJob({
    id: "tr-retry-recover",
    plan: (attempt) =>
      attempt === 1 ? errorResponse(429, { "retry-after": "1" }) : schemaOutput(`${ORIGINAL_TEXT}!`),
  });
  assert.equal(outcome.posts.length, 2);
  const job = parseTranscriptEnhancementJob(outcome.state.processingMetadata);
  assert.equal(job.executionStatus, "COMPLETED");
  assert.equal(job.chunks["0"]?.attemptCount, 2);
  assert.equal(outcome.state.text, `${ORIGINAL_TEXT}!`);
});
