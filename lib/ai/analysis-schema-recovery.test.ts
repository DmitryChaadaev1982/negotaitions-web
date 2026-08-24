import assert from "node:assert/strict";
import test from "node:test";

import { AiAnalysisStatus } from "@/app/generated/prisma/client";
import { yandexResponseLifecycleFixtures as fixtures } from "@/lib/ai/fixtures/yandex-response-lifecycle";
import { evaluateAiAnalysisCurrentness } from "@/lib/ai/analysis-currentness";
import {
  claimAiAnalysisRun,
  clearAiAnalysisProviderResponseId,
  completeAiAnalysisRun,
  failAiAnalysisRun,
  persistAiAnalysisProviderResponseId,
  startAiAnalysisRun,
  type AiAnalysisOperationStore,
  type AiAnalysisRunOwner,
} from "@/lib/ai/analysis-operation";
import {
  AI_ANALYSIS_TOTAL_GENERATIONS_MAX,
  decideSchemaRecoveryPrecheck,
  executeOwnedAnalysisWithBoundedYandexSchemaRecovery,
  getOwnedAnalysisSchemaRecoveryBounds,
  isEligibleForBoundedYandexSchemaRecovery,
  YANDEX_SCHEMA_RECOVERY_EVENT_TITLE,
} from "@/lib/ai/analysis-schema-recovery";
import {
  AiAnalysisProviderError,
  canRecoverProviderResponseAfterFailure,
  classifyAiAnalysisError,
  createMockAnalysisOutput,
  getAiAnalysisPerformanceModel,
  NegotiationAnalysisOutputSchema,
  runNegotiationAnalysis,
  type AiAnalysisErrorCode,
  type AiAnalysisProviderName,
  type AiAnalysisRunMetrics,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";

const INCIDENT_PATH = "listeningAndReframing.missedOpportunities.0";
const OWNED_PROMPT = "owned-operation-prompt-v1";
const FINGERPRINT_F1 = "fingerprint-f1";
const FINGERPRINT_F2 = "fingerprint-f2";

function canShareFromStatus(status: AiAnalysisStatus | null, analysisCurrent: boolean) {
  return status === AiAnalysisStatus.COMPLETED && analysisCurrent;
}

function incidentInvalidOutput(): unknown {
  const valid = createMockAnalysisOutput("en");
  return {
    ...valid,
    listeningAndReframing: {
      ...valid.listeningAndReframing,
      missedOpportunities: [
        {
          improvedPhrase: "If date is the constraint, we can trade volume.",
          whyItWorks: "It reframes a refusal as a package.",
        },
      ],
    },
  };
}

function schemaError(params: {
  provider?: AiAnalysisProviderName;
  code?: AiAnalysisErrorCode;
}): AiAnalysisProviderError {
  const parsed = NegotiationAnalysisOutputSchema.safeParse(incidentInvalidOutput());
  assert.equal(parsed.success, false);
  const paths = parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.path.join("."));
  if ((params.code ?? "MODEL_SCHEMA_VALIDATION_ERROR") === "MODEL_SCHEMA_VALIDATION_ERROR") {
    assert.ok(paths.includes(INCIDENT_PATH), paths.join(", "));
  }
  const error = new AiAnalysisProviderError({
    code: params.code ?? "MODEL_SCHEMA_VALIDATION_ERROR",
    provider: params.provider ?? "yandex",
    model: "deepseek-v4-flash",
    message: "Yandex AI response failed schema validation.",
    retryable: false,
    allowsRegeneration: false,
    diagnostics: {
      issueCount: 1,
      issuePaths: [INCIDENT_PATH],
    },
  });
  error.metrics = emptyMetrics({
    provider: params.provider ?? "yandex",
    generationCallCount: 1,
    errorClass: params.code ?? "MODEL_SCHEMA_VALIDATION_ERROR",
  });
  return error;
}

