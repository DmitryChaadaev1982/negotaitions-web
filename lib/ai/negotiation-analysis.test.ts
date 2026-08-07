import assert from "node:assert/strict";
import test from "node:test";

import {
  AiAnalysisProviderError,
  classifyYandexResponseLifecycle,
  createMockAnalysisOutput,
  getAiAnalysisPerformanceModel,
  runNegotiationAnalysis,
  type AiAnalysisExecutionOptions,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";
import { yandexResponseLifecycleFixtures as fixtures } from "@/lib/ai/fixtures/yandex-response-lifecycle";

const ORIGINAL_ENV = { ...process.env };

function configureYandexEnv() {
  process.env.AI_ANALYSIS_PROVIDER = "yandex";
  process.env.YANDEX_FOLDER_ID = "synthetic-folder";
  process.env.YANDEX_API_KEY = "synthetic-key";
  process.env.YANDEX_AI_MODEL = "deepseek-v4-flash";
  process.env.AI_ANALYSIS_MAX_ATTEMPTS = "2";
  process.env.AI_ANALYSIS_HTTP_TIMEOUT_MS = "5000";
  process.env.AI_ANALYSIS_RESPONSE_POLL_TIMEOUT_MS = "10000";
  process.env.AI_ANALYSIS_RESPONSE_POLL_INTERVAL_MS = "250";
  process.env.AI_ANALYSIS_MAX_POLL_REQUESTS = "100";
  process.env.AI_ANALYSIS_OPERATION_TIMEOUT_MS = "120000";
}

function validAnalysisOutput(): NegotiationAnalysisOutput {
  const output = createMockAnalysisOutput("en");
  return {
    ...output,
    executiveSummary:
      "The negotiation showed clear preparation and a practical search for agreement. Both parties exchanged constraints rather than only repeating positions. Value creation appeared when delivery, support, and price were packaged together. The main development need is to ask sharper diagnostic questions before trading concessions.",
    strengths: [
      ...output.strengths,
      {
        title: "Trade packaging",
        evidence: "Participants linked price, volume, delivery, and support.",
        whyItMatters: "Packages create more options than single-issue bargaining.",
        recommendation: "Continue proposing conditional packages with explicit trades.",
      },
    ],
    improvementAreas: [
      ...output.improvementAreas,
      {
        title: "Diagnostic questions",
        evidence: "Few questions explored the other party's priority ranking.",
        risk: "Concessions may be made before understanding value.",
        recommendation: "Ask priority and constraint questions before offering movement.",
        practiceExercise: "Ask three priority questions before any concession.",
      },
      {
        title: "Conditional concessions",
        evidence: "Some moves were stated without a reciprocal condition.",
        risk: "Unconditional movement can train the counterparty to ask for more.",
        recommendation: "Use if/then language for every concession.",
        practiceExercise: "Convert three concessions into if/then trades.",
      },
    ],
    detectedTactics: [
      ...output.detectedTactics,
      {
        name: "Conditional trade",
        usedBy: "Seller",
        evidence: "Seller connected discount to volume and payment terms.",
        effectiveness: "Medium to high because it protected margin.",
        counterMove: "Ask which variable matters most and trade on lower-cost items.",
      },
    ],
    nextTrainingFocus: [
      ...output.nextTrainingFocus,
      {
        focusArea: "Question sequencing",
        why: "Better questions would reveal trade priorities earlier.",
        exercise: "Run a drill with three diagnostic questions before proposals.",
      },
    ],
    facilitatorDebriefQuestions: [
      ...output.facilitatorDebriefQuestions,
      "Which concession should have been conditional?",
    ],
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function controlledRuntime() {
  let now = 0;
  return {
    monotonicNow: () => now,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      now += ms;
    },
    get now() {
      return now;
    },
  };
}

function runWithFetch(
  fetchImpl: typeof fetch,
  options: Omit<AiAnalysisExecutionOptions, "fetch"> = {},
) {
  return runNegotiationAnalysis("Synthetic transcript", "en", {
    fetch: fetchImpl,
    ...options,
  });
}

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("lifecycle classifier covers only documented production states", () => {
  assert.equal(classifyYandexResponseLifecycle(fixtures.queued).kind, "nonterminal");
  assert.equal(
    classifyYandexResponseLifecycle(fixtures.inProgress).kind,
    "nonterminal",
  );
  assert.equal(
    classifyYandexResponseLifecycle(fixtures.completed("{}")).kind,
    "success",
  );
  assert.equal(classifyYandexResponseLifecycle(fixtures.failed).kind, "failure");
  assert.equal(classifyYandexResponseLifecycle(fixtures.cancelled).kind, "failure");
  assert.equal(classifyYandexResponseLifecycle(fixtures.incomplete).kind, "failure");
  assert.equal(classifyYandexResponseLifecycle(fixtures.unknown).kind, "unknown");
});

test("direct completed success returns explicit metrics", async () => {
  configureYandexEnv();
  const result = await runWithFetch(
    (async () =>
      jsonResponse(
        fixtures.completed(JSON.stringify(validAnalysisOutput())),
      )) as typeof fetch,
  );

  assert.equal(result.output.overallScore, 72);
  assert.equal(result.metrics.operationAttemptCount, 1);
  assert.equal(result.metrics.outerRetryCount, 0);
  assert.equal(result.metrics.generationCallCount, 1);
  assert.equal(result.metrics.compactFallbackCount, 0);
  assert.equal(result.metrics.optionalDepthCallCount, 0);
  assert.equal(result.metrics.pollingRequestCount, 0);
  assert.ok(result.metrics.preProviderDurationMs >= 0);
  assert.ok(result.metrics.generationPostDurationMs >= 0);
  assert.ok(result.metrics.pollingDurationMs >= 0);
  assert.ok(result.metrics.parsingValidationDurationMs >= 0);
  assert.equal(result.metrics.optionalDepthDurationMs, 0);
  assert.ok(result.metrics.outputSchemaInstructionChars > 1_000);
  assert.equal(result.metrics.primaryMaxOutputTokensConfigured, 6_000);
  assert.ok(
    result.metrics.estimatedInputTokens >
      result.metrics.estimatedPromptTokens,
  );
  assert.equal(
    result.metrics.inputChars,
    result.metrics.promptChars + result.metrics.instructionChars,
  );
  const primaryCall = result.metrics.calls[0];
  assert.ok(primaryCall);
  assert.equal(
    primaryCall.inputChars,
    primaryCall.promptChars + primaryCall.instructionChars,
  );
});

test("completed success without response ID is accepted without retrieval", async () => {
  configureYandexEnv();
  const result = await runWithFetch(
    (async () =>
      jsonResponse({
        status: "completed",
        output_text: JSON.stringify(validAnalysisOutput()),
      })) as typeof fetch,
  );
  assert.equal(result.output.overallScore, 72);
  assert.equal(result.metrics.calls[0]?.responseIdPresent, false);
});

test("compact fallback is a semantic call, not an outer retry", async () => {
  configureYandexEnv();
  let posts = 0;
  const result = await runWithFetch(
    (async () => {
      posts += 1;
      return posts === 1
        ? jsonResponse(fixtures.completed('{"executiveSummary":'))
        : jsonResponse(
            fixtures.completed(JSON.stringify(validAnalysisOutput())),
          );
    }) as typeof fetch,
  );

  assert.equal(posts, 2);
  assert.equal(result.metrics.operationAttemptCount, 1);
  assert.equal(result.metrics.outerRetryCount, 0);
  assert.equal(result.metrics.compactFallbackCount, 1);
  assert.deepEqual(
    result.metrics.calls.map((call) => call.purpose),
    ["primary", "compact_fallback"],
  );
});

test("transient pre-ID failure performs one explicit outer retry", async () => {
  configureYandexEnv();
  let posts = 0;
  const result = await runWithFetch(
    (async () => {
      posts += 1;
      if (posts === 1) throw new TypeError("synthetic network failure");
      return jsonResponse(
        fixtures.completed(JSON.stringify(validAnalysisOutput())),
      );
    }) as typeof fetch,
    controlledRuntime(),
  );

  assert.equal(posts, 2);
  assert.equal(result.metrics.operationAttemptCount, 2);
  assert.equal(result.metrics.outerRetryCount, 1);
  assert.equal(result.metrics.generationCallCount, 2);
  assert.equal(result.metrics.calls[0]?.errorClass, "NETWORK_ERROR");
});

test("in-progress partial text is ignored until completed retrieval", async () => {
  configureYandexEnv();
  const methods: string[] = [];
  const result = await runWithFetch(
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") {
        return jsonResponse(fixtures.inProgressWithPartialText);
      }
      return jsonResponse(
        fixtures.completed(JSON.stringify(validAnalysisOutput())),
      );
    }) as typeof fetch,
    controlledRuntime(),
  );

  assert.equal(result.output.overallScore, 72);
  assert.deepEqual(methods, ["POST", "GET"]);
  assert.equal(result.metrics.generationCallCount, 1);
  assert.equal(result.metrics.pollingRequestCount, 1);
});

