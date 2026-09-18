export {
  getAiAnalysisProvider,
  getTranscriptionProvider,
  getVideoProvider,
  type AiAnalysisProvider,
  type TranscriptionProvider,
} from "@/lib/config/provider-runtime";
export {
  getSessionAbandonedCloseMs,
  getSessionDebriefEmptyCloseMs,
  getSessionDebriefMaxDurationMs,
  getSessionLifecycleDurations,
} from "@/lib/config/session-lifecycle-settings";
import { getSessionDebriefEmptyCloseMs } from "@/lib/config/session-lifecycle-settings";

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
export type TranscriptEnhancementOutputMode = "legacy" | "json_schema";
export type VoximplantServerStopMode =
  | "disabled"
  | "prefer_server_with_relay_fallback"
  | "prefer_server_no_relay_fallback";

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

export function isTranscriptEnhancementAutoRunEnabled(): boolean {
  return getEnvBoolean("TRANSCRIPT_ENHANCEMENT_AUTO_RUN", false);
}

export function isTranscriptEnhancementAutoTriggerEnabled(): boolean {
  return (
    isYandexTranscriptEnhancementEnabled() &&
    isTranscriptEnhancementAutoRunEnabled()
  );
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
  if (!raw || raw === "chunked") {
    return "chunked";
  }
  if (raw === "single") {
    return "single";
  }
  console.warn(
    `[env] Invalid TRANSCRIPT_ENHANCEMENT_MODE="${raw}". Falling back to default mode "chunked".`,
  );
  return "chunked";
}

export function getTranscriptEnhancementOutputMode(): TranscriptEnhancementOutputMode {
  const raw = process.env.TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE?.trim().toLowerCase();
  if (!raw || raw === "json_schema") {
    return "json_schema";
  }
  if (raw === "legacy") {
    return "legacy";
  }
  console.warn(
    `[env] Invalid TRANSCRIPT_ENHANCEMENT_OUTPUT_MODE="${raw}". Falling back to default mode "json_schema".`,
  );
  return "json_schema";
}

/** Frozen B02-1 operating point: ceil(1800/100). */
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS = 18;
/** Frozen B02-1 operating point (Phase A/E). */
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS = 1800;
/** Frozen B02-1 per-job concurrency (Phase B/E). Config may lower, never raise. */
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY = 8;
export const TRANSCRIPT_ENHANCEMENT_HARD_PER_JOB_CONCURRENCY = 8;
/** Frozen B02-1 global provider cap (Phase C/E). Config may lower, never raise. */
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY = 10;
export const TRANSCRIPT_ENHANCEMENT_HARD_GLOBAL_CONCURRENCY = 10;
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY = "reserved_slot" as const;
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_MAX_RETRIES = 2;
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_LEASE_TTL_MS = 45_000;
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS = 15_000;
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_T2_P95_MS = 11_500;
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_SAFETY_FACTOR = 4;
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_MIN_MS = 120_000;
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_MAX_MS = 1_800_000;

export function getTranscriptEnhancementChunkMaxSegments(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS),
  );
  return Number.isFinite(raw) && raw > 0
    ? Math.max(1, Math.round(raw))
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_SEGMENTS;
}

export function getTranscriptEnhancementChunkMaxChars(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS),
  );
  return Number.isFinite(raw) && raw > 0
    ? Math.max(80, Math.round(raw))
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_CHUNK_MAX_CHARS;
}

export function getTranscriptEnhancementMaxConcurrency(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY),
  );
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TRANSCRIPT_ENHANCEMENT_MAX_CONCURRENCY;
  }
  return Math.max(
    1,
    Math.min(TRANSCRIPT_ENHANCEMENT_HARD_PER_JOB_CONCURRENCY, Math.round(raw)),
  );
}

export function getTranscriptEnhancementGlobalConcurrency(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY),
  );
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_TRANSCRIPT_ENHANCEMENT_GLOBAL_CONCURRENCY;
  }
  return Math.max(
    1,
    Math.min(TRANSCRIPT_ENHANCEMENT_HARD_GLOBAL_CONCURRENCY, Math.round(raw)),
  );
}