function emptyMetrics(params: {
  provider: AiAnalysisProviderName;
  generationCallCount: number;
  errorClass: AiAnalysisErrorCode | null;
}): AiAnalysisRunMetrics {
  return {
    provider: params.provider,
    model: "deepseek-v4-flash",
    totalDurationMs: 10,
    preProviderDurationMs: 1,
    generationPostDurationMs: 2,
    pollingDurationMs: 0,
    parsingValidationDurationMs: 1,
    optionalDepthDurationMs: 0,
    promptChars: OWNED_PROMPT.length,
    estimatedPromptTokens: 1,
    instructionChars: 10,
    inputChars: OWNED_PROMPT.length + 10,
    estimatedInputTokens: 2,
    outputSchemaInstructionChars: 10,
    primaryMaxOutputTokensConfigured: 8000,
    operationAttemptCount: 1,
    outerRetryCount: 0,
    maxOperationAttempts: 1,
    generationCallCount: params.generationCallCount,
    compactFallbackCount: 0,
    optionalDepthCallCount: 0,
    pollingRequestCount: 0,
    retrievalRetryCount: 0,
    operationTimeoutMs: 600_000,
    httpTimeoutMs: 20_000,
    responsePollTimeoutMs: 300_000,
    optionalDepthOutcome: "not_needed",
    optionalDepthFailureClass: null,
    responseLength: 0,
    outputChars: 0,
    errorClass: params.errorClass,
    calls: [],
  };
}

function successResult(output: NegotiationAnalysisOutput) {
  return {
    output,
    rawOutput: { mock: true },
    model: "deepseek-v4-flash",
    metrics: emptyMetrics({
      provider: "yandex",
      generationCallCount: 1,
      errorClass: null,
    }),
  };
}

function createOwnedStore() {
  let row: {
    id: string;
    status: AiAnalysisStatus;
    runToken: string | null;
    leaseExpiresAt: Date | null;
    providerResponseId: string | null;
    transcriptId: string;
    transcriptRetranscribeCount: number;
    language: string;
    updatedAt: Date;
    analysisVersion: number;
  } | null = null;
  let currentOutput: NegotiationAnalysisOutput | null = null;
  const statusHistory: AiAnalysisStatus[] = [];
  let analysisVersion = 0;

  const store: AiAnalysisOperationStore = {
    async findBySession() {
      return row ? { ...row } : null;
    },
    async createClaim(params) {
      if (row) return null;
      analysisVersion = 1;
      row = {
        id: "analysis-owned-1",
        status: AiAnalysisStatus.QUEUED,
        runToken: params.runToken,
        leaseExpiresAt: params.leaseExpiresAt,
        providerResponseId: null,
        transcriptId: params.transcriptId,
        transcriptRetranscribeCount: params.transcriptRetranscribeCount,
        language: params.language,
        updatedAt: params.now,
        analysisVersion,
      };
      statusHistory.push(AiAnalysisStatus.QUEUED);
      return { ...row };
    },
    async tryClaimExisting(params) {
      if (
        !row ||
        row.id !== params.expected.id ||
        row.status !== params.expected.status ||
        row.runToken !== params.expected.runToken
      ) {
        return false;
      }
      analysisVersion += 1;
      row = {
        ...row,
        status: AiAnalysisStatus.QUEUED,
        runToken: params.runToken,
        leaseExpiresAt: params.leaseExpiresAt,
        providerResponseId: params.providerResponseId,
        transcriptId: params.transcriptId,
        transcriptRetranscribeCount: params.transcriptRetranscribeCount,
        language: params.language,
        updatedAt: params.now,
        analysisVersion,
      };
      statusHistory.push(AiAnalysisStatus.QUEUED);
      return true;
    },
    async start(owner, now, leaseExpiresAt) {
      if (
        !row ||
        row.id !== owner.analysisId ||
        row.status !== AiAnalysisStatus.QUEUED ||
        row.runToken !== owner.runToken
      ) {
        return false;
      }
      row = { ...row, status: AiAnalysisStatus.ANALYZING, leaseExpiresAt, updatedAt: now };
      statusHistory.push(AiAnalysisStatus.ANALYZING);
      return true;
    },
    async renew(owner, now, leaseExpiresAt) {
      if (
        !row ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== owner.runToken
      ) {
        return false;
      }
      row = { ...row, leaseExpiresAt, updatedAt: now };
      return true;
    },
    async persistProviderResponseId(params) {
      if (
        !row ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== params.owner.runToken
      ) {
        return false;
      }
      row = { ...row, providerResponseId: params.providerResponseId };
      return true;
    },
    async clearProviderResponseId(params) {
      if (
        !row ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== params.owner.runToken
      ) {
        return false;
      }
      row = { ...row, providerResponseId: null };
      return true;
    },
    async complete(params) {
      if (
        !row ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== params.owner.runToken
      ) {
        return false;
      }
      row = {
        ...row,
        status: AiAnalysisStatus.COMPLETED,
        leaseExpiresAt: null,
        providerResponseId: null,
        updatedAt: params.completedAt,
      };
      currentOutput = params.fields.analysisJson as NegotiationAnalysisOutput;
      statusHistory.push(AiAnalysisStatus.COMPLETED);
      return true;
    },
    async fail(params) {
      if (
        !row ||
        row.status !== AiAnalysisStatus.ANALYZING ||
        row.runToken !== params.owner.runToken
      ) {
        return false;
      }
      row = {
        ...row,
        status: AiAnalysisStatus.FAILED,
        leaseExpiresAt: null,
        providerResponseId: params.clearProviderResponseId
          ? null
          : row.providerResponseId,
        updatedAt: params.completedAt,
      };
      currentOutput = null;
      statusHistory.push(AiAnalysisStatus.FAILED);
      return true;
    },
  };

  return {
    store,
    statusHistory,
    get analysisVersion() {
      return row?.analysisVersion ?? analysisVersion;
    },
    get status() {
      return row?.status ?? null;
    },
    get currentOutput() {
      return currentOutput;
    },
    get providerResponseId() {
      return row?.providerResponseId ?? null;
    },
    get runToken() {
      return row?.runToken ?? null;
    },
  };
}

