import OpenAI from "openai";
import type { TranscriptionDiarized } from "openai/resources/audio/transcriptions";

import { ExternalService } from "@/app/generated/prisma/client";
import {
  buildDiarizedText,
  getDisplaySpeakerLabel,
  getUniqueSpeakerLabels,
  normalizeDiarizationResponse,
  type NormalizedSegment,
} from "@/lib/transcription/speaker-labels";
import { handleExternalServiceFailure } from "@/lib/services/external-service-events";
import {
  getOpenAiTranscriptionConfig,
  type OpenAiTranscriptionConfig,
} from "@/lib/audio/openai-transcription-config";
import {
  getTwoPassTranscriptionConfig,
  type TranscriptionStrategy,
} from "@/lib/audio/two-pass-transcription-config";
import {
  alignQualityTranscriptToDiarizedSegments,
  type AlignmentResult,
} from "@/lib/transcription/alignment";

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function createOpenAiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OpenAI API key is missing.");
  }

  return new OpenAI({ apiKey });
}

export async function checkOpenAiHealth() {
  if (!isOpenAiConfigured()) {
    return {
      ok: false,
      message: "OpenAI API key is missing.",
    };
  }

  try {
    const client = createOpenAiClient();
    await client.models.list();
    return {
      ok: true,
      message: "OpenAI API key validated.",
    };
  } catch (error) {
    const classified = await handleExternalServiceFailure(
      ExternalService.OPENAI,
      error,
      { context: "health" },
    );
    return {
      ok: false,
      message: classified.message,
    };
  }
}

export type TranscriptionLanguageHint = "ru" | "en" | "auto";

export type TranscriptionWarningCode =
  | "DIARIZATION_FAILED"
  | "NO_SPEAKER_LABELS"
  | "SPEAKER_LABELS_NOT_RETURNED"
  | "QUALITY_PASS_FAILED"
  | "ALIGNMENT_FAILED"
  | "UNSUPPORTED_PARAM_SKIPPED";

export type DiarizationStatus =
  | "NOT_REQUESTED"
  | "REQUESTED"
  | "COMPLETED"
  | "FAILED"
  | "NO_SPEAKERS_DETECTED"
  | "SINGLE_SPEAKER_ONLY";

export type QualityPassStatus =
  | "OK"
  | "LOW_CONFIDENCE"
  | "FAILED"
  | "SKIPPED";

export type TranscriptionResult = {
  text: string;
  model: string;
  language: string | null;
  hasSpeakerDiarization: boolean;
  diarizationStatus: DiarizationStatus;
  diarizationProvider: string;
  segments: NormalizedSegment[];
  diarizedText: string | null;
  warnings: TranscriptionWarningCode[];
  // Two-pass fields (present when strategy=diarize_plus_quality)
  strategy?: TranscriptionStrategy;
  qualityModel?: string;
  qualityPassStatus?: QualityPassStatus;
  alignmentResult?: AlignmentResult;
  qualityPromptMetadata?: QualityPromptMetadata;
  processingTimings?: {
    provider: string;
    totalMs: number;
    stages: Record<string, number>;
    counters?: Record<string, number>;
    flags?: Record<string, boolean | string | number | null>;
  };
  enhancementRecommendation?: {
    available: boolean;
    suggested: boolean;
    reasons: string[];
    asrArtifactsDetected: boolean;
    normalizationEnabled: boolean;
  };
};

export type QualityPromptMetadata = {
  promptEnabled: boolean;
  promptLanguage: string | null;
  promptTermsCount: number;
  promptContextSources: string[];
};

// Fallback model used when primary and diarization both fail
const WHISPER_FALLBACK_MODEL = "whisper-1";
const SUPPORTED_DIARIZATION_MODEL = "gpt-4o-transcribe-diarize";

