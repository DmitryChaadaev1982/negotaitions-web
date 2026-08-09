import assert from "node:assert/strict";
import test from "node:test";

import {
  AiAnalysisProviderError,
  canRecoverProviderResponseAfterFailure,
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
  assert.equal(result.metrics.primaryMaxOutputTokensConfigured, 8_000);
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

test("Yandex analysis request body uses background reasoning-none contract", async () => {
  configureYandexEnv();
  let requestBody: Record<string, unknown> | null = null;
  const result = await runWithFetch(
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(
        fixtures.completed(JSON.stringify(validAnalysisOutput())),
      );
    }) as typeof fetch,
  );

  assert.equal(result.output.overallScore, 72);
  assert.equal(requestBody?.model, "gpt://synthetic-folder/deepseek-v4-flash");
  assert.deepEqual(requestBody?.reasoning, { effort: "none" });
  assert.equal(requestBody?.background, true);
  assert.equal(requestBody?.temperature, 0.2);
  assert.equal(requestBody?.max_output_tokens, 8000);
  assert.equal(Object.hasOwn(requestBody ?? {}, "stream"), false);
  assert.equal(Object.hasOwn(requestBody ?? {}, "reasoning_effort"), false);
});

test("existing provider response ID is retrieved before any new generation POST", async () => {
  configureYandexEnv();
  const methods: string[] = [];
  const urls: string[] = [];
  const result = await runWithFetch(
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      urls.push(String(input));
      return jsonResponse(
        fixtures.completed(JSON.stringify(validAnalysisOutput())),
      );
    }) as typeof fetch,
    {
      existingProviderResponseId: "resp_existing",
    },
  );

  assert.equal(result.output.overallScore, 72);
  assert.deepEqual(methods, ["GET"]);
  assert.equal(urls[0]?.endsWith("/responses/resp_existing"), true);
  assert.equal(result.metrics.generationCallCount, 1);
  assert.equal(result.metrics.calls[0]?.responseIdPresent, true);
});

test("provider response ID is persisted before long polling continues", async () => {
  configureYandexEnv();
  const events: string[] = [];
  const result = await runWithFetch(
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        events.push("post");
        return jsonResponse(fixtures.inProgress);
      }
      events.push("get");
      return jsonResponse(
        fixtures.completed(JSON.stringify(validAnalysisOutput())),
      );
    }) as typeof fetch,
    {
      ...controlledRuntime(),
      persistProviderResponseId: async (providerResponseId) => {
        events.push(`persist:${providerResponseId}`);
        return true;
      },
    },
  );

  assert.equal(result.output.overallScore, 72);
  assert.deepEqual(events, ["post", "persist:resp_synthetic_in_progress", "get"]);
});

test("invalid accepted primary output does not create compact fallback generation", async () => {
  configureYandexEnv();
  let posts = 0;
  await assert.rejects(
    () =>
      runWithFetch(
        (async () => {
          posts += 1;
          return jsonResponse(fixtures.completed('{"executiveSummary":'));
        }) as typeof fetch,
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "MODEL_INVALID_OUTPUT");
      assert.equal(error.allowsRegeneration, false);
      return true;
    },
  );

  assert.equal(posts, 1);
});

test("acceptance-unknown POST transport failure does not retry generation", async () => {
  configureYandexEnv();
  let posts = 0;
  await assert.rejects(
    () =>
      runWithFetch(
        (async () => {
          posts += 1;
          throw new TypeError("synthetic network failure");
        }) as typeof fetch,
        controlledRuntime(),
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "NETWORK_ERROR");
      assert.equal(error.allowsRegeneration, false);
      return true;
    },
  );

  assert.equal(posts, 1);
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

test("configured max poll count no longer terminates valid operation", async () => {
  configureYandexEnv();
  process.env.AI_ANALYSIS_MAX_POLL_REQUESTS = "5";
  process.env.AI_ANALYSIS_RESPONSE_POLL_TIMEOUT_MS = "30000";
  const runtime = controlledRuntime();
  let gets = 0;
  const result = await runWithFetch(
    (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return jsonResponse(fixtures.inProgress);
      }
      gets += 1;
      return gets <= 100
        ? jsonResponse(fixtures.inProgress)
        : jsonResponse(fixtures.completed(JSON.stringify(validAnalysisOutput())));
    }) as typeof fetch,
    runtime,
  );

  assert.equal(result.output.overallScore, 72);
  assert.equal(gets, 101);
  assert.equal(result.metrics.pollingRequestCount, 101);
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

test("valid primary result does not trigger optional depth generation", async () => {
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

  assert.equal(posts, 1);
  assert.deepEqual(result.output, base);
  assert.equal(result.metrics.optionalDepthCallCount, 0);
  assert.equal(result.metrics.optionalDepthOutcome, "not_needed");
  assert.equal(result.metrics.outerRetryCount, 0);
});

test("valid primary remains terminal success without optional depth validation", async () => {
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
  assert.equal(posts, 1);
  assert.equal(result.metrics.optionalDepthOutcome, "not_needed");
  assert.equal(result.metrics.optionalDepthFailureClass, null);
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

test("retrieved-and-unusable outcomes exhaust the recorded generation", () => {
  for (const code of [
    "PROVIDER_LIFECYCLE_ERROR",
    "PROVIDER_HTTP_ERROR",
    "PROVIDER_RATE_LIMIT",
    "MODEL_EMPTY_OUTPUT",
    "MODEL_INVALID_OUTPUT",
    "MODEL_SCHEMA_VALIDATION_ERROR",
  ] as const) {
    assert.equal(canRecoverProviderResponseAfterFailure(code), false, code);
  }
  for (const code of [
    "NETWORK_TIMEOUT",
    "NETWORK_ERROR",
    "CANCELLED",
    "CONFIG_MISSING",
    "INTERNAL_ERROR",
    "OWNERSHIP_LOST",
  ] as const) {
    assert.equal(canRecoverProviderResponseAfterFailure(code), true, code);
  }
});

test("terminal lifecycle failure classifies as an exhausted generation", async () => {
  configureYandexEnv();
  await assert.rejects(
    () =>
      runWithFetch(
        (async () => jsonResponse(fixtures.incomplete)) as typeof fetch,
        controlledRuntime(),
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(canRecoverProviderResponseAfterFailure(error.code), false);
      return true;
    },
  );
});

test("poll deadline classifies as a still-recoverable generation", async () => {
  configureYandexEnv();
  await assert.rejects(
    () =>
      runWithFetch(
        (async (_input: RequestInfo | URL, init?: RequestInit) =>
          jsonResponse(
            init?.method === "POST" ? fixtures.inProgress : fixtures.inProgress,
          )) as typeof fetch,
        controlledRuntime(),
      ),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "NETWORK_TIMEOUT");
      assert.equal(canRecoverProviderResponseAfterFailure(error.code), true);
      return true;
    },
  );
});

test("performance model removes compact/depth multiplication", () => {
  configureYandexEnv();
  const model = getAiAnalysisPerformanceModel();
  assert.equal(model.beforeReviewTheoreticalWorstCaseMs, 1_440_000);
  assert.equal(model.maxOperationAttempts, 1);
  assert.equal(model.maxGenerationPosts, 1);
  assert.equal(model.maxCompactFallbackCalls, 0);
  assert.equal(model.maxOptionalDepthCalls, 0);
  assert.equal(model.maxPollingRequests, 40);
  assert.equal(model.theoreticalDefaultWorstCaseMs, 120_000);
});
