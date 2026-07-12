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
export type VoximplantAudioProcessingProfile = "speech" | "raw_diagnostic";
export type PauseProcessingMode =
  /**
   * Legacy fallback mode: approximate transcript-level pause filtering.
   * @deprecated Prefer source_audio_cut for deterministic pre-transcription trimming.
   */
  | "transcript_interval_filter"
  /**
   * Default production mode: deterministic ffmpeg cut/concat before transcription.
   */
  | "source_audio_cut";

export type TranscriptEnhancementMode = "single" | "chunked";

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

export function isPauseFilterCalibrationEnabled(): boolean {
  return getEnvBoolean("PAUSE_FILTER_CALIBRATION_ENABLED", false);
}

export function getPauseFilterCalibrationDir(): string {
  return (
    process.env.PAUSE_FILTER_CALIBRATION_DIR?.trim() ||
    ".debug/pause-filter-calibration"
  );
}

export function getPauseFilterCalibrationActiveMarkersRaw(): string | null {
  return process.env.PAUSE_FILTER_CALIBRATION_ACTIVE_MARKERS?.trim() || null;
}

export function getPauseFilterCalibrationPausedMarkersRaw(): string | null {
  return process.env.PAUSE_FILTER_CALIBRATION_PAUSED_MARKERS?.trim() || null;
}

export function isPauseFilterCalibrationAutoRunEnabled(): boolean {
  return getEnvBoolean("PAUSE_FILTER_CALIBRATION_AUTO_RUN", false);
}

export function getPauseFilterRuleOverridePath(): string | null {
  return process.env.PAUSE_FILTER_RULE_OVERRIDE_PATH?.trim() || null;
}

export function getPauseProcessingMode(): PauseProcessingMode {
  const raw = process.env.PAUSE_PROCESSING_MODE?.trim().toLowerCase();
  if (!raw || raw === "source_audio_cut") {
    return "source_audio_cut";
  }
  if (raw === "transcript_interval_filter") {
    return "transcript_interval_filter";
  }
  console.warn(
    `[env] Invalid PAUSE_PROCESSING_MODE="${raw}". Falling back to default mode "source_audio_cut". ` +
      `Use "transcript_interval_filter" only as a legacy fallback.`,
  );
  return "source_audio_cut";
}

export function getPauseSourceAudioDebugDir(): string {
  return process.env.PAUSE_SOURCE_AUDIO_DEBUG_DIR?.trim() || ".debug/pause-source-audio";
}

export function getYandexTranscriptEnhancementModel(): string {
  return process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_MODEL?.trim() || "deepseek-v4-flash";
}

export function getYandexTranscriptEnhancementFallbackModel(): string | null {
  const raw = process.env.TRANSCRIPT_ENHANCEMENT_FALLBACK_MODEL?.trim();
  return raw ? raw : null;
}

export function getYandexTranscriptEnhancementMaxOutputTokens(): number {
  const raw = Number(process.env.YANDEX_TRANSCRIPT_ENHANCEMENT_MAX_OUTPUT_TOKENS ?? "6000");
  return Number.isFinite(raw) && raw > 0 ? raw : 6000;
}

export function getTranscriptEnhancementMode(): TranscriptEnhancementMode {
  const raw = process.env.TRANSCRIPT_ENHANCEMENT_MODE?.trim().toLowerCase();
  if (!raw || raw === "single") {
    return "single";
  }
  if (raw === "chunked") {
    return "chunked";
  }
  console.warn(
    `[env] Invalid TRANSCRIPT_ENHANCEMENT_MODE="${raw}". Falling back to default mode "single".`,
  );
  return "single";
}

export function getTranscriptEnhancementChunkMaxSegments(): number {
  const raw = Number(process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS ?? "6");
  return Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.round(raw)) : 6;
}

export function getTranscriptEnhancementChunkMaxChars(): number {
  const raw = Number(process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS ?? "700");
  return Number.isFinite(raw) && raw > 0 ? Math.max(80, Math.round(raw)) : 700;
}

export function getTranscriptEnhancementMaxConcurrency(): number {
  const raw = Number(process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY ?? "4");
  return Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.round(raw)) : 4;
}

export function getTranscriptEnhancementChunkTimeoutMs(): number {
  const raw = Number(process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS ?? "120000");
  return Number.isFinite(raw) && raw > 0 ? Math.max(5000, Math.round(raw)) : 120000;
}

export function getTranscriptEnhancementMaxRetries(): number {
  const raw = Number(process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES ?? "1");
  if (!Number.isFinite(raw) || raw < 0) {
    return 1;
  }
  return Math.min(3, Math.round(raw));
}

/**
 * Server-side only. Returns the VOXIMPLANT_RECORDING_WEBHOOK_SECRET used to
 * validate HMAC-SHA256 signatures on incoming VoxEngine recording-status webhooks.
 * Returns null when the env var is absent or empty (webhook validation will reject all calls).
 */
export function getVoximplantRecordingWebhookSecret(): string | null {
  return process.env.VOXIMPLANT_RECORDING_WEBHOOK_SECRET?.trim() || null;
}

/**
 * Env default for Voximplant recording webhook base URL (server-side only).
 * Runtime admin override is stored in AppSetting — see recording-webhook-url.ts.
 */
export function getVoximplantRecordingWebhookBaseUrlFromEnv(): string | null {
  const raw = process.env.VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL?.trim();
  return raw || null;
}

export function getVoximplantAudioProcessingProfile(): VoximplantAudioProcessingProfile {
  const raw = process.env.VOXIMPLANT_AUDIO_PROCESSING_PROFILE?.trim().toLowerCase();
  return raw === "raw_diagnostic" ? "raw_diagnostic" : "speech";
}