async function runProductionOwnedRecovery(params: {
  provider?: AiAnalysisProviderName;
  generate: (input: {
    prompt: string;
    generationAttempt: 1 | 2;
    existingProviderResponseId: string | null;
    owner: AiAnalysisRunOwner;
    memory: ReturnType<typeof createOwnedStore>;
  }) => Promise<ReturnType<typeof successResult>>;
  assertReadyForSecondGeneration?: (context: {
    owner: AiAnalysisRunOwner;
    memory: ReturnType<typeof createOwnedStore>;
  }) => Promise<
    | { state: "ready" }
    | { state: "ownership_lost" }
    | { state: "stale_material" }
  >;
  remainingOperationBudgetMs?: () => number;
}) {
  const memory = createOwnedStore();
  const now = new Date("2026-08-23T12:00:00.000Z");
  const claimed = await claimAiAnalysisRun({
    sessionId: "session-owned",
    transcriptId: "transcript-owned",
    transcriptRetranscribeCount: 0,
    language: "ru",
    now,
    runToken: "token-a",
    store: memory.store,
  });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") {
    throw new Error("claim failed");
  }
  const started = await startAiAnalysisRun({
    owner: claimed.owner,
    now: new Date(now.getTime() + 500),
    leaseDurationMs: 180_000,
    store: memory.store,
  });
  assert.ok(started);
  let owner = started;
  const completeCalls = { count: 0 };
  const failCalls = { count: 0 };
  const diagnosticEvents: Array<{ title: string; attempt: number }> = [];
  const prompts: string[] = [];
  const generationAttempts: Array<1 | 2> = [];

  const result = await executeOwnedAnalysisWithBoundedYandexSchemaRecovery({
    provider: params.provider ?? "yandex",
    preparePrompt: async () => OWNED_PROMPT,
    existingProviderResponseId: owner.providerResponseId,
    remainingOperationBudgetMs: params.remainingOperationBudgetMs ?? (() => 120_000),
    generate: async (input) => {
      prompts.push(input.prompt);
      generationAttempts.push(input.generationAttempt);
      return params.generate({ ...input, owner, memory });
    },
    assertReadyForSecondGeneration: async () =>
      params.assertReadyForSecondGeneration
        ? params.assertReadyForSecondGeneration({ owner, memory })
        : { state: "ready" as const },
    clearExhaustedProviderResponseId: async () => {
      const cleared = await clearAiAnalysisProviderResponseId({
        owner,
        store: memory.store,
      });
      if (!cleared) return false;
      owner = cleared;
      return true;
    },
    observeFirstAttemptRecoveryDiagnostic: async (error) => {
      const classified = classifyAiAnalysisError(error);
      diagnosticEvents.push({
        title: YANDEX_SCHEMA_RECOVERY_EVENT_TITLE,
        attempt: 1,
      });
      assert.equal(classified.code, "MODEL_SCHEMA_VALIDATION_ERROR");
      assert.equal("candidate" in classified.diagnostics, false);
    },
    complete: async (value) => {
      completeCalls.count += 1;
      return completeAiAnalysisRun({
        owner,
        fields: {
          model: value.model,
          executiveSummary: value.output.executiveSummary,
          overallScore: value.output.overallScore,
          analysisJson: value.output,
          rawModelOutput: {
            providerEnvelope: value.rawOutput,
            diagnostics: {
              generationCallCount: value.metrics.generationCallCount,
            },
          },
        },
        store: memory.store,
      });
    },
    fail: async (failure) => {
      failCalls.count += 1;
      return failAiAnalysisRun({
        owner,
        errorMessage: failure.userMessage,
        clearProviderResponseId: !canRecoverProviderResponseAfterFailure(
          classifyAiAnalysisError(failure.originalError).code,
        ),
        store: memory.store,
      });
    },
    classifyFailure: (error) => {
      const classified = classifyAiAnalysisError(error);
      return {
        errorClass: classified.code,
        userMessage: classified.userMessage,
        originalError: error,
      };
    },
    isOwnershipLost: (error) =>
      classifyAiAnalysisError(error).code === "OWNERSHIP_LOST",
  });

  return {
    memory,
    result,
    owner,
    completeCalls: completeCalls.count,
    failCalls: failCalls.count,
    diagnosticEvents,
    prompts,
    generationAttempts,
    generationPostCount: generationAttempts.length,
  };
}

