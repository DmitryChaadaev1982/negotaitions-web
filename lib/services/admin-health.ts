import { getFfmpegStatus, isFfmpegAvailable } from "@/lib/audio/compress";
import {
  getAiAnalysisProvider,
  getEnvBoolean,
  getTranscriptionProvider,
  getVideoProvider,
  getVoximplantRecordingWebhookSecret,
  getYandexSpeechKitLanguage,
  getYandexSpeechKitModel,
  isYandexSpeechKitLiteratureTextEnabled,
  isYandexSpeechKitSpeakerLabelingEnabled,
  isYandexSpeechKitTextNormalizationEnabled,
  isYandexTranscriptEnhancementEnabled,
} from "@/lib/env";
import { getVoximplantConfig } from "@/lib/voximplant/config";
import { getVoximplantManagementApiDiagnostics } from "@/lib/voximplant/management-api";
import {
  getVoximplantRecordingWebhookBaseUrlEnvDefault,
  getVoximplantRecordingWebhookOverrideEnabledRaw,
  isVoximplantRecordingWebhookOverrideEnabled,
} from "@/lib/voximplant/recording-webhook-url";
import { getLiveKitConfig } from "@/lib/livekit";
import { createEgressClient } from "@/lib/livekit-egress";
import { getAdminEnvironmentDisplayGroups } from "@/lib/services/admin-env-display";
import { checkOpenAiHealth, isOpenAiConfigured } from "@/lib/services/openai-transcription";
import { checkStorageHealth } from "@/lib/storage/s3";

function getVoximplantEnvironmentConfigStatus() {
  const config = getVoximplantConfig({ requireForRuntime: false });
  const webhookBaseUrlDefault = getVoximplantRecordingWebhookBaseUrlEnvDefault();
  const managementDiagnostics = getVoximplantManagementApiDiagnostics();

  return {
    accountName: Boolean(config.accountName),
    applicationName: Boolean(config.applicationName),
    userDomain: Boolean(config.userDomain),
    scenarioName: Boolean(config.scenarioName),
    ruleName: Boolean(config.ruleName),
    recordingEnabled: config.recording.enabled,
    recordingAudioOnly: config.recording.audioOnly,
    recordingAudioMode: config.recording.audioMode,
    recordingStorage: Boolean(config.recordingStorage),
    managementApiConfigured:
      managementDiagnostics.apiAuth.status === "configured_via_env" ||
      managementDiagnostics.apiAuth.status === "configured_via_key_file",
    managementAccountId: managementDiagnostics.accountId,
    managementApplicationId: managementDiagnostics.applicationId,
    managementApiAuth: managementDiagnostics.apiAuth,
    apiKeyPath: managementDiagnostics.apiKeyPathConfigured,
    recordingWebhookSecret: Boolean(getVoximplantRecordingWebhookSecret()),
    recordingWebhookBaseUrl: Boolean(webhookBaseUrlDefault),
    recordingWebhookBaseUrlValue: webhookBaseUrlDefault,
    recordingWebhookOverrideEnabled: isVoximplantRecordingWebhookOverrideEnabled(),
    recordingWebhookOverrideEnabledRaw: getVoximplantRecordingWebhookOverrideEnabledRaw(),
    nodeEnv: process.env.NODE_ENV ?? "development",
  };
}

export function getEnvironmentConfigStatus() {
  const aiAnalysisProvider = getAiAnalysisProvider();
  const transcriptionProvider = getTranscriptionProvider();
  const videoProvider = getVideoProvider();
  const yandexFolderIdPresent = Boolean(process.env.YANDEX_FOLDER_ID?.trim());
  const yandexApiKeyPresent = Boolean(process.env.YANDEX_API_KEY?.trim());
  const voximplant = getVoximplantEnvironmentConfigStatus();

  return {
    videoProvider,
    videoProviderEnvValid: videoProvider === "voximplant" ? voximplant.applicationName && voximplant.accountName : true,
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
    voximplant,
    voximplantRecordingEnabled: getEnvBoolean("VOXIMPLANT_RECORDING_ENABLED", false),
    envGroups: getAdminEnvironmentDisplayGroups(),
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

export async function checkVoximplantHealth() {
  const config = getVoximplantConfig({ requireForRuntime: false });
  const requiredConfigured =
    Boolean(config.accountName) &&
    Boolean(config.applicationName) &&
    Boolean(config.userDomain) &&
    Boolean(config.scenarioName) &&
    Boolean(config.ruleName);
  const webhookSecretConfigured = Boolean(getVoximplantRecordingWebhookSecret());
  const managementDiagnostics = getVoximplantManagementApiDiagnostics();
  const managementReady =
    managementDiagnostics.apiAuth.status === "configured_via_env" ||
    managementDiagnostics.apiAuth.status === "configured_via_key_file";

  if (!requiredConfigured) {
    return {
      ok: false,
      message:
        "Voximplant config is incomplete (account/app/domain/scenario/rule).",
    };
  }

  if (!webhookSecretConfigured) {
    return {
      ok: false,
      message: "Voximplant recording webhook secret is not configured.",
    };
  }

  if (!managementReady) {
    return {
      ok: false,
      message:
        "Voximplant management API credentials are not configured. Config-level validation only.",
    };
  }

  return {
    ok: true,
    message:
      "Voximplant config is valid (env-level check). Live API call is skipped for safety.",
  };
}

export async function getAdminHealthSummary() {
  const config = getEnvironmentConfigStatus();

  return {
    config,
    hasRecentServiceErrors: false,
  };
}

export { checkStorageHealth, checkOpenAiHealth, isFfmpegAvailable, getFfmpegStatus };
