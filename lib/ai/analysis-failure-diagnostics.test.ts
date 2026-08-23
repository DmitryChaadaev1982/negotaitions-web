import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEYS,
  buildBoundedAiAnalysisLogPayload,
  buildBoundedSchemaIssueDiagnostics,
  isApprovedAiAnalysisDiagnosticKey,
  isForbiddenDiagnosticKey,
  sanitizeAiAnalysisDiagnostics,
} from "@/lib/ai/analysis-failure-diagnostics";
import {
  createMockAnalysisOutput,
  NegotiationAnalysisOutputSchema,
} from "@/lib/ai/negotiation-analysis";

const APPROVED_DIAGNOSTIC_SAMPLE: Record<
  (typeof APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEYS)[number],
  unknown
> = {
  issueCount: 2,
  issuePaths: ["listeningAndReframing.missedOpportunities.0"],
  issueCodes: ["invalid_type"],
  expectedKinds: ["string"],
  receivedKinds: ["object"],
  providerStatus: "incomplete",
  providerErrorCode: "server_error",
  incompleteReason: "max_output_tokens",
  outputFieldDetected: "output_text",
  outputCondition: "truncated_or_invalid",
  responseIdPresent: true,
  httpStatus: 503,
  bodyLength: 128,
  timeoutMs: 5000,
  timeoutScope: "known_response_poll",
  operationTimeoutMs: 120000,
  pollTimeoutMs: 10000,
  pollingRequestCount: 4,
  retrievalRetryCount: 1,
  maxPollRequestsReached: false,
  generationCallCount: 1,
  checkpoint: "after_known_response_get",
  cancellationSource: "request",
  inputChars: 2400,
  estimatedInputTokens: 600,
  estimatedTotalInputTokenBudget: 100000,
  contentDropped: false,
  promptChars: 1800,
  estimatedPromptTokens: 450,
  estimatedPromptTokenBudget: 90000,
  responseLength: 11115,
  errorName: "TypeError",
  messageLength: 42,
  purpose: "Yandex AI analysis request",
};

test("schema diagnostics keep issue count, paths, codes, and type kinds only", () => {
  const output = createMockAnalysisOutput("en");
  const invalid = {
    ...output,
    listeningAndReframing: {
      ...output.listeningAndReframing,
      missedOpportunities: [
        {
          improvedPhrase: "Shall we package date and volume?",
          whyItWorks: "Turns a refusal into a trade.",
        },
      ],
    },
  };
  const parsed = NegotiationAnalysisOutputSchema.safeParse(invalid);
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const diagnostics = buildBoundedSchemaIssueDiagnostics(parsed.error);
  assert.equal(diagnostics.issueCount >= 1, true);
  assert.ok(
    diagnostics.issuePaths.includes(
      "listeningAndReframing.missedOpportunities.0",
    ),
  );
  assert.equal(diagnostics.issueCodes.length, diagnostics.issuePaths.length);
  assert.equal(diagnostics.receivedKinds.length, diagnostics.issuePaths.length);
  assert.ok(diagnostics.receivedKinds.includes("object"));
  assert.ok(diagnostics.expectedKinds.includes("string"));
  const serialized = JSON.stringify(diagnostics);
  assert.doesNotMatch(serialized, /Shall we package/);
  assert.doesNotMatch(serialized, /Turns a refusal/);
});

test("A: every currently approved diagnostic key survives the positive allowlist", () => {
  const sanitized = sanitizeAiAnalysisDiagnostics(APPROVED_DIAGNOSTIC_SAMPLE);
  assert.deepEqual(
    Object.keys(sanitized).sort(),
    [...APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEYS].sort(),
  );
  for (const key of APPROVED_AI_ANALYSIS_DIAGNOSTIC_KEYS) {
    assert.equal(isApprovedAiAnalysisDiagnosticKey(key), true);
    assert.equal(sanitized[key], APPROVED_DIAGNOSTIC_SAMPLE[key]);
  }
});

test("B: unknown harmless-looking diagnostic key is dropped", () => {
  const sanitized = sanitizeAiAnalysisDiagnostics({
    issueCount: 1,
    latencyHint: "short",
    providerHint: "ok",
  });
  assert.deepEqual(sanitized, { issueCount: 1 });
  assert.equal(isApprovedAiAnalysisDiagnosticKey("latencyHint"), false);
});

test("C: candidate containing short model prose is dropped", () => {
  const sanitized = sanitizeAiAnalysisDiagnostics({
    issueCount: 1,
    candidate: "The parties should trade volume for price.",
  });
  assert.deepEqual(sanitized, { issueCount: 1 });
  assert.equal("candidate" in sanitized, false);
});

