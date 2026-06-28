import {
  buildDiarizedText,
  type NormalizedSegment,
} from "@/lib/transcription/speaker-labels";
import {
  getYandexSpeechKitContainerOverride,
  getYandexSpeechKitLanguage,
  getYandexSpeechKitModel,
  isYandexSpeechKitLiteratureTextEnabled,
  isYandexSpeechKitPhoneFormattingEnabled,
  isYandexSpeechKitProfanityFilterEnabled,
  isYandexSpeechKitSpeakerLabelingEnabled,
  isYandexSpeechKitTextNormalizationEnabled,
  isYandexTranscriptEnhancementEnabled,
  type YandexSpeechKitContainerType,
} from "@/lib/env";
import {
  enhanceTranscriptWithYandexAi,
  type TranscriptEnhancementInputSegment,
} from "@/lib/services/yandex-transcript-enhancement";
import type {
  DiarizationStatus,
  TranscriptionLanguageHint,
  TranscriptionResult,
} from "@/lib/services/openai-transcription";

type YandexOperation = {
  id?: string;
  done?: boolean;
  error?: {
    message?: string;
  };
};

const SUBMIT_TIMEOUT_MS = 180_000;
const RESULT_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 10 * 60_000;
const GET_RECOGNITION_RETRIES = 4;

function getSpeechKitBaseUrl(): string {
  return (process.env.YANDEX_SPEECHKIT_BASE_URL?.trim() ||
    "https://stt.api.cloud.yandex.net").replace(/\/$/, "");
}

function getOperationsBaseUrl(): string {
  return (process.env.YANDEX_OPERATION_BASE_URL?.trim() ||
    "https://operation.api.cloud.yandex.net").replace(/\/$/, "");
}

function languageHintToCode(hint: TranscriptionLanguageHint): string | null {
  if (hint === "ru") return "ru-RU";
  if (hint === "en") return "en-US";
  return null;
}

function inferContainerTypeFromInput(
  fileName?: string,
  mimeType?: string,
): YandexSpeechKitContainerType {
  const override = getYandexSpeechKitContainerOverride();
  if (override) return override;

  const normalizedMime = mimeType?.toLowerCase() ?? "";
  if (normalizedMime.includes("wav")) return "WAV";
  if (
    normalizedMime.includes("ogg") ||
    normalizedMime.includes("opus") ||
    normalizedMime.includes("webm")
  ) {
    return "OGG_OPUS";
  }
  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3")) return "MP3";

  const normalizedFileName = fileName?.toLowerCase() ?? "";
  if (normalizedFileName.endsWith(".wav")) return "WAV";
  if (
    normalizedFileName.endsWith(".ogg") ||
    normalizedFileName.endsWith(".opus") ||
    normalizedFileName.endsWith(".webm")
  ) {
    return "OGG_OPUS";
  }
  return "MP3";
}

function detectAsrArtifacts(segments: NormalizedSegment[]): {
  hasArtifacts: boolean;
  signals: string[];
} {
  if (segments.length === 0) {
    return { hasArtifacts: false, signals: [] };
  }

  const joined = segments.map((segment) => segment.text).join(" ");
  const normalized = joined.replace(/\s+/g, " ").trim();
  const signals = new Set<string>();

  // Repeated consecutive words: "да да", "я я".
  if (/\b([A-Za-zА-Яа-яЁё0-9]+)\s+\1\b/iu.test(normalized)) {
    signals.add("repeated_words");
  }
  // Broken word boundaries / stutters with hyphen artifacts.
  if (/\b[А-Яа-яЁёA-Za-z]-\s*[А-Яа-яЁёA-Za-z]\b/u.test(normalized)) {
    signals.add("broken_word_boundaries");
  }
  // Excessive filler disfluencies often produced by ASR noise.
  if (/\b(э+|эм+|мм+)\b/iu.test(normalized)) {
    signals.add("filler_noise");
  }

  return {
    hasArtifacts: signals.size > 0,
    signals: [...signals],
  };
}

async function fetchJsonWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; text: string; json: Record<string, unknown> | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = null;
    }
    return { response, text, json };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Yandex API network timeout. Check VPN split tunneling.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function extractOperationId(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  if (typeof payload.id === "string" && payload.id.trim()) return payload.id;
  const operation = payload.operation;
  if (
    operation &&
    typeof operation === "object" &&
    typeof (operation as Record<string, unknown>).id === "string"
  ) {
    return String((operation as Record<string, unknown>).id);
  }
  return null;
}

function toSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value / 1000;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed / 1000;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractLabel(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeStreamingResponses(payload: Record<string, unknown> | null): unknown[] {
  if (!payload) return [];
  if (Array.isArray(payload.streaming_responses)) return payload.streaming_responses;
  if (Array.isArray(payload.streamingResponses)) return payload.streamingResponses;

  const result = payload.result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (Array.isArray(record.streaming_responses)) return record.streaming_responses;
    if (Array.isArray(record.streamingResponses)) return record.streamingResponses;
  }
  return [];
}

function parseStreamingResponsesFromRawText(rawText: string): unknown[] {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return [];
  }

  // Sometimes SpeechKit-like APIs return JSONL/NDJSON streams.
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    const parsedLines: unknown[] = [];
    for (const line of lines) {
      try {
        parsedLines.push(JSON.parse(line) as unknown);
      } catch {
        // ignore malformed lines
      }
    }
    if (parsedLines.length > 0) {
      return parsedLines;
    }
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && typeof parsed === "object") {
      const normalized = normalizeStreamingResponses(parsed as Record<string, unknown>);
      if (normalized.length > 0) {
        return normalized;
      }
      return [parsed];
    }
  } catch {
    // no-op
  }

  return [];
}

function getAlternativesFromEntry(record: Record<string, unknown>): unknown[] {
  const finalRefinement = record.final_refinement as Record<string, unknown> | undefined;
  const normalized = finalRefinement?.normalized_text as
    | Record<string, unknown>
    | undefined;
  if (normalized && Array.isArray(normalized.alternatives)) {
    return normalized.alternatives;
  }

  const finalPart = record.final as Record<string, unknown> | undefined;
  if (finalPart && Array.isArray(finalPart.alternatives)) {
    return finalPart.alternatives;
  }

  if (Array.isArray(record.alternatives)) {
    return record.alternatives;
  }

  const partialPart = record.partial as Record<string, unknown> | undefined;
  if (partialPart && Array.isArray(partialPart.alternatives)) {
    return partialPart.alternatives;
  }

  return [];
}

function collectRecordsWithAlternatives(source: unknown): Record<string, unknown>[] {
  const stack: unknown[] = [source];
  const records: Record<string, unknown>[] = [];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (Array.isArray(current)) {
      for (const item of current) {
        stack.push(item);
      }
      continue;
    }
    if (typeof current !== "object") {
      continue;
    }

    const record = current as Record<string, unknown>;
    if (getAlternativesFromEntry(record).length > 0) {
      records.push(record);
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }

  return records;
}

