import {
  getYandexTranscriptEnhancementMaxOutputTokens,
  getYandexTranscriptEnhancementModel,
} from "@/lib/env";

const REQUEST_TIMEOUT_MS = 120_000;
const RESPONSE_POLL_INTERVAL_MS = 1_500;
const RESPONSE_POLL_TIMEOUT_MS = 90_000;

export type TranscriptEnhancementInputSegment = {
  index: number;
  speakerLabel: string;
  startMs: number | null;
  endMs: number | null;
  originalText: string;
};

type TranscriptEnhancementRawSegment = {
  index: number;
  speakerLabel: string;
  startMs: number | null;
  endMs: number | null;
  originalText: string;
  cleanedText: string;
  confidence: "high" | "medium" | "low";
  changes: string[];
};

export type TranscriptEnhancementResult = {
  segments: TranscriptEnhancementRawSegment[];
  globalWarnings: string[];
  meta?: {
    model: string;
    maxOutputTokens: number;
    elapsedMs: number;
    estimatedDurationMs: number | null;
    inputChars: number;
  };
};

function getYandexAiBaseUrl(): string {
  return (process.env.YANDEX_AI_BASE_URL?.trim() || "https://ai.api.cloud.yandex.net/v1").replace(
    /\/$/,
    "",
  );
}

function extractYandexOutputText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  const output = payload.output;
  const outputItems = Array.isArray(output) ? output : output ? [output] : [];
  const chunks: string[] = [];

  for (const item of outputItems) {
    if (!item || typeof item !== "object") continue;
    const itemRecord = item as Record<string, unknown>;
    const content = itemRecord.content;
    const contentItems = Array.isArray(content) ? content : content ? [content] : [];

    for (const part of contentItems) {
      if (!part || typeof part !== "object") continue;
      const partRecord = part as Record<string, unknown>;
      const text = partRecord.text;
      if (typeof text === "string" && text.trim()) {
        chunks.push(text);
      }
    }
  }

  if (chunks.length > 0) {
    return chunks.join("\n").trim();
  }

  const result = payload.result;
  if (result && typeof result === "object") {
    const nested = extractYandexOutputText(result as Record<string, unknown>);
    if (nested) return nested;
  }

  return "";
}

function toNullableMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.round(parsed));
    }
  }
  return null;
}

function normalizeConfidence(value: unknown): "high" | "medium" | "low" {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "low";
}

function extractJsonCandidates(text: string): string[] {
  const normalized = text.trim();
  const candidates: string[] = [];
  if (normalized) {
    candidates.push(normalized);
  }

  const fencedRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  while ((match = fencedRegex.exec(text)) !== null) {
    const block = match[1]?.trim();
    if (block) {
      candidates.push(block);
    }
  }

  const firstObjectStart = normalized.indexOf("{");
  const lastObjectEnd = normalized.lastIndexOf("}");
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    const objectSlice = normalized.slice(firstObjectStart, lastObjectEnd + 1).trim();
    if (objectSlice) {
      candidates.push(objectSlice);
    }
  }

  return Array.from(new Set(candidates));
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseEnhancementPayload(text: string): TranscriptEnhancementResult | null {
  const candidates = extractJsonCandidates(text);
  if (candidates.length === 0) {
    return null;
  }

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const parsedRecord = Array.isArray(parsed)
      ? ({ segments: parsed } as Record<string, unknown>)
      : (parsed as Record<string, unknown>);
    const record =
      parsedRecord.result && typeof parsedRecord.result === "object"
        ? (parsedRecord.result as Record<string, unknown>)
        : parsedRecord;
    if (!Array.isArray(record.segments)) {
      continue;
    }

    const rawSegments: TranscriptEnhancementRawSegment[] = [];
    let candidateValid = true;
    for (let i = 0; i < record.segments.length; i += 1) {
      const entry = record.segments[i];
      if (!entry || typeof entry !== "object") {
        candidateValid = false;
        break;
      }
      const segment = entry as Record<string, unknown>;
      const indexValue = toNumberOrNull(segment.index) ?? toNumberOrNull(segment.idx) ?? i;
      const cleanedTextValue =
        (typeof segment.cleanedText === "string" ? segment.cleanedText : null) ??
        (typeof segment.cleaned_text === "string" ? segment.cleaned_text : null) ??
        (typeof segment.text === "string" ? segment.text : null);
      if (cleanedTextValue === null) {
        candidateValid = false;
        break;
      }

      rawSegments.push({
        index: Math.max(0, Math.round(indexValue)),
        speakerLabel:
          typeof segment.speakerLabel === "string" && segment.speakerLabel.trim()
            ? segment.speakerLabel.trim()
            : typeof segment.speaker === "string" && segment.speaker.trim()
              ? segment.speaker.trim()
              : "Speaker",
        startMs: toNullableMs(segment.startMs),
        endMs: toNullableMs(segment.endMs),
        originalText:
          typeof segment.originalText === "string"
            ? segment.originalText
            : typeof segment.original_text === "string"
              ? segment.original_text
              : "",
        cleanedText: cleanedTextValue.trim(),
        confidence: normalizeConfidence(segment.confidence),
        changes: Array.isArray(segment.changes)
          ? segment.changes.filter((item): item is string => typeof item === "string")
          : [],
      });
    }

    if (!candidateValid) {
      continue;
    }

    return {
      segments: rawSegments,
      globalWarnings: Array.isArray(record.globalWarnings)
        ? record.globalWarnings.filter((item): item is string => typeof item === "string")
        : [],
    };
  }

  return null;
}

