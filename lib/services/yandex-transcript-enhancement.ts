import {
  getTranscriptEnhancementChunkMaxChars,
  getTranscriptEnhancementChunkMaxSegments,
  getTranscriptEnhancementOutputMode,
  getTranscriptEnhancementChunkTimeoutMs,
  getTranscriptEnhancementMaxConcurrency,
  getTranscriptEnhancementMode,
  getYandexTranscriptEnhancementFallbackModel,
  getYandexTranscriptEnhancementMaxOutputTokens,
  getYandexTranscriptEnhancementModel,
  type TranscriptEnhancementMode,
  type TranscriptEnhancementOutputMode,
} from "@/lib/env";

const SINGLE_REQUEST_TIMEOUT_MS = 120_000;
const RESPONSE_POLL_INTERVAL_MS = 1_500;
const RESPONSE_POLL_TIMEOUT_MS = 90_000;
const CHUNK_CONTEXT_NEIGHBORS = 1;
const CATASTROPHIC_SHRINK_MIN_SOURCE_CHARS = 40;
const CATASTROPHIC_SHRINK_RATIO = 0.35;
const CATASTROPHIC_SHRINK_MIN_REMOVED_CHARS = 30;
const EMPTY_OUTPUT_MAX_ATTEMPTS_PER_CHUNK = 3;
const TRANSCRIPT_ENHANCEMENT_SCHEMA_NAME = "transcript_enhancement_segments";
const TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION = "v1";

export type TranscriptEnhancementEmptyOutputStage =
  | "initial_response"
  | "polling"
  | "extraction"
  | "parsing"
  | "validation";

type OutputFieldDetected =
  | "output_text"
  | "output.content.text"
  | "output.text"
  | "response.output_text"
  | "result.output_text"
  | "result"
  | "none";

type RequestOutputDiagnostics = {
  responseIdPresent: boolean;
  initialStatus: string | null;
  finalStatus: string | null;
  pollingAttemptCount: number;
  pollingElapsedMs: number;
  outputFieldDetected: OutputFieldDetected;
  rawOutputCharCount: number;
  emptyOutputStage: TranscriptEnhancementEmptyOutputStage | null;
  providerStatus: string | null;
  incompleteReason: string | null;
  schemaAccepted: boolean | null;
  model: string;
  maxOutputTokens: number;
};

export type TranscriptEnhancementInputSegment = {
  index: number;
  speakerLabel: string;
  startMs: number | null;
  endMs: number | null;
  originalText: string;
  segmentId?: string | null;
  mappedParticipantId?: string | null;
};

export type TranscriptEnhancementRawSegment = {
  index: number;
  cleanedText: string;
  changed?: boolean;
  changeCategory?: string | null;
};

export type TranscriptEnhancementOverallStatus =
  | "COMPLETED"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED";

export type TranscriptEnhancementChunkMetadata = {
  chunkIndex: number;
  targetSegmentCount: number;
  targetSegmentStartIndex: number;
  targetSegmentEndIndex: number;
  inputChars: number;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
  status: "COMPLETED" | "FAILED_FALLBACK";
  retryCount: number;
  errorCategory: string | null;
  primaryModel?: string;
  fallbackModel?: string | null;
  modelUsed?: string;
  fallbackTriggered?: boolean;
  fallbackReason?: string | null;
  attemptCount?: number;
  attempts?: Array<{
    attemptNumber: number;
    attemptType: "primary_initial" | "primary_strict_retry" | "fallback_model_retry";
    modelUsed: string;
    maxOutputTokens: number;
    responseIdPresent: boolean;
    initialStatus: string | null;
    finalStatus: string | null;
    pollingAttemptCount: number;
    pollingElapsedMs: number;
    outputFieldDetected: OutputFieldDetected;
    rawOutputCharCount: number;
    parsedSegmentCount: number;
    outputMode?: TranscriptEnhancementOutputMode;
    providerStatus?: string | null;
    incompleteReason?: string | null;
    schemaValidationPassed?: boolean;
    schemaAccepted?: boolean | null;
    schemaName?: string | null;
    schemaVersion?: string | null;
    failureStage?: "provider" | "extraction" | "parsing" | "schema_validation" | "integrity_validation";
    emptyOutputStage: TranscriptEnhancementEmptyOutputStage | null;
    status: "COMPLETED" | "FAILED";
    errorCategory: string | null;
  }>;
  outputMode?: TranscriptEnhancementOutputMode;
  schemaName?: string | null;
  schemaVersion?: string | null;
  expectedSchemaKeyCount?: number;
  returnedSchemaKeyCount?: number;
  schemaAccepted?: boolean | null;
  schemaValidationPassed?: boolean;
  missingKeyCount?: number;
  extraKeyCount?: number;
  emptyValueCount?: number;
};

export type TranscriptEnhancementMeta = {
  mode: TranscriptEnhancementMode;
  model: string;
  overallStatus: TranscriptEnhancementOverallStatus;
  startedAt: string;
  finishedAt: string;
  totalLatencyMs: number;
  originalSegmentCount: number;
  originalCharacterCount: number;
  chunkCount: number;
  concurrency: number;
  successfulChunkCount: number;
  failedChunkCount: number;
  fallbackSegmentCount: number;
  changedSegmentCount: number;
  unchangedSegmentCount: number;
  retryCount: number;
  perChunk: TranscriptEnhancementChunkMetadata[];
  originalWordCount: number;
  enhancedWordCount: number;
  addedWordEstimate: number;
  removedWordEstimate: number;
  maxOutputTokens?: number;
  estimatedDurationMs?: number | null;
  inputChars?: number;
  primaryModel?: string;
  fallbackModel?: string | null;
  fallbackTriggered?: boolean;
  fallbackReason?: string | null;
  outputMode?: TranscriptEnhancementOutputMode;
  structuredOutputEnabled?: boolean;
  schemaVersion?: string | null;
  schemaChunkCount?: number;
};

export type TranscriptEnhancementResult = {
  segments: TranscriptEnhancementRawSegment[];
  globalWarnings: string[];
  meta?: TranscriptEnhancementMeta;
};

type ParsedEnhancementPayload = {
  segments: TranscriptEnhancementRawSegment[];
  globalWarnings: string[];
};

type ParsedSchemaEnhancementPayload = {
  segments: Record<string, string>;
};

type TranscriptEnhancementResponseSchema = {
  type: "object";
  additionalProperties: false;
  required: ["segments"];
  properties: {
    segments: {
      type: "object";
      additionalProperties: false;
      required: string[];
      properties: Record<string, { type: "string"; minLength: 1 }>;
    };
  };
};

type EnhancementChunk = {
  chunkIndex: number;
  targets: TranscriptEnhancementInputSegment[];
  contextBefore: TranscriptEnhancementInputSegment[];
  contextAfter: TranscriptEnhancementInputSegment[];
  inputChars: number;
};

type ChunkExecutionResult = {
  chunkIndex: number;
  enhancedByIndex: Map<number, string>;
  retryCount: number;
  modelUsed: string;
  fallbackTriggered: boolean;
  fallbackReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  latencyMs: number | null;
  status: "COMPLETED" | "FAILED_FALLBACK";
  errorCategory: string | null;
  warnings: string[];
  primaryModel: string;
  fallbackModel: string | null;
  attempts: TranscriptEnhancementChunkMetadata["attempts"];
  outputMode?: TranscriptEnhancementOutputMode;
  schemaName?: string | null;
  schemaVersion?: string | null;
  expectedSchemaKeyCount?: number;
  returnedSchemaKeyCount?: number;
  schemaAccepted?: boolean | null;
  schemaValidationPassed?: boolean;
  missingKeyCount?: number;
  extraKeyCount?: number;
  emptyValueCount?: number;
};

class ChunkValidationError extends Error {
  readonly category: string;

  constructor(message: string, category: string) {
    super(message);
    this.category = category;
  }
}

function getYandexAiBaseUrl(): string {
  return (process.env.YANDEX_AI_BASE_URL?.trim() || "https://ai.api.cloud.yandex.net/v1").replace(
    /\/$/,
    "",
  );
}

function getWordCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return normalized.split(/\s+/u).length;
}

