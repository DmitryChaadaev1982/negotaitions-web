import { isRetryableProviderCategory } from "@/lib/services/transcript-enhancement-retry";
import {
  ChunkStartRejectedError,
  isAbortingChunkStartRejection,
  type EnhancementChunkStartDecision,
  type EnhancementChunkStartRejectionReason,
} from "@/lib/services/transcript-enhancement-start-decision";
import {
  getTranscriptEnhancementChunkMaxChars,
  getTranscriptEnhancementChunkMaxSegments,
  getTranscriptEnhancementOutputMode,
  getTranscriptEnhancementChunkTimeoutMs,
  getTranscriptEnhancementMaxConcurrency,
  getTranscriptEnhancementMode,
  getYandexTranscriptEnhancementMaxOutputTokens,
  getYandexTranscriptEnhancementModel,
  type TranscriptEnhancementMode,
  type TranscriptEnhancementOutputMode,
} from "@/lib/env";

const RESPONSE_POLL_INTERVAL_MS = 1_500;
const RESPONSE_POLL_TIMEOUT_MS = 90_000;
const CHUNK_CONTEXT_NEIGHBORS = 1;
const CATASTROPHIC_SHRINK_MIN_SOURCE_CHARS = 40;
const CATASTROPHIC_SHRINK_RATIO = 0.35;
const CATASTROPHIC_SHRINK_MIN_REMOVED_CHARS = 30;
const EMPTY_OUTPUT_MAX_ATTEMPTS_PER_CHUNK = 2;
const TRANSCRIPT_ENHANCEMENT_RETRY_HARD_MAX_OUTPUT_TOKENS = 6000;
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
  targetPieceCount?: number;
  sourceSegmentCount?: number;
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
      failureStage?:
        | "provider"
        | "extraction"
        | "parsing"
        | "schema_validation"
        | "integrity_validation"
        | null;
      lastValidationStage?: "integrity_validation" | null;
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
  oversizedSegmentCount?: number;
  splitPieceCount?: number;
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

export type EnhancementChunk = {
  chunkIndex: number;
  targets: PackedTranscriptEnhancementSegment[];
  contextBefore: PackedTranscriptEnhancementSegment[];
  contextAfter: PackedTranscriptEnhancementSegment[];
  inputChars: number;
};

export type PackedTranscriptEnhancementSegment =
  TranscriptEnhancementInputSegment & {
    sourceIndex: number;
    pieceIndex: number;
    pieceCount: number;
    prefixText: string;
    separatorAfter: string;
  };

export type ChunkExecutionResult = {
  chunkIndex: number;
  enhancedByIndex: Map<number, string>;
  retryCount: number;
  /** 1-based POST attempt this invocation performed. Exactly one POST. */
  attemptNumber?: number;
  /** Normalized retry classification for the D1 retry owner. */
  retryableFailure?: boolean;
  httpStatus?: number | null;
  retryAfterHeader?: string | null;
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
  usageInputTokens?: number | null;
  usageOutputTokens?: number | null;
  usageTotalTokens?: number | null;
  usageClassification?: "provider" | "unknown" | null;
};

class ChunkValidationError extends Error {
  readonly category: string;

  constructor(message: string, category: string) {
    super(message);
    this.category = category;
  }
}

/**
 * Transport-level provider failure carrying the classification inputs the D1
 * retry owner needs: HTTP status and the raw `Retry-After` header.
 */
export class TranscriptEnhancementProviderHttpError extends Error {
  readonly httpStatus: number;
  readonly retryAfterHeader: string | null;

