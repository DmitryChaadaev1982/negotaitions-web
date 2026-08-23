/**
 * CU-C synthetic twins for the Stage 3.17A incident shape.
 *
 * The helper below encodes a PROPOSED, not-yet-production-enabled bounded
 * same-prompt extra generation. Production analyze/orchestration must not
 * import this file. Current production max attempts remain 1.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AiAnalysisStatus } from "@/app/generated/prisma/client";
import {
  claimAiAnalysisRun,
  completeAiAnalysisRun,
  failAiAnalysisRun,
  startAiAnalysisRun,
  type AiAnalysisOperationStore,
} from "@/lib/ai/analysis-operation";
import {
  AiAnalysisProviderError,
  canRecoverProviderResponseAfterFailure,
  createMockAnalysisOutput,
  getAiAnalysisPerformanceModel,
  NegotiationAnalysisOutputSchema,
  type NegotiationAnalysisOutput,
} from "@/lib/ai/negotiation-analysis";

const PROPOSED_BOUNDED_SCHEMA_RECOVERY_ENABLED_IN_PRODUCTION = false;
const INCIDENT_PATH = "listeningAndReframing.missedOpportunities.0";

type DurableRow = {
  status: AiAnalysisStatus;
  currentOutput: NegotiationAnalysisOutput | null;
  generationCount: number;
};

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

function createTwinStore() {
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
  } | null = null;
  let currentOutput: NegotiationAnalysisOutput | null = null;

  const store: AiAnalysisOperationStore = {
    async findBySession() {
      return row ? { ...row } : null;
    },
    async createClaim(params) {
      if (row) return null;
      row = {
        id: "analysis-twin-1",
        status: AiAnalysisStatus.QUEUED,
        runToken: params.runToken,
        leaseExpiresAt: params.leaseExpiresAt,
        providerResponseId: null,
        transcriptId: params.transcriptId,
        transcriptRetranscribeCount: params.transcriptRetranscribeCount,
        language: params.language,
        updatedAt: params.now,
      };
      return { ...row };
    },
    async tryClaimExisting() {
      throw new Error("twin tests stay on one claimed ANALYZING owner");
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
      return true;
    },
  };

  return {
    store,
    snapshot(): DurableRow {
      return {
        status: row?.status ?? AiAnalysisStatus.FAILED,
        currentOutput,
        generationCount: 0,
      };
    },
    get currentOutput() {
      return currentOutput;
    },
    get status() {
      return row?.status ?? null;
    },
  };
}

/**
 * PROPOSED policy runner. Not imported by production. Stays ANALYZING through
 * one extra same-prompt generation after MODEL_SCHEMA_VALIDATION_ERROR, then
 * completes or fails. Never starts a third generation.
 */