function getSegmentsText(segments: TranscriptEnhancementInputSegment[]): string {
  return segments
    .map((segment) => segment.originalText.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function extractYandexOutput(payload: Record<string, unknown>, depth = 0): {
  text: string;
  outputFieldDetected: OutputFieldDetected;
  rawOutputCharCount: number;
} {
  if (depth > 4) {
    return { text: "", outputFieldDetected: "none", rawOutputCharCount: 0 };
  }

  const directOutputText = payload.output_text;
  if (typeof directOutputText === "string") {
    return {
      text: directOutputText.trim(),
      outputFieldDetected: "output_text",
      rawOutputCharCount: directOutputText.length,
    };
  }

  const output = payload.output;
  const outputItems = Array.isArray(output) ? output : output ? [output] : [];
  const chunks: string[] = [];
  let outputFieldDetected: OutputFieldDetected = "none";
  let rawOutputCharCount = 0;

  for (const item of outputItems) {
    const itemRecord = toRecord(item);
    if (!itemRecord) continue;

    if (typeof itemRecord.text === "string") {
      outputFieldDetected = "output.text";
      rawOutputCharCount += itemRecord.text.length;
      if (itemRecord.text.trim()) chunks.push(itemRecord.text.trim());
    }

    const content = itemRecord.content;
    const contentItems = Array.isArray(content) ? content : content ? [content] : [];
    for (const part of contentItems) {
      const partRecord = toRecord(part);
      if (!partRecord) continue;
      const partText =
        typeof partRecord.text === "string"
          ? partRecord.text
          : typeof partRecord.output_text === "string"
            ? partRecord.output_text
            : typeof toRecord(partRecord.output_text)?.text === "string"
              ? String(toRecord(partRecord.output_text)?.text)
              : "";
      if (partText) {
        outputFieldDetected = "output.content.text";
        rawOutputCharCount += partText.length;
        if (partText.trim()) chunks.push(partText.trim());
      }
    }
  }

  if (chunks.length > 0 || outputFieldDetected !== "none") {
    return {
      text: chunks.join("\n").trim(),
      outputFieldDetected,
      rawOutputCharCount,
    };
  }

  const responseRecord = toRecord(payload.response);
  if (responseRecord) {
    const nested = extractYandexOutput(responseRecord, depth + 1);
    if (nested.outputFieldDetected !== "none" || nested.text) {
      return {
        text: nested.text,
        outputFieldDetected:
          nested.outputFieldDetected === "none"
            ? "response.output_text"
            : nested.outputFieldDetected,
        rawOutputCharCount: nested.rawOutputCharCount,
      };
    }
  }

  const resultRecord = toRecord(payload.result);
  if (resultRecord) {
    const nested = extractYandexOutput(resultRecord, depth + 1);
    if (nested.outputFieldDetected !== "none" || nested.text) {
      return {
        text: nested.text,
        outputFieldDetected:
          nested.outputFieldDetected === "none" ? "result.output_text" : nested.outputFieldDetected,
        rawOutputCharCount: nested.rawOutputCharCount,
      };
    }
    return {
      text: "",
      outputFieldDetected: "result",
      rawOutputCharCount: 0,
    };
  }

  return {
    text: "",
    outputFieldDetected: "none",
    rawOutputCharCount: 0,
  };
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
    if (block) candidates.push(block);
  }

  const firstObjectStart = normalized.indexOf("{");
  const lastObjectEnd = normalized.lastIndexOf("}");
  if (firstObjectStart >= 0 && lastObjectEnd > firstObjectStart) {
    const objectSlice = normalized.slice(firstObjectStart, lastObjectEnd + 1).trim();
    if (objectSlice) candidates.push(objectSlice);
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

function parseEnhancementPayload(text: string): ParsedEnhancementPayload | null {
  const candidates = extractJsonCandidates(text);
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") continue;
    const parsedRecord = Array.isArray(parsed)
      ? ({ segments: parsed } as Record<string, unknown>)
      : (parsed as Record<string, unknown>);
    const record =
      parsedRecord.result && typeof parsedRecord.result === "object"
        ? (parsedRecord.result as Record<string, unknown>)
        : parsedRecord;
    if (!Array.isArray(record.segments)) continue;

    const segments: TranscriptEnhancementRawSegment[] = [];
    let valid = true;
    for (let i = 0; i < record.segments.length; i += 1) {
      const segmentRaw = record.segments[i];
      if (!segmentRaw || typeof segmentRaw !== "object") {
        valid = false;
        break;
      }
      const segment = segmentRaw as Record<string, unknown>;
      const index = toNumberOrNull(segment.index) ?? toNumberOrNull(segment.idx) ?? i;
      const cleanedText =
        (typeof segment.cleanedText === "string" ? segment.cleanedText : null) ??
        (typeof segment.cleaned_text === "string" ? segment.cleaned_text : null) ??
        (typeof segment.text === "string" ? segment.text : null);
      if (cleanedText === null) {
        valid = false;
        break;
      }
      const category =
        typeof segment.changeCategory === "string"
          ? segment.changeCategory
          : typeof segment.change_category === "string"
            ? segment.change_category
            : null;
      const changedValue =
        typeof segment.changed === "boolean"
          ? segment.changed
          : typeof segment.isChanged === "boolean"
            ? segment.isChanged
            : undefined;
      segments.push({
        index: Math.max(0, Math.round(index)),
        cleanedText: cleanedText.trim(),
        changed: changedValue,
        changeCategory: category,
      });
    }
    if (!valid) continue;

    return {
      segments,
      globalWarnings: Array.isArray(record.globalWarnings)
        ? record.globalWarnings.filter((item): item is string => typeof item === "string")
        : [],
    };
  }

  return null;
}

function estimateDialogDurationMs(segments: TranscriptEnhancementInputSegment[]): number | null {
  const starts = segments
    .map((segment) => segment.startMs)
    .filter((value): value is number => typeof value === "number");
  const ends = segments
    .map((segment) => segment.endMs)
    .filter((value): value is number => typeof value === "number");
  if (starts.length === 0 || ends.length === 0) return null;
  const minStart = Math.min(...starts);
  const maxEnd = Math.max(...ends);
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd) || maxEnd <= minStart) return null;
  return maxEnd - minStart;
}

function resolveDynamicMaxOutputTokens(segments: TranscriptEnhancementInputSegment[]): {
  maxOutputTokens: number;
  estimatedDurationMs: number | null;
  inputChars: number;
} {
  const maxFromEnv = getYandexTranscriptEnhancementMaxOutputTokens();
  const inputChars = segments.reduce((sum, segment) => sum + segment.originalText.length, 0);
  const estimatedDurationMs = estimateDialogDurationMs(segments);
  const dynamicLimit =
    estimatedDurationMs !== null
      ? Math.round(500 + (estimatedDurationMs / 60000) * 900)
      : Math.round(400 + inputChars * 0.35);
  const bounded = Math.max(1200, Math.min(maxFromEnv, dynamicLimit));
  return { maxOutputTokens: bounded, estimatedDurationMs, inputChars };
}

function buildSinglePrompt(segments: TranscriptEnhancementInputSegment[], strictJsonMode = false): string {
  return [
    "You are cleaning an automatic Russian speech recognition transcript for a negotiation training app.",
    "Allowed edits: punctuation, capitalization, grammar, obvious morphology and highly probable ASR corrections.",
    "Do not add facts, do not invent missing speech, do not merge speakers, do not move words between speakers.",
    "Do not delete uncertain words. Preserve uncertain wording rather than guessing.",
    "Do not change timestamps, speaker identity, or segment ordering.",
    strictJsonMode
      ? "Output MUST be one JSON object only. No markdown, no code fences, no commentary."
      : "",
    "",
    "Return JSON in this shape:",
    "{",
    '  "segments": [',
    '    { "index": 0, "cleanedText": "...", "changed": true, "changeCategory": "punctuation" }',
    "  ],",
    '  "globalWarnings": []',
    "}",
    "",
    "Input segments JSON:",
    JSON.stringify({ segments }),
  ].join("\n");
}

function buildChunkPrompt(chunk: EnhancementChunk, strictJsonMode = false): string {
  return [
    "You are cleaning automatic Russian ASR transcript segments for negotiation training.",
    "Editable target segments are provided separately from read-only context.",
    "Allowed edits: punctuation, capitalization, grammar, obvious morphology, and only highly probable ASR corrections.",
    "Forbidden: inventing missing dialogue, adding new facts, merging speakers, changing speaker identity, moving words between speakers, deleting uncertain text, changing timestamps/order.",
    "Preserve semantic meaning and preserve uncertain wording rather than guessing.",
    "Do not transform severe acoustic uncertainty into fluent invented text.",
    "Return edits ONLY for target segment indexes listed in targetSegments.",
    "Never return context segment indexes.",
    strictJsonMode
      ? "Output MUST be one JSON object only. No markdown, no code fences, no commentary."
      : "",
    "",
    "Return JSON in this shape:",
    "{",
    '  "segments": [',
    '    { "index": 12, "cleanedText": "...", "changed": true, "changeCategory": "punctuation" }',
    "  ],",
    '  "globalWarnings": []',
    "}",
    "",
    "Input JSON:",
    JSON.stringify({
      readOnlyContextBefore: chunk.contextBefore.map((segment) => ({
        index: segment.index,
        speakerLabel: segment.speakerLabel,
        text: segment.originalText,
      })),
      targetSegments: chunk.targets.map((segment) => ({
        index: segment.index,
        speakerLabel: segment.speakerLabel,
        startMs: segment.startMs,
        endMs: segment.endMs,
        segmentId: segment.segmentId ?? null,
        mappedParticipantId: segment.mappedParticipantId ?? null,
        originalText: segment.originalText,
      })),
      readOnlyContextAfter: chunk.contextAfter.map((segment) => ({
        index: segment.index,
        speakerLabel: segment.speakerLabel,
        text: segment.originalText,
      })),
    }),
  ].join("\n");
}

