import assert from "node:assert/strict";
import test from "node:test";

import {
  AiAnalysisProviderError,
  createMockAnalysisOutput,
  runNegotiationAnalysis,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = globalThis.fetch;

function restoreEnvAndFetch() {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = ORIGINAL_FETCH;
}

function configureYandexEnv() {
  process.env.AI_ANALYSIS_PROVIDER = "yandex";
  process.env.YANDEX_FOLDER_ID = "test-folder";
  process.env.YANDEX_API_KEY = "test-key";
  process.env.YANDEX_AI_MODEL = "deepseek-v4-flash";
  process.env.AI_ANALYSIS_MAX_ATTEMPTS = "2";
  process.env.AI_ANALYSIS_HTTP_TIMEOUT_MS = "5000";
  process.env.AI_ANALYSIS_RESPONSE_POLL_TIMEOUT_MS = "10000";
  process.env.AI_ANALYSIS_RESPONSE_POLL_INTERVAL_MS = "250";
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
        exercise: "Run a five-minute drill with three diagnostic questions before proposals.",
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

function yandexEnvelope(output: unknown) {
  return {
    id: "resp-test",
    status: "completed",
    output_text: JSON.stringify(output),
  };
}

test.afterEach(() => {
  restoreEnvAndFetch();
});

test("Yandex analysis succeeds with sanitized metrics", async () => {
  configureYandexEnv();
  globalThis.fetch = (async () => jsonResponse(yandexEnvelope(validAnalysisOutput()))) as typeof fetch;

  const result = await runNegotiationAnalysis("Synthetic transcript", "en");

  assert.equal(result.model, "deepseek-v4-flash");
  assert.equal(result.output.overallScore, 72);
  assert.equal(result.metrics.provider, "yandex");
  assert.equal(result.metrics.modelCallCount, 1);
  assert.equal(result.metrics.promptChars, "Synthetic transcript".length);
  assert.equal(result.metrics.errorClass, null);
});

test("Yandex analysis retries a transient timeout and removes VPN guidance", async () => {
  configureYandexEnv();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    return jsonResponse(yandexEnvelope(validAnalysisOutput()));
  }) as typeof fetch;

  const result = await runNegotiationAnalysis("Synthetic transcript", "en");

  assert.equal(calls, 2);
  assert.equal(result.metrics.retryCount, 1);
  assert.equal(result.metrics.calls[0]?.errorClass, "NETWORK_TIMEOUT");
});

test("Yandex analysis exhausts retryable timeout without VPN guidance", async () => {
  configureYandexEnv();
  globalThis.fetch = (async () => {
    throw new DOMException("The operation was aborted.", "AbortError");
  }) as typeof fetch;

  await assert.rejects(
    () => runNegotiationAnalysis("Synthetic transcript", "en"),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "NETWORK_TIMEOUT");
      assert.equal(error.userMessage.includes("VPN"), false);
      assert.equal(error.metrics?.retryCount, 1);
      return true;
    },
  );
});

test("Yandex asynchronous response is polled instead of treated as empty output", async () => {
  configureYandexEnv();
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/responses")) {
      return jsonResponse({ id: "resp-pending", status: "in_progress", output: [] });
    }
    return jsonResponse(yandexEnvelope(validAnalysisOutput()));
  }) as typeof fetch;

  const result = await runNegotiationAnalysis("Synthetic transcript", "en");

  assert.equal(result.output.overallScore, 72);
  assert.equal(result.metrics.modelCallCount, 1);
  assert.equal(result.metrics.calls[0]?.responseIdPresent, true);
  assert.equal(result.metrics.calls[0]?.pollingAttemptCount, 1);
  assert.equal(requests.some((url) => url.includes("/responses/resp-pending")), true);
});

test("Yandex empty terminal model output is classified", async () => {
  configureYandexEnv();
  globalThis.fetch = (async () =>
    jsonResponse({ id: "resp-empty", status: "completed", output: [] })) as typeof fetch;

  await assert.rejects(
    () => runNegotiationAnalysis("Synthetic transcript", "en"),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "MODEL_EMPTY_OUTPUT");
      assert.equal(error.retryable, true);
      assert.equal(error.metrics?.errorClass, "MODEL_EMPTY_OUTPUT");
      return true;
    },
  );
});

test("Yandex invalid structured response is schema validation, not config missing", async () => {
  configureYandexEnv();
  globalThis.fetch = (async () => jsonResponse(yandexEnvelope({ executiveSummary: "too small" }))) as typeof fetch;

  await assert.rejects(
    () => runNegotiationAnalysis("Synthetic transcript", "en"),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "MODEL_SCHEMA_VALIDATION_ERROR");
      return true;
    },
  );
});

test("Yandex missing configuration is classified as config missing", async () => {
  configureYandexEnv();
  delete process.env.YANDEX_API_KEY;

  await assert.rejects(
    () => runNegotiationAnalysis("Synthetic transcript", "en"),
    (error) => {
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(error.code, "CONFIG_MISSING");
      assert.equal(error.retryable, false);
      return true;
    },
  );
});
