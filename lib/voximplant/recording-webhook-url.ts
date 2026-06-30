import "server-only";

import { getEnvBoolean } from "@/lib/env";
import { prisma } from "@/lib/prisma";

/** DB key for the runtime admin override of the Voximplant recording webhook base URL. */
export const VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL_OVERRIDE_KEY =
  "voximplant.recording.webhookBaseUrlOverride";

export type WebhookBaseUrlValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validate a public HTTPS webhook base URL (no path to /api/sessions/...).
 * Strips trailing slashes on success.
 */
export function validateVoximplantRecordingWebhookBaseUrl(
  raw: string,
): WebhookBaseUrlValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "URL is required." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL." };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "URL must start with https://." };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".local")
  ) {
    return { ok: false, error: "localhost URLs are not allowed." };
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  if (path.includes("/api/sessions")) {
    return {
      ok: false,
      error: "URL must be a base URL without /api/sessions/...",
    };
  }

  const value = `${parsed.origin}${path}`.replace(/\/+$/, "");
  return { ok: true, value };
}

/** Env default from VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL (validated; null when absent/invalid). */
export function getVoximplantRecordingWebhookBaseUrlEnvDefault(): string | null {
  const raw = process.env.VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL?.trim();
  if (!raw) return null;
  const validated = validateVoximplantRecordingWebhookBaseUrl(raw);
  return validated.ok ? validated.value : null;
}

/** Raw env value for VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED (null when unset/empty). */
export function getVoximplantRecordingWebhookOverrideEnabledRaw(): string | null {
  const raw = process.env.VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED?.trim();
  return raw || null;
}

function isDefaultOverrideEnabledForNodeEnv(): boolean {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  return nodeEnv === "development" || nodeEnv === "test";
}

/**
 * Whether admin/runtime override of the webhook base URL is permitted.
 * Explicit env true/false wins in any NODE_ENV.
 * When unset: enabled in development/test, disabled in production.
 */
export function isVoximplantRecordingWebhookOverrideEnabled(): boolean {
  const raw = getVoximplantRecordingWebhookOverrideEnabledRaw();
  if (raw) {
    return getEnvBoolean("VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED", false);
  }
  return isDefaultOverrideEnabledForNodeEnv();
}

/** Read the saved DB override (null when unset or invalid). */
export async function getVoximplantRecordingWebhookBaseUrlOverride(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({
    where: { key: VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL_OVERRIDE_KEY },
    select: { value: true },
  });
  if (!row?.value?.trim()) return null;

  const validated = validateVoximplantRecordingWebhookBaseUrl(row.value);
  return validated.ok ? validated.value : null;
}

/**
 * Effective webhook base URL: override if present, else env default, else null.
 */
export async function getVoximplantRecordingWebhookBaseUrl(): Promise<string | null> {
  const override = await getVoximplantRecordingWebhookBaseUrlOverride();
  if (override) return override;
  return getVoximplantRecordingWebhookBaseUrlEnvDefault();
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
  override: string | null;
  effective: string | null;
};

function buildVoximplantRecordingWebhookUrlStateBase(): Pick<
  VoximplantRecordingWebhookUrlState,
  "nodeEnv" | "overrideEnabledRaw" | "overrideEnabled" | "envDefault"
> {
  return {
    nodeEnv: process.env.NODE_ENV ?? "development",
    overrideEnabledRaw: getVoximplantRecordingWebhookOverrideEnabledRaw(),
    overrideEnabled: isVoximplantRecordingWebhookOverrideEnabled(),
    envDefault: getVoximplantRecordingWebhookBaseUrlEnvDefault(),
  };
}

/** Safe fallback when DB override lookup fails (env-derived fields only). */
export function buildVoximplantRecordingWebhookUrlStateWithoutDb(): VoximplantRecordingWebhookUrlState {
  const base = buildVoximplantRecordingWebhookUrlStateBase();
  return {
    ...base,
    override: null,
    effective: base.envDefault,
  };
}

export async function getVoximplantRecordingWebhookUrlState(): Promise<VoximplantRecordingWebhookUrlState> {
  const base = buildVoximplantRecordingWebhookUrlStateBase();
  const override = await getVoximplantRecordingWebhookBaseUrlOverride();
  const effective = override ?? base.envDefault;

  return {
    ...base,
    override,
    effective,
  };
}
