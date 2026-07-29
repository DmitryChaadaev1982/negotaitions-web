import "server-only";

import { prisma } from "@/lib/prisma";
import {
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
  getVoximplantRecordingWebhookBaseUrlEnvDefault,
  getVoximplantRecordingWebhookOverrideEnabledRaw,
  isVoximplantRecordingWebhookOverrideEnabled,
  resolveVoximplantRecordingWebhookUrl,
  validateVoximplantRecordingWebhookBaseUrl,
  type VoximplantRecordingWebhookEffectiveSource,
  type VoximplantRecordingWebhookUrlResolution,
  type WebhookBaseUrlValidationResult,
};

/** DB key for the runtime admin override of the Voximplant recording webhook base URL. */
export const VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL_OVERRIDE_KEY =
  "voximplant.recording.webhookBaseUrlOverride";

/** Read the raw saved DB override value (null when unset). */
export async function getVoximplantRecordingWebhookBaseUrlOverrideRaw(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key: VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL_OVERRIDE_KEY },
    select: { value: true },
  });
  const trimmed = row?.value?.trim();
  return trimmed || null;
}

/** Read the saved DB override (null when unset or invalid). */
export async function getVoximplantRecordingWebhookBaseUrlOverride(): Promise<string | null> {
  const raw = await getVoximplantRecordingWebhookBaseUrlOverrideRaw();
  if (!raw) return null;

  const validated = validateVoximplantRecordingWebhookBaseUrl(raw);
  return validated.ok ? validated.value : null;
}

export async function resolveVoximplantRecordingWebhookUrlFromDb(): Promise<VoximplantRecordingWebhookUrlResolution> {
  const savedOverrideRaw = await getVoximplantRecordingWebhookBaseUrlOverrideRaw();
  return resolveVoximplantRecordingWebhookUrl({ savedOverrideRaw });
}

/** Effective webhook base URL for scenarioMessage.claims.webhookBaseUrl and webhooks. */
export async function getVoximplantRecordingWebhookBaseUrl(): Promise<string | null> {
  const resolution = await resolveVoximplantRecordingWebhookUrlFromDb();
  return resolution.effectiveWebhookBaseUrl;
}

export async function setVoximplantRecordingWebhookBaseUrlOverride(
  url: string,
): Promise<{ ok: true; value: string } | { ok: false; error: string }> {
  if (!isVoximplantRecordingWebhookOverrideEnabled()) {
    return { ok: false, error: "Webhook base URL override is disabled." };
  }

  const validated = validateVoximplantRecordingWebhookBaseUrl(url);
  if (!validated.ok) {
    return validated;
  }

  await prisma.appSetting.upsert({
    where: { key: VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL_OVERRIDE_KEY },
    create: {
      key: VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL_OVERRIDE_KEY,
      value: validated.value,
    },
    update: { value: validated.value },
  });

  return { ok: true, value: validated.value };
}

export async function clearVoximplantRecordingWebhookBaseUrlOverride(): Promise<void> {
  await prisma.appSetting.deleteMany({
    where: { key: VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL_OVERRIDE_KEY },
  });
}

export type VoximplantRecordingWebhookUrlState = {
  nodeEnv: string;
  overrideEnabledRaw: string | null;
  overrideEnabled: boolean;
  envDefault: string | null;
  /** Valid saved override from DB (unchanged when overrideEnabled=false). */
  override: string | null;
  savedOverridePresent: boolean;
  savedOverrideActive: boolean;
  effective: string | null;
  effectiveSource: VoximplantRecordingWebhookEffectiveSource;
  warning?: string;
};

function mapResolutionToUrlState(
  resolution: VoximplantRecordingWebhookUrlResolution,
): VoximplantRecordingWebhookUrlState {
  const savedOverrideActive =
    resolution.overrideEnabled &&
    resolution.savedOverrideValid &&
    Boolean(resolution.savedOverrideWebhookBaseUrl);

  return {
    nodeEnv: resolution.nodeEnv,
    overrideEnabledRaw: resolution.overrideEnabledRaw,
    overrideEnabled: resolution.overrideEnabled,
    envDefault: resolution.envWebhookBaseUrl,
    override: resolution.savedOverrideWebhookBaseUrl,
    savedOverridePresent: resolution.savedOverridePresent,
    savedOverrideActive,
    effective: resolution.effectiveWebhookBaseUrl,
    effectiveSource: resolution.effectiveSource,
    ...(resolution.warning ? { warning: resolution.warning } : {}),
  };
}

/** Safe fallback when DB override lookup fails (env-derived fields only). */
export function buildVoximplantRecordingWebhookUrlStateWithoutDb(): VoximplantRecordingWebhookUrlState {
  return mapResolutionToUrlState(
    resolveVoximplantRecordingWebhookUrl({ savedOverrideRaw: null }),
  );
}

export async function getVoximplantRecordingWebhookUrlState(): Promise<VoximplantRecordingWebhookUrlState> {
  const resolution = await resolveVoximplantRecordingWebhookUrlFromDb();
  return mapResolutionToUrlState(resolution);
}