export function buildChunkSchemaJsonSchema(chunk: EnhancementChunk): TranscriptEnhancementResponseSchema {
  const keys = chunk.targets.map((segment) => String(segment.index));
  type SegmentPropertySchema = {
    type: "string";
    minLength: 1;
  };

  const properties: Record<string, SegmentPropertySchema> =
    Object.fromEntries(
      keys.map(
        (key): [string, SegmentPropertySchema] => [
          key,
          {
            type: "string",
            minLength: 1,
          },
        ],
      ),
    );
  return {
    type: "object",
    additionalProperties: false,
    required: ["segments"],
    properties: {
      segments: {
        type: "object",
        additionalProperties: false,
        required: keys,
        properties,
      },
    },
  };
}

function buildChunkSchemaPrompt(chunk: EnhancementChunk): string {
  return [
    "You are cleaning automatic Russian ASR transcript segments for negotiation training.",
    "Correct obvious ASR mistakes, morphology/grammar, and punctuation while preserving meaning.",
    "Preserve speaker ownership and do not invent facts.",
    "Return one corrected text value for every required segment key.",
    "Editable target segments are below; context segments are read-only.",
    "",
    "Input JSON:",
    JSON.stringify({
      readOnlyContextBefore: chunk.contextBefore.map((segment) => ({
        index: segment.index,
        speakerLabel: segment.speakerLabel,
        text: segment.originalText,
      })),
      targetSegments: chunk.targets.map((segment) => ({
        index: segment.index,
        speakerLabel: segment.speakerLabel,
        startMs: segment.startMs,
        endMs: segment.endMs,
        segmentId: segment.segmentId ?? null,
        mappedParticipantId: segment.mappedParticipantId ?? null,
        originalText: segment.originalText,
      })),
      readOnlyContextAfter: chunk.contextAfter.map((segment) => ({
        index: segment.index,
        speakerLabel: segment.speakerLabel,
        text: segment.originalText,
      })),
    }),
  ].join("\n");
}

function parseSchemaEnhancementPayload(text: string): ParsedSchemaEnhancementPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  if (Object.keys(root).length !== 1 || !("segments" in root)) return null;
  if (!root.segments || typeof root.segments !== "object" || Array.isArray(root.segments)) return null;
  const segments = root.segments as Record<string, unknown>;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(segments)) {
    if (typeof value !== "string") return null;
    normalized[key] = value;
  }
  return { segments: normalized };
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Yandex transcript enhancement timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function pollResponseUntilOutput(
  baseUrl: string,
  responseId: string,
  headers: HeadersInit,
  timeoutMs: number,
): Promise<{
  payload: Record<string, unknown> | null;
  attemptCount: number;
  elapsedMs: number;
  finalStatus: string | null;
  outputFieldDetected: OutputFieldDetected;
  rawOutputCharCount: number;
  hasOutput: boolean;
}> {
  const startedAt = Date.now();
  let attemptCount = 0;
  let finalStatus: string | null = null;
  let outputFieldDetected: OutputFieldDetected = "none";
  let rawOutputCharCount = 0;
  while (Date.now() - startedAt < timeoutMs) {
    attemptCount += 1;
    const { response, text } = await fetchTextWithTimeout(
      `${baseUrl}/responses/${encodeURIComponent(responseId)}`,
      { method: "GET", headers },
      Math.min(20_000, timeoutMs),
    );
    if (!response.ok) {
      return {
        payload: null,
        attemptCount,
        elapsedMs: Date.now() - startedAt,
        finalStatus,
        outputFieldDetected,
        rawOutputCharCount,
        hasOutput: false,
      };
    }
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = null;
    }
    if (!payload) {
      return {
        payload: null,
        attemptCount,
        elapsedMs: Date.now() - startedAt,
        finalStatus,
        outputFieldDetected,
        rawOutputCharCount,
        hasOutput: false,
      };
    }
    const output = extractYandexOutput(payload);
    outputFieldDetected = output.outputFieldDetected;
    rawOutputCharCount = output.rawOutputCharCount;
    if (output.text) {
      return {
        payload,
        attemptCount,
        elapsedMs: Date.now() - startedAt,
        finalStatus: typeof payload.status === "string" ? payload.status : null,
        outputFieldDetected,
        rawOutputCharCount,
        hasOutput: true,
      };
    }
    const status = payload.status;
    finalStatus = typeof status === "string" ? status : null;
    if (status === "failed" || status === "cancelled" || status === "incomplete") {
      return {
        payload,
        attemptCount,
        elapsedMs: Date.now() - startedAt,
        finalStatus,
        outputFieldDetected,
        rawOutputCharCount,
        hasOutput: false,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, RESPONSE_POLL_INTERVAL_MS));
  }
  return {
    payload: null,
    attemptCount,
    elapsedMs: Date.now() - startedAt,
    finalStatus,
    outputFieldDetected,
    rawOutputCharCount,
    hasOutput: false,
  };
}

type RequestEnhancementParams = {
  apiKey: string;
  folderId: string;
  baseUrl: string;
  modelName: string;
  maxTokens: number;
  timeoutMs: number;
  input: TranscriptEnhancementInputSegment[] | EnhancementChunk;
  promptBuilder: (input: TranscriptEnhancementInputSegment[] | EnhancementChunk, strictJsonMode?: boolean) => string;
  strictJsonMode?: boolean;
  outputMode: TranscriptEnhancementOutputMode;
  textFormat?: {
    type: "json_schema";
    name: string;
    strict: true;
    schema: TranscriptEnhancementResponseSchema;
  };
};

