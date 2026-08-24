/**
 * Lowest-sensitivity AI-analysis failure diagnostics for the existing
 * ExternalServiceEvent journal path. Do not persist transcript, notes,
 * hiddenInfo, personal feedback, raw model output, or extracted prose.
 *
 * The sanitizer is fail-closed: only the positive allowlist of technical
 * metadata keys produced by the current AI-analysis path may persist, and
 * only when the value is a bounded primitive or primitive array.
 */

import type { AiAnalysisErrorCode, AiAnalysisRunMetrics } from "@/lib/ai/negotiation-analysis";

const MAX_ISSUE_PATHS = 5;
const MAX_BOUNDED_STRING_CHARS = 500;
const MAX_BOUNDED_ARRAY_ITEMS = 16;
const MAX_BOUNDED_ARRAY_ITEM_CHARS = 200;

const FORBIDDEN_DIAGNOSTIC_KEY_PATTERN =
  /transcript|notes|hiddeninfo|hidden_info|feedback|rawmodel|providerenvelope|output_text|prose|prompttext/i;

export const BOUNDED_SCHEMA_DIAGNOSTIC_KEYS = [
  "issueCount",
  "issuePaths",
  "issueCodes",
  "expectedKinds",
  "receivedKinds",
] as const;

/**
 * Positive allowlist of approved low-sensitivity diagnostic keys currently
 * produced on the AI-analysis failure path. Unknown keys are dropped.
 *
 * Not allowlisted on purpose:
 * - free-form `issues` (Zod message prose)
 * - `candidate` / `responseBody` / raw model or provider prose
 * - transcript / notes / hiddenInfo / personal feedback
 */
export const APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEYS = [
  ...BOUNDED_SCHEMA_DIAGNOSTIC_KEYS,
  "providerStatus",
  "providerErrorCode",
  "incompleteReason",
  "outputFieldDetected",
  "outputCondition",
  "responseIdPresent",
  "httpStatus",
  "bodyLength",
  "timeoutMs",
  "timeoutScope",
  "operationTimeoutMs",
  "pollTimeoutMs",
  "pollingRequestCount",
  "retrievalRetryCount",
  "maxPollRequestsReached",
  "generationCallCount",
  "providerGenerationAttempt",
  "checkpoint",
  "cancellationSource",
  "inputChars",
  "estimatedInputTokens",
  "estimatedTotalInputTokenBudget",
  "contentDropped",
  "promptChars",
  "estimatedPromptTokens",
  "estimatedPromptTokenBudget",
  "responseLength",
  "errorName",
  "messageLength",
  "purpose",
] as const;

const APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEY_SET = new Set<string>(
  APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEYS,
);

export type ApprovedAiAnalysisDiagnosticKey =
  (typeof APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEYS)[number];

export type BoundedSchemaIssueDiagnostics = {
  issueCount: number;
  issuePaths: string[];
  issueCodes: string[];
  expectedKinds: Array<string | null>;
  receivedKinds: Array<string | null>;
};

export type BoundedAiAnalysisLogPayload = {
  errorClass: AiAnalysisErrorCode;
  provider: string;
  model: string | null;
  httpStatus: number | null;
  retryable: boolean;
  diagnostics: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
};

type ZodIssueLike = {
  path: ReadonlyArray<PropertyKey>;
  code?: unknown;
  expected?: unknown;
  received?: unknown;
  input?: unknown;
  message?: unknown;
};

type ZodErrorLike = {
  issues: readonly ZodIssueLike[];
};

export function describeRuntimeKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function extractExpectedKind(issue: ZodIssueLike): string | null {
  return typeof issue.expected === "string" ? issue.expected : null;
}

function extractReceivedKind(issue: ZodIssueLike): string | null {
  if (typeof issue.received === "string") return issue.received;
  if ("input" in issue) return describeRuntimeKind(issue.input);
  if (typeof issue.message === "string") {
    const match = issue.message.match(/received ([A-Za-z]+)/u);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

export function buildBoundedSchemaIssueDiagnostics(
  error: ZodErrorLike,
): BoundedSchemaIssueDiagnostics {
  const boundedIssues = error.issues.slice(0, MAX_ISSUE_PATHS);
  return {
    issueCount: error.issues.length,
    issuePaths: boundedIssues.map((issue) => issue.path.join(".")),
    issueCodes: boundedIssues.map((issue) =>
      typeof issue.code === "string" ? issue.code : "unknown",
    ),
    expectedKinds: boundedIssues.map(extractExpectedKind),
    receivedKinds: boundedIssues.map(extractReceivedKind),
  };
}

export function isForbiddenDiagnosticKey(key: string): boolean {
  return FORBIDDEN_DIAGNOSTIC_KEY_PATTERN.test(key);
}

export function isApprovedAiAnalysisDiagnosticKey(
  key: string,
): key is ApprovedAiAnalysisDiagnosticKey {
  return APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEY_SET.has(key);
}

function isBoundedDiagnosticValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value === "string") {
    return value.length <= MAX_BOUNDED_STRING_CHARS;
  }
  if (Array.isArray(value)) {
    return (
      value.length <= MAX_BOUNDED_ARRAY_ITEMS &&
      value.every(
        (item) =>
          item == null ||
          typeof item === "number" ||
          typeof item === "boolean" ||
          (typeof item === "string" && item.length <= MAX_BOUNDED_ARRAY_ITEM_CHARS),
      )
    );
  }
  return false;
}

