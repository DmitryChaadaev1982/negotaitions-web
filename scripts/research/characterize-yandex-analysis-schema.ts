/**
 * Stage 3.17A Checkpoint 1 — bounded synthetic Yandex characterization.
 *
 * Live calls are opt-in (`--live`). Hard cap is 15 independent generations.
 * No AiAnalysis writes. No production transcript. Raw bodies stay in gitignored tmp.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import {
  classifyParsedAnalysis,
  classifyProviderCharacterizationError,
  SCHEMA_CHARACTERIZATION_HARD_CAP,
  shouldStopAfterUltraShort,
  summarizeCharacterizationMatrix,
  summarizeMissedOpportunitiesShape,
  SYNTHETIC_SCHEMA_CHARACTERIZATION_FIXTURES,
  type CharacterizationFixtureId,
  type CharacterizationGenerationRecord,
} from "@/lib/ai/schema-characterization";
import {
  extractYandexOutputText,
  runNegotiationAnalysis,
  tryParseJsonWithRecovery,
} from "@/lib/ai/negotiation-analysis";
import { buildAnalysisPrompt } from "@/lib/ai/session-analysis-prompt";

loadEnvConfig(process.cwd());

const LIVE = process.argv.includes("--live");
const ARTIFACT_DIR = path.join(
  process.cwd(),
  "tmp",
  "stage-3-17a-characterization",
);

function requiredPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function extractCompletedText(envelope: unknown): string | null {
  if (!envelope || typeof envelope !== "object") return null;
  const extracted = extractYandexOutputText(envelope as Record<string, unknown>);
  return extracted.text?.trim() ? extracted.text : null;
}

function createCapturingFetch(onCompletedText: (text: string) => void): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    const cloned = response.clone();
    try {
      const envelope = await cloned.json();
      const text = extractCompletedText(envelope);
      if (typeof envelope?.status === "string" && envelope.status === "completed" && text) {
        onCompletedText(text);
      }
    } catch {
      // Characterization capture is best-effort and must not change the provider call.
    }
    return response;
  }) as typeof fetch;
}

async function runOneGeneration(
  fixture: CharacterizationFixtureId,
  runNumber: number,
): Promise<{
  record: CharacterizationGenerationRecord;
  rawText: string | null;
}> {
  const prompt = buildAnalysisPrompt(
    SYNTHETIC_SCHEMA_CHARACTERIZATION_FIXTURES[fixture].context,
  );
  const capture: { text: string | null } = { text: null };
  const started = Date.now();
  try {
    const result = await runNegotiationAnalysis(prompt, "ru-RU", {
      persistProviderResponseId: async () => true,
      fetch: createCapturingFetch((text) => {
        capture.text = text;
      }),
    });
    const parsedSource = capture.text
      ? tryParseJsonWithRecovery(capture.text)
      : result.output;
    const missed = summarizeMissedOpportunitiesShape(parsedSource ?? result.output);
    return {
      rawText: capture.text,
      record: {
        fixture,
        runNumber,
        model: result.model,
        providerLifecycleResult: "completed",
        durationMs: Date.now() - started,
        responseLength: result.metrics.responseLength,
        parseStatus: "valid",
        schemaStatus: "valid",
        schemaIssueCount: 0,
        schemaIssuePaths: [],
        missedOpportunitiesExists: missed.exists,
        missedOpportunitiesItemKinds: missed.itemKinds,
        missedOpportunitiesShape: missed.shape,
        requiredKeyPresence: "present",
        outputCondition: null,
        incompleteReason: null,
        estimatedInputTokens: result.metrics.estimatedInputTokens,
        estimatedPromptTokens: result.metrics.estimatedPromptTokens,
        errorClass: null,
        incidentPathMatch: false,
        invalidClass: null,
      },
    };
  } catch (error) {
    const classified = classifyProviderCharacterizationError(error);
    const parsed = capture.text ? tryParseJsonWithRecovery(capture.text) : null;
    const local = parsed ? classifyParsedAnalysis(parsed) : null;
    const missed = parsed
      ? summarizeMissedOpportunitiesShape(parsed)
      : { exists: false, itemKinds: [], shape: null };
    return {
      rawText: capture.text,
      record: {
        fixture,
        runNumber,
        model: "deepseek-v4-flash",
        providerLifecycleResult: classified.providerLifecycleResult,
        durationMs: Date.now() - started,
        responseLength: classified.responseLength ?? capture.text?.length ?? null,
        parseStatus: local
          ? "valid"
          : classified.parseStatus,
        schemaStatus: local?.schemaStatus ?? classified.schemaStatus,
        schemaIssueCount: local?.schemaIssueCount ?? classified.schemaIssueCount,
        schemaIssuePaths: local?.schemaIssuePaths ?? classified.schemaIssuePaths,
        missedOpportunitiesExists: missed.exists,
        missedOpportunitiesItemKinds: missed.itemKinds,
        missedOpportunitiesShape: missed.shape,
        requiredKeyPresence:
          missed.exists || classified.schemaIssuePaths.some((path) => path.includes("missedOpportunities"))
            ? missed.exists
              ? "present"
              : "missing"
            : "unknown",
        outputCondition: classified.outputCondition,
        incompleteReason: classified.incompleteReason,
        estimatedInputTokens: null,
        estimatedPromptTokens: null,
        errorClass: classified.errorClass,
        incidentPathMatch:
          local?.incidentPathMatch ?? classified.incidentPathMatch,
        invalidClass: local?.invalidClass ?? classified.invalidClass,
      },
    };
  }
}

async function main() {
  if (!LIVE) {
    console.error("Refusing to call Yandex without --live.");
    process.exit(2);
  }
  if (!requiredPresent("YANDEX_API_KEY") || !requiredPresent("YANDEX_FOLDER_ID")) {
    console.error("Yandex AI credentials are not configured.");
    process.exit(2);
  }
  process.env.AI_ANALYSIS_PROVIDER = process.env.AI_ANALYSIS_PROVIDER?.trim() || "yandex";
  if (process.env.AI_ANALYSIS_PROVIDER !== "yandex") {
    console.error("Characterization requires AI_ANALYSIS_PROVIDER=yandex.");
    process.exit(2);
  }

  await mkdir(ARTIFACT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  const records: CharacterizationGenerationRecord[] = [];
  let earlyStop = false;
  let earlyStopReason = "";
  const plan: CharacterizationFixtureId[] = [
    "ULTRA_SHORT",
    "ULTRA_SHORT",
    "ULTRA_SHORT",
    "ULTRA_SHORT",
    "ULTRA_SHORT",
    "SHORT",
    "SHORT",
    "SHORT",
    "SHORT",
    "SHORT",
    "NORMAL_CONTROL",
    "NORMAL_CONTROL",
    "NORMAL_CONTROL",
    "NORMAL_CONTROL",
    "NORMAL_CONTROL",
  ];

  console.error("Yandex credentials: present");
  console.error(`provider=${process.env.AI_ANALYSIS_PROVIDER}`);
  console.error(`model=${process.env.YANDEX_AI_MODEL?.trim() || "deepseek-v4-flash"}`);
  console.error(`hardCap=${SCHEMA_CHARACTERIZATION_HARD_CAP}`);

  for (const fixture of plan) {
    if (records.length >= SCHEMA_CHARACTERIZATION_HARD_CAP) break;
    const runNumber = records.filter((record) => record.fixture === fixture).length + 1;
    console.error(`generation ${records.length + 1}/${SCHEMA_CHARACTERIZATION_HARD_CAP} fixture=${fixture} run=${runNumber}`);
    const { record, rawText } = await runOneGeneration(fixture, runNumber);
    records.push(record);
    if (rawText) {
      await writeFile(
        path.join(
          ARTIFACT_DIR,
          `${stamp}-${fixture}-${runNumber}.raw.json`,
        ),
        rawText,
        "utf8",
      );
    }
    console.error(
      `  class=${record.errorClass ?? "SUCCESS"} parse=${record.parseStatus} schema=${record.schemaStatus} incident=${record.incidentPathMatch} shape=${record.missedOpportunitiesShape ?? "n/a"} durationMs=${record.durationMs}`,
    );
    if (shouldStopAfterUltraShort(records)) {
      earlyStop = true;
      earlyStopReason =
        "ULTRA_SHORT produced the same incident-class/path structural mismatch in >=2 independent runs.";
      break;
    }
  }

  const summary = {
    LIVE_PROVIDER_GENERATIONS: records.length,
    EXPERIMENT_EARLY_STOP: earlyStop ? "YES" : "NO",
    earlyStopReason,
    model: process.env.YANDEX_AI_MODEL?.trim() || "deepseek-v4-flash",
    provider: "yandex",
    language: "ru-RU",
    matrix: summarizeCharacterizationMatrix(records),
    records: records.map((record) => ({
      ...record,
    })),
    observedShapes: [...new Set(records.map((record) => record.missedOpportunitiesShape).filter(Boolean))],
    invalidClasses: [...new Set(records.map((record) => record.invalidClass).filter(Boolean))],
  };
  await writeFile(
    path.join(ARTIFACT_DIR, `${stamp}-summary.json`),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "characterization failed");
  process.exit(1);
});