test("owned-operation schema recovery bounds stay explicit and env-independent", () => {
  const bounds = getOwnedAnalysisSchemaRecoveryBounds();
  const performance = getAiAnalysisPerformanceModel();
  assert.equal(bounds.maxExtraSchemaRecoveryGenerations, 1);
  assert.equal(bounds.totalGenerationsMax, AI_ANALYSIS_TOTAL_GENERATIONS_MAX);
  assert.equal(bounds.totalGenerationsMax, 2);
  assert.equal(performance.maxGenerationPosts, 1);
  assert.equal(performance.maxOwnedOperationGenerationPosts, 2);
  assert.ok(performance.maxPollingRequestsPerGeneration > 0);
  assert.equal(
    performance.maxPollingRequests,
    performance.maxOwnedOperationGenerationPosts *
      performance.maxPollingRequestsPerGeneration,
  );
  assert.ok(
    performance.maxPollingRequests > performance.maxPollingRequestsPerGeneration,
  );
  assert.equal(performance.maxOperationAttempts, 1);
});

test("eligibility is exactly Yandex MODEL_SCHEMA_VALIDATION_ERROR on attempt 1", () => {
  const eligible = schemaError({ provider: "yandex" });
  assert.equal(
    isEligibleForBoundedYandexSchemaRecovery({
      provider: "yandex",
      error: eligible,
      completedGenerationCount: 1,
    }),
    true,
  );
  for (const [provider, code, count] of [
    ["yandex", "MODEL_INVALID_OUTPUT", 1],
    ["yandex", "MODEL_EMPTY_OUTPUT", 1],
    ["yandex", "NETWORK_TIMEOUT", 1],
    ["yandex", "NETWORK_ERROR", 1],
    ["yandex", "PROVIDER_HTTP_ERROR", 1],
    ["yandex", "PROVIDER_RATE_LIMIT", 1],
    ["yandex", "PROVIDER_LIFECYCLE_ERROR", 1],
    ["yandex", "INPUT_TOO_LARGE", 1],
    ["yandex", "CONFIG_MISSING", 1],
    ["yandex", "OWNERSHIP_LOST", 1],
    ["openai", "MODEL_SCHEMA_VALIDATION_ERROR", 1],
    ["yandex", "MODEL_SCHEMA_VALIDATION_ERROR", 2],
  ] as const) {
    assert.equal(
      isEligibleForBoundedYandexSchemaRecovery({
        provider,
        error: schemaError({
          provider: provider === "openai" ? "openai" : "yandex",
          code,
        }),
        completedGenerationCount: count,
      }),
      false,
      `${provider} ${code} count=${count}`,
    );
  }
});

