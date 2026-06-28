import { loadEnvConfig } from "@next/env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, TranscriptStatus } from "../app/generated/prisma/client";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { parseArgs } from "node:util";

type CliValues = {
  list?: boolean;
  "transcript-id"?: string;
  "session-id"?: string;
  models?: string;
  "max-chars"?: string;
  "output-dir"?: string;
};

type ModelRunResult = {
  modelName: string;
  elapsedMs: number;
  httpStatus: number | null;
  validJson: boolean;
  outputText: string;
  parsedJson?: unknown;
  error?: string;
};

type TranscriptForAnalysis = {
  id: string;
  sessionId: string;
  status: string;
  source: string;
  text: string;
  diarizedText: string | null;
  createdAt: Date;
  updatedAt: Date;
  session: {
    id: string;
    title: string;
    status: string;
    snapshotCaseLanguage: string;
  };
  segments: Array<{
    speakerLabel: string | null;
    text: string;
    orderIndex: number;
    mappedParticipant: { displayName: string } | null;
  }>;
};

const DEFAULT_MODELS = [
  "deepseek-v4-flash",
  "yandexgpt-5.1",
  "yandexgpt-lite",
];
const DEFAULT_MAX_CHARS = 25_000;
const DEFAULT_BASE_URL = "https://ai.api.cloud.yandex.net/v1";
const DEFAULT_OUTPUT_DIR = path.join("tmp", "yandex-model-benchmark");
const REQUEST_TIMEOUT_MS = 180_000;

loadEnvConfig(process.cwd());

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is missing`);
  }
  return value;
}

function parseMaxChars(raw: string | undefined): number {
  if (!raw) return DEFAULT_MAX_CHARS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --max-chars value: ${raw}`);
  }
  return parsed;
}

function parseModels(raw: string | undefined): string[] {
  const source = raw?.trim() ? raw : DEFAULT_MODELS.join(",");
  return source
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getOutputTextFromYandexPayload(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const asRecord = payload as Record<string, unknown>;
  if (typeof asRecord.output_text === "string" && asRecord.output_text.trim()) {
    return asRecord.output_text;
  }

  const output = asRecord.output;
  if (Array.isArray(output)) {
    const text = output
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const content = (item as Record<string, unknown>).content;
        return Array.isArray(content) ? content : [];
      })
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const textValue = (item as Record<string, unknown>).text;
        return typeof textValue === "string" ? textValue : null;
      })
      .filter((item): item is string => Boolean(item))
      .join("\n");
    if (text.trim()) return text;
  }

  return fallback;
}

function normalizeTextFromStructuredJson(rawText: string): string | null {
  const input = rawText.trim();
  if (!input.startsWith("{") && !input.startsWith("[")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }

  const collectUtterances = (node: unknown): Array<{ speaker: string; text: string }> => {
    if (Array.isArray(node)) {
      return node.flatMap((item) => collectUtterances(item));
    }
    if (!node || typeof node !== "object") {
      return [];
    }

    const record = node as Record<string, unknown>;
    const directText = [
      "text",
      "utterance",
      "message",
      "content",
      "transcript",
    ].find((key) => typeof record[key] === "string");
    const directSpeaker = [
      "speaker",
      "speakerLabel",
      "participant",
      "name",
      "role",
    ].find((key) => typeof record[key] === "string");

    const direct: Array<{ speaker: string; text: string }> =
      directText && typeof record[directText] === "string"
        ? [
            {
              speaker:
                (directSpeaker && String(record[directSpeaker]).trim()) || "Speaker",
              text: String(record[directText]).trim(),
            },
          ]
        : [];

    const nestedKeys = ["segments", "messages", "utterances", "items", "results"];
    const nested = nestedKeys.flatMap((key) => collectUtterances(record[key]));
    return [...direct, ...nested].filter((row) => row.text);
  };

  const rows = collectUtterances(parsed);
  if (rows.length === 0) {
    return null;
  }
  return rows.map((row) => `${row.speaker}: ${row.text}`).join("\n");
}

