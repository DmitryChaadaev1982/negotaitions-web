import assert from "node:assert/strict";
import test from "node:test";

import {
  AiAnalysisProviderError,
  createMockAnalysisOutput,
  runNegotiationAnalysis,
} from "@/lib/ai/negotiation-analysis";
import { yandexResponseLifecycleFixtures as fixtures } from "@/lib/ai/fixtures/yandex-response-lifecycle";
import { buildAnalysisPrompt } from "@/lib/ai/session-analysis-prompt";
import {
  classifyParsedAnalysis,
  classifyProviderCharacterizationError,
  fixtureTranscriptCharacterCount,
  INCIDENT_SCHEMA_ISSUE_PATH,
  SCHEMA_CHARACTERIZATION_HARD_CAP,
  shouldStopAfterUltraShort,
  summarizeCharacterizationMatrix,
  summarizeMissedOpportunitiesShape,
  SYNTHETIC_SCHEMA_CHARACTERIZATION_FIXTURES,
  type CharacterizationGenerationRecord,
} from "@/lib/ai/schema-characterization";

const ORIGINAL_ENV = { ...process.env };

function configureYandexEnv() {
  process.env.AI_ANALYSIS_PROVIDER = "yandex";
  process.env.YANDEX_FOLDER_ID = "synthetic-folder";
  process.env.YANDEX_API_KEY = "synthetic-key";
  process.env.YANDEX_AI_MODEL = "deepseek-v4-flash";
}

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test("synthetic fixtures stay inside the intended richness bands", () => {
  const ultra = fixtureTranscriptCharacterCount("ULTRA_SHORT");
  const short = fixtureTranscriptCharacterCount("SHORT");
  const normal = fixtureTranscriptCharacterCount("NORMAL_CONTROL");
  assert.ok(ultra.textChars >= 150 && ultra.textChars <= 320, String(ultra.textChars));
  assert.equal(ultra.segmentCount, 4);
  assert.ok(short.segmentCount >= 6 && short.segmentCount <= 10);
  assert.ok(normal.segmentCount >= 10);
  for (const fixture of Object.values(SYNTHETIC_SCHEMA_CHARACTERIZATION_FIXTURES)) {
    const names = fixture.context.participants.map((item) => item.displayName);
    assert.deepEqual(names.sort(), ["Buyer", "Facilitator", "Seller"]);
    assert.doesNotMatch(JSON.stringify(fixture.context), /cmt1l5d3p000irsm1ekwg3oh3/);
  }
});

test("incident object-array shape classifies as WRONG_ELEMENT_TYPE at .0", () => {
  const output = createMockAnalysisOutput("en");
  const parsed = {
    ...output,
    listeningAndReframing: {
      ...output.listeningAndReframing,
      missedOpportunities: [{ improvedPhrase: "x", whyItWorks: "y" }],
    },
  };
  const shape = summarizeMissedOpportunitiesShape(parsed);
  assert.equal(shape.shape, "object_array");
  const classified = classifyParsedAnalysis(parsed);
  assert.equal(classified.schemaStatus, "invalid");
  assert.equal(classified.incidentPathMatch, true);
  assert.equal(classified.invalidClass, "WRONG_ELEMENT_TYPE");
  assert.ok(classified.schemaIssuePaths.includes(INCIDENT_SCHEMA_ISSUE_PATH));
});

test("mocked Yandex provider path records schema failure without retries", async () => {
  configureYandexEnv();
  const output = createMockAnalysisOutput("ru");
  const invalid = {
    ...output,
    listeningAndReframing: {
      ...output.listeningAndReframing,
      missedOpportunities: [{ improvedPhrase: "x", whyItWorks: "y" }],
    },
  };
  let posts = 0;
  await assert.rejects(
    () =>
      runNegotiationAnalysis(
        buildAnalysisPrompt(SYNTHETIC_SCHEMA_CHARACTERIZATION_FIXTURES.ULTRA_SHORT.context),
        "ru-RU",
        {
          fetch: (async () => {
            posts += 1;
            return new Response(JSON.stringify(fixtures.completed(JSON.stringify(invalid))), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }) as typeof fetch,
        },
      ),
    (error) => {
      const classified = classifyProviderCharacterizationError(error);
      assert.ok(error instanceof AiAnalysisProviderError);
      assert.equal(classified.errorClass, "MODEL_SCHEMA_VALIDATION_ERROR");
      assert.equal(classified.incidentPathMatch, true);
      assert.equal(classified.parseStatus, "valid");
      assert.equal(classified.schemaStatus, "invalid");
      return true;
    },
  );
  assert.equal(posts, 1);
});

test("early-stop helper requires two ultra-short incident-path mismatches", () => {
  const record = (
    fixture: CharacterizationGenerationRecord["fixture"],
    incidentPathMatch: boolean,
  ): CharacterizationGenerationRecord => ({
    fixture,
    runNumber: 1,
    model: "deepseek-v4-flash",
    providerLifecycleResult: "MODEL_SCHEMA_VALIDATION_ERROR",
    durationMs: 10,
    responseLength: 100,
    parseStatus: "valid",
    schemaStatus: "invalid",
    schemaIssueCount: 1,
    schemaIssuePaths: [INCIDENT_SCHEMA_ISSUE_PATH],
    missedOpportunitiesExists: true,
    missedOpportunitiesItemKinds: ["object"],
    missedOpportunitiesShape: "object_array",
    requiredKeyPresence: "present",
    outputCondition: null,
    incompleteReason: null,
    estimatedInputTokens: 100,
    estimatedPromptTokens: 80,
    errorClass: "MODEL_SCHEMA_VALIDATION_ERROR",
    incidentPathMatch,
    invalidClass: "WRONG_ELEMENT_TYPE",
  });
  assert.equal(
    shouldStopAfterUltraShort([
      record("ULTRA_SHORT", true),
      record("ULTRA_SHORT", true),
    ]),
    true,
  );
  assert.equal(shouldStopAfterUltraShort([record("ULTRA_SHORT", true)]), false);
  assert.equal(SCHEMA_CHARACTERIZATION_HARD_CAP, 15);
  const matrix = summarizeCharacterizationMatrix([
    record("ULTRA_SHORT", true),
    record("ULTRA_SHORT", true),
  ]);
  assert.equal(matrix[0]?.incidentPathFailures, 2);
});