function buildPrompt(
  segments: TranscriptEnhancementInputSegment[],
  strictJsonMode = false,
): string {
  return [
    "You are cleaning an automatic Russian speech recognition transcript for a negotiation training app. Correct only obvious ASR errors, punctuation, casing, duplicated words and broken word boundaries. Preserve the exact meaning, tone, speaker labels, order and timestamps. Do not summarize. Do not add new content. Do not censor rude language unless it is clearly an ASR artifact. If uncertain, keep the original wording. Return strict valid JSON only.",
    strictJsonMode
      ? "Output MUST be a single JSON object only. Do not use markdown, code fences, explanations, prefixes, suffixes, or comments."
      : "",
    "",
    "Return JSON in this exact shape:",
    "{",
    '  "segments": [',
    "    {",
    '      "index": 0,',
    '      "speakerLabel": "Speaker 1",',
    '      "startMs": 0,',
    '      "endMs": 1200,',
    '      "originalText": "...",',
    '      "cleanedText": "...",',
    '      "confidence": "high|medium|low",',
    '      "changes": ["punctuation", "obvious_asr_fix"]',
    "    }",
    "  ],",
    '  "globalWarnings": []',
    "}",
    "",
    "Input segments JSON:",
    JSON.stringify({ segments }),
  ].join("\n");
}

function estimateDialogDurationMs(
  segments: TranscriptEnhancementInputSegment[],
): number | null {
  const starts = segments
    .map((segment) => segment.startMs)
    .filter((value): value is number => typeof value === "number");
  const ends = segments
    .map((segment) => segment.endMs)
    .filter((value): value is number => typeof value === "number");
  if (starts.length === 0 || ends.length === 0) return null;
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...ends);
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) {
    return null;
  }
  return maxEnd - minStart;
}

function resolveDynamicMaxOutputTokens(
  segments: TranscriptEnhancementInputSegment[],
): { maxOutputTokens: number; estimatedDurationMs: number | null; inputChars: number } {
  const maxFromEnv = getYandexTranscriptEnhancementMaxOutputTokens();
  const inputChars = segments.reduce((sum, segment) => sum + segment.originalText.length, 0);
  const estimatedDurationMs = estimateDialogDurationMs(segments);

  let dynamicLimit = 0;
  if (estimatedDurationMs !== null) {
    const minutes = estimatedDurationMs / 60000;
    dynamicLimit = Math.round(500 + minutes * 900);
  } else {
    dynamicLimit = Math.round(400 + inputChars * 0.35);
  }

  const bounded = Math.max(1200, Math.min(maxFromEnv, dynamicLimit));
  return { maxOutputTokens: bounded, estimatedDurationMs, inputChars };
}

async function pollResponseUntilOutput(
  baseUrl: string,
  responseId: string,
  headers: HeadersInit,
): Promise<Record<string, unknown> | null> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < RESPONSE_POLL_TIMEOUT_MS) {
    const response = await fetch(`${baseUrl}/responses/${encodeURIComponent(responseId)}`, {
      method: "GET",
      headers,
    });
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = null;
    }
    if (!payload) {
      return null;
    }

    const outputText = extractYandexOutputText(payload);
    if (outputText) {
      return payload;
    }

    const status = payload.status;
    if (status === "failed" || status === "cancelled" || status === "incomplete") {
      return payload;
    }

    await new Promise((resolve) => setTimeout(resolve, RESPONSE_POLL_INTERVAL_MS));
  }

  return null;
}

