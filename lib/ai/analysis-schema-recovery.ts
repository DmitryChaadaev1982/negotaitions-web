/**
 * Bounded same-prompt Yandex schema recovery for one owned analysis operation.
 *
 * Eligible only when the selected provider is Yandex and generation 1
 * terminates with MODEL_SCHEMA_VALIDATION_ERROR. Starts at most one NEW
 * generation with the already-built prompt. Does not terminalize between
 * attempts. Does not rebuild materials to obtain a second prompt.
 */

import {
  AI_ANALYSIS_MAX_EXTRA_SCHEMA_RECOVERY_GENERATIONS,
  AI_ANALYSIS_TOTAL_GENERATIONS_MAX,
  YANDEX_SCHEMA_RECOVERY_ELIGIBLE_ERROR_CODE,
  YANDEX_SCHEMA_RECOVERY_ELIGIBLE_PROVIDER,
  YANDEX_SCHEMA_RECOVERY_EVENT_TITLE,
} from "@/lib/ai/analysis-schema-recovery-policy";
import type { AiAnalysisCurrentnessResult } from "@/lib/ai/analysis-currentness";
import {
  executeOwnedAnalysis,
  type OwnedAnalysisExecutionResult,
  type OwnedAnalysisFailure,
} from "@/lib/ai/analysis-orchestration";
import {
  AiAnalysisProviderError,
  classifyAiAnalysisError,
  getAiAnalysisOperationTimeoutMs,
  type AiAnalysisProviderName,
  type AiAnalysisRunMetrics,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";

export {
  AI_ANALYSIS_MAX_EXTRA_SCHEMA_RECOVERY_GENERATIONS,
  AI_ANALYSIS_TOTAL_GENERATIONS_MAX,
  YANDEX_SCHEMA_RECOVERY_ELIGIBLE_ERROR_CODE,
  YANDEX_SCHEMA_RECOVERY_ELIGIBLE_PROVIDER,
  YANDEX_SCHEMA_RECOVERY_EVENT_TITLE,
};

export type OwnedNegotiationAnalysisResult = {
  output: NegotiationAnalysisOutput;
  rawOutput: unknown;
  model: string;
  metrics: AiAnalysisRunMetrics;
};

export type SchemaRecoveryPrecheckResult =
  | { state: "ready" }
  | { state: "ownership_lost" }
  | { state: "stale_material" };

export function getOwnedAnalysisSchemaRecoveryBounds() {
  return {
    maxExtraSchemaRecoveryGenerations:
      AI_ANALYSIS_MAX_EXTRA_SCHEMA_RECOVERY_GENERATIONS,
    totalGenerationsMax: AI_ANALYSIS_TOTAL_GENERATIONS_MAX,
    eligibleProvider: YANDEX_SCHEMA_RECOVERY_ELIGIBLE_PROVIDER,
    eligibleErrorCode: YANDEX_SCHEMA_RECOVERY_ELIGIBLE_ERROR_CODE,
  };
}

export function isEligibleForBoundedYandexSchemaRecovery(params: {
  provider: string;
  error: unknown;
  completedGenerationCount: number;
}): boolean {
  if (params.completedGenerationCount !== 1) return false;
  if (params.provider !== YANDEX_SCHEMA_RECOVERY_ELIGIBLE_PROVIDER) {
    return false;
  }
  const classified = classifyAiAnalysisError(params.error);
  return (
    classified.code === YANDEX_SCHEMA_RECOVERY_ELIGIBLE_ERROR_CODE &&
    classified.provider === YANDEX_SCHEMA_RECOVERY_ELIGIBLE_PROVIDER
  );
}

export function decideSchemaRecoveryPrecheck(params: {
  ownershipRenewed: boolean;
  currentness: AiAnalysisCurrentnessResult;
}): SchemaRecoveryPrecheckResult {
  if (!params.ownershipRenewed) {
    return { state: "ownership_lost" };
  }
  if (!params.currentness.current) {
    return { state: "stale_material" };
  }
  return { state: "ready" };
}

export function mergeOwnedSchemaRecoveryMetrics(
  first: AiAnalysisRunMetrics | undefined,
  second: AiAnalysisRunMetrics,
): AiAnalysisRunMetrics {
  const firstCalls = first?.calls ?? [];
  const secondCalls = second.calls.map((call, index) => ({
    ...call,
    generationCallNumber: firstCalls.length + index + 1,
  }));
  return {
    ...second,
    generationCallCount:
      (first?.generationCallCount ?? 0) + second.generationCallCount,
    calls: [...firstCalls, ...secondCalls],
    pollingRequestCount:
      (first?.pollingRequestCount ?? 0) + second.pollingRequestCount,
    retrievalRetryCount:
      (first?.retrievalRetryCount ?? 0) + second.retrievalRetryCount,
    generationPostDurationMs:
      (first?.generationPostDurationMs ?? 0) + second.generationPostDurationMs,
    pollingDurationMs:
      (first?.pollingDurationMs ?? 0) + second.pollingDurationMs,
    parsingValidationDurationMs:
      (first?.parsingValidationDurationMs ?? 0) +
      second.parsingValidationDurationMs,
    outerRetryCount: 0,
    operationAttemptCount: 1,
    maxOperationAttempts: 1,
  };
}

function ownershipLostError(provider: AiAnalysisProviderName) {
  return new AiAnalysisProviderError({
    code: "OWNERSHIP_LOST",
    provider,
    message: "AI analysis ownership was lost before schema recovery.",
    allowsRegeneration: false,
    diagnostics: {
      checkpoint: "before_schema_recovery_generation",
      providerGenerationAttempt: 1,
    },
  });
}

function operationDeadlineExhaustedError(params: {
  provider: AiAnalysisProviderName;
  generationCallCount: number;
}) {
  return new AiAnalysisProviderError({
    code: "NETWORK_TIMEOUT",
    provider: params.provider,
    message:
      "Yandex AI analysis operation deadline was exhausted before schema recovery.",
    retryable: true,
    allowsRegeneration: false,
    diagnostics: {
      timeoutScope: "operation",
      operationTimeoutMs: getAiAnalysisOperationTimeoutMs(),
      generationCallCount: params.generationCallCount,
      providerGenerationAttempt: 1,
    },
  });
}

function attachMergedMetrics(
  error: unknown,
  firstMetrics: AiAnalysisRunMetrics | undefined,
): never {
  if (error instanceof AiAnalysisProviderError) {
    if (error.metrics) {
      error.metrics = mergeOwnedSchemaRecoveryMetrics(
        firstMetrics,
        error.metrics,
      );
    }
    Object.assign(error.diagnostics, {
      providerGenerationAttempt: 2,
      generationCallCount: error.metrics?.generationCallCount ?? 2,
    });
  }
  throw error;
}

export async function runOwnedYandexSchemaRecoveryGeneration(params: {
  provider: AiAnalysisProviderName;
  prompt: string;
  existingProviderResponseId: string | null;
  remainingOperationBudgetMs: () => number;
  generate: (input: {
    prompt: string;
    generationAttempt: 1 | 2;
    existingProviderResponseId: string | null;
  }) => Promise<OwnedNegotiationAnalysisResult>;
  assertReadyForSecondGeneration: () => Promise<SchemaRecoveryPrecheckResult>;
  clearExhaustedProviderResponseId: () => Promise<boolean>;
  observeFirstAttemptRecoveryDiagnostic: (error: unknown) => Promise<void>;
}): Promise<OwnedNegotiationAnalysisResult> {
  try {
    return await params.generate({
      prompt: params.prompt,
      generationAttempt: 1,
      existingProviderResponseId: params.existingProviderResponseId,
    });
  } catch (firstError) {
    if (
      !isEligibleForBoundedYandexSchemaRecovery({
        provider: params.provider,
        error: firstError,
        completedGenerationCount: 1,
      })
    ) {
      throw firstError;
    }

    try {
      await params.observeFirstAttemptRecoveryDiagnostic(firstError);
    } catch {
      // Best-effort journal must not block recovery or later terminalization.
    }

    const cleared = await params.clearExhaustedProviderResponseId();
    if (!cleared) {
      throw ownershipLostError(params.provider);
    }

    const readiness = await params.assertReadyForSecondGeneration();
    if (readiness.state === "ownership_lost") {
      throw ownershipLostError(params.provider);
    }
    if (readiness.state === "stale_material") {
      throw firstError;
    }

    if (params.remainingOperationBudgetMs() <= 0) {
      throw operationDeadlineExhaustedError({
        provider: params.provider,
        generationCallCount: 1,
      });
    }

    const firstMetrics =
      firstError instanceof AiAnalysisProviderError
        ? firstError.metrics
        : undefined;

    try {
      const second = await params.generate({
        prompt: params.prompt,
        generationAttempt: 2,
        existingProviderResponseId: null,
      });
      return {
        ...second,
        metrics: mergeOwnedSchemaRecoveryMetrics(firstMetrics, second.metrics),
      };
    } catch (secondError) {
      attachMergedMetrics(secondError, firstMetrics);
    }
  }
}

export async function executeOwnedAnalysisWithBoundedYandexSchemaRecovery(params: {
  provider: AiAnalysisProviderName;
  preparePrompt: () => Promise<string>;
  existingProviderResponseId: string | null;
  remainingOperationBudgetMs: () => number;
  generate: (input: {
    prompt: string;
    generationAttempt: 1 | 2;
    existingProviderResponseId: string | null;
  }) => Promise<OwnedNegotiationAnalysisResult>;
  assertReadyForSecondGeneration: () => Promise<SchemaRecoveryPrecheckResult>;
  clearExhaustedProviderResponseId: () => Promise<boolean>;
  observeFirstAttemptRecoveryDiagnostic: (error: unknown) => Promise<void>;
  complete: (value: OwnedNegotiationAnalysisResult) => Promise<boolean>;
  fail: (failure: OwnedAnalysisFailure) => Promise<boolean>;
  classifyFailure: (error: unknown) => OwnedAnalysisFailure;
  isOwnershipLost: (error: unknown) => boolean;
  observeSuccess?: (
    value: OwnedNegotiationAnalysisResult,
  ) => void | Promise<void>;
  observeFailure?: (failure: OwnedAnalysisFailure) => void | Promise<void>;
  observeInstrumentationFailure?: (
    phase: "success" | "failure",
    error: unknown,
  ) => void;
}): Promise<OwnedAnalysisExecutionResult<OwnedNegotiationAnalysisResult>> {
  return executeOwnedAnalysis({
    run: async () => {
      const prompt = await params.preparePrompt();
      return runOwnedYandexSchemaRecoveryGeneration({
        provider: params.provider,
        prompt,
        existingProviderResponseId: params.existingProviderResponseId,
        remainingOperationBudgetMs: params.remainingOperationBudgetMs,
        generate: params.generate,
        assertReadyForSecondGeneration: params.assertReadyForSecondGeneration,
        clearExhaustedProviderResponseId: params.clearExhaustedProviderResponseId,
        observeFirstAttemptRecoveryDiagnostic:
          params.observeFirstAttemptRecoveryDiagnostic,
      });
    },
    complete: params.complete,
    fail: params.fail,
    classifyFailure: params.classifyFailure,
    isOwnershipLost: params.isOwnershipLost,
    observeSuccess: params.observeSuccess,
    observeFailure: params.observeFailure,
    observeInstrumentationFailure: params.observeInstrumentationFailure,
  });
}
