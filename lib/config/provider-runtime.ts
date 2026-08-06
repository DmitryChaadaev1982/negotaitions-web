import type { VideoProvider } from "@/lib/voximplant/types";
import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";

export type AiAnalysisProvider = "openai" | "yandex";
export type TranscriptionProvider = "openai" | "yandex_speechkit";

export function getVideoProvider(): VideoProvider {
  return parseServerRuntimeSetting("VIDEO_PROVIDER") as VideoProvider;
}

export function getAiAnalysisProvider(): AiAnalysisProvider {
  return parseServerRuntimeSetting(
    "AI_ANALYSIS_PROVIDER",
  ) as AiAnalysisProvider;
}

export function getTranscriptionProvider(): TranscriptionProvider {
  return parseServerRuntimeSetting(
    "TRANSCRIPTION_PROVIDER",
  ) as TranscriptionProvider;
}