  constructor(params: { httpStatus: number; retryAfterHeader: string | null; message: string }) {
    super(params.message);
    this.name = "TranscriptEnhancementProviderHttpError";
    this.httpStatus = params.httpStatus;
    this.retryAfterHeader = params.retryAfterHeader;
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

function buildSplitPiecePromptIdentity(
  segment: PackedTranscriptEnhancementSegment,
) {
  return segment.pieceCount > 1
    ? {
        sourceIndex: segment.sourceIndex,
        pieceIndex: segment.pieceIndex,
        pieceCount: segment.pieceCount,
      }
    : {};
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
        ...buildSplitPiecePromptIdentity(segment),
        speakerLabel: segment.speakerLabel,
        text: segment.originalText,
      })),
      targetSegments: chunk.targets.map((segment) => ({
        index: segment.index,
        ...buildSplitPiecePromptIdentity(segment),
        speakerLabel: segment.speakerLabel,
        startMs: segment.startMs,
        endMs: segment.endMs,
        segmentId: segment.segmentId ?? null,
        mappedParticipantId: segment.mappedParticipantId ?? null,
        originalText: segment.originalText,
      })),
      readOnlyContextAfter: chunk.contextAfter.map((segment) => ({
        index: segment.index,
        ...buildSplitPiecePromptIdentity(segment),
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
        ...buildSplitPiecePromptIdentity(segment),
        speakerLabel: segment.speakerLabel,
        text: segment.originalText,
      })),
      targetSegments: chunk.targets.map((segment) => ({
        index: segment.index,
        ...buildSplitPiecePromptIdentity(segment),
        speakerLabel: segment.speakerLabel,
        startMs: segment.startMs,
        endMs: segment.endMs,
        segmentId: segment.segmentId ?? null,
        mappedParticipantId: segment.mappedParticipantId ?? null,
        originalText: segment.originalText,
      })),
      readOnlyContextAfter: chunk.contextAfter.map((segment) => ({
        index: segment.index,
        ...buildSplitPiecePromptIdentity(segment),
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

export function extractProviderUsage(envelope: unknown): {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  const root = toRecord(envelope);
  const usage = toRecord(root?.usage) ?? toRecord(toRecord(root?.response)?.usage);
  if (!usage) {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const readNumber = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const inputTokens =
    readNumber(usage.input_text_tokens) ??
    readNumber(usage.input_tokens) ??
    readNumber(usage.prompt_tokens);
  const outputTokens =
    readNumber(usage.completion_tokens) ??
    readNumber(usage.output_tokens) ??
    readNumber(usage.output_text_tokens);
  const totalTokens = readNumber(usage.total_tokens);
  return { inputTokens, outputTokens, totalTokens };
}

export type ProviderChunkAttempt = {
  attemptNumber: number;
  flavor: "same_request" | "strict_json";
};

export type EnhanceTranscriptOptions = {
  jobId?: string;
  skipChunkIndexes?: ReadonlySet<number>;
  restoredEnhancedByIndex?: Map<number, string>;
  /**
   * Attempt descriptor per chunk, supplied by the D1 retry owner. The provider
   * performs exactly one POST per chunk per invocation and never retries.
   */
  attemptByChunkIndex?: ReadonlyMap<number, ProviderChunkAttempt>;
  onChunkStart?: (
    chunk: EnhancementChunk,
  ) => Promise<EnhancementChunkStartDecision | void> | EnhancementChunkStartDecision | void;
  onChunkFinish?: (
    result: ChunkExecutionResult,
    chunk: EnhancementChunk,
  ) => Promise<void> | void;
  withProviderSlot?: <T>(fn: () => Promise<T>) => Promise<T>;
};

async function requestEnhancement(params: RequestEnhancementParams): Promise<{
  envelope: Record<string, unknown>;
  outputText: string;
  tokensUsed: number | null;
  usageClassification: "provider" | "unknown";
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
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
        reasoning: { effort: "none" },
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
    throw new TranscriptEnhancementProviderHttpError({
      httpStatus: response.status,
      retryAfterHeader: response.headers?.get?.("retry-after") ?? null,
      message: `Yandex transcript enhancement failed with HTTP ${response.status}: ${text.slice(0, 240)}`,
    });
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

  const usage = extractProviderUsage(envelope);
  const tokensUsed =
    usage.totalTokens ??
    (usage.inputTokens != null && usage.outputTokens != null
      ? usage.inputTokens + usage.outputTokens
      : null);

  return {
    envelope,
    outputText,
    tokensUsed,
    usageClassification: tokensUsed == null ? "unknown" : "provider",
    usage,
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

function avoidSplittingSurrogatePair(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  const previous = text.charCodeAt(index - 1);
  const current = text.charCodeAt(index);
  const previousIsHighSurrogate = previous >= 0xd800 && previous <= 0xdbff;
  const currentIsLowSurrogate = current >= 0xdc00 && current <= 0xdfff;
  return previousIsHighSurrogate && currentIsLowSurrogate ? index - 1 : index;
}

function findPreferredPieceEnd(
  text: string,
  start: number,
  maxChars: number,
): number {
  const hardEnd = avoidSplittingSurrogatePair(
    text,
    Math.min(text.length, start + maxChars),
  );
  if (hardEnd >= text.length) return text.length;
  const preferredStart = start + Math.floor(maxChars * 0.5);

  for (let index = hardEnd - 1; index >= preferredStart; index -= 1) {
    if (
      /[.!?…;:]/u.test(text[index] ?? "") &&
      /\s/u.test(text[index + 1] ?? "")
    ) {
      return index + 1;
    }
  }
  for (let index = hardEnd - 1; index >= preferredStart; index -= 1) {
    if (/\s/u.test(text[index] ?? "")) {
      return index;
    }
  }
  return hardEnd;
}

export type SplitTextPiece = {
  text: string;
  prefixText: string;
  separatorAfter: string;
};

export function splitOversizedEnhancementText(
  text: string,
  maxChars: number,
): SplitTextPiece[] {
  const boundedMaxChars = Math.max(2, Math.floor(maxChars));
  if (text.length <= boundedMaxChars || text.trim().length === 0) {
    return [{ text, prefixText: "", separatorAfter: "" }];
  }

  const pieces: SplitTextPiece[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const prefixStart = cursor;
    while (cursor < text.length && /\s/u.test(text[cursor] ?? "")) {
      cursor += 1;
    }
    const prefixText = text.slice(prefixStart, cursor);
    if (cursor >= text.length) {
      if (pieces.length > 0) {
        pieces[pieces.length - 1]!.separatorAfter += prefixText;
      } else {
        pieces.push({ text: "", prefixText, separatorAfter: "" });
      }
      break;
    }

    let boundaryEnd = findPreferredPieceEnd(
      text,
      cursor,
      boundedMaxChars,
    );
    if (boundaryEnd <= cursor) {
      boundaryEnd = Math.min(text.length, cursor + boundedMaxChars);
    }
    let contentEnd = boundaryEnd;
    while (
      contentEnd > cursor &&
      /\s/u.test(text[contentEnd - 1] ?? "")
    ) {
      contentEnd -= 1;
    }
    let separatorEnd = boundaryEnd;
    while (
      separatorEnd < text.length &&
      /\s/u.test(text[separatorEnd] ?? "")
    ) {
      separatorEnd += 1;
    }
    pieces.push({
      text: text.slice(cursor, contentEnd),
      prefixText,
      separatorAfter: text.slice(contentEnd, separatorEnd),
    });
    cursor = separatorEnd;
  }
  return pieces;
}

export function buildTranscriptEnhancementTargetPieces(
  segments: TranscriptEnhancementInputSegment[],
  maxCharsPerPiece: number,
): PackedTranscriptEnhancementSegment[] {
  const maxExistingIndex = segments.reduce(
    (maximum, segment) => Math.max(maximum, segment.index),
    -1,
  );
  let nextSyntheticIndex = maxExistingIndex + 1;
  const packed: PackedTranscriptEnhancementSegment[] = [];

  for (const segment of segments) {
    if (segment.originalText.trim().length === 0) {
      continue;
    }
    const pieces = splitOversizedEnhancementText(
      segment.originalText,
      maxCharsPerPiece,
    );
    const split = pieces.length > 1;
    for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
      const piece = pieces[pieceIndex]!;
      packed.push({
        ...segment,
        index: split ? nextSyntheticIndex++ : segment.index,
        originalText: piece.text,
        sourceIndex: segment.index,
        pieceIndex,
        pieceCount: pieces.length,
        prefixText: piece.prefixText,
        separatorAfter: piece.separatorAfter,
      });
    }
  }
  return packed;
}

export function reconstructTranscriptEnhancementCoverage(params: {
  sourceSegments: TranscriptEnhancementInputSegment[];
  targetPieces: PackedTranscriptEnhancementSegment[];
  enhancedByIndex: Map<number, string>;
}): {
  textBySourceIndex: Map<number, string>;
  fallbackSourceIndexes: Set<number>;
} {
  const piecesBySourceIndex = new Map<
    number,
    PackedTranscriptEnhancementSegment[]
  >();
  for (const piece of params.targetPieces) {
    const current = piecesBySourceIndex.get(piece.sourceIndex) ?? [];
    current.push(piece);
    piecesBySourceIndex.set(piece.sourceIndex, current);
  }

  const textBySourceIndex = new Map<number, string>();
  const fallbackSourceIndexes = new Set<number>();
  for (const source of params.sourceSegments) {
    const pieces = piecesBySourceIndex.get(source.index) ?? [];
    if (pieces.length === 0) {
      textBySourceIndex.set(source.index, source.originalText);
      continue;
    }
    const complete = pieces.every((piece) =>
      params.enhancedByIndex.has(piece.index),
    );
    if (!complete) {
      fallbackSourceIndexes.add(source.index);
      textBySourceIndex.set(source.index, source.originalText);
      continue;
    }
    textBySourceIndex.set(
      source.index,
      pieces
        .map(
          (piece) =>
            `${piece.prefixText}${params.enhancedByIndex.get(piece.index)!.trim()}${piece.separatorAfter}`,
        )
        .join(""),
    );
  }
  return { textBySourceIndex, fallbackSourceIndexes };
}

export function getTranscriptEnhancementChunkSourceCharLimit(
  maxTargetChars: number,
  contextNeighbors = CHUNK_CONTEXT_NEIGHBORS,
): number {
  return (
    Math.max(1, maxTargetChars) *
    (1 + Math.max(0, Math.floor(contextNeighbors)) * 2)
  );
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
  const targetPieces = buildTranscriptEnhancementTargetPieces(
    segments,
    maxCharsPerChunk,
  );
  if (targetPieces.length === 0) return [];
  const totalChars = targetPieces.reduce(
    (sum, segment) => sum + segment.originalText.length,
    0,
  );
  const desiredChunkCount = Math.max(
    1,
    Math.ceil(targetPieces.length / Math.max(1, maxSegmentsPerChunk)),
    Math.ceil(totalChars / Math.max(1, maxCharsPerChunk)),
  );

  const partitions: PackedTranscriptEnhancementSegment[][] = [];
  let cursor = 0;
  for (let chunkIndex = 0; chunkIndex < desiredChunkCount && cursor < targetPieces.length; chunkIndex += 1) {
    const remainingSegments = targetPieces.length - cursor;
    const remainingChunks = desiredChunkCount - chunkIndex;
    const size = Math.ceil(remainingSegments / remainingChunks);
    partitions.push(targetPieces.slice(cursor, cursor + size));
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
    const firstGlobalIndex = targetPieces.findIndex(
      (segment) => segment.index === targets[0]?.index,
    );
    const lastGlobalIndex = firstGlobalIndex + targets.length - 1;
    const contextBefore = targetPieces.slice(
      Math.max(0, firstGlobalIndex - contextNeighbors),
      firstGlobalIndex,
    );
    const contextAfter = targetPieces.slice(
      lastGlobalIndex + 1,
      lastGlobalIndex + 1 + contextNeighbors,
    );
    return {
      chunkIndex,
      targets,
      contextBefore,
      contextAfter,
      inputChars: [...contextBefore, ...targets, ...contextAfter].reduce(
        (sum, segment) => sum + segment.originalText.length,
        0,
      ),
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
  if (error instanceof TranscriptEnhancementProviderHttpError) {
    if (error.httpStatus === 429) {
      return { category: "provider_rate_limit", retryable: true };
    }
    if (error.httpStatus >= 500) {
      return { category: "provider_http_5xx", retryable: true };
    }
    return { category: "request_failed", retryable: false };
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

function resolveSingleEscalatedMaxOutputTokens(params: {
  currentCap: number;
  hardMax: number;
  tokensUsed?: number | null;
}): number | null {
  const nextCap = Math.min(
    params.hardMax,
    Math.max(
      1600,
      params.currentCap + 1,
      Math.ceil(params.currentCap * 2),
      params.tokensUsed ? Math.ceil(params.tokensUsed * 2) : 0,
    ),
  );
  return nextCap > params.currentCap ? nextCap : null;
}

function resolveRetryHardMaxOutputTokens(currentCap: number, configuredMax: number): number {
  return Math.max(
    configuredMax,
    Math.min(
      TRANSCRIPT_ENHANCEMENT_RETRY_HARD_MAX_OUTPUT_TOKENS,
      Math.ceil(currentCap * 2),
    ),
  );
}

async function runChunkedEnhancement(params: {
  segments: TranscriptEnhancementInputSegment[];
  apiKey: string;
  folderId: string;
  modelName: string;
  baseUrl: string;
  options?: EnhanceTranscriptOptions;
}): Promise<TranscriptEnhancementResult> {
  const { segments, apiKey, folderId, modelName, baseUrl, options } = params;
  const outputMode = getTranscriptEnhancementOutputMode();
  const structuredOutputEnabled = outputMode === "json_schema";
  const startedAtMs = Date.now();
  const chunks = buildTranscriptEnhancementChunks(segments);
  const configuredMode = getTranscriptEnhancementMode();
  const maxConcurrency = Math.max(1, getTranscriptEnhancementMaxConcurrency());
  const perChunkTimeoutMs = getTranscriptEnhancementChunkTimeoutMs();
  const chunkResults: ChunkExecutionResult[] = new Array(chunks.length);
  const chunkQueuedAt = chunks.map(() => new Date().toISOString());
  const maxTokensFromEnv = getYandexTranscriptEnhancementMaxOutputTokens();

  let workerCursor = 0;
  const workerCount = Math.min(maxConcurrency, chunks.length);

  async function processChunk(
    chunk: EnhancementChunk,
    attempt: ProviderChunkAttempt,
  ): Promise<ChunkExecutionResult> {
    const providerAttemptNumber = Math.max(1, Math.round(attempt.attemptNumber));
    const { maxOutputTokens } = resolveDynamicMaxOutputTokens(chunk.targets);
    const strictRetryMaxTokens = resolveSingleEscalatedMaxOutputTokens({
      currentCap: maxOutputTokens,
      hardMax: resolveRetryHardMaxOutputTokens(maxOutputTokens, maxTokensFromEnv),
    });
    const schema = buildChunkSchemaJsonSchema(chunk);
    const schemaName = `${TRANSCRIPT_ENHANCEMENT_SCHEMA_NAME}_${TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION}`;
    const expectedSchemaKeys = chunk.targets.map((segment) => String(segment.index));
    const attemptPlan: Array<{
      attemptType: "primary_initial" | "primary_strict_retry";
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
          ...(strictRetryMaxTokens
            ? [
                {
                  attemptType: "primary_strict_retry" as const,
                  model: modelName,
                  maxTokens: strictRetryMaxTokens,
                  strictJsonMode: true,
                  fallbackTriggered: false,
                  fallbackReason: null,
                },
              ]
            : []),
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
          ...(strictRetryMaxTokens
            ? [
                {
                  attemptType: "primary_strict_retry" as const,
                  model: modelName,
                  maxTokens: strictRetryMaxTokens,
                  strictJsonMode: true,
                  fallbackTriggered: false,
                  fallbackReason: null,
                },
              ]
            : []),
        ];
    // Exactly one POST per invocation. The D1 retry owner decides whether a
    // second attempt happens and which flavor it uses.
    const availablePlan = attemptPlan.slice(0, EMPTY_OUTPUT_MAX_ATTEMPTS_PER_CHUNK);
    const strictEntry = availablePlan.find((entry) => entry.attemptType === "primary_strict_retry");
    const primaryEntry = availablePlan[0]!;
    const selectedEntry =
      providerAttemptNumber >= 2 && attempt.flavor === "strict_json"
        ? strictEntry ?? { ...primaryEntry, strictJsonMode: true }
        : primaryEntry;
    const boundedPlan = [selectedEntry];

    const attempts: NonNullable<ChunkExecutionResult["attempts"]> = [];
    let lastRetryable = false;
    let lastHttpStatus: number | null = null;
    let lastRetryAfterHeader: string | null = null;
    const firstAttemptStartedAt = new Date();
    const firstAttemptStartedAtMs = Date.now();
    let lastErrorCategory: string | null = null;
    let lastMissingKeyCount = 0;
    let lastExtraKeyCount = 0;
    let lastEmptyValueCount = 0;
    let modelUsed = modelName;
    let fallbackTriggered = false;
    let fallbackReason: string | null = null;
    let lastUsage: Pick<
      ChunkExecutionResult,
      "usageInputTokens" | "usageOutputTokens" | "usageTotalTokens" | "usageClassification"
    > = {
      usageInputTokens: null,
      usageOutputTokens: null,
      usageTotalTokens: null,
      usageClassification: null,
    };

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
        lastUsage = {
          usageInputTokens: requestResult.usage.inputTokens,
          usageOutputTokens: requestResult.usage.outputTokens,
          usageTotalTokens: requestResult.usage.totalTokens ?? requestResult.tokensUsed,
          usageClassification: requestResult.usageClassification,
        };

        if (!requestResult.outputText) {
          attempts.push({
            attemptNumber: providerAttemptNumber,
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
              attemptNumber: providerAttemptNumber,
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
                attemptNumber: providerAttemptNumber,
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
              attemptNumber: providerAttemptNumber,
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
              failureStage: null,
              lastValidationStage: "integrity_validation",
              emptyOutputStage: null,
              status: "COMPLETED",
              errorCategory: null,
            });
            return {
              chunkIndex: chunk.chunkIndex,
              enhancedByIndex: validated.enhancedByIndex,
              retryCount: providerAttemptNumber - 1,
              attemptNumber: providerAttemptNumber,
              retryableFailure: false,
              httpStatus: null,
              retryAfterHeader: null,
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
              fallbackModel: null,
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
              ...lastUsage,
            };
          } catch (validationError) {
            const category =
              validationError instanceof ChunkValidationError
                ? validationError.category
                : classifyChunkError(validationError).category;
            attempts.push({
              attemptNumber: providerAttemptNumber,
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
            attemptNumber: providerAttemptNumber,
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
            attemptNumber: providerAttemptNumber,
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
            failureStage: null,
            lastValidationStage: "integrity_validation",
            emptyOutputStage: null,
            status: "COMPLETED",
            errorCategory: null,
          });
          return {
            chunkIndex: chunk.chunkIndex,
            enhancedByIndex: validated.enhancedByIndex,
            retryCount: providerAttemptNumber - 1,
            attemptNumber: providerAttemptNumber,
            retryableFailure: false,
            httpStatus: null,
            retryAfterHeader: null,
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
            fallbackModel: null,
            attempts,
            outputMode,
            ...lastUsage,
          };
        } catch (validationError) {
          const category =
            validationError instanceof ChunkValidationError
              ? validationError.category
              : classifyChunkError(validationError).category;
          attempts.push({
            attemptNumber: providerAttemptNumber,
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
              attemptNumber: providerAttemptNumber,
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
        lastRetryable = classified.retryable;
        if (error instanceof TranscriptEnhancementProviderHttpError) {
          lastHttpStatus = error.httpStatus;
          lastRetryAfterHeader = error.retryAfterHeader;
        }
        // No provider-internal backoff: the D1 retry owner schedules delays.
      }
    }

    return {
      chunkIndex: chunk.chunkIndex,
      enhancedByIndex: new Map<number, string>(),
      retryCount: providerAttemptNumber - 1,
      attemptNumber: providerAttemptNumber,
      retryableFailure: lastRetryable || isRetryableProviderCategory(lastErrorCategory),
      httpStatus: lastHttpStatus,
      retryAfterHeader: lastRetryAfterHeader,
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
      fallbackModel: null,
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
      ...lastUsage,
    };
  }

  const schedulingAbort: { reason: EnhancementChunkStartRejectionReason | null } = {
    reason: null,
  };
  const schedulingStopped = () => schedulingAbort.reason != null;
  const recordStartRejection = (reason: EnhancementChunkStartRejectionReason) => {
    if (isAbortingChunkStartRejection(reason)) {
      schedulingAbort.reason = reason;
    }
  };

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      if (schedulingStopped()) break;
      const currentIndex = workerCursor;
      workerCursor += 1;
      if (currentIndex >= chunks.length) break;
      const chunk = chunks[currentIndex];
      if (options?.skipChunkIndexes?.has(chunk.chunkIndex)) {
        const restored = new Map<number, string>();
        for (const target of chunk.targets) {
          const text = options.restoredEnhancedByIndex?.get(target.sourceIndex);
          if (typeof text === "string") {
            restored.set(target.sourceIndex, text);
          }
        }
        chunkResults[currentIndex] = {
          chunkIndex: chunk.chunkIndex,
          enhancedByIndex: restored,
          retryCount: 0,
          modelUsed: modelName,
          fallbackTriggered: false,
          fallbackReason: null,
          startedAt: null,
          finishedAt: null,
          latencyMs: 0,
          status: "COMPLETED",
          errorCategory: null,
          warnings: [],
          primaryModel: modelName,
          fallbackModel: null,
          attempts: [],
          outputMode,
        };
        continue;
      }
      const attempt = options?.attemptByChunkIndex?.get(chunk.chunkIndex) ?? {
        attemptNumber: 1,
        flavor: "same_request" as const,
      };
      // 1. abort check (no slot)
      // 2. acquire DB provider slot (withProviderSlot waits without Transcript lock)
      // 3. authoritative start checkpoint
      // 4. REJECTED: release slot, no attempt increment, no HTTP
      // 5. ACCEPTED: attemptCount already persisted; one HTTP POST
      // 6/7. release slot in finally
      const run = async () => {
        if (schedulingStopped()) {
          throw new ChunkStartRejectedError(schedulingAbort.reason ?? "JOB_TERMINAL");
        }
        const decision = await options?.onChunkStart?.(chunk);
        if (decision && decision.status === "REJECTED") {
          throw new ChunkStartRejectedError(decision.reason);
        }
        return processChunk(chunk, attempt);
      };
      try {
        const result = options?.withProviderSlot ? await options.withProviderSlot(run) : await run();
        chunkResults[currentIndex] = result;
        await options?.onChunkFinish?.(result, chunk);
      } catch (error) {
        if (error instanceof ChunkStartRejectedError) {
          recordStartRejection(error.reason);
          continue;
        }
        throw error;
      }
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

  for (const result of chunkResults) {
    if (!result) continue;
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
      if (result.errorCategory) {
        warnings.push(`chunk_${result.chunkIndex}:${result.errorCategory}`);
      }
    }
  }

  let changedSegmentCount = 0;
  const targetPieces = chunks.flatMap((chunk) => chunk.targets);
  const reconstructed = reconstructTranscriptEnhancementCoverage({
    sourceSegments: segments,
    targetPieces,
    enhancedByIndex: resultByIndex,
  });
  const fallbackSegmentCount = reconstructed.fallbackSourceIndexes.size;
  const mergedSegments: TranscriptEnhancementRawSegment[] = segments.map((segment) => {
    const cleanedText =
      reconstructed.textBySourceIndex.get(segment.index) ??
      segment.originalText;
    const changed = cleanedText.trim() !== segment.originalText.trim();
    if (changed) changedSegmentCount += 1;
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
      : failedChunkCount > 0 || fallbackSegmentCount > 0
        ? "PARTIAL"
        : "COMPLETED";

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
      mode: configuredMode === "single" && chunks.length === 1 ? "single" : "chunked",
      model: modelName,
      primaryModel: modelName,
      fallbackModel: null,
      fallbackTriggered: fallbackTriggeredAny,
      fallbackReason: fallbackReasons.size > 0 ? Array.from(fallbackReasons).join(",") : null,
      outputMode,
      structuredOutputEnabled,
      schemaVersion: structuredOutputEnabled ? TRANSCRIPT_ENHANCEMENT_SCHEMA_VERSION : null,
      schemaChunkCount: structuredOutputEnabled ? chunks.length : 0,
      oversizedSegmentCount: new Set(
        targetPieces
          .filter((piece) => piece.pieceCount > 1)
          .map((piece) => piece.sourceIndex),
      ).size,
      splitPieceCount: targetPieces.filter(
        (piece) => piece.pieceCount > 1,
      ).length,
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
        const sourceIndexes = new Set(
          chunk.targets.map((target) => target.sourceIndex),
        );
        return {
          chunkIndex: chunk.chunkIndex,
          targetSegmentCount: sourceIndexes.size,
          targetPieceCount: chunk.targets.length,
          sourceSegmentCount: sourceIndexes.size,
          targetSegmentStartIndex: chunk.targets[0]?.sourceIndex ?? 0,
          targetSegmentEndIndex:
            chunk.targets[chunk.targets.length - 1]?.sourceIndex ?? 0,
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
  options?: EnhanceTranscriptOptions,
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

  return runChunkedEnhancement({
    segments,
    apiKey,
    folderId,
    modelName,
    baseUrl,
    options,
  });
}