test("D: responseBody is dropped even when short", () => {
  const sanitized = sanitizeAiAnalysisDiagnostics({
    responseLength: 64,
    responseBody: '{"status":"failed"}',
  });
  assert.deepEqual(sanitized, { responseLength: 64 });
  assert.equal("responseBody" in sanitized, false);
});

test("E: free-form issues string is dropped and does not bypass the allowlist", () => {
  const sanitized = sanitizeAiAnalysisDiagnostics({
    issues:
      "listeningAndReframing.missedOpportunities.0: Expected string, received object",
    issueCount: 1,
    issuePaths: ["listeningAndReframing.missedOpportunities.0"],
    issueCodes: ["invalid_type"],
    expectedKinds: ["string"],
    receivedKinds: ["object"],
  });
  assert.equal("issues" in sanitized, false);
  assert.deepEqual(sanitized, {
    issueCount: 1,
    issuePaths: ["listeningAndReframing.missedOpportunities.0"],
    issueCodes: ["invalid_type"],
    expectedKinds: ["string"],
    receivedKinds: ["object"],
  });
});

test("F: schema bounded issue metadata survives sanitizer and journal payload", () => {
  const output = createMockAnalysisOutput("en");
  const invalid = {
    ...output,
    listeningAndReframing: {
      ...output.listeningAndReframing,
      missedOpportunities: [
        {
          improvedPhrase: "Shall we package date and volume?",
          whyItWorks: "Turns a refusal into a trade.",
        },
      ],
    },
  };
  const parsed = NegotiationAnalysisOutputSchema.safeParse(invalid);
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const bounded = buildBoundedSchemaIssueDiagnostics(parsed.error);
  const issues = parsed.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  const sanitized = sanitizeAiAnalysisDiagnostics({ issues, ...bounded });
  assert.equal("issues" in sanitized, false);
  assert.equal(sanitized.issueCount, bounded.issueCount);
  assert.deepEqual(sanitized.issuePaths, bounded.issuePaths);
  assert.deepEqual(sanitized.issueCodes, bounded.issueCodes);
  assert.deepEqual(sanitized.expectedKinds, bounded.expectedKinds);
  assert.deepEqual(sanitized.receivedKinds, bounded.receivedKinds);
});

test("G: transcript, notes, hiddenInfo, and raw model output remain dropped", () => {
  const sanitized = sanitizeAiAnalysisDiagnostics({
    issueCount: 1,
    issuePaths: ["listeningAndReframing.missedOpportunities.0"],
    transcript: "secret transcript text",
    notes: "participant notes",
    hiddenInfo: "role secret",
    rawModelOutput: { providerEnvelope: "model prose" },
    responseLength: 11115,
    nestedObject: { text: "should be dropped" },
  });
  assert.deepEqual(sanitized, {
    issueCount: 1,
    issuePaths: ["listeningAndReframing.missedOpportunities.0"],
    responseLength: 11115,
  });
  assert.equal(isForbiddenDiagnosticKey("transcript"), true);
  assert.equal(isForbiddenDiagnosticKey("issuePaths"), false);
});

test("known allowlisted key with unbounded or nested value is dropped", () => {
  const sanitized = sanitizeAiAnalysisDiagnostics({
    issueCount: 1,
    issuePaths: ["a".repeat(201)],
    checkpoint: "x".repeat(501),
    providerStatus: { nested: "object" },
  });
  assert.deepEqual(sanitized, { issueCount: 1 });
});

test("bounded AI analysis log payload never copies raw provider text", () => {
  const payload = buildBoundedAiAnalysisLogPayload({
    errorClass: "MODEL_SCHEMA_VALIDATION_ERROR",
    provider: "yandex",
    model: "deepseek-v4-flash",
    httpStatus: null,
    retryable: false,
    diagnostics: {
      issues: "Expected string, received object",
      issueCount: 1,
      issuePaths: ["listeningAndReframing.missedOpportunities.0"],
      issueCodes: ["invalid_type"],
      expectedKinds: ["string"],
      receivedKinds: ["object"],
      candidate: "short model prose",
      responseBody: '{"ok":true}',
      transcript: "must not persist",
    },
  });
  assert.equal(payload.errorClass, "MODEL_SCHEMA_VALIDATION_ERROR");
  assert.deepEqual(payload.diagnostics, {
    issueCount: 1,
    issuePaths: ["listeningAndReframing.missedOpportunities.0"],
    issueCodes: ["invalid_type"],
    expectedKinds: ["string"],
    receivedKinds: ["object"],
  });
  assert.equal("issues" in payload.diagnostics, false);
  assert.equal("candidate" in payload.diagnostics, false);
  assert.equal("responseBody" in payload.diagnostics, false);
  assert.equal("transcript" in payload.diagnostics, false);
  assert.equal(payload.metrics, null);
});
