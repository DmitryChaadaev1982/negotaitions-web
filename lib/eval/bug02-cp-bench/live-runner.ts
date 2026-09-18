import { randomUUID } from "node:crypto";

import { enhanceTranscriptWithYandexAi } from "@/lib/services/yandex-transcript-enhancement";

import { resolveCharBoundSegmentCap } from "./planner";
import { scoreEnhancementQuality } from "./quality";
import type {
  BenchWorkload,
  LiveRunSummary,
  ProviderCallRecord,
} from "./types";
import { toEnhancementInput } from "./workloads";

const ENV_KEYS = [
  "TRANSCRIPT_ENHANCEMENT_MODE",
  "TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE",
  "TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS",
  "TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS",
  "TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY",
] as const;

export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function extractProviderUsage(envelope: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  const root = asRecord(envelope);
  const usage = asRecord(root?.usage) ?? asRecord(asRecord(root?.response)?.usage);
  if (!usage) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const inputTokens =
    readNumber(usage.input_text_tokens) ??
    readNumber(usage.input_tokens) ??
    readNumber(usage.prompt_tokens);
  const outputTokens =
    readNumber(usage.completion_tokens) ??
    readNumber(usage.output_tokens) ??
    readNumber(usage.output_text_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  return { inputTokens, outputTokens, totalTokens };
}

function classifyHttp(status: number | null, failed: boolean): ProviderCallRecord["errorClass"] {
  if (status === 429) return "429";
  if (status !== null && status >= 500) return "5xx";
  if (failed && status === null) return "network";
  if (failed) return "other";
  return "none";
}

export function createProviderCallInterceptor(options?: {
  aroundCall?: <T>(fn: () => Promise<T>) => Promise<T>;
}): { records: ProviderCallRecord[]; install: () => () => void } {
  const records: ProviderCallRecord[] = [];
  return {
    records,
    install: () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const run = async () => {
          const startedAtMs = Date.now();
          let maxTokensInRequest: number | null = null;
          try {
            if (typeof init?.body === "string") {
              const body = JSON.parse(init.body) as { max_output_tokens?: unknown };
              maxTokensInRequest = readNumber(body.max_output_tokens);
            }
          } catch {
            maxTokensInRequest = null;
          }
          try {
            const response = await originalFetch(input, init);
            let usage = {
              inputTokens: null as number | null,
              outputTokens: null as number | null,
              totalTokens: null as number | null,
            };
            try {
              const envelope = await response.clone().json();
              usage = extractProviderUsage(envelope);
            } catch {
              // Envelope parse is observational only; never log body text.
            }
            records.push({
              startedAtMs,
              finishedAtMs: Date.now(),
              latencyMs: Date.now() - startedAtMs,
              httpStatus: response.status,
              ok: response.ok,
              errorClass: classifyHttp(response.status, !response.ok),
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
              maxTokensInRequest,
            });
            return response;
          } catch (error) {
            records.push({
              startedAtMs,
              finishedAtMs: Date.now(),
              latencyMs: Date.now() - startedAtMs,
              httpStatus: null,
              ok: false,
              errorClass: "network",
              inputTokens: null,
              outputTokens: null,
              totalTokens: null,
              maxTokensInRequest,
            });
            throw error;
          }
        };
        return options?.aroundCall ? options.aroundCall(run) : run();
      }) as typeof fetch;
      return () => {
        globalThis.fetch = originalFetch;
      };
    },
  };
}

export async function runLiveEnhancementJob(params: {
  phase: "A" | "B" | "C";
  workload: BenchWorkload;
  maxChars: number;
  concurrency: number;
  jobId?: string;
  globalCap?: number;
  fairnessPolicy?: string;
  aroundCall?: <T>(fn: () => Promise<T>) => Promise<T>;
}): Promise<LiveRunSummary> {
  const maxSegments = resolveCharBoundSegmentCap(params.maxChars);
  const interceptor = createProviderCallInterceptor({ aroundCall: params.aroundCall });
  const restoreFetch = interceptor.install();
  const wallStarted = Date.now();
  try {
    const result = await withEnv(
      {
        TRANSCRIPT_ENHANCEMENT_MODE: "chunked",
        TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE: "json_schema",
        TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS: String(params.maxChars),
        TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS: String(maxSegments),
        TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY: String(params.concurrency),
      },
      () => enhanceTranscriptWithYandexAi(toEnhancementInput(params.workload)),
    );
    const quality = scoreEnhancementQuality({
      original: params.workload.segments,
      result,
    });
    const actualInputTokens = interceptor.records.reduce(
      (sum, record) => (record.inputTokens === null ? sum : (sum ?? 0) + record.inputTokens),
      null as number | null,
    );
    const actualOutputTokens = interceptor.records.reduce(
      (sum, record) => (record.outputTokens === null ? sum : (sum ?? 0) + record.outputTokens),
      null as number | null,
    );
    const actualTotalTokens = interceptor.records.reduce(
      (sum, record) => (record.totalTokens === null ? sum : (sum ?? 0) + record.totalTokens),
      null as number | null,
    );
    const configuredMaxTokensSeen = interceptor.records.reduce(
      (sum, record) =>
        record.maxTokensInRequest === null ? sum : (sum ?? 0) + record.maxTokensInRequest,
      null as number | null,
    );
    return {
      phase: params.phase,
      runId: randomUUID(),
      jobId: params.jobId,
      workloadId: params.workload.id,
      maxChars: params.maxChars,
      maxSegments,
      concurrency: params.concurrency,
      globalCap: params.globalCap,
      fairnessPolicy: params.fairnessPolicy,
      wallClockMs: Date.now() - wallStarted,
      chunkCount: result.meta?.chunkCount ?? 0,
      successfulChunkCount: result.meta?.successfulChunkCount ?? 0,
      failedChunkCount: result.meta?.failedChunkCount ?? 0,
      fallbackSegmentCount: result.meta?.fallbackSegmentCount ?? 0,
      retryCount: result.meta?.retryCount ?? 0,
      overallStatus: result.meta?.overallStatus ?? "FAILED",
      quality,
      providerCalls: interceptor.records,
      http429: interceptor.records.filter((record) => record.errorClass === "429").length,
      http5xx: interceptor.records.filter((record) => record.errorClass === "5xx").length,
      networkFailures: interceptor.records.filter((record) => record.errorClass === "network")
        .length,
      callLatencyMs: interceptor.records.map((record) => record.latencyMs),
      actualInputTokens,
      actualOutputTokens,
      actualTotalTokens,
      configuredMaxTokensSeen,
      tokensUsedEqualsConfiguredCap:
        actualTotalTokens === null || configuredMaxTokensSeen === null
          ? null
          : actualTotalTokens === configuredMaxTokensSeen,
    };
  } finally {
    restoreFetch();
    void ENV_KEYS;
  }
}