async function requestEnhancement(params: RequestEnhancementParams): Promise<{
  envelope: Record<string, unknown>;
  outputText: string;
  tokensUsed: number;
  diagnostics: RequestOutputDiagnostics;
}> {
  const {
    apiKey,
    folderId,
    baseUrl,
    modelName,
    maxTokens,
    timeoutMs,
    input,
    promptBuilder,
    strictJsonMode = false,
    outputMode,
    textFormat,
  } = params;
  const headers: HeadersInit = {
    Authorization: `Api-Key ${apiKey}`,
    "Content-Type": "application/json",
    "x-folder-id": folderId,
    "x-data-logging-enabled": "false",
  };
  const { response, text } = await fetchTextWithTimeout(
    `${baseUrl}/responses`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: `gpt://${folderId}/${modelName}`,
        temperature: 0,
        max_output_tokens: maxTokens,
        instructions:
          outputMode === "json_schema"
            ? "Return valid JSON that satisfies the provided schema."
            : "Return ONLY a valid JSON object with keys segments and globalWarnings.",
        input: promptBuilder(input, strictJsonMode),
        ...(outputMode === "json_schema" && textFormat
          ? {
              text: {
                format: textFormat,
              },
            }
          : {}),
      }),
    },
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(
      `Yandex transcript enhancement failed with HTTP ${response.status}: ${text.slice(0, 240)}`,
    );
  }
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Yandex transcript enhancement returned non-JSON envelope.");
  }
  const initialExtraction = extractYandexOutput(envelope);
  let outputText = initialExtraction.text;
  const responseId =
    typeof envelope.id === "string" && envelope.id.trim() ? envelope.id.trim() : null;
  const initialStatus = typeof envelope.status === "string" ? envelope.status : null;
  let finalStatus = initialStatus;
  let pollingAttemptCount = 0;
  let pollingElapsedMs = 0;
  let outputFieldDetected = initialExtraction.outputFieldDetected;
  let rawOutputCharCount = initialExtraction.rawOutputCharCount;
  let emptyOutputStage: TranscriptEnhancementEmptyOutputStage | null = null;
  const incompleteReasonRaw = toRecord(envelope.incomplete_details)?.reason;
  const initialIncompleteReason =
    typeof incompleteReasonRaw === "string" ? incompleteReasonRaw : null;
  let incompleteReason = initialIncompleteReason;
  const schemaAcceptedValue = toRecord(envelope.text)?.format;
  const schemaAccepted =
    toRecord(schemaAcceptedValue)?.type === "json_schema"
      ? true
      : outputMode === "json_schema"
        ? null
        : null;

  if (!outputText && responseId && outputMode !== "json_schema") {
    const pollingResult = await pollResponseUntilOutput(
      baseUrl,
      responseId,
      headers,
      Math.min(timeoutMs, RESPONSE_POLL_TIMEOUT_MS),
    );
    pollingAttemptCount = pollingResult.attemptCount;
    pollingElapsedMs = pollingResult.elapsedMs;
    finalStatus = pollingResult.finalStatus ?? finalStatus;
    outputFieldDetected = pollingResult.outputFieldDetected;
    rawOutputCharCount = pollingResult.rawOutputCharCount;
    if (pollingResult.payload) {
      envelope = pollingResult.payload;
      const polledIncompleteReasonRaw = toRecord(envelope.incomplete_details)?.reason;
      incompleteReason =
        typeof polledIncompleteReasonRaw === "string" ? polledIncompleteReasonRaw : incompleteReason;
      outputText = extractYandexOutput(envelope).text;
      if (!outputText) {
        emptyOutputStage =
          outputFieldDetected === "none" && pollingResult.finalStatus === null
            ? "polling"
            : "extraction";
      }
    } else {
      emptyOutputStage = "polling";
    }
  } else if (!outputText) {
    emptyOutputStage =
      outputFieldDetected === "none" ? "initial_response" : "extraction";
  }

  if (!outputText && emptyOutputStage === null) {
    emptyOutputStage = outputFieldDetected === "none" ? "initial_response" : "extraction";
  }

  return {
    envelope,
    outputText,
    tokensUsed: maxTokens,
    diagnostics: {
      responseIdPresent: Boolean(responseId),
      initialStatus,
      finalStatus: finalStatus ?? null,
      pollingAttemptCount,
      pollingElapsedMs,
      outputFieldDetected,
      rawOutputCharCount,
      emptyOutputStage,
      providerStatus: finalStatus ?? null,
      incompleteReason,
      schemaAccepted,
      model: modelName,
      maxOutputTokens: maxTokens,
    },
  };
}

function isCatastrophicShrink(originalText: string, cleanedText: string): boolean {
  const originalTrimmed = originalText.trim();
  const cleanedTrimmed = cleanedText.trim();
  if (originalTrimmed.length < CATASTROPHIC_SHRINK_MIN_SOURCE_CHARS) return false;
  if (!cleanedTrimmed) return originalTrimmed.length > 0;
  const ratio = cleanedTrimmed.length / originalTrimmed.length;
  const removedChars = originalTrimmed.length - cleanedTrimmed.length;
  return ratio < CATASTROPHIC_SHRINK_RATIO && removedChars >= CATASTROPHIC_SHRINK_MIN_REMOVED_CHARS;
}

export function buildTranscriptEnhancementChunks(
  segments: TranscriptEnhancementInputSegment[],
  options?: {
    maxSegmentsPerChunk?: number;
    maxCharsPerChunk?: number;
    contextNeighbors?: number;
  },
): EnhancementChunk[] {
  if (segments.length === 0) return [];
  const maxSegmentsPerChunk =
    options?.maxSegmentsPerChunk ?? getTranscriptEnhancementChunkMaxSegments();
  const maxCharsPerChunk = options?.maxCharsPerChunk ?? getTranscriptEnhancementChunkMaxChars();
  const contextNeighbors = options?.contextNeighbors ?? CHUNK_CONTEXT_NEIGHBORS;
  const totalChars = segments.reduce((sum, segment) => sum + segment.originalText.length, 0);
  const desiredChunkCount = Math.max(
    1,
    Math.ceil(segments.length / Math.max(1, maxSegmentsPerChunk)),
    Math.ceil(totalChars / Math.max(1, maxCharsPerChunk)),
  );

  const partitions: TranscriptEnhancementInputSegment[][] = [];
  let cursor = 0;
  for (let chunkIndex = 0; chunkIndex < desiredChunkCount && cursor < segments.length; chunkIndex += 1) {
    const remainingSegments = segments.length - cursor;
    const remainingChunks = desiredChunkCount - chunkIndex;
    const size = Math.ceil(remainingSegments / remainingChunks);
    partitions.push(segments.slice(cursor, cursor + size));
    cursor += size;
  }

  for (let i = 0; i < partitions.length; ) {
    const current = partitions[i];
    const chars = current.reduce((sum, segment) => sum + segment.originalText.length, 0);
    const oversized = current.length > maxSegmentsPerChunk || chars > maxCharsPerChunk;
    if (!oversized || current.length <= 1) {
      i += 1;
      continue;
    }
    const splitPoint = Math.ceil(current.length / 2);
    partitions.splice(i, 1, current.slice(0, splitPoint), current.slice(splitPoint));
  }

  return partitions.map((targets, chunkIndex) => {
    const firstGlobalIndex = segments.findIndex((segment) => segment.index === targets[0]?.index);
    const lastGlobalIndex = firstGlobalIndex + targets.length - 1;
    return {
      chunkIndex,
      targets,
      contextBefore: segments.slice(Math.max(0, firstGlobalIndex - contextNeighbors), firstGlobalIndex),
      contextAfter: segments.slice(lastGlobalIndex + 1, lastGlobalIndex + 1 + contextNeighbors),
      inputChars: targets.reduce((sum, segment) => sum + segment.originalText.length, 0),
    };
  });
}

export function validateChunkEnhancementResponse(params: {
  targets: TranscriptEnhancementInputSegment[];
  parsed: ParsedEnhancementPayload;
}): { enhancedByIndex: Map<number, string>; warnings: string[] } {
  const { targets, parsed } = params;
  const targetByIndex = new Map<number, TranscriptEnhancementInputSegment>();
  for (const target of targets) {
    targetByIndex.set(target.index, target);
  }

  const seen = new Set<number>();
  const enhancedByIndex = new Map<number, string>();
  for (const segment of parsed.segments) {
    if (!targetByIndex.has(segment.index)) {
      throw new ChunkValidationError(
        `Chunk returned unknown segment index ${segment.index}.`,
        "unknown_segment_id",
      );
    }
    if (seen.has(segment.index)) {
      throw new ChunkValidationError(
        `Chunk returned duplicate segment index ${segment.index}.`,
        "duplicate_segment_id",
      );
    }
    seen.add(segment.index);
    const originalText = targetByIndex.get(segment.index)!.originalText;
    const cleanedText = segment.cleanedText.trim();
    if (!cleanedText && originalText.trim()) {
      throw new ChunkValidationError(
        `Chunk returned empty text for non-empty segment ${segment.index}.`,
        "empty_enhanced_text",
      );
    }
    if (isCatastrophicShrink(originalText, cleanedText)) {
      throw new ChunkValidationError(
        `Chunk triggered catastrophic shrink guard for segment ${segment.index}.`,
        "catastrophic_shrinkage",
      );
    }
    enhancedByIndex.set(segment.index, cleanedText || originalText);
  }

  return { enhancedByIndex, warnings: parsed.globalWarnings };
}

export function validateChunkSchemaEnhancementResponse(params: {
  targets: TranscriptEnhancementInputSegment[];
  parsed: ParsedSchemaEnhancementPayload;
}): {
  enhancedByIndex: Map<number, string>;
  missingKeys: string[];
  extraKeys: string[];
  emptyKeys: string[];
} {
  const expectedKeys = params.targets.map((segment) => String(segment.index));
  const expectedSet = new Set(expectedKeys);
  const actualKeys = Object.keys(params.parsed.segments);
  const actualSet = new Set(actualKeys);
  const missingKeys = expectedKeys.filter((key) => !actualSet.has(key));
  const extraKeys = actualKeys.filter((key) => !expectedSet.has(key));
  const emptyKeys: string[] = [];
  const enhancedByIndex = new Map<number, string>();

  for (const key of expectedKeys) {
    const value = params.parsed.segments[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      emptyKeys.push(key);
      continue;
    }
    const index = Number(key);
    if (!Number.isFinite(index)) {
      extraKeys.push(key);
      continue;
    }
    const target = params.targets.find((segment) => segment.index === index);
    if (!target) {
      extraKeys.push(key);
      continue;
    }
    if (isCatastrophicShrink(target.originalText, value.trim())) {
      throw new ChunkValidationError(
        `Chunk triggered catastrophic shrink guard for segment ${index}.`,
        "catastrophic_shrinkage",
      );
    }
    enhancedByIndex.set(index, value.trim());
  }

  return { enhancedByIndex, missingKeys, extraKeys, emptyKeys };
}

