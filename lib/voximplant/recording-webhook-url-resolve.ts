import { getEnvBoolean } from "@/lib/env";

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

export type VoximplantRecordingWebhookEffectiveSource =
  | "env"
  | "saved_override"
  | "fallback"
  | "invalid";

export type VoximplantRecordingWebhookUrlResolution = {
  nodeEnv: string;
  envWebhookBaseUrl: string | null;
  overrideEnabledRaw: string | null;
  overrideEnabled: boolean;
  savedOverrideWebhookBaseUrl: string | null;
  savedOverrideValid: boolean;
  savedOverridePresent: boolean;
  effectiveWebhookBaseUrl: string | null;
  effectiveSource: VoximplantRecordingWebhookEffectiveSource;
  warning?: string;
};

/**
 * Pure resolver: saved override applies only when overrideEnabled is true.
 */
export function resolveVoximplantRecordingWebhookUrl(input: {
  savedOverrideRaw: string | null;
}): VoximplantRecordingWebhookUrlResolution {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const envWebhookBaseUrl = getVoximplantRecordingWebhookBaseUrlEnvDefault();
  const overrideEnabledRaw = getVoximplantRecordingWebhookOverrideEnabledRaw();
  const overrideEnabled = isVoximplantRecordingWebhookOverrideEnabled();

  const savedOverridePresent = Boolean(input.savedOverrideRaw?.trim());
  let savedOverrideValid = false;
  let savedOverrideWebhookBaseUrl: string | null = null;

  if (input.savedOverrideRaw?.trim()) {
    const validated = validateVoximplantRecordingWebhookBaseUrl(input.savedOverrideRaw);
    if (validated.ok) {
      savedOverrideValid = true;
      savedOverrideWebhookBaseUrl = validated.value;
    }
  }

  let effectiveWebhookBaseUrl: string | null = null;
  let effectiveSource: VoximplantRecordingWebhookEffectiveSource = "invalid";
  let warning: string | undefined;

  if (overrideEnabled && savedOverrideValid && savedOverrideWebhookBaseUrl) {
    effectiveWebhookBaseUrl = savedOverrideWebhookBaseUrl;
    effectiveSource = "saved_override";
  } else if (envWebhookBaseUrl) {
    effectiveWebhookBaseUrl = envWebhookBaseUrl;
    effectiveSource = "env";
    if (overrideEnabled && savedOverridePresent && !savedOverrideValid) {
      warning =
        "Override is enabled but the saved override URL is missing or invalid; using env default.";
    } else if (overrideEnabled && !savedOverridePresent) {
      warning = "Override is enabled but no saved override exists; using env default.";
    }
  }

  return {
    nodeEnv,
    envWebhookBaseUrl,
    overrideEnabledRaw,
    overrideEnabled,
    savedOverrideWebhookBaseUrl,
    savedOverrideValid,
    savedOverridePresent,
    effectiveWebhookBaseUrl,
    effectiveSource,
    ...(warning ? { warning } : {}),
  };
}