function resolveDiarizationModel(modelFromConfig: string): string {
  if (modelFromConfig.toLowerCase().includes("diarize")) {
    return modelFromConfig;
  }

  // Some OpenAI transcription models do not accept `diarized_json`.
  // Force a diarization-capable model to avoid hard failure.
  return SUPPORTED_DIARIZATION_MODEL;
}

// gpt-4o-transcribe-diarize does NOT support the `prompt` parameter.
// Passing one causes a 400 error, which silently falls through to the non-diarized
// plain-transcription fallback — the root cause of missing speaker labels.
// This function is intentionally removed; the diarization call omits prompt entirely.

function isDiarizedResponse(
  response: OpenAI.Audio.Transcriptions.TranscriptionCreateResponse,
): response is TranscriptionDiarized {
  return "segments" in response && Array.isArray(response.segments);
}

function extractSegmentsWithSpeakerFallback(
  response: OpenAI.Audio.Transcriptions.TranscriptionCreateResponse,
): NormalizedSegment[] {
  if (!("segments" in response) || !Array.isArray(response.segments)) {
    return [];
  }

  const rawSegments = response.segments
    .map((segment, orderIndex) => {
      if (!segment || typeof segment.text !== "string") {
        return null;
      }

      const rawSpeaker =
        "speaker" in segment && typeof segment.speaker === "string"
          ? segment.speaker
          : null;
      const startSeconds =
        "start" in segment && typeof segment.start === "number"
          ? segment.start
          : null;
      const endSeconds =
        "end" in segment && typeof segment.end === "number" ? segment.end : null;

      return {
        rawSpeaker,
        startSeconds,
        endSeconds,
        text: segment.text.trim(),
        orderIndex,
      };
    })
    .filter(
      (
        segment,
      ): segment is {
        rawSpeaker: string | null;
        startSeconds: number | null;
        endSeconds: number | null;
        text: string;
        orderIndex: number;
      } => Boolean(segment && segment.text.length > 0),
    );

  if (rawSegments.length === 0) {
    return [];
  }

  const hasSpeakerLabels = rawSegments.some((segment) => Boolean(segment.rawSpeaker));
  const speakerOrder = hasSpeakerLabels
    ? [
        ...new Set(
          rawSegments
            .map((segment) => segment.rawSpeaker)
            .filter((speaker): speaker is string => Boolean(speaker)),
        ),
      ]
    : [];

  return rawSegments.map((segment) => {
    // Do NOT default to "speaker_1" when the provider returned no speaker labels.
    // A null speakerLabel signals that no diarization was performed.
    const speakerLabel = segment.rawSpeaker ?? null;
    return {
      speakerLabel,
      displaySpeakerLabel: speakerLabel
        ? getDisplaySpeakerLabel(speakerLabel, speakerOrder)
        : null,
      startSeconds: segment.startSeconds,
      endSeconds: segment.endSeconds,
      text: segment.text,
      orderIndex: segment.orderIndex,
    };
  });
}

async function transcribePlain(
  client: OpenAI,
  file: File,
  model: string,
  config: OpenAiTranscriptionConfig,
  language?: string,
  prompt?: string,
  temperature?: number,
) {
  const request: Record<string, unknown> = {
    file,
    model,
    response_format: "verbose_json",
    ...(config.useTimestamps
      ? {
          timestamp_granularities: [config.timestampGranularity],
        }
      : {}),
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };

  const response = (await client.audio.transcriptions.create(
    request as unknown as Parameters<typeof client.audio.transcriptions.create>[0],
  )) as unknown as OpenAI.Audio.Transcriptions.TranscriptionCreateResponse;

  const segments = extractSegmentsWithSpeakerFallback(response);

  return {
    text: "text" in response ? response.text : "",
    model,
    language: language ?? null,
    segments,
    diarizedText: buildDiarizedText(segments),
  };
}