function classifyChunkError(error: unknown): { category: string; retryable: boolean } {
  if (error instanceof ChunkValidationError) {
    return { category: error.category, retryable: false };
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timed out") || message.includes("timeout")) {
    return { category: "timeout", retryable: true };
  }
  if (message.includes("network")) {
    return { category: "network", retryable: true };
  }
  if (message.includes("http 429")) {
    return { category: "provider_rate_limit", retryable: true };
  }
  if (message.includes("http 5")) {
    return { category: "provider_http_5xx", retryable: true };
  }
  if (message.includes("non-json envelope")) {
    return { category: "provider_malformed_envelope", retryable: false };
  }
  if (message.includes("invalid json payload")) {
    return { category: "malformed_output", retryable: false };
  }
  if (message.includes("empty model output")) {
    return { category: "empty_output", retryable: false };
  }
  return { category: "request_failed", retryable: false };
}

async function runSingleShotEnhancement(params: {
  segments: TranscriptEnhancementInputSegment[];
  apiKey: string;
  folderId: string;
  modelName: string;
  baseUrl: string;
}): Promise<TranscriptEnhancementResult> {
  const { segments, apiKey, folderId, modelName, baseUrl } = params;
  const outputMode = getTranscriptEnhancementOutputMode();
  const maxTokensFromEnv = getYandexTranscriptEnhancementMaxOutputTokens();
  const { maxOutputTokens, estimatedDurationMs, inputChars } =
    resolveDynamicMaxOutputTokens(segments);
  const startedAt = Date.now();

  let { envelope, outputText, tokensUsed } = await requestEnhancement({
    apiKey,
    folderId,
    baseUrl,
    modelName,
    maxTokens: maxOutputTokens,
    timeoutMs: SINGLE_REQUEST_TIMEOUT_MS,
    input: segments,
    promptBuilder: (input, strictJsonMode) =>
      buildSinglePrompt(input as TranscriptEnhancementInputSegment[], strictJsonMode),
    outputMode,
  });

  if (!outputText) {
    for (let attempt = 0; attempt < 2 && !outputText; attempt += 1) {
      const retryTokens = Math.max(1600, Math.min(maxTokensFromEnv, tokensUsed * 2));
      if (retryTokens <= tokensUsed) break;
      const retryResult = await requestEnhancement({
        apiKey,
        folderId,
        baseUrl,
        modelName,
        maxTokens: retryTokens,
        timeoutMs: SINGLE_REQUEST_TIMEOUT_MS,
        input: segments,
        promptBuilder: (input, strictJsonMode) =>
          buildSinglePrompt(input as TranscriptEnhancementInputSegment[], strictJsonMode),
        outputMode,
      });
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
      const strictRetryTokens = Math.max(1600, Math.min(maxTokensFromEnv, tokensUsed * 2));
      if (strictRetryTokens <= tokensUsed && attempt > 0) break;
      const strictRetry = await requestEnhancement({
        apiKey,
        folderId,
        baseUrl,
        modelName,
        maxTokens: strictRetryTokens,
        timeoutMs: SINGLE_REQUEST_TIMEOUT_MS,
        input: segments,
        promptBuilder: (input, strictJsonMode) =>
          buildSinglePrompt(input as TranscriptEnhancementInputSegment[], strictJsonMode),
        strictJsonMode: true,
        outputMode,
      });
      outputText = strictRetry.outputText;
      tokensUsed = strictRetry.tokensUsed;
      parsed = parseEnhancementPayload(outputText);
    }
    if (!parsed) {
      throw new Error("Yandex transcript enhancement returned invalid JSON payload.");
    }
  }

  const finishedAt = Date.now();
  const parsedByIndex = new Map(parsed.segments.map((segment) => [segment.index, segment]));
  const mergedSegments = segments.map((segment) => {
    const replacement = parsedByIndex.get(segment.index);
    const cleanedText = replacement?.cleanedText?.trim() || segment.originalText;
    return {
      index: segment.index,
      cleanedText,
      changed: cleanedText.trim() !== segment.originalText.trim(),
      changeCategory: replacement?.changeCategory ?? null,
    };
  });
  const changedSegmentCount = mergedSegments.filter((segment) => segment.changed).length;
  const originalText = getSegmentsText(segments);
  const enhancedText = mergedSegments.map((segment) => segment.cleanedText).join(" ").trim();

  return {
    segments: mergedSegments,
    globalWarnings: parsed.globalWarnings,
    meta: {
      mode: "single",
      model: modelName,
      outputMode,
      structuredOutputEnabled: false,
      schemaVersion: null,
      schemaChunkCount: 0,
      overallStatus: "COMPLETED",
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      totalLatencyMs: finishedAt - startedAt,
      originalSegmentCount: segments.length,
      originalCharacterCount: inputChars,
      chunkCount: 1,
      concurrency: 1,
      successfulChunkCount: 1,
      failedChunkCount: 0,
      fallbackSegmentCount: 0,
      changedSegmentCount,
      unchangedSegmentCount: segments.length - changedSegmentCount,
      retryCount: 0,
      perChunk: [
        {
          chunkIndex: 0,
          targetSegmentCount: segments.length,
          targetSegmentStartIndex: segments[0]?.index ?? 0,
          targetSegmentEndIndex: segments[segments.length - 1]?.index ?? 0,
          inputChars,
          queuedAt: new Date(startedAt).toISOString(),
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date(finishedAt).toISOString(),
          latencyMs: finishedAt - startedAt,
          status: "COMPLETED",
          retryCount: 0,
          errorCategory: null,
        },
      ],
      originalWordCount: getWordCount(originalText),
      enhancedWordCount: getWordCount(enhancedText),
      addedWordEstimate: Math.max(0, getWordCount(enhancedText) - getWordCount(originalText)),
      removedWordEstimate: Math.max(0, getWordCount(originalText) - getWordCount(enhancedText)),
      maxOutputTokens: tokensUsed,
      estimatedDurationMs,
      inputChars,
    },
  };
}