export type TranscriptEnhancementFairnessPolicy = "reserved_slot" | "half_share";

export function getTranscriptEnhancementFairnessPolicy(): TranscriptEnhancementFairnessPolicy {
  const raw = process.env.TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY?.trim().toLowerCase();
  if (!raw || raw === "reserved_slot") {
    return "reserved_slot";
  }
  if (raw === "half_share") {
    return "half_share";
  }
  console.warn(
    `[env] Invalid TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY="${raw}". Falling back to reserved_slot.`,
  );
  return DEFAULT_TRANSCRIPT_ENHANCEMENT_FAIRNESS_POLICY;
}

export function getTranscriptEnhancementLeaseTtlMs(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_LEASE_TTL_MS ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_LEASE_TTL_MS),
  );
  return Number.isFinite(raw) && raw > 0
    ? Math.max(5_000, Math.round(raw))
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_LEASE_TTL_MS;
}

export function getTranscriptEnhancementHeartbeatMs(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS),
  );
  return Number.isFinite(raw) && raw > 0
    ? Math.max(1_000, Math.round(raw))
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_HEARTBEAT_MS;
}

export function getTranscriptEnhancementT2P95Ms(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_T2_P95_MS ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_T2_P95_MS),
  );
  return Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_T2_P95_MS;
}

export function getTranscriptEnhancementT3SafetyFactor(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_T3_SAFETY_FACTOR ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_SAFETY_FACTOR),
  );
  return Number.isFinite(raw) && raw > 0
    ? raw
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_SAFETY_FACTOR;
}

export function getTranscriptEnhancementT3MinMs(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_T3_MIN_MS ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_MIN_MS),
  );
  return Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_MIN_MS;
}

export function getTranscriptEnhancementT3MaxMs(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_T3_MAX_MS ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_MAX_MS),
  );
  return Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_T3_MAX_MS;
}

/**
 * T3 is the job safety/recovery bound: clamp(waves × p95 × factor, min, max).
 * It is not TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS and must not discard checkpoints.
 */
export function computeTranscriptEnhancementT3Ms(chunkCount: number, perJobConcurrency?: number): number {
  const concurrency = Math.max(1, perJobConcurrency ?? getTranscriptEnhancementMaxConcurrency());
  const waves = Math.max(1, Math.ceil(Math.max(0, chunkCount) / concurrency));
  const expectedMs = waves * getTranscriptEnhancementT2P95Ms();
  const raw = expectedMs * getTranscriptEnhancementT3SafetyFactor();
  return Math.min(
    getTranscriptEnhancementT3MaxMs(),
    Math.max(getTranscriptEnhancementT3MinMs(), Math.round(raw)),
  );
}

export function getTranscriptEnhancementChunkTimeoutMs(): number {
  const raw = Number(process.env.TRANSCRIPT_ENHANCEMENT_CHUNK_TIMEOUT_MS ?? "120000");
  return Number.isFinite(raw) && raw > 0 ? Math.max(5000, Math.round(raw)) : 120000;
}

/**
 * Historical Stage 3.15A whole-run wait window (default 7000 ms).
 *
 * Deprecated as enhancement publication authority, T1, T2, T3, Continue
 * timeout, edit-lock duration, and recovery lease. Readable for compatibility
 * and historical SKIPPED/timeout rows. New correctness must not depend on it.
 */
export const DEFAULT_TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS = 7000;

export function getTranscriptEnhancementTimeoutMs(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS),
  );
  return Number.isFinite(raw) && raw > 0
    ? Math.round(raw)
    : DEFAULT_TRANSCRIPT_ENHANCEMENT_TIMEOUT_MS;
}

export function getTranscriptEnhancementMaxRetries(): number {
  const raw = Number(
    process.env.TRANSCRIPT_ENHANCEMENT_MAX_RETRIES ??
      String(DEFAULT_TRANSCRIPT_ENHANCEMENT_MAX_RETRIES),
  );
  if (!Number.isFinite(raw) || raw < 0) {
    return DEFAULT_TRANSCRIPT_ENHANCEMENT_MAX_RETRIES;
  }
  return Math.min(3, Math.round(raw));
}