test("precheck distinguishes lost ownership from stale material", () => {
  assert.deepEqual(
    decideSchemaRecoveryPrecheck({
      ownershipRenewed: false,
      currentness: { current: true, reason: "fingerprint_match" },
    }),
    { state: "ownership_lost" },
  );
  assert.deepEqual(
    decideSchemaRecoveryPrecheck({
      ownershipRenewed: true,
      currentness: evaluateAiAnalysisCurrentness({
        analysis: {
          inputFingerprint: FINGERPRINT_F1,
          transcriptId: "t1",
          transcriptRetranscribeCount: 0,
        },
        currentFingerprint: FINGERPRINT_F2,
        transcriptId: "t1",
        transcriptRetranscribeCount: 0,
      }),
    }),
    { state: "stale_material" },
  );
  assert.deepEqual(
    decideSchemaRecoveryPrecheck({
      ownershipRenewed: true,
      currentness: evaluateAiAnalysisCurrentness({
        analysis: {
          inputFingerprint: FINGERPRINT_F1,
          transcriptId: "t1",
          transcriptRetranscribeCount: 0,
        },
        currentFingerprint: FINGERPRINT_F1,
        transcriptId: "t1",
        transcriptRetranscribeCount: 0,
      }),
    }),
    { state: "ready" },
  );
});

test("TWIN A production path: invalid then valid stays one owned operation", async () => {
  const valid = createMockAnalysisOutput("en");
  const statusesDuringRecovery: AiAnalysisStatus[] = [];
  const run = await runProductionOwnedRecovery({
    generate: async ({ generationAttempt, existingProviderResponseId }) => {
      if (generationAttempt === 1) {
        assert.equal(existingProviderResponseId, null);
        throw schemaError({ provider: "yandex" });
      }
      assert.equal(generationAttempt, 2);
      assert.equal(existingProviderResponseId, null);
      return successResult(valid);
    },
    assertReadyForSecondGeneration: async () => {
      statusesDuringRecovery.push(AiAnalysisStatus.ANALYZING);
      return { state: "ready" };
    },
  });

  assert.equal(run.generationPostCount, 2);
  assert.deepEqual(run.generationAttempts, [1, 2]);
  assert.equal(run.prompts[0], OWNED_PROMPT);
  assert.equal(run.prompts[1], OWNED_PROMPT);
  assert.equal(run.completeCalls, 1);
  assert.equal(run.failCalls, 0);
  assert.equal(run.result.state, "completed");
  assert.equal(run.memory.status, AiAnalysisStatus.COMPLETED);
  assert.deepEqual(run.memory.currentOutput, valid);
  assert.equal(run.memory.analysisVersion, 1);
  assert.equal(run.diagnosticEvents.length, 1);
  assert.equal(run.diagnosticEvents[0]?.title, YANDEX_SCHEMA_RECOVERY_EVENT_TITLE);
  assert.ok(!run.memory.statusHistory.includes(AiAnalysisStatus.FAILED));
  assert.deepEqual(run.memory.statusHistory, [
    AiAnalysisStatus.QUEUED,
    AiAnalysisStatus.ANALYZING,
    AiAnalysisStatus.COMPLETED,
  ]);
  assert.equal(statusesDuringRecovery.includes(AiAnalysisStatus.FAILED), false);
  assert.equal(canShareFromStatus(AiAnalysisStatus.ANALYZING, true), false);
  assert.equal(canShareFromStatus(run.memory.status, true), true);
  if (run.result.state === "completed") {
    assert.equal(run.result.value.metrics.generationCallCount, 2);
    assert.deepEqual(run.result.value.output, valid);
  }
});

