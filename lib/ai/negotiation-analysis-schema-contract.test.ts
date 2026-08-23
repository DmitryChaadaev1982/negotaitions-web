import assert from "node:assert/strict";
import test from "node:test";

import { buildBoundedSchemaIssueDiagnostics } from "@/lib/ai/analysis-failure-diagnostics";
import {
  createMockAnalysisOutput,
  getAnalysisPromptContracts,
  NegotiationAnalysisOutputSchema,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";

const INCIDENT_PATH = "listeningAndReframing.missedOpportunities.0";

function validOutput(): NegotiationAnalysisOutput {
  return createMockAnalysisOutput("en");
}

function issuePaths(output: unknown): string[] {
  const parsed = NegotiationAnalysisOutputSchema.safeParse(output);
  assert.equal(parsed.success, false);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => issue.path.join("."));
}

test("A: canonical missedOpportunities string array passes write schema", () => {
  const output = validOutput();
  output.listeningAndReframing.missedOpportunities = [
    "Improved phrase: 'If timing is the constraint, we can trade volume.' Why it works: it reframes delay as a package.",
  ];
  const parsed = NegotiationAnalysisOutputSchema.safeParse(output);
  assert.equal(parsed.success, true);
});

test("A: empty missedOpportunities array is schema-valid", () => {
  const output = validOutput();
  output.listeningAndReframing.missedOpportunities = [];
  const parsed = NegotiationAnalysisOutputSchema.safeParse(output);
  assert.equal(parsed.success, true);
});

test("B: object element fails at listeningAndReframing.missedOpportunities.0", () => {
  const output = validOutput();
  output.listeningAndReframing.missedOpportunities = [
    {
      improvedPhrase: "Could we treat delivery as a shared risk?",
      whyItWorks: "It shows listening and offers a reframe.",
    },
  ] as unknown as string[];
  const paths = issuePaths(output);
  assert.ok(paths.includes(INCIDENT_PATH), paths.join(", "));
  const parsed = NegotiationAnalysisOutputSchema.safeParse(output);
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const bounded = buildBoundedSchemaIssueDiagnostics(parsed.error);
  assert.equal(bounded.issueCount >= 1, true);
  assert.ok(bounded.issuePaths.includes(INCIDENT_PATH));
});

test("C: sparse short-session canonical output with empty arrays passes", () => {
  const output = validOutput();
  output.roleObjectivesAnalysis = [];
  output.strengths = [];
  output.improvementAreas = [];
  output.detectedTactics = [];
  output.questionsAnalysis.goodQuestions = [];
  output.questionsAnalysis.missedQuestions = [];
  output.listeningAndReframing.goodExamples = [];
  output.listeningAndReframing.missedOpportunities = [];
  output.valueCreationAnalysis.createdOptions = [];
  output.valueCreationAnalysis.missedOptions = [];
  output.valueCreationAnalysis.tradeOffsDiscussed = [];
  output.nextTrainingFocus = [];
  output.facilitatorDebriefQuestions = [];
  output.participantPersonalFeedback = [];
  const parsed = NegotiationAnalysisOutputSchema.safeParse(output);
  assert.equal(parsed.success, true);
});

test("D: plausible alternate object representation fails at the incident path", () => {
  const output = validOutput();
  const alternates = [
    [{ phrase: "Let us reframe price as a package.", why: "Creates options." }],
    [{ improvedPhrase: "What matters more, date or price?", whyItWorks: "Diagnoses priority." }],
    [null],
    [12],
  ];
  for (const missedOpportunities of alternates) {
    const candidate = {
      ...output,
      listeningAndReframing: {
        ...output.listeningAndReframing,
        missedOpportunities,
      },
    };
    const paths = issuePaths(candidate);
    assert.ok(
      paths.includes(INCIDENT_PATH),
      `${JSON.stringify(missedOpportunities)} => ${paths.join(", ")}`,
    );
  }
});

test("extra keys on listeningAndReframing are stripped, not rejected", () => {
  const output = {
    ...validOutput(),
    listeningAndReframing: {
      ...validOutput().listeningAndReframing,
      extraCoachNote: "should be stripped",
    },
  };
  const parsed = NegotiationAnalysisOutputSchema.safeParse(output);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(
    "extraCoachNote" in parsed.data.listeningAndReframing,
    false,
  );
});

test("Yandex typed schema says string[] while coaching asks for phrase plus why", () => {
  const contracts = getAnalysisPromptContracts();
  assert.match(
    contracts.yandexSchemaDescription,
    /missedOpportunities:\s*string\[\]/,
  );
  assert.match(
    contracts.yandexCoachingRequirements,
    /listeningAndReframing\.missedOpportunities: provide improved phrase and why it works/,
  );
  assert.match(
    contracts.openAiSchemaDescription,
    /missedOpportunities:\s*string\[\]/,
  );
  assert.doesNotMatch(
    contracts.yandexSchemaDescription,
    /missedOpportunities:\s*Array<\{/,
  );
});