export function sanitizeAiAnalysisDiagnostics(
  diagnostics: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(diagnostics)) {
    if (!isApprovedAiAnalysisDiagnosticKey(key)) continue;
    if (isForbiddenDiagnosticKey(key)) continue;
    if (!isBoundedDiagnosticValue(value)) continue;
    sanitized[key] = value;
  }
  return sanitized;
}

export function buildBoundedAiAnalysisLogPayload(params: {
  errorClass: AiAnalysisErrorCode;
  provider: string;
  model: string | null;
  httpStatus: number | null;
  retryable: boolean;
  metrics?: AiAnalysisRunMetrics;
  diagnostics: Record<string, unknown>;
}): BoundedAiAnalysisLogPayload {
  return {
    errorClass: params.errorClass,
    provider: params.provider,
    model: params.model,
    httpStatus: params.httpStatus,
    retryable: params.retryable,
    diagnostics: sanitizeAiAnalysisDiagnostics(params.diagnostics),
    metrics: params.metrics
      ? {
          totalDurationMs: params.metrics.totalDurationMs,
          preProviderDurationMs: params.metrics.preProviderDurationMs,
          generationPostDurationMs: params.metrics.generationPostDurationMs,
          pollingDurationMs: params.metrics.pollingDurationMs,
          parsingValidationDurationMs: params.metrics.parsingValidationDurationMs,
          optionalDepthDurationMs: params.metrics.optionalDepthDurationMs,
          promptChars: params.metrics.promptChars,
          estimatedPromptTokens: params.metrics.estimatedPromptTokens,
          instructionChars: params.metrics.instructionChars,
          inputChars: params.metrics.inputChars,
          estimatedInputTokens: params.metrics.estimatedInputTokens,
          outputSchemaInstructionChars:
            params.metrics.outputSchemaInstructionChars,
          primaryMaxOutputTokensConfigured:
            params.metrics.primaryMaxOutputTokensConfigured,
          operationAttemptCount: params.metrics.operationAttemptCount,
          outerRetryCount: params.metrics.outerRetryCount,
          maxOperationAttempts: params.metrics.maxOperationAttempts,
          generationCallCount: params.metrics.generationCallCount,
          compactFallbackCount: params.metrics.compactFallbackCount,
          optionalDepthCallCount: params.metrics.optionalDepthCallCount,
          pollingRequestCount: params.metrics.pollingRequestCount,
          retrievalRetryCount: params.metrics.retrievalRetryCount,
          operationTimeoutMs: params.metrics.operationTimeoutMs,
          httpTimeoutMs: params.metrics.httpTimeoutMs,
          responsePollTimeoutMs: params.metrics.responsePollTimeoutMs,
          optionalDepthOutcome: params.metrics.optionalDepthOutcome,
          optionalDepthFailureClass: params.metrics.optionalDepthFailureClass,
          responseLength: params.metrics.responseLength,
          outputChars: params.metrics.outputChars,
          calls: params.metrics.calls.map((call) => ({
            operationAttemptNumber: call.operationAttemptNumber,
            generationCallNumber: call.generationCallNumber,
            purpose: call.purpose,
            model: call.model,
            durationMs: call.durationMs,
            generationPostDurationMs: call.generationPostDurationMs,
            pollingDurationMs: call.pollingDurationMs,
            promptChars: call.promptChars,
            instructionChars: call.instructionChars,
            inputChars: call.inputChars,
            estimatedInputTokens: call.estimatedInputTokens,
            maxOutputTokens: call.maxOutputTokens,
            responseLength: call.responseLength,
            httpStatus: call.httpStatus,
            providerStatus: call.providerStatus,
            responseIdPresent: call.responseIdPresent,
            pollingRequestCount: call.pollingRequestCount,
            retrievalRetryCount: call.retrievalRetryCount,
            errorClass: call.errorClass,
          })),
        }
      : null,
  };
}