function normalizeTranscriptText(
  transcript: TranscriptForAnalysis,
  maxChars: number,
): {
  text: string;
  sourceUsed: "segments" | "diarizedText" | "structuredText" | "text" | "empty";
  originalLength: number;
  wasTrimmed: boolean;
  textLength: number;
} {
  let baseText = "";
  let sourceUsed: "segments" | "diarizedText" | "structuredText" | "text" | "empty" =
    "empty";

  if (transcript.segments.length > 0) {
    baseText = transcript.segments
      .map((segment, idx) => {
        const speaker =
          segment.mappedParticipant?.displayName?.trim() ||
          segment.speakerLabel?.trim() ||
          `Speaker ${idx + 1}`;
        return `${speaker}: ${segment.text.trim()}`;
      })
      .filter(Boolean)
      .join("\n");
    sourceUsed = "segments";
  } else if (transcript.diarizedText?.trim()) {
    baseText = transcript.diarizedText.trim();
    sourceUsed = "diarizedText";
  } else if (transcript.text?.trim()) {
    const normalizedJson = normalizeTextFromStructuredJson(transcript.text);
    if (normalizedJson) {
      baseText = normalizedJson;
      sourceUsed = "structuredText";
    } else {
      baseText = transcript.text.trim();
      sourceUsed = "text";
    }
  }

  const originalLength = baseText.length;
  const wasTrimmed = originalLength > maxChars;
  const text = wasTrimmed
    ? `${baseText.slice(0, maxChars)}\n\n[TRIMMED: originalLength=${originalLength}, maxChars=${maxChars}]`
    : baseText;

  return {
    text,
    sourceUsed,
    originalLength,
    wasTrimmed,
    textLength: text.length,
  };
}