for (const [name, fixture] of [
  ["failed", fixtures.failed],
  ["cancelled", fixtures.cancelled],
  ["incomplete", fixtures.incomplete],
] as const) {
  test(`${name} lifecycle does not collapse into MODEL_EMPTY_OUTPUT`, async () => {
    configureYandexEnv();
    await assert.rejects(
      () =>
        runWithFetch(
          (async () => jsonResponse(fixture)) as typeof fetch,
          controlledRuntime(),
        ),
      (error) => {
        assert.ok(error instanceof AiAnalysisProviderError);
        assert.equal(error.code, "PROVIDER_LIFECYCLE_ERROR");
        assert.equal(error.diagnostics.providerStatus, name);
        return true;
      },
    );
  });
}

test("completed empty output is MODEL_EMPTY_OUTPUT", async () => {
  configureYandexEnv();
  await assert.rejects(
    () =>
      runWithFetch(
        (async () => jsonResponse(fixtures.completedEmpty)) as typeof fetch,
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "MODEL_EMPTY_OUTPUT");
      return true;
    },
  );
});

test("poll deadline is a timeout and does not regenerate", async () => {
  configureYandexEnv();
  const runtime = controlledRuntime();
  let posts = 0;
  let gets = 0;
  await assert.rejects(
    () =>
      runWithFetch(
        (async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "POST") {
            posts += 1;
            return jsonResponse(fixtures.inProgress);
          }
          gets += 1;
          return jsonResponse(fixtures.inProgress);
        }) as typeof fetch,
        runtime,
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "NETWORK_TIMEOUT");
      assert.equal(error.diagnostics.timeoutScope, "known_response_poll");
      assert.equal(error.allowsRegeneration, false);
      return true;
    },
  );
  assert.equal(posts, 1);
  assert.ok(gets > 1);
  assert.ok(runtime.now <= 10_000);
});

