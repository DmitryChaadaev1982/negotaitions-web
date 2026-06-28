import { loadEnvConfig } from "@next/env";
import { parseArgs } from "node:util";

loadEnvConfig(process.cwd());

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    mode: { type: "string", default: "text" },
  },
});

const folderId = process.env.YANDEX_FOLDER_ID;
const apiKey = process.env.YANDEX_API_KEY;
const baseURL =
  process.env.YANDEX_AI_BASE_URL || "https://ai.api.cloud.yandex.net/v1";

if (!folderId) throw new Error("YANDEX_FOLDER_ID is missing");
if (!apiKey) throw new Error("YANDEX_API_KEY is missing");

const modelName =
  values.model ||
  process.env.YANDEX_AI_MODEL ||
  "deepseek-v4-flash";

const mode = values.mode || "text";

function getJsonSmokeMaxOutputTokens(): number {
  const parsed = Number.parseInt(
    process.env.YANDEX_AI_MAX_OUTPUT_TOKENS?.trim() || "4000",
    10,
  );
  if (!Number.isFinite(parsed)) {
    return 4000;
  }
  return Math.max(3000, parsed);
}

function getPrompt() {
  if (mode === "json") {
    return {
      input: `
Проанализируй короткий фрагмент переговоров.

Контекст:
Покупатель просит скидку 20%.
Продавец не готов снижать цену, но может дать бесплатную доставку и расширенную гарантию.
Покупатель говорит, что у конкурента дешевле.
Продавец хочет сохранить маржу и закрыть сделку сегодня.

Верни строго JSON без markdown:
{
  "summary": "краткое резюме",
  "sellerStrengths": ["..."],
  "sellerRisks": ["..."],
  "buyerInterests": ["..."],
  "recommendations": ["..."],
  "score": 1
}
`,
      instructions:
        "Ты эксперт по переговорам. Отвечай только валидным JSON без markdown и без поясняющего текста.",
      maxOutputTokens: getJsonSmokeMaxOutputTokens(),
    };
  }

  return {
    input:
      "Проанализируй короткую ситуацию: покупатель просит скидку, продавец не хочет снижать цену, но готов добавить бонус. Дай 3 рекомендации продавцу.",
    instructions:
      "Ты помощник для анализа переговоров. Отвечай кратко и структурированно.",
    maxOutputTokens: 500,
  };
}

async function main() {
  const safeFolderId = folderId as string;
  const safeApiKey = apiKey as string;
  const model = `gpt://${folderId}/${modelName}`;
  const url = `${baseURL}/responses`;
  const prompt = getPrompt();

  console.log("Testing Yandex AI Studio via direct REST fetch...");
  console.log(`Model: ${modelName}`);
  console.log(`Mode: ${mode}`);
  console.log(`Folder ID present: ${Boolean(folderId)}`);
  console.log(`API key present: ${Boolean(apiKey)}`);
  console.log(`URL: ${url}`);

  const startedAt = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Api-Key ${safeApiKey}`,
        "Content-Type": "application/json",
        "x-folder-id": safeFolderId,
        "x-data-logging-enabled": "false",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_output_tokens: prompt.maxOutputTokens,
        instructions: prompt.instructions,
        input: prompt.input,
      }),
    });

    const elapsedMs = Date.now() - startedAt;
    const rawText = await response.text();

    console.log(`HTTP status: ${response.status}`);
    console.log(`Elapsed: ${elapsedMs} ms`);

    if (!response.ok) {
      console.log("Raw error response:");
      console.log(rawText);
      throw new Error(`Yandex API returned HTTP ${response.status}`);
    }

    const data = JSON.parse(rawText) as {
      output_text?: string;
      output?: Array<{
        content?: Array<{ text?: string }>;
      }>;
    };

    const outputText =
      data.output_text ||
      data.output
        ?.flatMap((item) => item.content || [])
        ?.map((item) => item.text)
        ?.filter(Boolean)
        ?.join("\n") ||
      rawText;

    console.log("");
    console.log("Response:");
    console.log(outputText);

    if (mode === "json") {
      console.log("");
      console.log("JSON validation:");
      try {
        const parsed = JSON.parse(outputText);
        console.log({
          validJson: true,
          keys: Object.keys(parsed),
        });
      } catch {
        const trimmed = outputText.trim();
        const looksTruncated =
          trimmed.endsWith(":") || trimmed.endsWith(",") || !trimmed.endsWith("}");
        throw new Error(
          `Yandex smoke JSON parse failed (${looksTruncated ? "truncated/invalid JSON" : "invalid JSON"}): model=${modelName}, responseLength=${outputText.length}`,
        );
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error("");
  console.error("Yandex AI smoke test failed:");
  console.error(error);
  process.exitCode = 1;
});
