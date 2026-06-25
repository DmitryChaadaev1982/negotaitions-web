import { getEnvBoolean } from "@/lib/env";

/**
 * OpenAI transcription API configuration, driven by OPENAI_TRANSCRIPTION_*
 * environment variables.
 *
 * Defaults below mirror the recommended values from .env.example and are safe
 * for production use without explicit env configuration.
 */

export type TranscriptionLanguageSetting = "auto" | "ru" | "en";
export type TimestampGranularity = "segment" | "word";

export function getOpenAiTranscriptionModel(): string {
  return process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-transcribe-diarize";
}

export function getOpenAiTranscriptionResponseFormat(): string {
  return (
    process.env.OPENAI_TRANSCRIPTION_RESPONSE_FORMAT?.trim() || "verbose_json"
  );
}

export function getOpenAiTranscriptionTemperature(): number {
  const raw = process.env.OPENAI_TRANSCRIPTION_TEMPERATURE?.trim();
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

export function getOpenAiTranscriptionUseTimestamps(): boolean {
  return getEnvBoolean("OPENAI_TRANSCRIPTION_USE_TIMESTAMPS", true);
}

export function getOpenAiTranscriptionTimestampGranularity(): TimestampGranularity {
  const raw = process.env.OPENAI_TRANSCRIPTION_TIMESTAMP_GRANULARITY?.trim();
  if (raw === "word" || raw === "segment") return raw;
  return "segment";
}

export function getOpenAiTranscriptionLanguageSetting(): TranscriptionLanguageSetting {
  const raw = process.env.OPENAI_TRANSCRIPTION_LANGUAGE?.trim();
  if (raw === "ru" || raw === "en") return raw;
  return "auto";
}

export function getOpenAiTranscriptionPromptEnabled(): boolean {
  return getEnvBoolean("OPENAI_TRANSCRIPTION_PROMPT_ENABLED", true);
}

export type OpenAiTranscriptionConfig = {
  model: string;
  responseFormat: string;
  temperature: number;
  useTimestamps: boolean;
  timestampGranularity: TimestampGranularity;
  languageSetting: TranscriptionLanguageSetting;
  promptEnabled: boolean;
};

export function getOpenAiTranscriptionConfig(): OpenAiTranscriptionConfig {
  return {
    model: getOpenAiTranscriptionModel(),
    responseFormat: getOpenAiTranscriptionResponseFormat(),
    temperature: getOpenAiTranscriptionTemperature(),
    useTimestamps: getOpenAiTranscriptionUseTimestamps(),
    timestampGranularity: getOpenAiTranscriptionTimestampGranularity(),
    languageSetting: getOpenAiTranscriptionLanguageSetting(),
    promptEnabled: getOpenAiTranscriptionPromptEnabled(),
  };
}