test("TWIN B production path: invalid then invalid terminalizes once with no third generation", async () => {
  const run = await runProductionOwnedRecovery({
    generate: async () => {
      throw schemaError({ provider: "yandex" });
    },
  });

  assert.equal(run.generationPostCount, 2);
  assert.deepEqual(run.generationAttempts, [1, 2]);
  assert.equal(run.completeCalls, 0);
  assert.equal(run.failCalls, 1);
  assert.equal(run.result.state, "failed");
  assert.equal(run.memory.status, AiAnalysisStatus.FAILED);
  assert.equal(run.memory.currentOutput, null);
  assert.equal(run.memory.analysisVersion, 1);
  assert.equal(run.diagnosticEvents.length, 1);
  assert.equal(canShareFromStatus(run.memory.status, true), false);
  if (run.result.state === "failed") {
    assert.equal(run.result.failure.errorClass, "MODEL_SCHEMA_VALIDATION_ERROR");
    const original = run.result.failure.originalError;
    assert.ok(original instanceof AiAnalysisProviderError);
    assert.equal(original.diagnostics.providerGenerationAttempt, 2);
    assert.equal(original.metrics?.generationCallCount, 2);
  }
});

for (const [name, provider, code] of [
  ["Yandex MODEL_INVALID_OUTPUT", "yandex", "MODEL_INVALID_OUTPUT"],
  ["Yandex NETWORK_TIMEOUT", "yandex", "NETWORK_TIMEOUT"],
  ["Yandex PROVIDER_HTTP_ERROR", "yandex", "PROVIDER_HTTP_ERROR"],
  ["OpenAI MODEL_SCHEMA_VALIDATION_ERROR", "openai", "MODEL_SCHEMA_VALIDATION_ERROR"],
] as const) {
  test(`non-eligible ${name} does not start generation 2`, async () => {
    const run = await runProductionOwnedRecovery({
      provider,
      generate: async () => {
        throw schemaError({ provider, code });
      },
    });
    assert.equal(run.generationPostCount, 1);
    assert.equal(run.completeCalls, 0);
    assert.equal(run.failCalls, 1);
    assert.equal(run.diagnosticEvents.length, 0);
    assert.equal(run.memory.status, AiAnalysisStatus.FAILED);
  });
}

test("lost ownership before attempt 2 makes zero second-generation POSTs", async () => {
  const startedAt = new Date("2026-08-23T12:00:00.000Z");
  const valid = createMockAnalysisOutput("en");
  const ownerARef: { owner: AiAnalysisRunOwner | null } = { owner: null };
  const run = await runProductionOwnedRecovery({
    generate: async ({ generationAttempt }) => {
      if (generationAttempt === 1) {
        throw schemaError({ provider: "yandex" });
      }
      return successResult(valid);
    },
    assertReadyForSecondGeneration: async ({ owner, memory }) => {
      ownerARef.owner = owner;
      const claimedB = await claimAiAnalysisRun({
        sessionId: "session-owned",
        transcriptId: "transcript-owned",
        transcriptRetranscribeCount: 0,
        language: "ru",
        now: new Date(startedAt.getTime() + 181_000),
        leaseDurationMs: 180_000,
        runToken: "token-b",
        store: memory.store,
      });
      assert.equal(claimedB.state, "claimed");
      assert.equal(memory.runToken, "token-b");
      const completedByA = await completeAiAnalysisRun({
        owner,
        fields: {
          model: "stale",
          executiveSummary: "must not persist",
          overallScore: 1,
          analysisJson: valid,
          rawModelOutput: { stale: true },
        },
        store: memory.store,
      });
      const failedByA = await failAiAnalysisRun({
        owner,
        errorMessage: "stale fail",
        store: memory.store,
      });
      const persistedByA = await persistAiAnalysisProviderResponseId({
        owner,
        providerResponseId: "resp-stale-a",
        store: memory.store,
      });
      assert.equal(completedByA, false);
      assert.equal(failedByA, false);
      assert.equal(persistedByA, null);
      assert.equal(memory.runToken, "token-b");
      assert.notEqual(memory.status, AiAnalysisStatus.COMPLETED);
      assert.notEqual(memory.status, AiAnalysisStatus.FAILED);
      return { state: "ownership_lost" };
    },
  });

  assert.equal(run.generationPostCount, 1);
  assert.equal(run.completeCalls, 0);
  assert.equal(run.failCalls, 0);
  assert.equal(run.result.state, "ownership_lost");
  assert.equal(run.memory.runToken, "token-b");
  assert.equal(run.memory.analysisVersion, 2);
  assert.ok(ownerARef.owner);
});