async function runChunkedEnhancement(params: {
  segments: TranscriptEnhancementInputSegment[];
  apiKey: string;
  folderId: string;
  modelName: string;
  baseUrl: string;
}): Promise<TranscriptEnhancementResult> {
  const { segments, apiKey, folderId, modelName, baseUrl } = params;
  const outputMode = getTranscriptEnhancementOutputMode();
  const structuredOutputEnabled = outputMode === "json_schema";
  const startedAtMs = Date.now();
  const chunks = buildTranscriptEnhancementChunks(segments);
  const maxConcurrency = Math.max(1, getTranscriptEnhancementMaxConcurrency());
  const perChunkTimeoutMs = getTranscriptEnhancementChunkTimeoutMs();
  const chunkResults: ChunkExecutionResult[] = new Array(chunks.length);
  const chunkQueuedAt = chunks.map(() => new Date().toISOString());
  const fallbackModel =
    outputMode === "legacy" ? getYandexTranscriptEnhancementFallbackModel() : null;
  const maxTokensFromEnv = getYandexTranscriptEnhancementMaxOutputTokens();

  let workerCursor = 0;
  const workerCount = Math.min(maxConcurrency, chunks.length);

  async function processChunk(chunk: EnhancementChunk): Promise<ChunkExecutionResult> {
    const { maxOutputTokens } = resolveDynamicMaxOutputTokens(chunk.targets);
    const strictRetryMaxTokens = Math.max(
      maxOutputTokens,
      Math.min(maxTokensFromEnv, Math.max(1600, maxOutputTokens * 2)),
    );
    const schema = buildChunkSchemaJsonSchema(chunk);
    const schemaName = `${TRANSCRIPT_ENHANCEMENT_SCHEMA_NAME}_${TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION}`;
    const expectedSchemaKeys = chunk.targets.map((segment) => String(segment.index));
    const attemptPlan: Array<{
      attemptType: "primary_initial" | "primary_strict_retry" | "fallback_model_retry";
      model: string;
      maxTokens: number;
      strictJsonMode: boolean;
      fallbackTriggered: boolean;
      fallbackReason: string | null;
    }> = structuredOutputEnabled
      ? [
          {
            attemptType: "primary_initial",
            model: modelName,
            maxTokens: maxOutputTokens,
            strictJsonMode: false,
            fallbackTriggered: false,
            fallbackReason: null,
          },
          {
            attemptType: "primary_strict_retry",
            model: modelName,
            maxTokens: strictRetryMaxTokens,
            strictJsonMode: true,
            fallbackTriggered: false,
            fallbackReason: null,
          },
        ]
      : [
          {
            attemptType: "primary_initial",
            model: modelName,
            maxTokens: maxOutputTokens,
            strictJsonMode: false,
            fallbackTriggered: false,
            fallbackReason: null,
          },
          {
            attemptType: "primary_strict_retry",
            model: modelName,
            maxTokens: strictRetryMaxTokens,
            strictJsonMode: true,
            fallbackTriggered: false,
            fallbackReason: null,
          },
          ...(fallbackModel && fallbackModel !== modelName
            ? [
                {
                  attemptType: "fallback_model_retry" as const,
                  model: fallbackModel,
                  maxTokens: strictRetryMaxTokens,
                  strictJsonMode: true,
                  fallbackTriggered: true,
                  fallbackReason: "empty_output",
                },
              ]
            : []),
        ];
    const boundedPlan = attemptPlan.slice(0, EMPTY_OUTPUT_MAX_ATTEMPTS_PER_CHUNK);

    const attempts: NonNullable<ChunkExecutionResult["attempts"]> = [];
    const firstAttemptStartedAt = new Date();
    const firstAttemptStartedAtMs = Date.now();
    let lastErrorCategory: string | null = null;
    let lastMissingKeyCount = 0;
    let lastExtraKeyCount = 0;
    let lastEmptyValueCount = 0;
    let modelUsed = modelName;
    let fallbackTriggered = false;
    let fallbackReason: string | null = null;

    for (let i = 0; i < boundedPlan.length; i += 1) {
      const plan = boundedPlan[i];
      modelUsed = plan.model;
      fallbackTriggered = fallbackTriggered || plan.fallbackTriggered;
      fallbackReason = fallbackReason ?? plan.fallbackReason;

      try {
        const requestResult = await requestEnhancement({
          apiKey,
          folderId,
          baseUrl,
          modelName: plan.model,
          maxTokens: plan.maxTokens,
          timeoutMs: perChunkTimeoutMs,
          input: chunk,
          promptBuilder: (input, strictJsonMode) =>
            structuredOutputEnabled
              ? buildChunkSchemaPrompt(input as EnhancementChunk)
              : buildChunkPrompt(input as EnhancementChunk, strictJsonMode),
          strictJsonMode: plan.strictJsonMode,
          outputMode,
          textFormat: structuredOutputEnabled
            ? {
                type: "json_schema",
                name: schemaName,
                strict: true,
                schema,
              }
            : undefined,
        });

        if (!requestResult.outputText) {
          attempts.push({
            attemptNumber: i + 1,
            attemptType: plan.attemptType,
            modelUsed: plan.model,
            maxOutputTokens: plan.maxTokens,
            responseIdPresent: requestResult.diagnostics.responseIdPresent,
            initialStatus: requestResult.diagnostics.initialStatus,
            finalStatus: requestResult.diagnostics.finalStatus,
            pollingAttemptCount: requestResult.diagnostics.pollingAttemptCount,
            pollingElapsedMs: requestResult.diagnostics.pollingElapsedMs,
            outputFieldDetected: requestResult.diagnostics.outputFieldDetected,
            rawOutputCharCount: requestResult.diagnostics.rawOutputCharCount,
            parsedSegmentCount: 0,
            outputMode,
            providerStatus: requestResult.diagnostics.providerStatus,
            incompleteReason: requestResult.diagnostics.incompleteReason,
            schemaValidationPassed: false,
            schemaAccepted: requestResult.diagnostics.schemaAccepted,
            schemaName: structuredOutputEnabled ? schemaName : null,
            schemaVersion: structuredOutputEnabled ? TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION : null,
            failureStage: "extraction",
            emptyOutputStage:
              requestResult.diagnostics.emptyOutputStage ?? "initial_response",
            status: "FAILED",
            errorCategory: "empty_output",
          });
          lastErrorCategory = "empty_output";
          continue;
        }

        if (structuredOutputEnabled) {
          const parsedSchema = parseSchemaEnhancementPayload(requestResult.outputText);
          if (!parsedSchema) {
            attempts.push({
              attemptNumber: i + 1,
              attemptType: plan.attemptType,
              modelUsed: plan.model,
              maxOutputTokens: plan.maxTokens,
              responseIdPresent: requestResult.diagnostics.responseIdPresent,
              initialStatus: requestResult.diagnostics.initialStatus,
              finalStatus: requestResult.diagnostics.finalStatus,
              pollingAttemptCount: requestResult.diagnostics.pollingAttemptCount,
              pollingElapsedMs: requestResult.diagnostics.pollingElapsedMs,
              outputFieldDetected: requestResult.diagnostics.outputFieldDetected,
              rawOutputCharCount: requestResult.diagnostics.rawOutputCharCount,
              parsedSegmentCount: 0,
              outputMode,
              providerStatus: requestResult.diagnostics.providerStatus,
              incompleteReason: requestResult.diagnostics.incompleteReason,
              schemaValidationPassed: false,
              schemaAccepted: requestResult.diagnostics.schemaAccepted,
              schemaName,
              schemaVersion: TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION,
              failureStage: "parsing",
              emptyOutputStage: "parsing",
              status: "FAILED",
              errorCategory: "malformed_output",
            });
            lastErrorCategory = "malformed_output";
            continue;
          }

          try {
            const validated = validateChunkSchemaEnhancementResponse({
              targets: chunk.targets,
              parsed: parsedSchema,
            });
            if (
              validated.missingKeys.length > 0 ||
              validated.extraKeys.length > 0 ||
              validated.emptyKeys.length > 0
            ) {
              lastMissingKeyCount = validated.missingKeys.length;
              lastExtraKeyCount = validated.extraKeys.length;
              lastEmptyValueCount = validated.emptyKeys.length;
              attempts.push({
                attemptNumber: i + 1,
                attemptType: plan.attemptType,
                modelUsed: plan.model,
                maxOutputTokens: plan.maxTokens,
                responseIdPresent: requestResult.diagnostics.responseIdPresent,
                initialStatus: requestResult.diagnostics.initialStatus,
                finalStatus: requestResult.diagnostics.finalStatus,
                pollingAttemptCount: requestResult.diagnostics.pollingAttemptCount,
                pollingElapsedMs: requestResult.diagnostics.pollingElapsedMs,
                outputFieldDetected: requestResult.diagnostics.outputFieldDetected,
                rawOutputCharCount: requestResult.diagnostics.rawOutputCharCount,
                parsedSegmentCount: Object.keys(parsedSchema.segments).length,
                outputMode,
                providerStatus: requestResult.diagnostics.providerStatus,
                incompleteReason: requestResult.diagnostics.incompleteReason,
                schemaValidationPassed: false,
                schemaAccepted: requestResult.diagnostics.schemaAccepted,
                schemaName,
                schemaVersion: TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION,
                failureStage: "schema_validation",
                emptyOutputStage: "validation",
                status: "FAILED",
                errorCategory:
                  validated.missingKeys.length > 0
                    ? "missing_segment_id"
                    : validated.extraKeys.length > 0
                      ? "unknown_segment_id"
                      : "empty_enhanced_text",
              });
              lastErrorCategory =
                validated.missingKeys.length > 0
                  ? "missing_segment_id"
                  : validated.extraKeys.length > 0
                    ? "unknown_segment_id"
                    : "empty_enhanced_text";
              continue;
            }

            attempts.push({
              attemptNumber: i + 1,
              attemptType: plan.attemptType,
              modelUsed: plan.model,
              maxOutputTokens: plan.maxTokens,
              responseIdPresent: requestResult.diagnostics.responseIdPresent,
              initialStatus: requestResult.diagnostics.initialStatus,
              finalStatus: requestResult.diagnostics.finalStatus,
              pollingAttemptCount: requestResult.diagnostics.pollingAttemptCount,
              pollingElapsedMs: requestResult.diagnostics.pollingElapsedMs,
              outputFieldDetected: requestResult.diagnostics.outputFieldDetected,
              rawOutputCharCount: requestResult.diagnostics.rawOutputCharCount,
              parsedSegmentCount: Object.keys(parsedSchema.segments).length,
              outputMode,
              providerStatus: requestResult.diagnostics.providerStatus,
              incompleteReason: requestResult.diagnostics.incompleteReason,
              schemaValidationPassed: true,
              schemaAccepted: requestResult.diagnostics.schemaAccepted,
              schemaName,
              schemaVersion: TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION,
              failureStage: "integrity_validation",
              emptyOutputStage: null,
              status: "COMPLETED",
              errorCategory: null,
            });
            return {
              chunkIndex: chunk.chunkIndex,
              enhancedByIndex: validated.enhancedByIndex,
              retryCount: Math.max(0, i),
              modelUsed: plan.model,
              fallbackTriggered,
              fallbackReason,
              startedAt: firstAttemptStartedAt.toISOString(),
              finishedAt: new Date().toISOString(),
              latencyMs: Date.now() - firstAttemptStartedAtMs,
              status: "COMPLETED",
              errorCategory: null,
              warnings: [],
              primaryModel: modelName,
              fallbackModel: fallbackModel ?? null,
              attempts,
              outputMode,
              schemaName,
              schemaVersion: TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION,
              expectedSchemaKeyCount: expectedSchemaKeys.length,
              returnedSchemaKeyCount: Object.keys(parsedSchema.segments).length,
              schemaAccepted: requestResult.diagnostics.schemaAccepted,
              schemaValidationPassed: true,
              missingKeyCount: lastMissingKeyCount,
              extraKeyCount: lastExtraKeyCount,
              emptyValueCount: lastEmptyValueCount,
            };
          } catch (validationError) {
            const category =
              validationError instanceof ChunkValidationError
                ? validationError.category
                : classifyChunkError(validationError).category;
            attempts.push({
              attemptNumber: i + 1,
              attemptType: plan.attemptType,
              modelUsed: plan.model,
              maxOutputTokens: plan.maxTokens,
              responseIdPresent: requestResult.diagnostics.responseIdPresent,
              initialStatus: requestResult.diagnostics.initialStatus,
              finalStatus: requestResult.diagnostics.finalStatus,
              pollingAttemptCount: requestResult.diagnostics.pollingAttemptCount,
              pollingElapsedMs: requestResult.diagnostics.pollingElapsedMs,
              outputFieldDetected: requestResult.diagnostics.outputFieldDetected,
              rawOutputCharCount: requestResult.diagnostics.rawOutputCharCount,
              parsedSegmentCount: 0,
              outputMode,
              providerStatus: requestResult.diagnostics.providerStatus,
              incompleteReason: requestResult.diagnostics.incompleteReason,
              schemaValidationPassed: false,
              schemaAccepted: requestResult.diagnostics.schemaAccepted,
              schemaName,
              schemaVersion: TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION,
              failureStage: "integrity_validation",
              emptyOutputStage: "validation",
              status: "FAILED",
              errorCategory: category,
            });
            lastErrorCategory = category;
            continue;
          }
        }

        const parsed = parseEnhancementPayload(requestResult.outputText);
        if (!parsed) {
          attempts.push({
            attemptNumber: i + 1,
            attemptType: plan.attemptType,
            modelUsed: plan.model,
            maxOutputTokens: plan.maxTokens,
            responseIdPresent: requestResult.diagnostics.responseIdPresent,
            initialStatus: requestResult.diagnostics.initialStatus,
            finalStatus: requestResult.diagnostics.finalStatus,
            pollingAttemptCount: requestResult.diagnostics.pollingAttemptCount,
            pollingElapsedMs: requestResult.diagnostics.pollingElapsedMs,
            outputFieldDetected: requestResult.diagnostics.outputFieldDetected,
            rawOutputCharCount: requestResult.diagnostics.rawOutputCharCount,
            parsedSegmentCount: 0,
            outputMode,
            providerStatus: requestResult.diagnostics.providerStatus,
            incompleteReason: requestResult.diagnostics.incompleteReason,
            schemaValidationPassed: false,
            schemaAccepted: null,
            schemaName: null,
            schemaVersion: null,
            failureStage: "parsing",
            emptyOutputStage: "parsing",
            status: "FAILED",
            errorCategory: "malformed_output",
          });
          lastErrorCategory = "malformed_output";
          continue;
        }

        try {
          const validated = validateChunkEnhancementResponse({
            targets: chunk.targets,
            parsed,
          });
          attempts.push({
            attemptNumber: i + 1,
            attemptType: plan.attemptType,
            modelUsed: plan.model,
            maxOutputTokens: plan.maxTokens,
            responseIdPresent: requestResult.diagnostics.responseIdPresent,
            initialStatus: requestResult.diagnostics.initialStatus,
            finalStatus: requestResult.diagnostics.finalStatus,
            pollingAttemptCount: requestResult.diagnostics.pollingAttemptCount,
            pollingElapsedMs: requestResult.diagnostics.pollingElapsedMs,
            outputFieldDetected: requestResult.diagnostics.outputFieldDetected,
            rawOutputCharCount: requestResult.diagnostics.rawOutputCharCount,
            parsedSegmentCount: parsed.segments.length,
            outputMode,
            providerStatus: requestResult.diagnostics.providerStatus,
            incompleteReason: requestResult.diagnostics.incompleteReason,
            schemaValidationPassed: false,
            schemaAccepted: null,
            schemaName: null,
            schemaVersion: null,
            failureStage: "integrity_validation",
            emptyOutputStage: null,
            status: "COMPLETED",
            errorCategory: null,
          });
          return {
            chunkIndex: chunk.chunkIndex,
            enhancedByIndex: validated.enhancedByIndex,
            retryCount: Math.max(0, i),
            modelUsed: plan.model,
            fallbackTriggered,
            fallbackReason,
            startedAt: firstAttemptStartedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            latencyMs: Date.now() - firstAttemptStartedAtMs,
            status: "COMPLETED",
            errorCategory: null,
            warnings: validated.warnings,
            primaryModel: modelName,
            fallbackModel: fallbackModel ?? null,
            attempts,
            outputMode,
          };
        } catch (validationError) {
          const category =
            validationError instanceof ChunkValidationError
              ? validationError.category
              : classifyChunkError(validationError).category;
          attempts.push({
            attemptNumber: i + 1,
            attemptType: plan.attemptType,
            modelUsed: plan.model,
            maxOutputTokens: plan.maxTokens,
            responseIdPresent: requestResult.diagnostics.responseIdPresent,
            initialStatus: requestResult.diagnostics.initialStatus,
            finalStatus: requestResult.diagnostics.finalStatus,
            pollingAttemptCount: requestResult.diagnostics.pollingAttemptCount,
            pollingElapsedMs: requestResult.diagnostics.pollingElapsedMs,
            outputFieldDetected: requestResult.diagnostics.outputFieldDetected,
            rawOutputCharCount: requestResult.diagnostics.rawOutputCharCount,
            parsedSegmentCount: parsed.segments.length,
            outputMode,
            providerStatus: requestResult.diagnostics.providerStatus,
            incompleteReason: requestResult.diagnostics.incompleteReason,
            schemaValidationPassed: false,
            schemaAccepted: null,
            schemaName: null,
            schemaVersion: null,
            failureStage: "integrity_validation",
            emptyOutputStage: "validation",
            status: "FAILED",
            errorCategory: category,
          });
          lastErrorCategory = category;
        }
      } catch (error) {
        const classified = classifyChunkError(error);
        attempts.push({
          attemptNumber: i + 1,
          attemptType: plan.attemptType,
          modelUsed: plan.model,
          maxOutputTokens: plan.maxTokens,
          responseIdPresent: false,
          initialStatus: null,
          finalStatus: null,
          pollingAttemptCount: 0,
          pollingElapsedMs: 0,
          outputFieldDetected: "none",
          rawOutputCharCount: 0,
          parsedSegmentCount: 0,
          outputMode,
          providerStatus: null,
          incompleteReason: null,
          schemaValidationPassed: false,
          schemaAccepted: structuredOutputEnabled ? false : null,
          schemaName: structuredOutputEnabled ? schemaName : null,
          schemaVersion: structuredOutputEnabled ? TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION : null,
          failureStage: "provider",
          emptyOutputStage: null,
          status: "FAILED",
          errorCategory: classified.category,
        });
        lastErrorCategory = classified.category;
      }
    }

    return {
      chunkIndex: chunk.chunkIndex,
      enhancedByIndex: new Map<number, string>(),
      retryCount: Math.max(0, boundedPlan.length - 1),
      modelUsed,
      fallbackTriggered,
      fallbackReason: fallbackTriggered ? fallbackReason ?? "empty_output" : null,
      startedAt: firstAttemptStartedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      latencyMs: Date.now() - firstAttemptStartedAtMs,
      status: "FAILED_FALLBACK",
      errorCategory: lastErrorCategory ?? "empty_output",
      warnings: [],
      primaryModel: modelName,
      fallbackModel: fallbackModel ?? null,
      attempts,
      outputMode,
      schemaName: structuredOutputEnabled ? schemaName : null,
      schemaVersion: structuredOutputEnabled ? TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION : null,
      expectedSchemaKeyCount: structuredOutputEnabled ? expectedSchemaKeys.length : undefined,
      returnedSchemaKeyCount:
        structuredOutputEnabled && attempts.length > 0
          ? attempts[attempts.length - 1]?.parsedSegmentCount ?? 0
          : undefined,
      schemaAccepted:
        structuredOutputEnabled && attempts.length > 0
          ? (attempts[attempts.length - 1]?.schemaAccepted ?? null)
          : null,
      schemaValidationPassed: false,
      missingKeyCount: structuredOutputEnabled ? lastMissingKeyCount : undefined,
      extraKeyCount: structuredOutputEnabled ? lastExtraKeyCount : undefined,
      emptyValueCount: structuredOutputEnabled ? lastEmptyValueCount : undefined,
    };
  }

  const workers = Array.from({ length: workerCount }, async () => {
    while (workerCursor < chunks.length) {
      const currentIndex = workerCursor;
      workerCursor += 1;
      const chunk = chunks[currentIndex];
      chunkResults[currentIndex] = await processChunk(chunk);
    }
  });
  await Promise.all(workers);

  const resultByIndex = new Map<number, string>();
  const warnings: string[] = [];
  let successfulChunkCount = 0;
  let failedChunkCount = 0;
  let totalRetryCount = 0;
  let fallbackTriggeredAny = false;
  const fallbackReasons = new Set<string>();
  const failedChunkIndexes = new Set<number>();

  for (const result of chunkResults) {
    totalRetryCount += result.retryCount;
    fallbackTriggeredAny = fallbackTriggeredAny || result.fallbackTriggered;
    if (result.fallbackReason) {
      fallbackReasons.add(result.fallbackReason);
    }
    if (result.status === "COMPLETED") {
      successfulChunkCount += 1;
      for (const [index, cleanedText] of result.enhancedByIndex) {
        resultByIndex.set(index, cleanedText);
      }
      warnings.push(...result.warnings);
    } else {
      failedChunkCount += 1;
      failedChunkIndexes.add(result.chunkIndex);
      if (result.errorCategory) {
        warnings.push(`chunk_${result.chunkIndex}:${result.errorCategory}`);
      }
    }
  }

  let changedSegmentCount = 0;
  let fallbackSegmentCount = 0;
  const mergedSegments: TranscriptEnhancementRawSegment[] = segments.map((segment) => {
    const cleanedText = resultByIndex.get(segment.index) ?? segment.originalText;
    const changed = cleanedText.trim() !== segment.originalText.trim();
    if (changed) changedSegmentCount += 1;
    const ownerChunk = chunks.find((chunk) =>
      chunk.targets.some((targetSegment) => targetSegment.index === segment.index),
    );
    if (
      !resultByIndex.has(segment.index) &&
      ownerChunk &&
      failedChunkIndexes.has(ownerChunk.chunkIndex)
    ) {
      fallbackSegmentCount += 1;
    }
    return {
      index: segment.index,
      cleanedText,
      changed,
      changeCategory: null,
    };
  });

  const unchangedSegmentCount = segments.length - changedSegmentCount;
  const overallStatus: TranscriptEnhancementOverallStatus =
    successfulChunkCount === 0
      ? "FAILED"
      : failedChunkCount === 0
        ? "COMPLETED"
        : "PARTIAL";

  const originalText = getSegmentsText(segments);
  const enhancedText = mergedSegments
    .map((segment) => segment.cleanedText.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  const originalWordCount = getWordCount(originalText);
  const enhancedWordCount = getWordCount(enhancedText);
  const finishedAtMs = Date.now();

  return {
    segments: mergedSegments,
    globalWarnings: Array.from(new Set(warnings)),
    meta: {
      mode: "chunked",
      model: modelName,
      primaryModel: modelName,
      fallbackModel: fallbackModel ?? null,
      fallbackTriggered: fallbackTriggeredAny,
      fallbackReason: fallbackReasons.size > 0 ? Array.from(fallbackReasons).join(",") : null,
      outputMode,
      structuredOutputEnabled,
      schemaVersion: structuredOutputEnabled ? TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION : null,
      schemaChunkCount: structuredOutputEnabled ? chunks.length : 0,
      overallStatus,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalLatencyMs: finishedAtMs - startedAtMs,
      originalSegmentCount: segments.length,
      originalCharacterCount: segments.reduce((sum, segment) => sum + segment.originalText.length, 0),
      chunkCount: chunks.length,
      concurrency: workerCount,
      successfulChunkCount,
      failedChunkCount,
      fallbackSegmentCount,
      changedSegmentCount,
      unchangedSegmentCount,
      retryCount: totalRetryCount,
      perChunk: chunks.map((chunk) => {
        const result = chunkResults[chunk.chunkIndex];
        return {
          chunkIndex: chunk.chunkIndex,
          targetSegmentCount: chunk.targets.length,
          targetSegmentStartIndex: chunk.targets[0]?.index ?? 0,
          targetSegmentEndIndex: chunk.targets[chunk.targets.length - 1]?.index ?? 0,
          inputChars: chunk.inputChars,
          queuedAt: chunkQueuedAt[chunk.chunkIndex],
          startedAt: result?.startedAt ?? null,
          finishedAt: result?.finishedAt ?? null,
          latencyMs: result?.latencyMs ?? null,
          status: result?.status ?? "FAILED_FALLBACK",
          retryCount: result?.retryCount ?? 0,
          errorCategory: result?.errorCategory ?? null,
          primaryModel: result?.primaryModel ?? modelName,
          fallbackModel: result?.fallbackModel ?? null,
          modelUsed: result?.modelUsed ?? modelName,
          fallbackTriggered: result?.fallbackTriggered ?? false,
          fallbackReason: result?.fallbackReason ?? null,
          attemptCount: result?.attempts?.length ?? 0,
          attempts: result?.attempts ?? [],
          outputMode: result?.outputMode ?? outputMode,
          schemaName: result?.schemaName ?? null,
          schemaVersion: result?.schemaVersion ?? null,
          expectedSchemaKeyCount: result?.expectedSchemaKeyCount,
          returnedSchemaKeyCount: result?.returnedSchemaKeyCount,
          schemaAccepted: result?.schemaAccepted ?? null,
          schemaValidationPassed: result?.schemaValidationPassed ?? false,
          missingKeyCount: result?.missingKeyCount ?? 0,
          extraKeyCount: result?.extraKeyCount ?? 0,
          emptyValueCount: result?.emptyValueCount ?? 0,
        };
      }),
      originalWordCount,
      enhancedWordCount,
      addedWordEstimate: Math.max(0, enhancedWordCount - originalWordCount),
      removedWordEstimate: Math.max(0, originalWordCount - enhancedWordCount),
    },
  };
}

export async function enhanceTranscriptWithYandexAi(
  segments: TranscriptEnhancementInputSegment[],
): Promise<TranscriptEnhancementResult> {
  const startedAt = Date.now();
  const mode = getTranscriptEnhancementMode();
  const outputMode = getTranscriptEnhancementOutputMode();
  const structuredOutputEnabled = outputMode === "json_schema";
  if (segments.length === 0) {
    const finishedAt = Date.now();
    return {
      segments: [],
      globalWarnings: [],
      meta: {
        mode,
        model: getYandexTranscriptEnhancementModel(),
        outputMode,
        structuredOutputEnabled,
        schemaVersion: structuredOutputEnabled ? TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION : null,
        schemaChunkCount: 0,
        overallStatus: "SKIPPED",
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        totalLatencyMs: finishedAt - startedAt,
        originalSegmentCount: 0,
        originalCharacterCount: 0,
        chunkCount: 0,
        concurrency: 0,
        successfulChunkCount: 0,
        failedChunkCount: 0,
        fallbackSegmentCount: 0,
        changedSegmentCount: 0,
        unchangedSegmentCount: 0,
        retryCount: 0,
        perChunk: [],
        originalWordCount: 0,
        enhancedWordCount: 0,
        addedWordEstimate: 0,
        removedWordEstimate: 0,
      },
    };
  }

  const apiKey = process.env.YANDEX_API_KEY?.trim();
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  if (!apiKey || !folderId) {
    throw new Error("Yandex transcript enhancement configuration is missing.");
  }
  const modelName = getYandexTranscriptEnhancementModel();
  const baseUrl = getYandexAiBaseUrl();

  if (mode === "single") {
    return runSingleShotEnhancement({
      segments,
      apiKey,
      folderId,
      modelName,
      baseUrl,
    });
  }

  return runChunkedEnhancement({
    segments,
    apiKey,
    folderId,
    modelName,
    baseUrl,
  });
}
