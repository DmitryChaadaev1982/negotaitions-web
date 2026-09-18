import { getTranscriptEnhancementMaxRetries } from "@/lib/env";

/**
 * Single durable retry owner.
 *
 * D1 orchestration owns attemptCount, classification, backoff, Retry-After and
 * the retry budget. The provider module performs exactly one HTTP POST per
 * invocation and never sleeps or retries internally.
 *
 * Hard bound: at most 2 HTTP POST attempts per chunk per `runId`
 * (attempt 1 = initial request, attempt 2 = the single retry).
 */
export const MAX_PROVIDER_POST_ATTEMPTS_PER_CHUNK = 2;

/** Provider-requested delays are honoured but never exceed this cap. */
export const MAX_PROVIDER_RETRY_AFTER_MS = 30_000;

const BACKOFF_BASE_MS = 250;
const BACKOFF_MAX_MS = 8_000;
const BACKOFF_JITTER_MS = 120;

/**
 * Effective POST budget per chunk.
 *
 * `TRANSCRIPT_ENHANCEMENT_MAX_RETRIES` counts retries, so the POST budget is
 * retries + 1. The operator knob may lower the budget (0 retries = a single
 * POST) but can never widen it past the approved hard bound of 2.
 */
export function getProviderPostAttemptBudget(): number {
  const configuredRetries = Math.max(0, getTranscriptEnhancementMaxRetries());
  return Math.min(MAX_PROVIDER_POST_ATTEMPTS_PER_CHUNK, configuredRetries + 1);
}

/**
 * `Retry-After` per RFC 9110: delta-seconds or HTTP-date. Malformed, missing
 * and already-elapsed values return null/0 so the caller falls back to normal
 * backoff. The provider-requested delay is capped.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  nowMs: number,
): number | null {
  if (typeof headerValue !== "string") return null;
  const raw = headerValue.trim();
  if (!raw) return null;

  if (/^\d+$/u.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isFinite(seconds)) return null;
    return Math.min(MAX_PROVIDER_RETRY_AFTER_MS, Math.max(0, Math.round(seconds * 1000)));
  }

  // HTTP-date forms (IMF-fixdate, RFC 850, asctime) always carry weekday and
  // month names. Anything else is malformed and falls back to backoff.
  if (!/[a-z]/iu.test(raw)) return null;
  const parsedDate = Date.parse(raw);
  if (!Number.isFinite(parsedDate)) return null;
  return Math.min(MAX_PROVIDER_RETRY_AFTER_MS, Math.max(0, parsedDate - nowMs));
}

/** Exponential backoff with jitter for attempt N (1-based). */
export function retryBackoffMs(attemptNumber: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attemptNumber - 1);
  const base = BACKOFF_BASE_MS * 2 ** exponent;
  const jitter = Math.floor(random() * BACKOFF_JITTER_MS);
  return Math.min(BACKOFF_MAX_MS, base + jitter);
}

/**
 * Retry delay is never shorter than normal backoff and never shorter than a
 * capped provider-requested `Retry-After`.
 */
export function resolveRetryDelayMs(params: {
  backoffMs: number;
  retryAfterMs?: number | null;
}): number {
  const backoff = Math.max(0, params.backoffMs);
  const requested =
    params.retryAfterMs == null
      ? 0
      : Math.min(MAX_PROVIDER_RETRY_AFTER_MS, Math.max(0, params.retryAfterMs));
  return Math.max(backoff, requested);
}

/**
 * Retryable provider error categories. These are the categories for which the
 * approved Product behavior allows exactly one further POST attempt.
 */
const RETRYABLE_PROVIDER_CATEGORIES = new Set([
  "provider_rate_limit",
  "provider_http_5xx",
  "timeout",
  "network",
  "empty_output",
  "malformed_output",
  "missing_segment_id",
  "empty_enhanced_text",
  "provider_slot_unavailable",
]);

/**
 * Never retryable. Catastrophic shrink and structurally invalid indexes stay
 * terminal; a second POST cannot fix them.
 */