test("post-linearization material change leaves completed F1 non-current and unshareable", async () => {
  const valid = createMockAnalysisOutput("en");
  let linearizationPassed = false;
  const run = await runProductionOwnedRecovery({
    generate: async ({ generationAttempt }) => {
      if (generationAttempt === 1) {
        throw schemaError({ provider: "yandex" });
      }
      assert.equal(linearizationPassed, true);
      return successResult(valid);
    },
    assertReadyForSecondGeneration: async () => {
      const readiness = decideSchemaRecoveryPrecheck({
        ownershipRenewed: true,
        currentness: evaluateAiAnalysisCurrentness({
          analysis: {
            inputFingerprint: FINGERPRINT_F1,
            transcriptId: "transcript-owned",
            transcriptRetranscribeCount: 0,
          },
          currentFingerprint: FINGERPRINT_F1,
          transcriptId: "transcript-owned",
          transcriptRetranscribeCount: 0,
        }),
      });
      assert.equal(readiness.state, "ready");
      linearizationPassed = true;
      return readiness;
    },
  });

  assert.equal(run.generationPostCount, 2);
  assert.equal(run.completeCalls, 1);
  assert.equal(run.memory.status, AiAnalysisStatus.COMPLETED);
  const afterMutation = evaluateAiAnalysisCurrentness({
    analysis: {
      inputFingerprint: FINGERPRINT_F1,
      transcriptId: "transcript-owned",
      transcriptRetranscribeCount: 0,
    },
    currentFingerprint: FINGERPRINT_F2,
    transcriptId: "transcript-owned",
    transcriptRetranscribeCount: 0,
  });
  assert.deepEqual(afterMutation, {
    current: false,
    reason: "fingerprint_mismatch",
  });
  assert.equal(canShareFromStatus(run.memory.status, afterMutation.current), false);
});

test("stale material before attempt 2 makes zero second-generation POSTs", async () => {
  const run = await runProductionOwnedRecovery({
    generate: async ({ generationAttempt }) => {
      if (generationAttempt === 1) {
        throw schemaError({ provider: "yandex" });
      }
      return successResult(createMockAnalysisOutput("en"));
    },
    assertReadyForSecondGeneration: async () =>
      decideSchemaRecoveryPrecheck({
        ownershipRenewed: true,
        currentness: evaluateAiAnalysisCurrentness({
          analysis: {
            inputFingerprint: FINGERPRINT_F1,
            transcriptId: "transcript-owned",
            transcriptRetranscribeCount: 0,
          },
          currentFingerprint: FINGERPRINT_F2,
          transcriptId: "transcript-owned",
          transcriptRetranscribeCount: 0,
        }),
      }),
  });

  assert.equal(run.generationPostCount, 1);
  assert.equal(run.completeCalls, 0);
  assert.equal(run.failCalls, 1);
  assert.equal(run.result.state, "failed");
  assert.equal(run.memory.status, AiAnalysisStatus.FAILED);
  assert.equal(run.memory.currentOutput, null);
  assert.equal(canShareFromStatus(run.memory.status, false), false);
});