function extractAlternativeText(alt: Record<string, unknown>): string {
  const directText =
    (typeof alt.normalized_text === "string" && alt.normalized_text.trim()) ||
    (typeof alt.normalizedText === "string" && alt.normalizedText.trim()) ||
    (typeof alt.text === "string" && alt.text.trim()) ||
    (typeof alt.transcript === "string" && alt.transcript.trim()) ||
    (typeof alt.utterance === "string" && alt.utterance.trim()) ||
    "";
  if (directText) {
    return directText;
  }

  const words = alt.words;
  if (!Array.isArray(words)) {
    return "";
  }
  return words
    .map((word) => {
      if (!word || typeof word !== "object") return "";
      const token = word as Record<string, unknown>;
      const value =
        (typeof token.text === "string" && token.text) ||
        (typeof token.word === "string" && token.word) ||
        "";
      return value.trim();
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

function selectBestAlternative(alternatives: unknown[]): Record<string, unknown> | null {
  let best: Record<string, unknown> | null = null;
  let bestScore = -1;

  for (const alternative of alternatives) {
    if (!alternative || typeof alternative !== "object") continue;
    const alt = alternative as Record<string, unknown>;
    const text = extractAlternativeText(alt);
    if (!text) continue;

    const confidence = toNumber(alt.confidence) ?? toNumber(alt.confidence_score) ?? 0;
    const score = text.length * 10 + confidence;
    if (score > bestScore) {
      bestScore = score;
      best = alt;
    }
  }

  return best;
}

function extractTextFallback(
  payload: Record<string, unknown> | null | undefined,
): string {
  if (!payload) return "";
  const directText = payload.text;
  if (typeof directText === "string" && directText.trim().length > 0) {
    return directText.trim();
  }

  const results: string[] = [];
  const stack: unknown[] = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    if (typeof current !== "object") continue;
    const record = current as Record<string, unknown>;
    const textCandidates = [
      record.text,
      record.normalized_text,
      record.normalizedText,
      record.transcript,
      record.utterance,
    ];
    for (const value of textCandidates) {
      if (typeof value === "string" && value.trim().length > 0) {
        results.push(value.trim());
      }
    }
    for (const value of Object.values(record)) {
      if (typeof value === "object" && value !== null) {
        stack.push(value);
      }
    }
  }
  return results.join(" ").trim();
}

function normalizeSpeakerLabel(raw: string, labelOrder: string[]): string {
  if (!labelOrder.includes(raw)) {
    labelOrder.push(raw);
  }
  const index = labelOrder.indexOf(raw) + 1;
  return `speaker_${index}`;
}

function extractSegmentsFromRecognition(responses: unknown[]): NormalizedSegment[] {
  const rawLabelOrder: string[] = [];
  const segments: NormalizedSegment[] = [];
  const timedIndexByKey = new Map<string, number>();

  for (const rootEntry of responses) {
    const records = collectRecordsWithAlternatives(rootEntry);
    for (const record of records) {
      const alternatives = getAlternativesFromEntry(record);
      if (alternatives.length === 0) continue;

      const responseLevelChannel =
        extractLabel(record.channel_tag) ??
        extractLabel(record.channelTag) ??
        extractLabel(record.speaker_tag) ??
        extractLabel(record.speakerTag);

      const bestAlt = selectBestAlternative(alternatives);
      if (bestAlt) {
        const alt = bestAlt;
      const text = extractAlternativeText(alt);
      if (!text) continue;

      const startSeconds =
        toSeconds(alt.start_time_ms ?? alt.startTimeMs) ??
        toNumber(alt.start_time_seconds ?? alt.startTimeSeconds);
      const endSeconds =
        toSeconds(alt.end_time_ms ?? alt.endTimeMs) ??
        toNumber(alt.end_time_seconds ?? alt.endTimeSeconds);
      const altChannel =
        extractLabel(alt.channel_tag) ??
        extractLabel(alt.channelTag) ??
        extractLabel(alt.speaker_tag) ??
        extractLabel(alt.speakerTag);
      const rawSpeaker = altChannel ?? responseLevelChannel;
      const speakerLabel = rawSpeaker
        ? normalizeSpeakerLabel(rawSpeaker, rawLabelOrder)
        : null;
      const nextSegment: NormalizedSegment = {
        speakerLabel,
        displaySpeakerLabel: speakerLabel
          ? `Speaker ${speakerLabel.split("_")[1] ?? "1"}`
          : null,
        startSeconds,
        endSeconds,
        text,
        orderIndex: segments.length,
      };

      // SpeechKit may emit multiple hypotheses for the same timed span.
      // Keep only one best segment per (speaker, start, end).
      if (startSeconds !== null || endSeconds !== null) {
        const timedKey = `${speakerLabel ?? ""}|${startSeconds ?? ""}|${endSeconds ?? ""}`;
        const existingIndex = timedIndexByKey.get(timedKey);
        if (existingIndex !== undefined) {
          const existing = segments[existingIndex];
          const existingLen = existing.text.trim().length;
          const nextLen = nextSegment.text.trim().length;
          if (nextLen > existingLen) {
            segments[existingIndex] = {
              ...nextSegment,
              orderIndex: existing.orderIndex,
            };
          }
          continue;
        }
        timedIndexByKey.set(timedKey, segments.length);
      }

      segments.push(nextSegment);
    }
  }
  }

  const seenTimedKeys = new Set<string>();
  const deduplicated: NormalizedSegment[] = [];

  for (const segment of segments) {
    const normalizedText = segment.text.replace(/\s+/g, " ").trim().toLowerCase();
    const speaker = segment.speakerLabel ?? "";
    const start = segment.startSeconds ?? null;
    const end = segment.endSeconds ?? null;

    const previous = deduplicated[deduplicated.length - 1];
    if (
      previous &&
      (previous.speakerLabel ?? "") === speaker &&
      previous.startSeconds === start &&
      previous.endSeconds === end &&
      previous.text.replace(/\s+/g, " ").trim().toLowerCase() === normalizedText
    ) {
      continue;
    }

    // Only globally dedupe timed segments to avoid removing legitimate repeated
    // short replies when provider doesn't return timestamps.
    if (start !== null || end !== null) {
      const timedKey = `${speaker}|${start ?? ""}|${end ?? ""}|${normalizedText}`;
      if (seenTimedKeys.has(timedKey)) {
        continue;
      }
      seenTimedKeys.add(timedKey);
    }

    deduplicated.push({
      ...segment,
      orderIndex: deduplicated.length,
    });
  }

  return deduplicated;
}

function resolveDiarization(segments: NormalizedSegment[]): {
  hasSpeakerDiarization: boolean;
  diarizationStatus: DiarizationStatus;
} {
  const uniqueLabels = new Set(
    segments.map((segment) => segment.speakerLabel).filter(Boolean),
  );

  if (uniqueLabels.size === 0) {
    return {
      hasSpeakerDiarization: false,
      diarizationStatus: "NO_SPEAKERS_DETECTED",
    };
  }

  if (uniqueLabels.size === 1) {
    return {
      hasSpeakerDiarization: false,
      diarizationStatus: "SINGLE_SPEAKER_ONLY",
    };
  }

  return {
    hasSpeakerDiarization: true,
    diarizationStatus: "COMPLETED",
  };
}

async function waitForOperation(
  operationId: string,
  headers: HeadersInit,
): Promise<{ operation: YandexOperation; attempts: number; elapsedMs: number }> {
  const operationsBase = getOperationsBaseUrl();
  const started = Date.now();
  let attempts = 0;

  while (Date.now() - started < POLL_TIMEOUT_MS) {
    attempts += 1;
    const { response, json, text } = await fetchJsonWithTimeout(
      `${operationsBase}/operations/${operationId}`,
      {
        method: "GET",
        headers,
      },
      RESULT_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new Error(
        `Yandex operation polling failed with HTTP ${response.status}: ${text.slice(0, 200)}`,
      );
    }

    const operation = (json ?? {}) as YandexOperation;
    if (operation.done) {
      return {
        operation,
        attempts,
        elapsedMs: Date.now() - started,
      };
    }

    console.info(`[SpeechKit] polling operation ${operationId}, attempt ${attempts}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Yandex SpeechKit polling timeout after 10 minutes.");
}

export async function transcribeAudioBufferWithYandexSpeechKit(
  buffer: Buffer,
  languageHint: TranscriptionLanguageHint,
  options?: {
    fileName?: string;
    mimeType?: string;
    forceEnhancementEnabled?: boolean;
    forceSpeechKitModel?: string;
    forceSpeechKitLanguage?: string;
    forceTextNormalizationEnabled?: boolean;
    forceLiteratureText?: boolean;
    forceProfanityFilter?: boolean;
    forcePhoneFormatting?: boolean;
    forceSpeakerLabelingEnabled?: boolean;
    forceContainerType?: YandexSpeechKitContainerType;
  },
): Promise<TranscriptionResult> {
  const transcriptionStartedAt = Date.now();
  const apiKey = process.env.YANDEX_API_KEY?.trim();
  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  if (!apiKey || !folderId) {
    throw new Error("Yandex SpeechKit configuration is missing.");
  }

  const speechBase = getSpeechKitBaseUrl();
  const model = options?.forceSpeechKitModel ?? getYandexSpeechKitModel();
  const languageCode =
    options?.forceSpeechKitLanguage ??
    languageHintToCode(languageHint) ??
    getYandexSpeechKitLanguage();
  const containerType =
    options?.forceContainerType ??
    inferContainerTypeFromInput(options?.fileName, options?.mimeType);
  const textNormalizationEnabled =
    options?.forceTextNormalizationEnabled ?? isYandexSpeechKitTextNormalizationEnabled();
  const literatureText =
    options?.forceLiteratureText ?? isYandexSpeechKitLiteratureTextEnabled();
  const profanityFilter =
    options?.forceProfanityFilter ?? isYandexSpeechKitProfanityFilterEnabled();
  const phoneFormatting =
    options?.forcePhoneFormatting ?? isYandexSpeechKitPhoneFormattingEnabled();
  const speakerLabelingEnabled =
    options?.forceSpeakerLabelingEnabled ?? isYandexSpeechKitSpeakerLabelingEnabled();
  const headers: HeadersInit = {
    Authorization: `Api-Key ${apiKey}`,
    "Content-Type": "application/json",
    "x-folder-id": folderId,
    "x-data-logging-enabled": "false",
  };

  const submitPayload = {
    content: buffer.toString("base64"),
    recognition_model: {
      model,
      audio_format: {
        container_audio: {
          container_audio_type: containerType,
        },
      },
      language_restriction: {
        restriction_type: "WHITELIST",
        language_code: [languageCode],
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
    },
    speaker_labeling: {
      speaker_labeling: speakerLabelingEnabled
        ? "SPEAKER_LABELING_ENABLED"
        : "SPEAKER_LABELING_DISABLED",
    },
  };

  const submitStartedAt = Date.now();
  const { response, json, text } = await fetchJsonWithTimeout(
    `${speechBase}/stt/v3/recognizeFileAsync`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(submitPayload),
    },
    SUBMIT_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(
      `Yandex SpeechKit submit failed with HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  const operationId = extractOperationId(json);
  if (!operationId) {
    throw new Error("Yandex SpeechKit did not return an operation id.");
  }

  const submitMs = Date.now() - submitStartedAt;
  const waitResult = await waitForOperation(operationId, headers);
  const operationPollMs = waitResult.elapsedMs;
  if (waitResult.operation.error?.message) {
    throw new Error(`Yandex SpeechKit operation failed: ${waitResult.operation.error.message}`);
  }

  let segments: NormalizedSegment[] = [];
  let plainText = "";
  let getRecognitionAttempts = 0;
  let getRecognitionFetchMs = 0;
  let getRecognitionRetryWaitMs = 0;
  const getRecognitionStartedAt = Date.now();

  while (getRecognitionAttempts <= GET_RECOGNITION_RETRIES) {
    getRecognitionAttempts += 1;
    const getRecognitionFetchStartedAt = Date.now();
    const resultFetch = await fetchJsonWithTimeout(
      `${speechBase}/stt/v3/getRecognition?operation_id=${encodeURIComponent(operationId)}`,
      {
        method: "GET",
        headers,
      },
      RESULT_TIMEOUT_MS,
    );
    getRecognitionFetchMs += Date.now() - getRecognitionFetchStartedAt;

    if (!resultFetch.response.ok) {
      throw new Error(
        `Yandex SpeechKit result fetch failed with HTTP ${resultFetch.response.status}: ${resultFetch.text.slice(0, 300)}`,
      );
    }

    const responses = normalizeStreamingResponses(resultFetch.json);
    const rawResponses =
      responses.length > 0
        ? responses
        : parseStreamingResponsesFromRawText(resultFetch.text);
    segments = extractSegmentsFromRecognition(rawResponses);
    const plainTextFromSegments = segments
      .map((segment) => segment.text)
      .join(" ")
      .trim();
    plainText =
      plainTextFromSegments.length > 0
        ? plainTextFromSegments
        : extractTextFallback(resultFetch.json) ||
          extractTextFallback(
            parseStreamingResponsesFromRawText(resultFetch.text)[0] as
              | Record<string, unknown>
              | undefined
              | null,
          );

    if (segments.length > 0 || plainText.trim().length > 0) {
      break;
    }

    if (getRecognitionAttempts <= GET_RECOGNITION_RETRIES) {
      const retryWaitStartedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      getRecognitionRetryWaitMs += Date.now() - retryWaitStartedAt;
    }
  }
  const getRecognitionTotalMs = Date.now() - getRecognitionStartedAt;
  let normalizedSegments =
    segments.length > 0
      ? segments
      : plainText.length > 0
        ? [
            {
              speakerLabel: null,
              displaySpeakerLabel: null,
              startSeconds: null,
              endSeconds: null,
              text: plainText,
              orderIndex: 0,
            },
          ]
        : [];
  const enhancementFeatureEnabled = isYandexTranscriptEnhancementEnabled();
  const enhancementRequested = options?.forceEnhancementEnabled === true;
  const artifactDetection = detectAsrArtifacts(normalizedSegments);
  const enhancementRecommendation = {
    available: enhancementFeatureEnabled,
    suggested:
      enhancementFeatureEnabled &&
      (!textNormalizationEnabled || artifactDetection.hasArtifacts),
    reasons: [
      ...(!textNormalizationEnabled ? ["normalization_disabled"] : []),
      ...(artifactDetection.hasArtifacts
        ? [`asr_artifacts:${artifactDetection.signals.join(",")}`]
        : []),
    ],
    asrArtifactsDetected: artifactDetection.hasArtifacts,
    normalizationEnabled: textNormalizationEnabled,
  };
  let enhancementMs = 0;
  let enhancementApplied = false;
  let enhancementFallbackReason: string | null = null;
  if (enhancementRequested && normalizedSegments.length > 0) {
    const enhancementInput: TranscriptEnhancementInputSegment[] = normalizedSegments.map(
      (segment) => ({
        index: segment.orderIndex,
        speakerLabel: segment.displaySpeakerLabel ?? "Speaker",
        startMs:
          segment.startSeconds !== null ? Math.round(segment.startSeconds * 1000) : null,
        endMs:
          segment.endSeconds !== null ? Math.round(segment.endSeconds * 1000) : null,
        originalText: segment.text,
      }),
    );

    try {
      const enhancementStartedAt = Date.now();
      const enhanced = await enhanceTranscriptWithYandexAi(enhancementInput);
      enhancementMs = Date.now() - enhancementStartedAt;
      const byIndex = new Map(enhanced.segments.map((segment) => [segment.index, segment]));
      const isValid =
        enhanced.segments.length === normalizedSegments.length &&
        normalizedSegments.every((segment) => byIndex.has(segment.orderIndex));

      if (!isValid) {
        enhancementFallbackReason = "validation_failed";
        console.warn(
          "[SpeechKit] transcript enhancement validation failed: segment count/index mismatch.",
        );
      } else {
        enhancementApplied = true;
        enhancementRecommendation.suggested = false;
        normalizedSegments = normalizedSegments.map((segment) => {
          const replacement = byIndex.get(segment.orderIndex)!;
          return {
            ...segment,
            text: replacement.cleanedText || segment.text,
          };
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown enhancement error.";
      enhancementFallbackReason = "request_failed";
      console.warn(`[SpeechKit] transcript enhancement skipped: ${message}`);
    }
  }

  const textFromSegments = normalizedSegments
    .map((segment) => segment.text)
    .join(" ")
    .trim();
  plainText = textFromSegments.length > 0 ? textFromSegments : plainText;

  const diarizedText =
    normalizedSegments.length > 0 ? buildDiarizedText(normalizedSegments) : null;
  const diarization = resolveDiarization(normalizedSegments);
  const totalMs = Date.now() - transcriptionStartedAt;

  if (normalizedSegments.length === 0 && plainText.trim().length === 0) {
    throw new Error(
      `Yandex SpeechKit returned empty recognition payload after ${getRecognitionAttempts} attempts.`,
    );
  }

  return {
    text: plainText,
    model: `speechkit:${model}`,
    language: languageCode,
    hasSpeakerDiarization: diarization.hasSpeakerDiarization,
    diarizationStatus: diarization.diarizationStatus,
    diarizationProvider: "yandex_speechkit",
    segments: normalizedSegments,
    diarizedText,
    warnings: [],
    strategy: "diarize_only",
    qualityPassStatus: "SKIPPED",
    processingTimings: {
      provider: "yandex_speechkit",
      totalMs,
      stages: {
        submitMs,
        operationPollMs,
        getRecognitionTotalMs,
        getRecognitionFetchMs,
        getRecognitionRetryWaitMs,
        enhancementMs,
      },
      counters: {
        operationPollAttempts: waitResult.attempts,
        getRecognitionAttempts,
        segmentsCount: normalizedSegments.length,
      },
      flags: {
        enhancementFeatureEnabled,
        enhancementRequested,
        enhancementSuggested: enhancementRecommendation.suggested,
        enhancementApplied,
        enhancementFallbackReason,
      },
    },
    enhancementRecommendation,
  };
}
