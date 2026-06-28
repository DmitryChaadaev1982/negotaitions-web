import { getFfmpegStatus, isFfmpegAvailable } from "@/lib/audio/compress";
import {
  getAiAnalysisProvider,
  getTranscriptionProvider,
  getYandexSpeechKitLanguage,
  getYandexSpeechKitModel,
  isYandexSpeechKitLiteratureTextEnabled,
  isYandexSpeechKitSpeakerLabelingEnabled,
  isYandexSpeechKitTextNormalizationEnabled,
  isYandexTranscriptEnhancementEnabled,
} from "@/lib/env";
import { getLiveKitConfig } from "@/lib/livekit";
import { createEgressClient } from "@/lib/livekit-egress";
import { checkOpenAiHealth, isOpenAiConfigured } from "@/lib/services/openai-transcription";
import { checkStorageHealth } from "@/lib/storage/s3";

export function getEnvironmentConfigStatus() {
  const aiAnalysisProvider = getAiAnalysisProvider();
  const transcriptionProvider = getTranscriptionProvider();
  const yandexFolderIdPresent = Boolean(process.env.YANDEX_FOLDER_ID?.trim());
  const yandexApiKeyPresent = Boolean(process.env.YANDEX_API_KEY?.trim());

  return {
    aiAnalysisProvider,
    transcriptionProvider,
    aiAnalysisProviderEnvValid:
      aiAnalysisProvider === "yandex" ? yandexFolderIdPresent && yandexApiKeyPresent : true,
    transcriptionProviderEnvValid:
      transcriptionProvider === "yandex_speechkit"
        ? yandexFolderIdPresent && yandexApiKeyPresent
        : true,
    livekitUrl: Boolean(process.env.LIVEKIT_URL?.trim()),
    livekitApiKey: Boolean(process.env.LIVEKIT_API_KEY?.trim()),
    livekitApiSecret: Boolean(process.env.LIVEKIT_API_SECRET?.trim()),
    s3Bucket: Boolean(process.env.S3_BUCKET?.trim()),
    s3Region: Boolean(process.env.S3_REGION?.trim()),
    s3Endpoint: Boolean(process.env.S3_ENDPOINT?.trim()),
    s3AccessKeyId: Boolean(process.env.S3_ACCESS_KEY_ID?.trim()),
    s3SecretAccessKey: Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim()),
    openAiApiKey: isOpenAiConfigured(),
    yandexFolderId: yandexFolderIdPresent,
    yandexApiKey: yandexApiKeyPresent,
    yandexAiModel: Boolean(process.env.YANDEX_AI_MODEL?.trim()),
    yandexSpeechKitModel: Boolean(getYandexSpeechKitModel().trim()),
    yandexSpeechKitModelValue: getYandexSpeechKitModel(),
    yandexSpeechKitLanguageValue: getYandexSpeechKitLanguage(),
    yandexSpeechKitNormalizationEnabled: isYandexSpeechKitTextNormalizationEnabled(),
    yandexSpeechKitLiteratureTextEnabled: isYandexSpeechKitLiteratureTextEnabled(),
    yandexSpeechKitSpeakerLabelingEnabled: isYandexSpeechKitSpeakerLabelingEnabled(),
    yandexTranscriptEnhancementEnabled: isYandexTranscriptEnhancementEnabled(),
    yandexSpeechKitRequiredKeysPresent: yandexFolderIdPresent && yandexApiKeyPresent,
    ffmpeg: getFfmpegStatus(),
  };
}

export async function checkLiveKitHealth() {
  const config = getLiveKitConfig();
  if (!config) {
    return {
      ok: false,
      message: "LiveKit recording is not configured.",
    };
  }

  try {
    createEgressClient();
    return {
      ok: true,
      message: "LiveKit client initialized successfully.",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "LiveKit check failed.",
    };
  }
}

export async function getAdminHealthSummary() {
  const config = getEnvironmentConfigStatus();

  return {
    config,
    hasRecentServiceErrors: false,
  };
}

export { checkStorageHealth, checkOpenAiHealth, isFfmpegAvailable, getFfmpegStatus };