test("exhausted operation budget skips generation 2 without resetting the deadline", async () => {
  const run = await runProductionOwnedRecovery({
    remainingOperationBudgetMs: () => 0,
    generate: async ({ generationAttempt }) => {
      if (generationAttempt === 1) {
        throw schemaError({ provider: "yandex" });
      }
      return successResult(createMockAnalysisOutput("en"));
    },
  });

  assert.equal(run.generationPostCount, 1);
  assert.equal(run.completeCalls, 0);
  assert.equal(run.failCalls, 1);
  assert.equal(run.result.state, "failed");
  if (run.result.state === "failed") {
    assert.equal(run.result.failure.errorClass, "NETWORK_TIMEOUT");
  }
});

test("provider response IDs are fenced across schema recovery generations", async () => {
  const valid = createMockAnalysisOutput("en");
  const run = await runProductionOwnedRecovery({
    generate: async ({ generationAttempt, owner, memory }) => {
      if (generationAttempt === 1) {
        const persisted = await persistAiAnalysisProviderResponseId({
          owner,
          providerResponseId: "resp-attempt-1",
          store: memory.store,
        });
        assert.ok(persisted);
        assert.equal(memory.providerResponseId, "resp-attempt-1");
        throw schemaError({ provider: "yandex" });
      }
      assert.equal(memory.providerResponseId, null);
      const persisted = await persistAiAnalysisProviderResponseId({
        owner,
        providerResponseId: "resp-attempt-2",
        store: memory.store,
      });
      assert.ok(persisted);
      const stale = await persistAiAnalysisProviderResponseId({
        owner: { ...owner, runToken: "stale-token" },
        providerResponseId: "resp-attempt-1",
        store: memory.store,
      });
      assert.equal(stale, null);
      assert.equal(memory.providerResponseId, "resp-attempt-2");
      return successResult(valid);
    },
  });

  assert.equal(run.generationPostCount, 2);
  assert.equal(run.memory.status, AiAnalysisStatus.COMPLETED);
  assert.equal(run.memory.providerResponseId, null);
});

test("production generate counts Yandex generation POSTs not GET polls", async () => {
  const originalEnv = { ...process.env };
  process.env.AI_ANALYSIS_PROVIDER = "yandex";
  process.env.YANDEX_FOLDER_ID = "synthetic-folder";
  process.env.YANDEX_API_KEY = "synthetic-key";
  process.env.YANDEX_AI_MODEL = "deepseek-v4-flash";
  process.env.AI_ANALYSIS_MAX_ATTEMPTS = "1";
  const valid = createMockAnalysisOutput("en");
  let generationPosts = 0;
  let getPolls = 0;
  try {
    const run = await runProductionOwnedRecovery({
      generate: async ({ prompt, existingProviderResponseId }) =>
        runNegotiationAnalysis(prompt, "en", {
          existingProviderResponseId,
          persistProviderResponseId: async () => true,
          fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
            if ((init?.method ?? "GET").toUpperCase() === "POST") {
              generationPosts += 1;
              const body =
                generationPosts === 1
                  ? JSON.stringify(incidentInvalidOutput())
                  : JSON.stringify(valid);
              return new Response(JSON.stringify(fixtures.completed(body)), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
            }
            getPolls += 1;
            return new Response(JSON.stringify(fixtures.inProgress), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }) as typeof fetch,
        }),
    });
    assert.equal(generationPosts, 2);
    assert.equal(getPolls, 0);
    assert.equal(run.generationPostCount, 2);
    assert.equal(run.memory.status, AiAnalysisStatus.COMPLETED);
    assert.deepEqual(run.memory.currentOutput, valid);
  } finally {
    process.env = originalEnv;
  }
});

test("first-attempt valid Yandex generation does not start recovery", async () => {
  const valid = createMockAnalysisOutput("en");
  const run = await runProductionOwnedRecovery({
    generate: async () => successResult(valid),
  });
  assert.equal(run.generationPostCount, 1);
  assert.equal(run.completeCalls, 1);
  assert.equal(run.failCalls, 0);
  assert.equal(run.diagnosticEvents.length, 0);
  assert.equal(run.memory.status, AiAnalysisStatus.COMPLETED);
});
