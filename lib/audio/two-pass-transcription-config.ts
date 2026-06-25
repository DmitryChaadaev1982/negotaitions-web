import { getEnvBoolean } from "@/lib/env";

/**
 * Configuration for the two-pass (diarize_plus_quality) transcription strategy.
 *
 * Reads OPENAI_TRANSCRIPTION_STRATEGY, OPENAI_DIARIZATION_*, and
 * OPENAI_QUALITY_TRANSCRIPTION_* environment variables.
 *
 * Audio preprocessing variables (AUDIO_*) are intentionally NOT duplicated here;
 * they are consumed by lib/audio/config.ts and lib/audio/compress.ts as before.
 */

export type TranscriptionStrategy =
  | "diarize_only"
  | "quality_only"
  | "diarize_plus_quality";

export type QualityTranscriptionLanguage = "auto" | "ru" | "en";

export type TwoPassTranscriptionConfig = {
  strategy: TranscriptionStrategy;
  diarizationModel: string;
  diarizationResponseFormat: string;
  qualityModel: string;
  qualityLanguage: QualityTranscriptionLanguage;
  qualityPromptEnabled: boolean;
  qualityTemperature: number;
};

const ALLOWED_STRATEGIES: TranscriptionStrategy[] = [
  "diarize_only",
  "quality_only",
  "diarize_plus_quality",
];

export function getTranscriptionStrategy(): TranscriptionStrategy {
  const raw = process.env.OPENAI_TRANSCRIPTION_STRATEGY?.trim().toLowerCase();
  if (raw && (ALLOWED_STRATEGIES as string[]).includes(raw)) {
    return raw as TranscriptionStrategy;
  }
  return "diarize_only";
}

export function getDiarizationModel(): string {
  return (
    process.env.OPENAI_DIARIZATION_MODEL?.trim() || "gpt-4o-transcribe-diarize"
  );
}

export function getDiarizationResponseFormat(): string {
  return (
    process.env.OPENAI_DIARIZATION_RESPONSE_FORMAT?.trim() || "diarized_json"
  );
}

export function getQualityTranscriptionModel(): string {
  return (
    process.env.OPENAI_QUALITY_TRANSCRIPTION_MODEL?.trim() || "gpt-4o-transcribe"
  );
}

export function getQualityTranscriptionLanguage(): QualityTranscriptionLanguage {
  const raw = process.env.OPENAI_QUALITY_TRANSCRIPTION_LANGUAGE?.trim().toLowerCase();
  if (raw === "ru" || raw === "en") return raw;
  return "auto";
}

export function getQualityTranscriptionPromptEnabled(): boolean {
  return getEnvBoolean("OPENAI_QUALITY_TRANSCRIPTION_PROMPT_ENABLED", true);
}

export function getQualityTranscriptionTemperature(): number {
  const raw = process.env.OPENAI_QUALITY_TRANSCRIPTION_TEMPERATURE?.trim();
  if (!raw) return 0;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function getTwoPassTranscriptionConfig(): TwoPassTranscriptionConfig {
  return {
    strategy: getTranscriptionStrategy(),
    diarizationModel: getDiarizationModel(),
    diarizationResponseFormat: getDiarizationResponseFormat(),
    qualityModel: getQualityTranscriptionModel(),
    qualityLanguage: getQualityTranscriptionLanguage(),
    qualityPromptEnabled: getQualityTranscriptionPromptEnabled(),
    qualityTemperature: getQualityTranscriptionTemperature(),
  };
}
