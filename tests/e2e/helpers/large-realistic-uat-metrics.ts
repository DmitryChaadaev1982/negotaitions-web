import { extractProviderUsage } from "@/lib/services/yandex-transcript-enhancement";
import {
  parseTranscriptEnhancementJob,
  type TranscriptEnhancementJob,
} from "@/lib/services/transcript-enhancement-job";

export type ProviderCallRecord = {
  startedAtMs: number;
  finishedAtMs: number;
  latencyMs: number;
  httpStatus: number | null;
  ok: boolean;
  kind: "create" | "poll" | "other";
  errorClass: "none" | "429" | "5xx" | "network" | "schema" | "other";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type TextChangeSummary = {
  segmentsTotal: number;
  segmentsTextChanged: number;
  segmentsTextUnchanged: number;
  failedOrErrorSegments: number;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

export function summarizeCallLatencies(records: readonly ProviderCallRecord[]): {
  calls: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
  retries: number;
  http429: number;
  http5xx: number;
  networkFailures: number;
  schemaFailures: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  firstCallAt: string | null;
  lastCallAt: string | null;
} {
  const primary = records.filter((record) => record.kind !== "poll");
  const latencies = primary.map((record) => record.latencyMs).sort((left, right) => left - right);
  const tokenSum = (key: "inputTokens" | "outputTokens" | "totalTokens") => {
    const values = records.map((record) => record[key]).filter((value): value is number => value != null);
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
  };
  const first = primary[0] ?? records[0];
  const last = primary[primary.length - 1] ?? records[records.length - 1];
  return {
    calls: primary.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: latencies.length > 0 ? latencies[latencies.length - 1]! : null,
    retries: Math.max(0, records.filter((record) => !record.ok).length),
    http429: records.filter((record) => record.errorClass === "429").length,
    http5xx: records.filter((record) => record.errorClass === "5xx").length,
    networkFailures: records.filter((record) => record.errorClass === "network").length,
    schemaFailures: records.filter((record) => record.errorClass === "schema").length,
    inputTokens: tokenSum("inputTokens"),
    outputTokens: tokenSum("outputTokens"),
    totalTokens: tokenSum("totalTokens"),
    firstCallAt: first ? new Date(first.startedAtMs).toISOString() : null,
    lastCallAt: last ? new Date(last.finishedAtMs).toISOString() : null,
  };
}

export function classifyHttp(status: number | null, failed: boolean, message?: string): ProviderCallRecord["errorClass"] {
  if (status === 429) return "429";
  if (status !== null && status >= 500) return "5xx";
  const lower = message?.toLowerCase() ?? "";
  if (lower.includes("schema") || lower.includes("invalid json")) return "schema";
  if (failed && status === null) return "network";
  if (failed) return "other";
  return "none";
}

function classifyYandexCallKind(url: string, method: string): ProviderCallRecord["kind"] {
  if (/\/responses\/[^/]+/i.test(url)) return "poll";
  if (/\/responses\/?$/i.test(url) && method.toUpperCase() === "POST") return "create";
  return "other";
}

function isYandexAiUrl(url: string): boolean {
  const configured = process.env.YANDEX_AI_BASE_URL?.trim();
  if (configured && url.startsWith(configured.replace(/\/$/, ""))) return true;
  return /ai\.api\.cloud\.yandex/i.test(url);
}

export function installYandexFetchInterceptor(): {
  records: ProviderCallRecord[];
  restore: () => void;
} {
  const records: ProviderCallRecord[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!isYandexAiUrl(url)) {
      return originalFetch(input, init);
    }
    const method =
      init?.method ??
      (typeof input === "object" && !(input instanceof URL) && "method" in input
        ? String((input as Request).method)
        : "GET");
    const kind = classifyYandexCallKind(url, method);
    const startedAtMs = Date.now();
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
        // Observational only.
      }
      records.push({
        startedAtMs,
        finishedAtMs: Date.now(),
        latencyMs: Date.now() - startedAtMs,
        httpStatus: response.status,
        ok: response.ok,
        kind,
        errorClass: classifyHttp(response.status, !response.ok),
        ...usage,
      });
      return response;
    } catch (error) {
      records.push({
        startedAtMs,
        finishedAtMs: Date.now(),
        latencyMs: Date.now() - startedAtMs,
        httpStatus: null,
        ok: false,
        kind,
        errorClass: "network",
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      });
      throw error;
    }
  }) as typeof fetch;
  return {
    records,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

export function summarizeTextChanges(
  segments: Array<{ text: string; qualityText: string | null }>,
): TextChangeSummary {
  let changed = 0;
  let unchanged = 0;
  for (const segment of segments) {
    const original = segment.qualityText ?? segment.text;
    if (segment.text === original) unchanged += 1;
    else changed += 1;
  }
  return {
    segmentsTotal: segments.length,
    segmentsTextChanged: changed,
    segmentsTextUnchanged: unchanged,
    failedOrErrorSegments: 0,
  };
}

export function jobRuntimeSummary(job: TranscriptEnhancementJob): {
  runId: string | null;
  chunksTotal: number;
  chunksCompleted: number;
  chunksFailed: number;
  executionStatus: string;
  terminalQuality: string | null;
  publicationEligible: boolean;
  publicationOutcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  skipReason: string | null;
  skipTime: string | null;
} {
  return {
    runId: job.runId,
    chunksTotal: job.progress.totalChunks,
    chunksCompleted: job.progress.completedChunks,
    chunksFailed: job.progress.permanentFailedChunks,
    executionStatus: job.executionStatus,
    terminalQuality: job.terminalQuality,
    publicationEligible: job.publicationEligible,
    publicationOutcome: job.publicationOutcome,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    skipReason: job.skipReason,
    skipTime: job.cancelledAt,
  };
}

export function parseJobFromMetadata(metadata: unknown): TranscriptEnhancementJob {
  return parseTranscriptEnhancementJob(metadata);
}

export type ChunkVersusSkip =
  | "completed_before_skip"
  | "completed_after_skip"
  | "in_flight_at_skip"
  | "pending_after_skip"
  | "failed";

export type SkipEvidenceSummary = {
  runId: string | null;
  startedAt: string | null;
  skipTime: string | null;
  publicationEligible: boolean;
  executionStatus: string;
  publicationOutcome: string | null;
  chunksTotal: number;
  completedBeforeSkip: number[];
  inFlightAtSkip: number[];
  completedAfterSkip: number[];
  pendingAfterSkip: number[];
  failed: number[];
};

export function classifyChunkVersusSkip(
  chunk: TranscriptEnhancementJob["chunks"][string],
  skipMs: number | null,
): ChunkVersusSkip {
  if (chunk.status === "FAILED" || chunk.status === "RETRYABLE_FAILED") return "failed";
  if (chunk.status === "COMPLETED") {
    if (skipMs == null || !chunk.finishedAt) return "completed_before_skip";
    return Date.parse(chunk.finishedAt) > skipMs ? "completed_after_skip" : "completed_before_skip";
  }
  if (chunk.status === "RUNNING") return "in_flight_at_skip";
  return "pending_after_skip";
}

export type ProviderCallVersusSkip =
  | "COMPLETED_BEFORE_SKIP"
  | "COMPLETED_AFTER_SKIP"
  | "STILL_IN_FLIGHT_OR_ABORTED";

export type ProviderCallObserveRecord = {
  runId: string | null;
  chunkIndex: number;
  requestStartedAt: string | null;
  responseReceivedAt: string | null;
  checkpointAccepted: boolean | null;
  checkpointRejectionReason: string | null;
};

export type ProviderSkipObservability = {
  inFlightAtSkip: number[];
  completedBeforeSkip: number[];
  completedAfterSkip: number[];
  stillInFlightOrAborted: number[];
  lateCheckpointAccepted: boolean | null;
  lateCheckpointRejected: boolean;
};

export function classifyProviderCallVersusSkip(
  record: Pick<ProviderCallObserveRecord, "requestStartedAt" | "responseReceivedAt">,
  skipMs: number | null,
): ProviderCallVersusSkip {
  if (!record.responseReceivedAt) return "STILL_IN_FLIGHT_OR_ABORTED";
  if (skipMs == null) return "COMPLETED_BEFORE_SKIP";
  return Date.parse(record.responseReceivedAt) > skipMs
    ? "COMPLETED_AFTER_SKIP"
    : "COMPLETED_BEFORE_SKIP";
}

export function summarizeProviderSkipObservability(
  records: readonly ProviderCallObserveRecord[],
  skipTime: string | null,
  runId?: string | null,
): ProviderSkipObservability {
  const skipMs = skipTime ? Date.parse(skipTime) : null;
  const scoped = records.filter((record) => !runId || record.runId === runId);
  const latestByChunk = new Map<number, ProviderCallObserveRecord>();
  for (const record of scoped) {
    latestByChunk.set(record.chunkIndex, record);
  }
  const completedBeforeSkip: number[] = [];
  const completedAfterSkip: number[] = [];
  const stillInFlightOrAborted: number[] = [];
  const inFlightAtSkip: number[] = [];
  let lateAccepted = false;
  let lateRejected = false;
  for (const record of [...latestByChunk.values()].sort((left, right) => left.chunkIndex - right.chunkIndex)) {
    const klass = classifyProviderCallVersusSkip(record, skipMs);
    const startedMs = record.requestStartedAt ? Date.parse(record.requestStartedAt) : null;
    const endedMs = record.responseReceivedAt ? Date.parse(record.responseReceivedAt) : null;
    if (
      skipMs != null &&
      startedMs != null &&
      startedMs <= skipMs &&
      (endedMs == null || endedMs > skipMs)
    ) {
      inFlightAtSkip.push(record.chunkIndex);
    }
    if (klass === "COMPLETED_BEFORE_SKIP") completedBeforeSkip.push(record.chunkIndex);
    else if (klass === "COMPLETED_AFTER_SKIP") {
      completedAfterSkip.push(record.chunkIndex);
      if (record.checkpointAccepted === true) lateAccepted = true;
      if (record.checkpointAccepted === false) lateRejected = true;
    } else stillInFlightOrAborted.push(record.chunkIndex);
  }
  return {
    inFlightAtSkip,
    completedBeforeSkip,
    completedAfterSkip,
    stillInFlightOrAborted,
    lateCheckpointAccepted:
      completedAfterSkip.length === 0 ? null : lateAccepted,
    lateCheckpointRejected: lateRejected,
  };
}

export function summarizeSkipEvidence(job: TranscriptEnhancementJob): SkipEvidenceSummary {
  const skipTime = job.cancelledAt;
  const skipMs = skipTime ? Date.parse(skipTime) : null;
  const completedBeforeSkip: number[] = [];
  const inFlightAtSkip: number[] = [];
  const completedAfterSkip: number[] = [];
  const pendingAfterSkip: number[] = [];
  const failed: number[] = [];
  for (const chunk of Object.values(job.chunks).sort((left, right) => left.chunkIndex - right.chunkIndex)) {
    const klass = classifyChunkVersusSkip(chunk, skipMs);
    if (klass === "completed_before_skip") completedBeforeSkip.push(chunk.chunkIndex);
    else if (klass === "completed_after_skip") completedAfterSkip.push(chunk.chunkIndex);
    else if (klass === "in_flight_at_skip") inFlightAtSkip.push(chunk.chunkIndex);
    else if (klass === "failed") failed.push(chunk.chunkIndex);
    else pendingAfterSkip.push(chunk.chunkIndex);
  }
  return {
    runId: job.runId,
    startedAt: job.startedAt,
    skipTime,
    publicationEligible: job.publicationEligible,
    executionStatus: job.executionStatus,
    publicationOutcome: job.publicationOutcome,
    chunksTotal: job.progress.totalChunks,
    completedBeforeSkip,
    inFlightAtSkip,
    completedAfterSkip,
    pendingAfterSkip,
    failed,
  };
}