const HARD_PROVIDER_MARKERS = [
  "catastrophic shrink",
  "catastrophic shrinkage",
  "unknown segment",
  "duplicate segment",
  "provider malformed envelope",
];

/** Legacy/substring forms of retryable classes kept readable in durable rows. */
const RETRYABLE_PROVIDER_MARKERS = [
  "429",
  "5xx",
  "http 5",
  "rate limit",
  "timeout",
  "timed out",
  "network",
  "fetch failed",
  "empty output",
  "empty model output",
  "malformed output",
  "invalid json",
  "schema",
  "slot unavailable",
];

/**
 * Retry classification for a durable `lastErrorClass`. Accepts both the
 * canonical provider categories and the legacy substring forms that historical
 * rows may carry.
 */
export function isRetryableProviderCategory(category: string | null | undefined): boolean {
  if (!category) return false;
  const normalized = category.trim().toLowerCase();
  if (RETRYABLE_PROVIDER_CATEGORIES.has(normalized)) return true;
  const spaced = normalized.replace(/[^a-z0-9]+/gu, " ").trim();
  if (HARD_PROVIDER_MARKERS.some((marker) => spaced.includes(marker))) return false;
  return RETRYABLE_PROVIDER_MARKERS.some((marker) => spaced.includes(marker));
}

export type ProviderAttemptFlavor = "same_request" | "strict_json";

/**
 * Attempt 2 flavor. Empty/malformed/schema failures re-ask with the stricter
 * JSON instruction and a bounded token adjustment; transport failures repeat
 * the same semantic request.
 */
export function resolveAttemptFlavor(
  previousErrorClass: string | null | undefined,
): ProviderAttemptFlavor {
  if (!previousErrorClass) return "same_request";
  const normalized = previousErrorClass.toLowerCase();
  if (
    normalized.includes("empty_output") ||
    normalized.includes("malformed_output") ||
    normalized.includes("schema") ||
    normalized.includes("segment_id") ||
    normalized.includes("empty_enhanced_text")
  ) {
    return "strict_json";
  }
  return "same_request";
}

export type ProviderAttemptDecision = {
  chunkIndex: number;
  attemptNumber: number;
  flavor: ProviderAttemptFlavor;
};

export type ChunkRetryLedgerEntry = {
  chunkIndex: number;
  status: string;
  attemptCount: number;
  lastErrorClass: string | null;
};

/**
 * Which chunks may still receive an HTTP POST, and with which attempt number.
 * Derived only from the durable ledger, so a process restart cannot manufacture
 * an extra attempt. COMPLETED chunks are never re-posted; chunks that already
 * consumed the budget are excluded.
 */
export function resolveChunkAttemptPlan(params: {
  chunks: ChunkRetryLedgerEntry[];
  budget?: number;
}): ProviderAttemptDecision[] {
  const budget = params.budget ?? getProviderPostAttemptBudget();
  const decisions: ProviderAttemptDecision[] = [];
  for (const chunk of params.chunks) {
    if (chunk.status === "COMPLETED" || chunk.status === "FAILED") continue;
    const consumed = Math.max(0, chunk.attemptCount);
    if (consumed >= budget) continue;
    decisions.push({
      chunkIndex: chunk.chunkIndex,
      attemptNumber: consumed + 1,
      flavor: consumed === 0 ? "same_request" : resolveAttemptFlavor(chunk.lastErrorClass),
    });
  }
  return decisions.sort((left, right) => left.chunkIndex - right.chunkIndex);
}

/**
 * Durable status for a finished provider attempt. `RETRYABLE_FAILED` is only
 * legal while POST budget remains; otherwise the chunk is permanently failed
 * and Slice A terminalization takes over.
 */
export function resolveChunkStatusAfterAttempt(params: {
  providerCompleted: boolean;
  retryable: boolean;
  attemptNumber: number;
  budget?: number;
}): "COMPLETED" | "RETRYABLE_FAILED" | "FAILED" {
  if (params.providerCompleted) return "COMPLETED";
  const budget = params.budget ?? getProviderPostAttemptBudget();
  return params.retryable && params.attemptNumber < budget ? "RETRYABLE_FAILED" : "FAILED";
}