/**
 * Quality pass: plain transcription with domain prompt support.
 * Used by both the quality_only strategy and the second pass of diarize_plus_quality.
 *
 * Does NOT pass: prompt to diarization-only models, logprobs, diarization params.
 * Skips unsupported params gracefully and writes warnings to metadata.
 */
async function transcribeWithQuality(
  client: OpenAI,
  file: File,
  qualityModel: string,
  language: string | undefined,
  prompt: string | undefined,
  temperature: number,
): Promise<{
  text: string;
  model: string;
  language: string | null;
  unsupportedParamWarnings: string[];
}> {
  const unsupportedParamWarnings: string[] = [];

  // Models that contain "diarize" do NOT support prompt — skip it gracefully
  if (prompt && qualityModel.toLowerCase().includes("diarize")) {
    unsupportedParamWarnings.push(
      `Model ${qualityModel} does not support 'prompt'; skipped.`,
    );
    prompt = undefined;
  }

  const request: Record<string, unknown> = {
    file,
    model: qualityModel,
    response_format: "text",
    ...(language ? { language } : {}),
    ...(prompt ? { prompt } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };

  const response = (await client.audio.transcriptions.create(
    request as unknown as Parameters<typeof client.audio.transcriptions.create>[0],
  )) as unknown as { text?: string } | string;

  const text =
    typeof response === "string"
      ? response
      : typeof response === "object" && response !== null && "text" in response
        ? String(response.text ?? "")
        : "";

  return {
    text: text.trim(),
    model: qualityModel,
    language: language ?? null,
    unsupportedParamWarnings,
  };
}

function computeDiarizationStatus(
  hasSpeakerDiarization: boolean,
  segments: NormalizedSegment[],
  warning: TranscriptionWarningCode | null,
): DiarizationStatus {
  if (!hasSpeakerDiarization) {
    if (warning === "DIARIZATION_FAILED") return "FAILED";
    if (warning === "NO_SPEAKER_LABELS") return "NO_SPEAKERS_DETECTED";
    if (warning === "SPEAKER_LABELS_NOT_RETURNED") return "NO_SPEAKERS_DETECTED";
    return "NOT_REQUESTED";
  }

  const uniqueLabels = new Set(
    segments.map((s) => s.speakerLabel).filter(Boolean),
  );

  if (uniqueLabels.size <= 1) {
    return "SINGLE_SPEAKER_ONLY";
  }

  return "COMPLETED";
}

async function transcribeWithDiarization(
  client: OpenAI,
  file: File,
  language: string | undefined,
  config: OpenAiTranscriptionConfig,
  options?: { sessionId?: string; recordingId?: string },
): Promise<{
  result: TranscriptionResult | null;
  diarizationError: unknown | null;
}> {
  const diarizationModel = resolveDiarizationModel(config.model);

  try {
    const response = (await client.audio.transcriptions.create({
      file,
      model: diarizationModel,
      response_format: "diarized_json",
      chunking_strategy: "auto",
      ...(language ? { language } : {}),
      // NOTE: gpt-4o-transcribe-diarize does NOT support `prompt`, `logprobs`,
      // or `timestamp_granularities`. Passing `prompt` returns a 400 error and
      // causes silent fallback to the non-diarized model.
    } as Parameters<typeof client.audio.transcriptions.create>[0])) as unknown as OpenAI.Audio.Transcriptions.TranscriptionCreateResponse;

    if (!isDiarizedResponse(response)) {
      const fallbackSegments = extractSegmentsWithSpeakerFallback(response);
      return {
        result: {
          text: "text" in response ? response.text : "",
          model: diarizationModel,
          language: language ?? null,
          hasSpeakerDiarization: false,
          diarizationStatus: "NO_SPEAKERS_DETECTED" as DiarizationStatus,
          diarizationProvider: diarizationModel,
          segments: fallbackSegments,
          diarizedText: buildDiarizedText(fallbackSegments),
          warnings: ["SPEAKER_LABELS_NOT_RETURNED"] as TranscriptionWarningCode[],
        },
        diarizationError: null,
      };
    }

    const segments = normalizeDiarizationResponse(response);
    const speakerLabels = getUniqueSpeakerLabels(segments);

    if (segments.length === 0 || speakerLabels.length === 0) {
      return {
        result: {
          text: response.text,
          model: diarizationModel,
          language: language ?? null,
          hasSpeakerDiarization: false,
          diarizationStatus: "NO_SPEAKERS_DETECTED" as DiarizationStatus,
          diarizationProvider: diarizationModel,
          segments,
          diarizedText: buildDiarizedText(segments),
          warnings: ["NO_SPEAKER_LABELS"] as TranscriptionWarningCode[],
        },
        diarizationError: null,
      };
    }

    const diarizedText = buildDiarizedText(segments);
    const diarizationStatus = computeDiarizationStatus(true, segments, null);

    return {
      result: {
        text: response.text,
        model: diarizationModel,
        language: language ?? null,
        hasSpeakerDiarization: speakerLabels.length > 1,
        diarizationStatus,
        diarizationProvider: diarizationModel,
        segments,
        diarizedText,
        warnings: [] as TranscriptionWarningCode[],
      },
      diarizationError: null,
    };
  } catch (error) {
    await handleExternalServiceFailure(ExternalService.OPENAI, error, {
      sessionId: options?.sessionId,
      recordingId: options?.recordingId,
      context: "diarization",
    });

    return { result: null, diarizationError: error };
  }
}

// ---------------------------------------------------------------------------
// Two-pass: diarize_plus_quality
// ---------------------------------------------------------------------------

/**
 * Two-pass transcription: diarization pass + quality pass + alignment.
 *
 * 1. Diarization pass: speaker labels + timestamps
 * 2. Quality pass: improved text with domain prompt
 * 3. Alignment: merge quality text back onto diarized segments
 *
 * On quality pass failure: returns diarized result with qualityPassStatus=LOW_CONFIDENCE.
 * On alignment failure: same — diarized text is the final text.
 * Speaker labels and timestamps are NEVER destroyed.
 */
async function transcribeAudioBufferTwoPass(
  client: OpenAI,
  file: File,
  language: string | undefined,
  config: OpenAiTranscriptionConfig,
  options?: { sessionId?: string; recordingId?: string; prompt?: string },
): Promise<TranscriptionResult> {
  const twoPassConfig = getTwoPassTranscriptionConfig();
  const warnings: TranscriptionWarningCode[] = [];

  // ── Pass 1: diarization ──────────────────────────────────────────────────
  const { result: diarizedResult, diarizationError } =
    await transcribeWithDiarization(client, file, language, config, options);

  if (!diarizedResult) {
    // Diarization failed — cannot proceed with two-pass
    throw new Error(
      diarizationError instanceof Error
        ? diarizationError.message
        : "Diarization pass failed.",
    );
  }

  // ── Pass 2: quality transcription ────────────────────────────────────────
  const qualityModel = twoPassConfig.qualityModel;
  const qualityLanguage =
    twoPassConfig.qualityLanguage === "auto" ? undefined : twoPassConfig.qualityLanguage;
  const qualityTemp = twoPassConfig.qualityTemperature;
  const useQualityPrompt = twoPassConfig.qualityPromptEnabled;
  const qualityPrompt = useQualityPrompt ? options?.prompt : undefined;

  let qualityText: string | null = null;
  let qualityPassStatus: QualityPassStatus = "SKIPPED";
  let qualityModel_used = qualityModel;
  let unsupportedParamWarnings: string[] = [];
  const promptMetadata: QualityPromptMetadata = {
    promptEnabled: useQualityPrompt,
    promptLanguage: qualityLanguage ?? "auto",
    promptTermsCount: 0,
    promptContextSources: [],
  };

  try {
    const qualityResult = await transcribeWithQuality(
      client,
      file,
      qualityModel,
      qualityLanguage,
      qualityPrompt,
      qualityTemp,
    );
    qualityText = qualityResult.text || null;
    qualityModel_used = qualityResult.model;
    unsupportedParamWarnings = qualityResult.unsupportedParamWarnings;
    qualityPassStatus = qualityText ? "OK" : "SKIPPED";

    if (unsupportedParamWarnings.length > 0) {
      warnings.push("UNSUPPORTED_PARAM_SKIPPED");
    }
  } catch (qualityError) {
    await handleExternalServiceFailure(ExternalService.OPENAI, qualityError, {
      sessionId: options?.sessionId,
      recordingId: options?.recordingId,
      context: "quality_transcription",
    });
    warnings.push("QUALITY_PASS_FAILED");
    qualityPassStatus = "FAILED";
  }

  // ── Pass 3: alignment ────────────────────────────────────────────────────
  let alignmentResult: AlignmentResult | undefined;

  if (qualityText && diarizedResult.segments.length > 0) {
    try {
      alignmentResult = alignQualityTranscriptToDiarizedSegments(
        diarizedResult.segments.map((s) => ({
          speakerLabel: s.speakerLabel,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
          text: s.text,
          orderIndex: s.orderIndex,
        })),
        qualityText,
      );

      if (
        alignmentResult.alignmentStatus === "FAILED" ||
        alignmentResult.overallConfidence < 0.5
      ) {
        warnings.push("ALIGNMENT_FAILED");
        qualityPassStatus = qualityPassStatus === "OK" ? "LOW_CONFIDENCE" : qualityPassStatus;
      }
    } catch {
      warnings.push("ALIGNMENT_FAILED");
      qualityPassStatus = "LOW_CONFIDENCE";
    }
  } else if (!qualityText) {
    // Quality pass failed or empty — keep diarized
    qualityPassStatus = qualityPassStatus === "SKIPPED" ? "SKIPPED" : "LOW_CONFIDENCE";
  }

  // Build enhanced segments: use aligned finalText where available,
  // preserve speaker labels and timestamps from diarization pass always.
  const mergedSegments: NormalizedSegment[] = diarizedResult.segments.map((seg, i) => {
    const aligned = alignmentResult?.segments[i];
    const finalText =
      aligned && aligned.alignmentSource === "QUALITY"
        ? aligned.finalText
        : seg.text;
    return {
      ...seg,
      text: finalText,
    };
  });

  // Build enhanced diarized text from merged segments
  const enhancedDiarizedText = buildDiarizedText(mergedSegments);

  // Plain text = concatenation of final segment texts
  const enhancedText = mergedSegments.map((s) => s.text).join(" ");

  return {
    text: enhancedText || diarizedResult.text,
    model: diarizedResult.model,
    language: diarizedResult.language,
    hasSpeakerDiarization: diarizedResult.hasSpeakerDiarization,
    diarizationStatus: diarizedResult.diarizationStatus,
    diarizationProvider: diarizedResult.diarizationProvider,
    segments: mergedSegments,
    diarizedText: enhancedDiarizedText,
    warnings: [...diarizedResult.warnings, ...warnings],
    // Two-pass specific
    strategy: "diarize_plus_quality",
    qualityModel: qualityModel_used,
    qualityPassStatus,
    alignmentResult,
    qualityPromptMetadata: {
      ...promptMetadata,
      promptTermsCount: unsupportedParamWarnings.length,
      promptContextSources: useQualityPrompt && qualityPrompt
        ? ["case_title", "participants", "business_context"]
        : [],
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function transcribeAudioBuffer(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  languageHint: TranscriptionLanguageHint,
  options?: { sessionId?: string; recordingId?: string; prompt?: string },
): Promise<TranscriptionResult> {
  const client = createOpenAiClient();
  const file = new File([new Uint8Array(buffer)], fileName, { type: mimeType });
  const config = getOpenAiTranscriptionConfig();
  const twoPassConfig = getTwoPassTranscriptionConfig();

  // Resolve language: "auto" means let the model detect it (no explicit language param)
  const language = languageHint === "auto" ? undefined : languageHint;

  // Use session-provided prompt or fall back to undefined (no prompt)
  const prompt = options?.prompt;

  // ── Route by strategy ──────────────────────────────────────────────────
  if (twoPassConfig.strategy === "diarize_plus_quality") {
    return transcribeAudioBufferTwoPass(client, file, language, config, {
      ...options,
      prompt,
    });
  }

  if (twoPassConfig.strategy === "quality_only") {
    // Quality-only: plain transcription with prompt, no speaker labels
    const qualityModel = twoPassConfig.qualityModel;
    const qualityLanguage =
      twoPassConfig.qualityLanguage === "auto" ? language : twoPassConfig.qualityLanguage;
    const qualityTemp = twoPassConfig.qualityTemperature;
    const usePrompt = twoPassConfig.qualityPromptEnabled;

    try {
      const result = await transcribeWithQuality(
        client,
        file,
        qualityModel,
        qualityLanguage,
        usePrompt ? prompt : undefined,
        qualityTemp,
      );
      const segments: NormalizedSegment[] = [];
      return {
        text: result.text,
        model: result.model,
        language: result.language,
        hasSpeakerDiarization: false,
        diarizationStatus: "NOT_REQUESTED",
        diarizationProvider: result.model,
        segments,
        diarizedText: null,
        warnings: result.unsupportedParamWarnings.length > 0
          ? ["UNSUPPORTED_PARAM_SKIPPED"]
          : [],
        strategy: "quality_only",
        qualityModel: result.model,
        qualityPassStatus: "OK",
      };
    } catch (error) {
      const classified = await handleExternalServiceFailure(
        ExternalService.OPENAI,
        error,
        { ...options, context: "quality_transcription" },
      );
      throw new Error(classified.message);
    }
  }

  // ── diarize_only (default / legacy path) ──────────────────────────────
  const { result: diarizedResult, diarizationError } =
    await transcribeWithDiarization(client, file, language, config, options);

  if (diarizedResult) {
    return { ...diarizedResult, strategy: "diarize_only" };
  }

  const warnings: TranscriptionWarningCode[] = diarizationError
    ? ["DIARIZATION_FAILED"]
    : [];

  const diarizationStatus: DiarizationStatus = diarizationError ? "FAILED" : "NOT_REQUESTED";

  // Fall back to plain transcription using primary model (non-diarizing)
  const primaryModel = "gpt-4o-mini-transcribe";
  try {
    const primary = await transcribePlain(
      client,
      file,
      primaryModel,
      config,
      language,
      undefined,
      config.temperature,
    );
    return {
      ...primary,
      hasSpeakerDiarization: false,
      diarizationStatus,
      diarizationProvider: primaryModel,
      segments: primary.segments,
      diarizedText: primary.diarizedText,
      warnings,
      strategy: "diarize_only",
    };
  } catch {
    try {
      const fallback = await transcribePlain(
        client,
        file,
        WHISPER_FALLBACK_MODEL,
        config,
        language,
        undefined,
        config.temperature,
      );
      return {
        ...fallback,
        hasSpeakerDiarization: false,
        diarizationStatus,
        diarizationProvider: WHISPER_FALLBACK_MODEL,
        segments: fallback.segments,
        diarizedText: fallback.diarizedText,
        warnings,
        strategy: "diarize_only",
      };
    } catch (fallbackError) {
      const classified = await handleExternalServiceFailure(
        ExternalService.OPENAI,
        fallbackError,
        {
          sessionId: options?.sessionId,
          recordingId: options?.recordingId,
          context: "transcription",
        },
      );
      throw new Error(classified.message);
    }
  }
}
