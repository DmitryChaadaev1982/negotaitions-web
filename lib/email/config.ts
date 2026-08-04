import { getEnvBoolean } from "@/lib/env";
import { validateEmailAddress } from "@/lib/email/address";

export type EmailProviderName = "disabled" | "yandex_postbox" | "fake";

export type EmailSenderKey = "no-reply" | "notifications" | "invitations";
export type EmailReplyToKey = "support" | "security" | "business";

export type EmailConfig = {
  deliveryEnabled: boolean;
  provider: EmailProviderName;
  canonicalBaseUrl: string;
  from: Record<EmailSenderKey, string>;
  replyTo: Record<EmailReplyToKey, string>;
  operatorName: string;
  workerBatchSize: number;
  maxAttempts: number;
  retryBaseSeconds: number;
  retryMaxSeconds: number;
  processingLeaseSeconds: number;
  contentRetentionDays: number;
  deliveryAttemptRetentionDays: number;
  providerIdRetentionDays: number;
  providerEventRetentionDays: number;
  bounceComplaintRetentionDays: number;
  adminTestEnabled: boolean;
  yandexPostbox: {
    region: string;
    endpoint: string;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    configurationSetName: string | null;
  };
};

function parseBoundedInteger(
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const raw = process.env[key]?.trim();
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${key}. Expected integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseProvider(): EmailProviderName {
  const raw = process.env.EMAIL_PROVIDER?.trim().toLowerCase() || "disabled";
  if (raw === "disabled" || raw === "yandex_postbox" || raw === "fake") {
    return raw;
  }
  throw new Error("Invalid EMAIL_PROVIDER. Allowed: disabled, yandex_postbox, fake.");
}

function parseCanonicalBaseUrl(): string {
  const raw =
    process.env.EMAIL_CANONICAL_BASE_URL?.trim() || "https://negotaitions.ru";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid EMAIL_CANONICAL_BASE_URL.");
  }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("EMAIL_CANONICAL_BASE_URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("EMAIL_CANONICAL_BASE_URL must be an exact origin.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("EMAIL_CANONICAL_BASE_URL must not include a path.");
  }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new Error("EMAIL_CANONICAL_BASE_URL must use https in production.");
  }
  return url.origin;
}

function readOptionalSecret(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

export function getEmailConfig(): EmailConfig {
  const deliveryEnabled = getEnvBoolean("EMAIL_DELIVERY_ENABLED", false);
  const provider = parseProvider();
  const yandexAccessKeyId = readOptionalSecret("YANDEX_POSTBOX_ACCESS_KEY_ID");
  const yandexSecretAccessKey = readOptionalSecret("YANDEX_POSTBOX_SECRET_ACCESS_KEY");

  if (deliveryEnabled && provider === "disabled") {
    throw new Error("EMAIL_PROVIDER must not be disabled when EMAIL_DELIVERY_ENABLED=true.");
  }
  if (deliveryEnabled && provider === "yandex_postbox") {
    if (!yandexAccessKeyId || !yandexSecretAccessKey) {
      throw new Error(
        "Missing Yandex Postbox credentials for enabled email delivery.",
      );
    }
  }

  return {
    deliveryEnabled,
    provider,
    canonicalBaseUrl: parseCanonicalBaseUrl(),
    from: {
      "no-reply": validateEmailAddress(
        process.env.EMAIL_FROM_NO_REPLY ?? "no-reply@negotaitions.ru",
        "EMAIL_FROM_NO_REPLY",
      ),
      notifications: validateEmailAddress(
        process.env.EMAIL_FROM_NOTIFICATIONS ?? "notifications@negotaitions.ru",
        "EMAIL_FROM_NOTIFICATIONS",
      ),
      invitations: validateEmailAddress(
        process.env.EMAIL_FROM_INVITATIONS ?? "invitations@negotaitions.ru",
        "EMAIL_FROM_INVITATIONS",
      ),
    },
    replyTo: {
      support: validateEmailAddress(
        process.env.EMAIL_REPLY_TO_SUPPORT ?? "support@negotaitions.ru",
        "EMAIL_REPLY_TO_SUPPORT",
      ),
      security: validateEmailAddress(
        process.env.EMAIL_REPLY_TO_SECURITY ?? "security@negotaitions.ru",
        "EMAIL_REPLY_TO_SECURITY",
      ),
      business: validateEmailAddress(
        process.env.EMAIL_REPLY_TO_BUSINESS ?? "business@negotaitions.ru",
        "EMAIL_REPLY_TO_BUSINESS",
      ),
    },
    operatorName:
      process.env.EMAIL_OPERATOR_NAME?.trim() || "Чаадаев Дмитрий Владимирович",
    workerBatchSize: parseBoundedInteger("EMAIL_WORKER_BATCH_SIZE", 25, 1, 500),
    maxAttempts: parseBoundedInteger("EMAIL_MAX_ATTEMPTS", 5, 1, 20),
    retryBaseSeconds: parseBoundedInteger("EMAIL_RETRY_BASE_SECONDS", 60, 10, 3600),
    retryMaxSeconds: parseBoundedInteger("EMAIL_RETRY_MAX_SECONDS", 43200, 60, 86400),
    processingLeaseSeconds: parseBoundedInteger(
      "EMAIL_PROCESSING_LEASE_SECONDS",
      600,
      60,
      7200,
    ),
    contentRetentionDays: parseBoundedInteger("EMAIL_CONTENT_RETENTION_DAYS", 90, 1, 3650),
    deliveryAttemptRetentionDays: parseBoundedInteger(
      "EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS",
      365,
      1,
      3650,
    ),
    providerIdRetentionDays: parseBoundedInteger(
      "EMAIL_PROVIDER_ID_RETENTION_DAYS",
      365,
      1,
      3650,
    ),
    providerEventRetentionDays: parseBoundedInteger(
      "EMAIL_PROVIDER_EVENT_RETENTION_DAYS",
      730,
      1,
      3650,
    ),
    bounceComplaintRetentionDays: parseBoundedInteger(
      "EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS",
      730,
      1,
      3650,
    ),
    adminTestEnabled: getEnvBoolean("EMAIL_ADMIN_TEST_ENABLED", false),
    yandexPostbox: {
      region: process.env.YANDEX_POSTBOX_REGION?.trim() || "ru-central1",
      endpoint:
        process.env.YANDEX_POSTBOX_ENDPOINT?.trim() ||
        "https://postbox.cloud.yandex.net",
      accessKeyId: yandexAccessKeyId,
      secretAccessKey: yandexSecretAccessKey,
      configurationSetName:
        process.env.YANDEX_POSTBOX_CONFIGURATION_SET?.trim() || null,
    },
  };
}