function buildStandalonePromptRu(params: {
  sessionTitle: string;
  caseLanguage: string;
  transcriptText: string;
  transcriptWasTrimmed: boolean;
  transcriptOriginalLength: number;
  transcriptCurrentLength: number;
}): { instructions: string; input: string } {
  const instructions = [
    "Ты эксперт по переговорам.",
    "Верни только валидный JSON без markdown, без поясняющего текста и без дополнительных полей.",
    "Если данных недостаточно, так и укажи в соответствующих полях.",
    "Ответ должен быть на русском языке.",
  ].join(" ");

  const input = `
Проанализируй сохраненную расшифровку переговорной сессии.

Метаданные:
- Название сессии: ${params.sessionTitle}
- Язык кейса: ${params.caseLanguage}
- Длина текста для анализа: ${params.transcriptCurrentLength}
- Исходная длина текста: ${params.transcriptOriginalLength}
- Было ли обрезание по лимиту: ${params.transcriptWasTrimmed ? "да" : "нет"}

Требуемая структура JSON (строго):
{
  "kratkoe_rezyume_peregovorov": "string",
  "tseli_i_interesy_storon": {
    "storona_1": ["string"],
    "storona_2": ["string"]
  },
  "silnye_hody_kazhdoi_storony": {
    "storona_1": ["string"],
    "storona_2": ["string"]
  },
  "oshibki_riski_kazhdoi_storony": {
    "storona_1": ["string"],
    "storona_2": ["string"]
  },
  "gde_byl_poteryan_kontrol": ["string"],
  "takticheskie_rekomendacii": ["string"],
  "ocenka_kachestva_peregovorov_po_10_ballnoi_shkale": 0,
  "tri_frazy_kotorye_stoilo_skazat_inache": [
    {
      "original": "string",
      "improved": "string",
      "why": "string"
    }
  ]
}

Ограничения:
- "ocenka_kachestva_peregovorov_po_10_ballnoi_shkale" — целое число от 1 до 10.
- "tri_frazy_kotorye_stoilo_skazat_inache" — ровно 3 элемента.
- Не придумывай факты, которых нет в тексте.

Текст переговоров:
${params.transcriptText}
`.trim();

  return { instructions, input };
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toRunTimestamp(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const second = String(now.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

async function runModel(params: {
  modelName: string;
  folderId: string;
  apiKey: string;
  baseUrl: string;
  instructions: string;
  input: string;
}): Promise<ModelRunResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${params.baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Api-Key ${params.apiKey}`,
        "Content-Type": "application/json",
        "x-folder-id": params.folderId,
        "x-data-logging-enabled": "false",
      },
      body: JSON.stringify({
        model: `gpt://${params.folderId}/${params.modelName}`,
        temperature: 0.2,
        max_output_tokens: 3_000,
        instructions: params.instructions,
        input: params.input,
      }),
    });

    const elapsedMs = Date.now() - startedAt;
    const rawText = await response.text();

    if (!response.ok) {
      return {
        modelName: params.modelName,
        elapsedMs,
        httpStatus: response.status,
        validJson: false,
        outputText: rawText,
        error: `Yandex API returned HTTP ${response.status}`,
      };
    }

    let payload: unknown = null;
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }

    const outputText = getOutputTextFromYandexPayload(payload, rawText);
    try {
      const parsedJson = JSON.parse(outputText);
      return {
        modelName: params.modelName,
        elapsedMs,
        httpStatus: response.status,
        validJson: true,
        outputText,
        parsedJson,
      };
    } catch {
      return {
        modelName: params.modelName,
        elapsedMs,
        httpStatus: response.status,
        validJson: false,
        outputText,
        error: "Model output is not valid JSON",
      };
    }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timeoutMessage =
      error instanceof Error && error.name === "AbortError"
        ? "Network timeout. Check VPN split tunneling for ai.api.cloud.yandex.net."
        : error instanceof Error
          ? error.message
          : "Unknown error";
    return {
      modelName: params.modelName,
      elapsedMs,
      httpStatus: null,
      validJson: false,
      outputText: "",
      error: timeoutMessage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function renderComparisonMarkdown(params: {
  transcript: TranscriptForAnalysis;
  models: string[];
  maxChars: number;
  normalized: ReturnType<typeof normalizeTranscriptText>;
  results: ModelRunResult[];
}): string {
  const lines: string[] = [];
  lines.push("# Yandex model benchmark");
  lines.push("");
  lines.push(`- Transcript ID: \`${params.transcript.id}\``);
  lines.push(`- Session ID: \`${params.transcript.sessionId}\``);
  lines.push(`- Session title: ${params.transcript.session.title}`);
  lines.push(`- Transcript status: ${params.transcript.status}`);
  lines.push(`- Transcript source: ${params.transcript.source}`);
  lines.push(`- Text source used: ${params.normalized.sourceUsed}`);
  lines.push(`- Max chars: ${params.maxChars}`);
  lines.push(`- Was trimmed: ${params.normalized.wasTrimmed ? "yes" : "no"}`);
  lines.push(`- Original length: ${params.normalized.originalLength}`);
  lines.push(`- Length sent to model: ${params.normalized.textLength}`);
  lines.push(`- Models: ${params.models.join(", ")}`);
  lines.push("");

  for (const result of params.results) {
    lines.push(`## ${result.modelName}`);
    lines.push("");
    lines.push(`- elapsedMs: ${result.elapsedMs}`);
    lines.push(`- httpStatus: ${result.httpStatus ?? "null"}`);
    lines.push(`- validJson: ${result.validJson}`);
    if (result.error) {
      lines.push(`- error: ${result.error}`);
    }
    lines.push("");
    lines.push("```json");
    if (result.validJson && typeof result.parsedJson !== "undefined") {
      lines.push(JSON.stringify(result.parsedJson, null, 2));
    } else {
      lines.push(
        JSON.stringify(
          {
            rawOutputText: result.outputText,
          },
          null,
          2,
        ),
      );
    }
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n");
}

function printListRows(
  rows: Array<{
    id: string;
    sessionId: string;
    status: string;
    source: string;
    createdAt: Date;
    updatedAt: Date;
    text: string;
    diarizedText: string | null;
    session: { id: string; title: string } | null;
  }>,
): void {
  if (rows.length === 0) {
    console.log("No transcripts found.");
    return;
  }

  for (const row of rows) {
    const bestTextLength = (row.diarizedText?.length ?? 0) > 0
      ? row.diarizedText!.length
      : row.text.length;
    console.log(
      JSON.stringify(
        {
          transcriptId: row.id,
          sessionId: row.sessionId,
          sessionTitle: row.session?.title ?? null,
          transcriptStatus: row.status,
          source: row.source,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
          textLength: bestTextLength,
        },
        null,
        2,
      ),
    );
  }
}

async function getTranscriptForSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<TranscriptForAnalysis | null> {
  return prisma.transcript.findFirst({
    where: {
      sessionId,
      status: TranscriptStatus.COMPLETED,
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      sessionId: true,
      status: true,
      source: true,
      text: true,
      diarizedText: true,
      createdAt: true,
      updatedAt: true,
      session: {
        select: {
          id: true,
          title: true,
          status: true,
          snapshotCaseLanguage: true,
        },
      },
      segments: {
        orderBy: { orderIndex: "asc" },
        select: {
          speakerLabel: true,
          text: true,
          orderIndex: true,
          mappedParticipant: {
            select: { displayName: true },
          },
        },
      },
    },
  }) as Promise<TranscriptForAnalysis | null>;
}

async function getTranscriptById(
  prisma: PrismaClient,
  transcriptId: string,
): Promise<TranscriptForAnalysis | null> {
  return prisma.transcript.findUnique({
    where: { id: transcriptId },
    select: {
      id: true,
      sessionId: true,
      status: true,
      source: true,
      text: true,
      diarizedText: true,
      createdAt: true,
      updatedAt: true,
      session: {
        select: {
          id: true,
          title: true,
          status: true,
          snapshotCaseLanguage: true,
        },
      },
      segments: {
        orderBy: { orderIndex: "asc" },
        select: {
          speakerLabel: true,
          text: true,
          orderIndex: true,
          mappedParticipant: {
            select: { displayName: true },
          },
        },
      },
    },
  }) as Promise<TranscriptForAnalysis | null>;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      list: { type: "boolean", default: false },
      "transcript-id": { type: "string" },
      "session-id": { type: "string" },
      models: { type: "string" },
      "max-chars": { type: "string" },
      "output-dir": { type: "string" },
    },
  });

  const cli = values as CliValues;
  const maxChars = parseMaxChars(cli["max-chars"]);
  const models = parseModels(cli.models);
  const outputDirBase = cli["output-dir"]?.trim() || DEFAULT_OUTPUT_DIR;

  const connectionString = requireEnv("DATABASE_URL");
  const folderId = requireEnv("YANDEX_FOLDER_ID");
  const apiKey = requireEnv("YANDEX_API_KEY");
  const baseUrl = process.env.YANDEX_AI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const dataLoggingHeader = process.env.YANDEX_DATA_LOGGING_ENABLED?.trim() || "false";

  if (dataLoggingHeader.toLowerCase() !== "false") {
    throw new Error("YANDEX_DATA_LOGGING_ENABLED must be false for this benchmark.");
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    if (cli.list) {
      const rows = await prisma.transcript.findMany({
        orderBy: { updatedAt: "desc" },
        take: 25,
        select: {
          id: true,
          sessionId: true,
          status: true,
          source: true,
          text: true,
          diarizedText: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const sessionIds = [...new Set(rows.map((row) => row.sessionId))];
      const sessions = await prisma.session.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, title: true },
      });
      const sessionTitleById = new Map(sessions.map((session) => [session.id, session.title]));
      printListRows(
        rows.map((row) => ({
          ...row,
          session: {
            id: row.sessionId,
            title: sessionTitleById.get(row.sessionId) ?? "(unknown session)",
          },
        })),
      );
      return;
    }

    const transcriptId = cli["transcript-id"]?.trim();
    const sessionId = cli["session-id"]?.trim();
    if (!transcriptId && !sessionId) {
      throw new Error("Provide --transcript-id <id> or --session-id <id>, or use --list.");
    }

    let transcript: TranscriptForAnalysis | null = null;
    if (transcriptId) {
      transcript = await getTranscriptById(prisma, transcriptId);
      if (!transcript) {
        throw new Error(`Transcript not found: ${transcriptId}`);
      }
    } else if (sessionId) {
      transcript = await getTranscriptForSession(prisma, sessionId);
      if (!transcript) {
        throw new Error(
          `No suitable completed transcript found for session: ${sessionId}`,
        );
      }
    }

    if (!transcript) {
      throw new Error("Transcript not found.");
    }

    if (transcript.status !== TranscriptStatus.COMPLETED) {
      throw new Error(
        `Transcript status must be COMPLETED. Current status: ${transcript.status}`,
      );
    }

    const normalized = normalizeTranscriptText(transcript, maxChars);
    if (!normalized.text.trim()) {
      throw new Error("Transcript text is empty and cannot be analyzed.");
    }

    const prompt = buildStandalonePromptRu({
      sessionTitle: transcript.session.title,
      caseLanguage: transcript.session.snapshotCaseLanguage,
      transcriptText: normalized.text,
      transcriptWasTrimmed: normalized.wasTrimmed,
      transcriptOriginalLength: normalized.originalLength,
      transcriptCurrentLength: normalized.textLength,
    });

    const runStartedAt = new Date();
    const runDir = path.join(outputDirBase, toRunTimestamp(runStartedAt));
    await mkdir(runDir, { recursive: true });

    console.log(`Transcript ID: ${transcript.id}`);
    console.log(`Session ID: ${transcript.sessionId}`);
    console.log(`Models: ${models.join(", ")}`);
    console.log(`Output dir: ${runDir}`);
    console.log(`Text length sent: ${normalized.textLength}`);
    if (normalized.wasTrimmed) {
      console.log(
        `Transcript was trimmed from ${normalized.originalLength} to ${normalized.textLength} chars.`,
      );
    }

    const results: ModelRunResult[] = [];
    for (const modelName of models) {
      console.log(`Running model: ${modelName}`);
      const result = await runModel({
        modelName,
        folderId,
        apiKey,
        baseUrl,
        instructions: prompt.instructions,
        input: prompt.input,
      });
      results.push(result);
      console.log(
        `Finished ${modelName}: httpStatus=${result.httpStatus ?? "null"}, validJson=${result.validJson}, elapsedMs=${result.elapsedMs}`,
      );
      if (result.error === "Network timeout. Check VPN split tunneling for ai.api.cloud.yandex.net.") {
        console.log("Network timeout. Check VPN split tunneling for ai.api.cloud.yandex.net.");
      }
    }

    for (const result of results) {
      const modelFile = path.join(
        runDir,
        `${sanitizeFileName(result.modelName)}.json`,
      );
      await writeFile(modelFile, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }

    const comparisonPath = path.join(runDir, "comparison.md");
    const comparisonMarkdown = renderComparisonMarkdown({
      transcript,
      models,
      maxChars,
      normalized,
      results,
    });
    await writeFile(comparisonPath, comparisonMarkdown, "utf8");

    const runMetadataPath = path.join(runDir, "run-metadata.json");
    await writeFile(
      runMetadataPath,
      `${JSON.stringify(
        {
          runStartedAt: runStartedAt.toISOString(),
          runFinishedAt: new Date().toISOString(),
          transcript: {
            id: transcript.id,
            sessionId: transcript.sessionId,
            sessionTitle: transcript.session.title,
            transcriptStatus: transcript.status,
            transcriptSource: transcript.source,
            createdAt: transcript.createdAt.toISOString(),
            updatedAt: transcript.updatedAt.toISOString(),
          },
          config: {
            models,
            maxChars,
            outputDirBase,
            runDir,
            yandexBaseUrl: baseUrl,
            yandexDataLoggingEnabled: "false",
          },
          transcriptText: {
            sourceUsed: normalized.sourceUsed,
            originalLength: normalized.originalLength,
            sentLength: normalized.textLength,
            wasTrimmed: normalized.wasTrimmed,
          },
          results: results.map((item) => ({
            modelName: item.modelName,
            elapsedMs: item.elapsedMs,
            httpStatus: item.httpStatus,
            validJson: item.validJson,
            error: item.error ?? null,
          })),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    console.log("Benchmark completed.");
    console.log(`Artifacts saved to: ${runDir}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Benchmark failed:");
  console.error(error);
  process.exitCode = 1;
});
