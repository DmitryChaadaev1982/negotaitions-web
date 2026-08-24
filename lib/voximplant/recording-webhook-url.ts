import "server-only";

export {
  getVoximplantRecordingWebhookBaseUrlEnvDefault,
  getVoximplantRecordingWebhookOverrideEnabledRaw,
  isVoximplantRecordingWebhookOverrideEnabled,
  resolveVoximplantRecordingWebhookUrl,
  validateVoximplantRecordingWebhookBaseUrl,
  type VoximplantRecordingWebhookEffectiveSource,
  type VoximplantRecordingWebhookUrlResolution,
  type WebhookBaseUrlValidationResult,
} from "@/lib/voximplant/recording-webhook-url-resolve";
export {
  buildVoximplantRecordingWebhookUrlStateWithoutDb,
  clearVoximplantRecordingWebhookBaseUrlOverride,
  getVoximplantRecordingWebhookBaseUrl,
  getVoximplantRecordingWebhookBaseUrlOverride,
  getVoximplantRecordingWebhookBaseUrlOverrideRaw,
  getVoximplantRecordingWebhookUrlState,
  resolveVoximplantRecordingWebhookUrlFromDb,
  setVoximplantRecordingWebhookBaseUrlOverride,
  VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL_OVERRIDE_KEY,
  type VoximplantRecordingWebhookUrlState,
} from "@/lib/voximplant/recording-webhook-url-store";