export async function enhanceTranscriptWithYandexAi(
  segments: TranscriptEnhancementInputSegment[],
): Promise<TranscriptEnhancementResult> {
  if (segments.length === 0) {
    return { segments: [], globalWarnings: [] };
  }

  const apiKeyFromEnv = process.env.YANDEX_API_KEY?.trim();
  const folderIdFromEnv = process.env.YANDEX_FOLDER_ID?.trim();
  if (!apiKeyFromEnv || !folderIdFromEnv) {
    throw new Error("Yandex transcript enhancement configuration is missing.");
  }
  const apiKey = apiKeyFromEnv;
  const folderId = folderIdFromEnv;

  const modelName = getYandexTranscriptEnhancementModel();
  const maxTokensFromEnv = getYandexTranscriptEnhancementMaxOutputTokens();
  const { maxOutputTokens, estimatedDurationMs, inputChars } =
    resolveDynamicMaxOutputTokens(segments);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const baseUrl = getYandexAiBaseUrl();
  const startedAt = Date.now();

  async function requestEnhancement(options: {
    maxTokens: number;
    strictJsonMode?: boolean;
  }): Promise<{
    envelope: Record<string, unknown>;
    outputText: string;
    tokensUsed: number;
  }> {
    const { maxTokens, strictJsonMode = false } = options;
    const response = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "Content-Type": "application/json",
        "x-folder-id": folderId,
        "x-data-logging-enabled": "false",
      },
      body: JSON.stringify({
        model: `gpt://${folderId}/${modelName}`,
        temperature: 0,
        max_output_tokens: maxTokens,
        instructions:
          strictJsonMode
            ? "Return ONLY a valid JSON object with keys segments and globalWarnings. Keep segment order, labels and timestamps unchanged."
            : "Return strict JSON only. Keep segment order, labels and timestamps unchanged.",
        input: buildPrompt(segments, strictJsonMode),
      }),
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(
        `Yandex transcript enhancement failed with HTTP ${response.status}: ${rawText.slice(0, 240)}`,
      );
    }

    let envelope: Record<string, unknown>;
    try {
      envelope = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      throw new Error("Yandex transcript enhancement returned non-JSON envelope.");
    }

    let outputText = extractYandexOutputText(envelope);
    if (!outputText) {
      const responseId =
        typeof envelope.id === "string" && envelope.id.trim() ? envelope.id.trim() : null;
      if (responseId) {
        const polled = await pollResponseUntilOutput(baseUrl, responseId, {
          Authorization: `Api-Key ${apiKey}`,
          "Content-Type": "application/json",
          "x-folder-id": folderId,
          "x-data-logging-enabled": "false",
        });
        if (polled) {
          envelope = polled;
          outputText = extractYandexOutputText(envelope);
        }
      }
    }

    return { envelope, outputText, tokensUsed: maxTokens };
  }

  try {
    let { envelope, outputText, tokensUsed } = await requestEnhancement({
      maxTokens: maxOutputTokens,
    });

    if (!outputText) {
      for (let attempt = 0; attempt < 2 && !outputText; attempt += 1) {
        const retryTokens = Math.max(1600, Math.min(maxTokensFromEnv, tokensUsed * 2));
        if (retryTokens <= tokensUsed) {
          break;
        }
        const retryResult = await requestEnhancement({ maxTokens: retryTokens });
        envelope = retryResult.envelope;
        outputText = retryResult.outputText;
        tokensUsed = retryResult.tokensUsed;
      }
      if (!outputText) {
        throw new Error(
          `Yandex transcript enhancement returned empty model output (status=${String(envelope.status ?? "unknown")}).`,
        );
      }
    }

    let parsed = parseEnhancementPayload(outputText);
    if (!parsed) {
      for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
        const strictRetryTokens = Math.max(
          1600,
          Math.min(maxTokensFromEnv, tokensUsed * 2),
        );
        if (strictRetryTokens <= tokensUsed && attempt > 0) {
          break;
        }
        const strictRetry = await requestEnhancement({
          maxTokens: strictRetryTokens,
          strictJsonMode: true,
        });
        envelope = strictRetry.envelope;
        outputText = strictRetry.outputText;
        tokensUsed = strictRetry.tokensUsed;
        parsed = parseEnhancementPayload(outputText);
      }
      if (!parsed) {
        throw new Error("Yandex transcript enhancement returned invalid JSON payload.");
      }
    }

    return {
      ...parsed,
      meta: {
        model: modelName,
        maxOutputTokens: tokensUsed,
        elapsedMs: Date.now() - startedAt,
        estimatedDurationMs,
        inputChars,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Yandex transcript enhancement timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