/** @deprecated Use getSessionDebriefEmptyCloseMs. Compatibility alias. */
export function getDebriefAutoCloseGraceMs(): number {
  return getSessionDebriefEmptyCloseMs();
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
 * Shared secret used to sign browser-relayed recording_control commands.
 * Fails closed when absent/invalid.
 */
export function getVoximplantRecordingControlSecret(): string {
  const secret = process.env.VOXIMPLANT_RECORDING_CONTROL_SECRET?.trim() || "";
  if (!secret) {
    throw new Error(
      "Missing required VOXIMPLANT_RECORDING_CONTROL_SECRET for recording control signing.",
    );
  }
  if (secret.length < 16) {
    throw new Error(
      "Invalid VOXIMPLANT_RECORDING_CONTROL_SECRET. Expected at least 16 characters.",
    );
  }
  return secret;
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

const VOXIMPLANT_SERVER_STOP_MODES = new Set<VoximplantServerStopMode>([
  "disabled",
  "prefer_server_with_relay_fallback",
  "prefer_server_no_relay_fallback",
]);

function parsePositiveIntegerEnv(
  key: string,
  defaultValue: number,
  minimumValue: number,
): number {
  const raw = process.env[key]?.trim();
  if (!raw) {
    return defaultValue;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < minimumValue) {
    throw new Error(
      `Invalid ${key}="${raw}". Expected integer >= ${minimumValue}.`,
    );
  }
  return Math.round(parsed);
}

export function getVoximplantServerStopMode(): VoximplantServerStopMode {
  const raw = process.env.VOXIMPLANT_SERVER_STOP_MODE?.trim().toLowerCase();
  if (!raw) {
    return "disabled";
  }
  if (VOXIMPLANT_SERVER_STOP_MODES.has(raw as VoximplantServerStopMode)) {
    return raw as VoximplantServerStopMode;
  }
  throw new Error(
    `Invalid VOXIMPLANT_SERVER_STOP_MODE="${raw}". Allowed: disabled, prefer_server_with_relay_fallback, prefer_server_no_relay_fallback.`,
  );
}

export function isVoximplantServerStopEnabled(
  mode: VoximplantServerStopMode = getVoximplantServerStopMode(),
) {
  return mode !== "disabled";
}

function getRequiredServerStopSecret(
  key: "VOXIMPLANT_SERVER_STOP_CONTROL_SECRET" | "VOXIMPLANT_SERVER_STOP_CALLBACK_SECRET",
  mode: VoximplantServerStopMode,
) {
  const value = process.env[key]?.trim() || null;
  if (!isVoximplantServerStopEnabled(mode)) {
    return value;
  }
  if (!value) {
    throw new Error(
      `Missing required ${key}. Configure it when VOXIMPLANT_SERVER_STOP_MODE is enabled.`,
    );
  }
  return value;
}

export function getVoximplantServerStopControlSecret(
  mode: VoximplantServerStopMode = getVoximplantServerStopMode(),
): string | null {
  return getRequiredServerStopSecret("VOXIMPLANT_SERVER_STOP_CONTROL_SECRET", mode);
}

export function getVoximplantServerStopCallbackSecret(
  mode: VoximplantServerStopMode = getVoximplantServerStopMode(),
): string | null {
  return getRequiredServerStopSecret("VOXIMPLANT_SERVER_STOP_CALLBACK_SECRET", mode);
}

export function getVoximplantServerStopControlTimeoutMs() {
  return parsePositiveIntegerEnv(
    "VOXIMPLANT_SERVER_STOP_CONTROL_TIMEOUT_MS",
    5000,
    100,
  );
}

export function getVoximplantServerStopCallbackReplayWindowSeconds() {
  return parsePositiveIntegerEnv(
    "VOXIMPLANT_SERVER_STOP_CALLBACK_REPLAY_WINDOW_SECONDS",
    300,
    30,
  );
}

export function getVoximplantServerStopTerminalTimeoutSeconds() {
  return parsePositiveIntegerEnv(
    "VOXIMPLANT_SERVER_STOP_TERMINAL_TIMEOUT_SECONDS",
    90,
    10,
  );
}