async function runProposedBoundedSchemaRecovery(params: {
  generate: () => Promise<NegotiationAnalysisOutput>;
}): Promise<{
  generations: number;
  status: AiAnalysisStatus;
  currentOutput: NegotiationAnalysisOutput | null;
}> {
  assert.equal(
    PROPOSED_BOUNDED_SCHEMA_RECOVERY_ENABLED_IN_PRODUCTION,
    false,
    "proposed recovery must remain disabled in production",
  );
  const memory = createTwinStore();
  const now = new Date("2026-08-21T12:00:00.000Z");
  const claimed = await claimAiAnalysisRun({
    sessionId: "session-twin",
    transcriptId: "transcript-twin",
    transcriptRetranscribeCount: 0,
    language: "ru",
    now,
    runToken: "twin-token",
    store: memory.store,
  });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") {
    throw new Error("claim failed");
  }
  const started = await startAiAnalysisRun({
    owner: claimed.owner,
    now: new Date(now.getTime() + 500),
    store: memory.store,
  });
  assert.ok(started);

  let generations = 0;
  const attempt = async () => {
    generations += 1;
    return params.generate();
  };

  try {
    const first = await attempt();
    await completeAiAnalysisRun({
      owner: started,
      fields: {
        model: "synthetic",
        executiveSummary: first.executiveSummary,
        overallScore: first.overallScore,
        analysisJson: first,
        rawModelOutput: { mock: true },
      },
      store: memory.store,
    });
    return {
      generations,
      status: AiAnalysisStatus.COMPLETED,
      currentOutput: memory.currentOutput,
    };
  } catch (error) {
    assert.ok(error instanceof AiAnalysisProviderError);
    if (error.code !== "MODEL_SCHEMA_VALIDATION_ERROR") {
      await failAiAnalysisRun({
        owner: started,
        errorMessage: error.userMessage,
        clearProviderResponseId: !canRecoverProviderResponseAfterFailure(error.code),
        store: memory.store,
      });
      return {
        generations,
        status: AiAnalysisStatus.FAILED,
        currentOutput: memory.currentOutput,
      };
    }
  }

  try {
    const second = await attempt();
    await completeAiAnalysisRun({
      owner: started,
      fields: {
        model: "synthetic",
        executiveSummary: second.executiveSummary,
        overallScore: second.overallScore,
        analysisJson: second,
        rawModelOutput: { mock: true },
      },
      store: memory.store,
    });
    return {
      generations,
      status: AiAnalysisStatus.COMPLETED,
      currentOutput: memory.currentOutput,
    };
  } catch (error) {
    assert.ok(error instanceof AiAnalysisProviderError);
    await failAiAnalysisRun({
      owner: started,
      errorMessage: error.userMessage,
      clearProviderResponseId: !canRecoverProviderResponseAfterFailure(error.code),
      store: memory.store,
    });
    return {
      generations,
      status: AiAnalysisStatus.FAILED,
      currentOutput: memory.currentOutput,
    };
  }
}

function schemaInvalidAtIncidentPath(): never {
  const parsed = NegotiationAnalysisOutputSchema.safeParse(incidentInvalidOutput());
  assert.equal(parsed.success, false);
  if (parsed.success) {
    throw new Error("expected invalid");
  }
  const paths = parsed.error.issues.map((issue) => issue.path.join("."));
  assert.ok(paths.includes(INCIDENT_PATH), paths.join(", "));
  throw new AiAnalysisProviderError({
    code: "MODEL_SCHEMA_VALIDATION_ERROR",
    provider: "yandex",
    model: "deepseek-v4-flash",
    message: "Yandex AI response failed schema validation.",
    retryable: false,
    allowsRegeneration: false,
    diagnostics: {
      issueCount: parsed.error.issues.length,
      issuePaths: paths.slice(0, 5),
    },
  });
}

test("proposed recovery remains disabled in production configuration", () => {
  assert.equal(PROPOSED_BOUNDED_SCHEMA_RECOVERY_ENABLED_IN_PRODUCTION, false);
  assert.equal(getAiAnalysisPerformanceModel().maxOperationAttempts, 1);
  assert.equal(getAiAnalysisPerformanceModel().maxGenerationPosts, 1);
});

test("TWIN 1: invalid incident-path generation then valid generation becomes current", async () => {
  const valid = createMockAnalysisOutput("en");
  const bodies = [incidentInvalidOutput(), valid];
  const result = await runProposedBoundedSchemaRecovery({
    generate: async () => {
      const body = bodies.shift();
      const parsed = NegotiationAnalysisOutputSchema.safeParse(body);
      if (!parsed.success) schemaInvalidAtIncidentPath();
      return parsed.data;
    },
  });
  assert.equal(result.generations, 2);
  assert.equal(result.status, AiAnalysisStatus.COMPLETED);
  assert.deepEqual(result.currentOutput, valid);
});

test("TWIN 2: two invalid generations terminalize FAILED with no third generation", async () => {
  let generateCalls = 0;
  const result = await runProposedBoundedSchemaRecovery({
    generate: async () => {
      generateCalls += 1;
      schemaInvalidAtIncidentPath();
    },
  });
  assert.equal(generateCalls, 2);
  assert.equal(result.generations, 2);
  assert.equal(result.status, AiAnalysisStatus.FAILED);
  assert.equal(result.currentOutput, null);
});
