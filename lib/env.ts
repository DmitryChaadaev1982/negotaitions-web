import type { VideoProvider } from "@/lib/voximplant/types";

/**
 * Safe boolean env-var parser.
 *
 * Avoids the JavaScript "truthy string" pitfall where
 * Boolean("false") === true.
 *
 * Recognised truthy values  : "true", "1", "yes", "on"
 * Recognised falsy values   : "false", "0", "no", "off"
 * Missing / empty            : returns defaultValue (default: false)
 */
export function getEnvBoolean(key: string, defaultValue = false): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  return defaultValue;
}

/**
 * When true, transcription starts automatically after a recording is
 * marked COMPLETED. When false, transcription must be started manually
 * by the facilitator/host.
 *
 * Controlled by AUTO_TRANSCRIBE_AFTER_RECORDING env variable.
 * Default: false (opt-in, to avoid unexpected OpenAI charges).
 */
export const autoTranscribeAfterRecording = getEnvBoolean(
  "AUTO_TRANSCRIBE_AFTER_RECORDING",
  false,
);

export type AiAnalysisProvider = "openai" | "yandex";
export type TranscriptionProvider = "openai" | "yandex_speechkit";
export type YandexSpeechKitContainerType = "MP3" | "WAV" | "OGG_OPUS";

export function getVideoProvider(): VideoProvider {
  const raw = process.env.VIDEO_PROVIDER?.trim().toLowerCase();
  return raw === "voximplant" ? "voximplant" : "livekit";
}

export function getAiAnalysisProvider(): AiAnalysisProvider {
  const raw = process.env.AI_ANALYSIS_PROVIDER?.trim().toLowerCase();
  return raw === "yandex" ? "yandex" : "openai";
}

export function getTranscriptionProvider(): TranscriptionProvider {
  const raw = process.env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
  return raw === "yandex_speechkit" ? "yandex_speechkit" : "openai";
}

export function isYandexAiConfigured(): boolean {
  return Boolean(
    process.env.YANDEX_FOLDER_ID?.trim() &&
      process.env.YANDEX_API_KEY?.trim(),
  );
}

export function isYandexSpeechKitConfigured(): boolean {
  return Boolean(
    process.env.YANDEX_FOLDER_ID?.trim() &&
      process.env.YANDEX_API_KEY?.trim(),
  );
}

export function getYandexSpeechKitModel(): string {
  return process.env.YANDEX_SPEECHKIT_MODEL?.trim() || "general:rc";
}

export function getYandexSpeechKitLanguage(): string {
  return process.env.YANDEX_SPEECHKIT_LANGUAGE?.trim() || "ru-RU";
}

export function getYandexSpeechKitContainerOverride():
  | YandexSpeechKitContainerType
  | null {
  const raw = process.env.YANDEX_SPEECHKIT_AUDIO_CONTAINER?.trim().toUpperCase();
  if (raw === "MP3" || raw === "WAV" || raw === "OGG_OPUS") {
    return raw;
  }
  return null;
}

export function isYandexSpeechKitTextNormalizationEnabled(): boolean {
  return getEnvBoolean("YANDEX_SPEECHKIT_TEXT_NORMALIZATION_ENABLED", true);
}

export function isYandexSpeechKitLiteratureTextEnabled(): boolean {
  return getEnvBoolean("YANDEX_SPEECHKIT_LITERATURE_TEXT", true);
}

export function isYandexSpeechKitProfanityFilterEnabled(): boolean {
  return getEnvBoolean("YANDEX_SPEECHKIT_PROFANITY_FILTER", false);
}

export function isYandexSpeechKitPhoneFormattingEnabled(): boolean {
  return getEnvBoolean("YANDEX_SPEECHKIT_PHONE_FORMATTING", false);
}

export function isYandexSpeechKitSpeakerLabelingEnabled(): boolean {
  return getEnvBoolean("YANDEX_SPEECHKIT_ENABLE_SPEAKER_LABELING", true);
}

export function isYandexTranscriptEnhancementEnabled(): boolean {
  return getEnvBoolean("YANDEX_TRANSCRIPT_ENHANCEMENT_ENABLED", false);
}

export function getYandexTranscriptEnhancementModel(): string {
  return process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL?.trim() || "deepseek-v4-flash";
}

export function getYandexTranscriptEnhancementMaxOutputTokens(): number {
  const raw = Number(process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_MAX_OUTPUT_TOKENS ?? "6000");
  return Number.isFinite(raw) && raw > 0 ? raw : 6000;
}
