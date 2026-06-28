import { readFile } from "node:fs/promises";
import { loadEnvConfig } from "@next/env";
import { parseArgs } from "node:util";

loadEnvConfig(process.cwd());

const { values } = parseArgs({
  options: {
    file: { type: "string" },
  },
});

const apiKey = process.env.YANDEX_API_KEY?.trim();
const folderId = process.env.YANDEX_FOLDER_ID?.trim();
const sttBase = (
  process.env.YANDEX_SPEECHKIT_BASE_URL?.trim() || "https://stt.api.cloud.yandex.net"
).replace(/\/$/, "");
const operationBase = (
  process.env.YANDEX_OPERATION_BASE_URL?.trim() ||
  "https://operation.api.cloud.yandex.net"
).replace(/\/$/, "");
const model = process.env.YANDEX_SPEECHKIT_MODEL?.trim() || "general:rc";
const language = process.env.YANDEX_SPEECHKIT_LANGUAGE?.trim() || "ru-RU";
const textNormalizationEnabled =
  (process.env.YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED?.trim().toLowerCase() || "true") !==
  "false";
const literatureText =
  (process.env.YANDEX_SPEECHKIT_LITERATURE_TEXT?.trim().toLowerCase() || "true") !== "false";
const profanityFilter =
  (process.env.YANDEX_SPEECHKIT_PROFANITY_FILTER?.trim().toLowerCase() || "false") === "true";
const phoneFormatting =
  (process.env.YANDEX_SPEECHKIT_PHONE_FORMATTING?.trim().toLowerCase() || "false") === "true";
const speakerLabelingEnabled =
  (process.env.YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING?.trim().toLowerCase() || "true") !==
  "false";
const containerType = (
  process.env.YANDEX_SPEECHKIT_AUDIO_CONTAINER?.trim().toUpperCase() || "MP3"
) as "MP3" | "WAV" | "OGG_OPUS";

if (!apiKey) throw new Error("YANDEX_API_KEY is missing");
if (!folderId) throw new Error("YANDEX_FOLDER_ID is missing");
const safeFolderId = folderId;

if (!values.file) {
  throw new Error("Pass --file /absolute/path/to/audio.mp3");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { response, text, json };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const audio = await readFile(values.file as string);
  const headers = {
    Authorization: `Api-Key ${apiKey}`,
    "Content-Type": "application/json",
    "x-folder-id": safeFolderId,
    "x-data-logging-enabled": "false",
  };

  console.log("Yandex SpeechKit smoke test");
  console.log(`Audio bytes: ${audio.length}`);
  console.log(`Model: ${model}`);
  console.log(`Language: ${language}`);
  console.log(`Container: ${containerType}`);
  console.log(`Text normalization: ${textNormalizationEnabled}`);
  console.log(`Literature text: ${literatureText}`);
  console.log(`Speaker labeling: ${speakerLabelingEnabled}`);

  const submit = await fetchJsonWithTimeout(
    `${sttBase}/stt/v3/recognizeFileAsync`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        content: audio.toString("base64"),
        recognition_model: {
          model,
          audio_format: {
            container_audio: {
              container_audio_type: containerType,
            },
          },
          text_normalization: {
            text_normalization: textNormalizationEnabled
              ? "TEXT_NORMALIZATION_ENABLED"
              : "TEXT_NORMALIZATION_DISABLED",
            literature_text: literatureText,
            profanity_filter: profanityFilter,
            phone_formatting_mode: phoneFormatting
              ? "PHONE_FORMATTING_MODE_ENABLED"
              : "PHONE_FORMATTING_MODE_DISABLED",
          },
          language_restriction: {
            restriction_type: "WHITELIST",
            language_code: [language],
          },
        },
        speaker_labeling: {
          speaker_labeling: speakerLabelingEnabled
            ? "SPEAKER_LABELING_ENABLED"
            : "SPEAKER_LABELING_DISABLED",
        },
      }),
    },
    180_000,
  );

  if (!submit.response.ok || !submit.json?.id) {
    console.log(submit.text);
    throw new Error(`Submit failed: HTTP ${submit.response.status}`);
  }

  const operationId = String(submit.json.id);
  console.log(`Operation id: ${operationId}`);

  const started = Date.now();
  while (Date.now() - started < 10 * 60_000) {
    const poll = await fetchJsonWithTimeout(
      `${operationBase}/operations/${operationId}`,
      { method: "GET", headers },
      120_000,
    );
    if (!poll.response.ok) {
      console.log(poll.text);
      throw new Error(`Polling failed: HTTP ${poll.response.status}`);
    }

    if (poll.json?.done) {
      if (
        poll.json.error &&
        typeof poll.json.error === "object" &&
        "message" in poll.json.error
      ) {
        throw new Error(
          `Recognition failed: ${String((poll.json.error as Record<string, unknown>).message)}`,
        );
      }
      break;
    }

    console.log("Polling...");
    await delay(2_000);
  }

  const result = await fetchJsonWithTimeout(
    `${sttBase}/stt/v3/getRecognition?operation_id=${encodeURIComponent(operationId)}`,
    { method: "GET", headers },
    120_000,
  );
  if (!result.response.ok) {
    console.log(result.text);
    throw new Error(`GetRecognition failed: HTTP ${result.response.status}`);
  }

  const responses = Array.isArray(result.json?.result)
    ? result.json.result
    : Array.isArray(result.json?.streaming_responses)
      ? result.json.streaming_responses
      : Array.isArray((result.json?.result as Record<string, unknown>)?.streaming_responses)
        ? ((result.json?.result as Record<string, unknown>).streaming_responses as unknown[])
        : [];

  const text = responses
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const final = (entry as Record<string, unknown>).final as Record<string, unknown> | undefined;
      if (!final || !Array.isArray(final.alternatives)) return "";
      return final.alternatives
        .map((alt) =>
          alt && typeof alt === "object" && typeof (alt as Record<string, unknown>).text === "string"
            ? String((alt as Record<string, unknown>).text)
            : "",
        )
        .join(" ");
    })
    .filter(Boolean)
    .join(" ")
    .trim();

  console.log("Recognized text preview:");
  console.log(text.slice(0, 500) || "(empty)");
}

main().catch((error) => {
  if (error instanceof Error && error.name === "AbortError") {
    console.error("Yandex API network timeout. Check VPN split tunneling.");
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