test("transient poll failure retries GET on the same known response ID", async () => {
  configureYandexEnv();
  const requestedUrls: string[] = [];
  let gets = 0;
  let posts = 0;
  const result = await runWithFetch(
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        posts += 1;
        return jsonResponse(fixtures.inProgress);
      }
      gets += 1;
      requestedUrls.push(url);
      if (gets === 1) throw new TypeError("synthetic transient network failure");
      return jsonResponse(
        fixtures.completed(JSON.stringify(validAnalysisOutput())),
      );
    }) as typeof fetch,
    controlledRuntime(),
  );

  assert.equal(posts, 1);
  assert.equal(gets, 2);
  assert.equal(new Set(requestedUrls).size, 1);
  assert.equal(
    requestedUrls[0]?.endsWith("/responses/resp_synthetic_in_progress"),
    true,
  );
  assert.equal(result.metrics.retrievalRetryCount, 1);
});

test("unknown lifecycle status terminates immediately and boundedly", async () => {
  configureYandexEnv();
  let calls = 0;
  await assert.rejects(
    () =>
      runWithFetch(
        (async () => {
          calls += 1;
          return jsonResponse(fixtures.unknown);
        }) as typeof fetch,
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "PROVIDER_LIFECYCLE_ERROR");
      assert.equal(error.diagnostics.providerStatus, "synthetic_future_state");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("nonterminal response without ID fails deterministically", async () => {
  configureYandexEnv();
  await assert.rejects(
    () =>
      runWithFetch(
        (async () => jsonResponse(fixtures.nonterminalWithoutId)) as typeof fetch,
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "PROVIDER_LIFECYCLE_ERROR");
      assert.equal(error.diagnostics.responseIdPresent, false);
      return true;
    },
  );
});

test("request cancellation stops local processing", async () => {
  configureYandexEnv();
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    () =>
      runWithFetch(
        (async () => {
          calls += 1;
          controller.abort();
          throw new DOMException("Aborted", "AbortError");
        }) as typeof fetch,
        { signal: controller.signal },
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "CANCELLED");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("ownership loss after provider response stops terminal processing", async () => {
  configureYandexEnv();
  let renewals = 0;
  await assert.rejects(
    () =>
      runWithFetch(
        (async () =>
          jsonResponse(
            fixtures.completed(JSON.stringify(validAnalysisOutput())),
          )) as typeof fetch,
        {
          renewLease: async () => {
            renewals += 1;
            return renewals === 1;
          },
        },
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "OWNERSHIP_LOST");
      return true;
    },
  );
  assert.equal(renewals, 2);
});

test("valid primary survives failed optional depth", async () => {
  configureYandexEnv();
  const base = createMockAnalysisOutput("en");
  let posts = 0;
  const result = await runWithFetch(
    (async () => {
      posts += 1;
      if (posts === 1) {
        return jsonResponse(fixtures.completed(JSON.stringify(base)));
      }
      return jsonResponse({ error: "synthetic" }, 503);
    }) as typeof fetch,
    controlledRuntime(),
  );

  assert.equal(posts, 2);
  assert.deepEqual(result.output, base);
  assert.equal(result.metrics.optionalDepthCallCount, 1);
  assert.equal(result.metrics.optionalDepthOutcome, "failed");
  assert.equal(result.metrics.optionalDepthFailureClass, "PROVIDER_HTTP_ERROR");
  assert.equal(result.metrics.outerRetryCount, 0);
});

test("valid primary survives invalid optional depth", async () => {
  configureYandexEnv();
  const base = createMockAnalysisOutput("en");
  let posts = 0;
  const result = await runWithFetch(
    (async () => {
      posts += 1;
      return posts === 1
        ? jsonResponse(fixtures.completed(JSON.stringify(base)))
        : jsonResponse(fixtures.completed("not-json"));
    }) as typeof fetch,
  );

  assert.deepEqual(result.output, base);
  assert.equal(result.metrics.optionalDepthOutcome, "invalid");
  assert.equal(result.metrics.optionalDepthFailureClass, "MODEL_INVALID_OUTPUT");
});

test("invalid schema is not misclassified as missing configuration", async () => {
  configureYandexEnv();
  await assert.rejects(
    () =>
      runWithFetch(
        (async () =>
          jsonResponse(
            fixtures.completed(JSON.stringify({ executiveSummary: "small" })),
          )) as typeof fetch,
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "MODEL_SCHEMA_VALIDATION_ERROR");
      return true;
    },
  );
});

test("missing configuration remains explicit", async () => {
  configureYandexEnv();
  delete process.env.YANDEX_API_KEY;
  await assert.rejects(
    () =>
      runWithFetch(
        (async () => {
          throw new Error("fetch must not run");
        }) as typeof fetch,
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "CONFIG_MISSING");
      return true;
    },
  );
});

test("performance model removes compact/depth multiplication", () => {
  configureYandexEnv();
  const model = getAiAnalysisPerformanceModel();
  assert.equal(model.beforeReviewTheoreticalWorstCaseMs, 1_440_000);
  assert.equal(model.maxOperationAttempts, 2);
  assert.equal(model.maxGenerationPosts, 4);
  assert.equal(model.maxCompactFallbackCalls, 1);
  assert.equal(model.maxOptionalDepthCalls, 1);
  assert.equal(model.maxPollingRequests, 400);
  assert.equal(model.theoreticalDefaultWorstCaseMs, 120_000);
});
