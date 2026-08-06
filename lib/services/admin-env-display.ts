import {
  getAiAnalysisProvider,
  getTranscriptionProvider,
  getVideoProvider,
} from "@/lib/env";
import { getPasswordResetConfig } from "@/lib/auth/password-reset-config";
import { isTrustedProxyEnabled } from "@/lib/auth/trusted-proxy";
import { getEmailConfig } from "@/lib/email/config";

export type AdminEnvDisplayItem = {
  key: string;
  area: string;
  status:
    | "configured"
    | "using_effective_default"
    | "disabled_by_design"
    | "not_applicable"
    | "missing_required"
    | "invalid";
  valueSource: "environment" | "default" | "derived" | "not_applicable";
  configured: boolean;
  isSecret: boolean;
  value: string | null;
  applicable: boolean;
  required: boolean;
  consumer: string;
  explanation: string;
};

export type AdminEnvDisplayGroup = {
  group: string | null;
  items: AdminEnvDisplayItem[];
};

export function maskSecretValue(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "********";
  if (normalized.length <= 4) {
    return `${normalized.slice(0, 1)}********`;
  }
  if (normalized.length <= 8) {
    return `${normalized.slice(0, 2)}********`;
  }
  return `${normalized.slice(0, 3)}********${normalized.slice(-3)}`;
}

function readEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

function item(params: {
  key: string;
  area: string;
  status: AdminEnvDisplayItem["status"];
  valueSource: AdminEnvDisplayItem["valueSource"];
  value?: string | number | boolean | null;
  isSecret?: boolean;
  applicable?: boolean;
  required?: boolean;
  consumer: string;
  explanation: string;
}): AdminEnvDisplayItem {
  return {
    key: params.key,
    area: params.area,
    status: params.status,
    valueSource: params.valueSource,
    configured:
      params.status === "configured" ||
      params.status === "using_effective_default",
    isSecret: Boolean(params.isSecret),
    value: params.isSecret
      ? null
      : params.value === undefined || params.value === null
        ? null
        : String(params.value),
    applicable: params.applicable ?? true,
    required: params.required ?? false,
    consumer: params.consumer,
    explanation: params.explanation,
  };
}

function envOrDefaultStatus(key: string): {
  status: AdminEnvDisplayItem["status"];
  source: AdminEnvDisplayItem["valueSource"];
} {
  return readEnv(key)
    ? { status: "configured", source: "environment" }
    : { status: "using_effective_default", source: "default" };
}

function secretStatus(key: string, required: boolean, applicable = true) {
  if (!applicable) {
    return {
      status: "not_applicable" as const,
      valueSource: "not_applicable" as const,
    };
  }
  if (readEnv(key)) {
    return { status: "configured" as const, valueSource: "environment" as const };
  }
  return {
    status: required ? ("missing_required" as const) : ("not_applicable" as const),
    valueSource: required
      ? ("environment" as const)
      : ("not_applicable" as const),
  };
}

export function getAdminEnvironmentDisplayGroups(): AdminEnvDisplayGroup[] {
  const passwordReset = getPasswordResetConfig();
  const trustedProxy = isTrustedProxyEnabled();
  const email = getEmailConfig();
  const deliveryUsesPostbox =
    email.deliveryEnabled && email.provider === "yandex_postbox";
  const ingestion = email.providerEventIngestion;
  const ingestionEnabled = ingestion.enabled;
  const trustedProxySource = envOrDefaultStatus("TRUSTED_PROXY_ENABLED");
  const ttlSource = envOrDefaultStatus("PASSWORD_RESET_TOKEN_TTL_MINUTES");
  const cooldownSource = envOrDefaultStatus(
    "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
  );
  const hourlySource = envOrDefaultStatus("PASSWORD_RESET_MAX_REQUESTS_PER_HOUR");
  const postboxRegionSource = envOrDefaultStatus("YANDEX_POSTBOX_REGION");
  const postboxEndpointSource = envOrDefaultStatus("YANDEX_POSTBOX_ENDPOINT");
  const ingestionEnabledSource = envOrDefaultStatus(
    "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
  );

  const groups: AdminEnvDisplayGroup[] = [
    {
      // Variables that do not belong to one provider-domain group.
      group: null,
      items: [
        {
          ...item({
            key: "VIDEO_PROVIDER",
            area: "Video",
            status: "configured",
            valueSource: "derived",
            value: getVideoProvider(),
            consumer: "lib/env.ts",
            explanation: "Effective video provider selected by runtime parser.",
          }),
        },
        item({
          key: "TRANSCRIPTION_PROVIDER",
          area: "Transcription",
          status: "configured",
          valueSource: "derived",
          value: getTranscriptionProvider(),
          consumer: "lib/env.ts",
          explanation: "Effective transcription provider selected by runtime parser.",
        }),
        item({
          key: "AI_ANALYSIS_PROVIDER",
          area: "AI analysis",
          status: "configured",
          valueSource: "derived",
          value: getAiAnalysisProvider(),
          consumer: "lib/env.ts",
          explanation: "Effective AI analysis provider selected by runtime parser.",
        }),
      ],
    },
    {
      group: "Database / Auth",
      items: [
        item({
          key: "DATABASE_URL",
          area: "Database",
          status: readEnv("DATABASE_URL") ? "configured" : "missing_required",
          valueSource: "environment",
          isSecret: true,
          required: true,
          consumer: "lib/prisma.ts",
          explanation: "Required by Prisma for all durable runtime state.",
        }),
        item({
          key: "AUTH_SECRET",
          area: "Authentication",
          status: readEnv("AUTH_SECRET") ? "configured" : "missing_required",
          valueSource: "environment",
          isSecret: true,
          required: true,
          consumer: "lib/auth/client-ip.ts",
          explanation: "Required to HMAC client identity in production.",
        }),
        item({
          key: "ADMIN_EMAILS",
          area: "Authentication",
          status: readEnv("ADMIN_EMAILS")
            ? "configured"
            : "using_effective_default",
          valueSource: readEnv("ADMIN_EMAILS") ? "environment" : "default",
          value: readEnv("ADMIN_EMAILS") ? "configured list" : "empty list",
          consumer: "lib/auth/admin.ts",
          explanation: "Bootstrap admin email allowlist; empty is valid.",
        }),
        item({
          key: "TRUSTED_PROXY_ENABLED",
          area: "Authentication",
          status: trustedProxySource.status,
          valueSource: trustedProxySource.source,
          value: trustedProxy,
          consumer: "lib/auth/trusted-proxy.ts",
          explanation: "Effective trusted-proxy mode used for client IP handling.",
        }),
      ],
    },
    {
      group: "Password reset",
      items: [
        item({
          key: "PASSWORD_RESET_TOKEN_TTL_MINUTES",
          area: "Password reset",
          status: ttlSource.status,
          valueSource: ttlSource.source,
          value: passwordReset.ttlMinutes,
          consumer: "lib/auth/password-reset-config.ts",
          explanation: "Effective reset token lifetime.",
        }),
        item({
          key: "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
          area: "Password reset",
          status: cooldownSource.status,
          valueSource: cooldownSource.source,
          value: passwordReset.cooldownSeconds,
          consumer: "lib/auth/password-reset-config.ts",
          explanation: "Effective per-account reset request cooldown.",
        }),
        item({
          key: "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
          area: "Password reset",
          status: hourlySource.status,
          valueSource: hourlySource.source,
          value: passwordReset.maxPerAccountPerHour,
          consumer: "lib/auth/password-reset-config.ts",
          explanation: "Effective per-account hourly reset request limit.",
        }),
      ],
    },
    {
      group: "Email foundation",
      items: [
        item({
          key: "EMAIL_DELIVERY_ENABLED",
          area: "Email",
          status: envOrDefaultStatus("EMAIL_DELIVERY_ENABLED").status,
          valueSource: envOrDefaultStatus("EMAIL_DELIVERY_ENABLED").source,
          value: email.deliveryEnabled,
          consumer: "lib/email/config.ts",
          explanation: "Effective email delivery feature flag.",
        }),
        item({
          key: "EMAIL_PROVIDER",
          area: "Email",
          status:
            email.provider === "disabled"
              ? "disabled_by_design"
              : envOrDefaultStatus("EMAIL_PROVIDER").status,
          valueSource:
            email.provider === "disabled" && !readEnv("EMAIL_PROVIDER")
              ? "default"
              : "environment",
          value: email.provider,
          consumer: "lib/email/config.ts",
          explanation: "Effective email provider.",
        }),
        item({
          key: "EMAIL_CANONICAL_BASE_URL",
          area: "Email",
          status: envOrDefaultStatus("EMAIL_CANONICAL_BASE_URL").status,
          valueSource: envOrDefaultStatus("EMAIL_CANONICAL_BASE_URL").source,
          value: email.canonicalBaseUrl,
          consumer: "lib/email/config.ts",
          explanation: "Origin used for account-security email links.",
        }),
        item({
          key: "YANDEX_POSTBOX_REGION",
          area: "Postbox",
          status: postboxRegionSource.status,
          valueSource: postboxRegionSource.source,
          value: email.yandexPostbox.region,
          consumer: "lib/email/config.ts",
          explanation: "Effective Postbox API signing region.",
        }),
        item({
          key: "YANDEX_POSTBOX_ENDPOINT",
          area: "Postbox",
          status: postboxEndpointSource.status,
          valueSource: postboxEndpointSource.source,
          value: email.yandexPostbox.endpoint,
          consumer: "lib/email/config.ts",
          explanation: "Effective Postbox SES-compatible endpoint.",
        }),
        item({
          key: "YANDEX_POSTBOX_CONFIGURATION_SET",
          area: "Postbox",
          status: email.yandexPostbox.configurationSetName
            ? "configured"
            : "not_applicable",
          valueSource: email.yandexPostbox.configurationSetName
            ? "environment"
            : "not_applicable",
          value: email.yandexPostbox.configurationSetName,
          applicable: Boolean(email.yandexPostbox.configurationSetName),
          consumer: "lib/email/config.ts",
          explanation:
            "Optional Postbox configuration set; absent is valid unless a selected activation strategy requires it.",
        }),
        item({
          key: "YANDEX_POSTBOX_ACCESS_KEY_ID",
          area: "Postbox",
          ...secretStatus("YANDEX_POSTBOX_ACCESS_KEY_ID", deliveryUsesPostbox),
          isSecret: true,
          required: deliveryUsesPostbox,
          applicable: deliveryUsesPostbox,
          consumer: "lib/email/config.ts",
          explanation: "Dedicated Postbox sending access key state.",
        }),
        item({
          key: "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
          area: "Postbox",
          ...secretStatus("YANDEX_POSTBOX_SECRET_ACCESS_KEY", deliveryUsesPostbox),
          isSecret: true,
          required: deliveryUsesPostbox,
          applicable: deliveryUsesPostbox,
          consumer: "lib/email/config.ts",
          explanation: "Dedicated Postbox sending secret key state.",
        }),
      ],
    },
    {
      group: "Provider-event ingestion",
      items: [
        item({
          key: "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
          area: "Provider events",
          status: ingestion.enabled
            ? ingestionEnabledSource.status
            : "disabled_by_design",
          valueSource: ingestionEnabledSource.source,
          value: ingestion.enabled,
          consumer: "lib/email/config.ts",
          explanation: "Provider-event ingestion is disabled until explicit activation.",
        }),
        item({
          key: "YANDEX_DATA_STREAMS_ENDPOINT",
          area: "Provider events",
          status: ingestion.endpoint
            ? "configured"
            : ingestionEnabled
              ? "missing_required"
              : "not_applicable",
          valueSource: ingestion.endpoint ? "environment" : "not_applicable",
          value: ingestion.endpoint,
          applicable: ingestionEnabled,
          required: ingestionEnabled,
          consumer: "lib/email/config.ts",
          explanation: "Yandex Data Streams HTTPS endpoint for ingestion.",
        }),
        item({
          key: "YANDEX_DATA_STREAMS_STREAM_NAME",
          area: "Provider events",
          status: ingestion.streamName
            ? "configured"
            : ingestionEnabled
              ? "missing_required"
              : "not_applicable",
          valueSource: ingestion.streamName ? "environment" : "not_applicable",
          value: ingestion.streamName,
          applicable: ingestionEnabled,
          required: ingestionEnabled,
          consumer: "lib/email/config.ts",
          explanation: "Yandex Data Streams stream consumed by the worker.",
        }),
        item({
          key: "YANDEX_DATA_STREAMS_REGION",
          area: "Provider events",
          status: envOrDefaultStatus("YANDEX_DATA_STREAMS_REGION").status,
          valueSource: envOrDefaultStatus("YANDEX_DATA_STREAMS_REGION").source,
          value: ingestion.region,
          consumer: "lib/email/config.ts",
          explanation: "Effective Data Streams signing region.",
        }),
        item({
          key: "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
          area: "Provider events",
          ...secretStatus("YANDEX_DATA_STREAMS_ACCESS_KEY_ID", ingestionEnabled, ingestionEnabled),
          isSecret: true,
          applicable: ingestionEnabled,
          required: ingestionEnabled,
          consumer: "lib/email/config.ts",
          explanation: "Dedicated Data Streams access key state.",
        }),
        item({
          key: "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
          area: "Provider events",
          ...secretStatus("YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY", ingestionEnabled, ingestionEnabled),
          isSecret: true,
          applicable: ingestionEnabled,
          required: ingestionEnabled,
          consumer: "lib/email/config.ts",
          explanation: "Dedicated Data Streams secret key state.",
        }),
        item({
          key: "EMAIL_PROVIDER_EVENT_INITIAL_POSITION",
          area: "Provider events",
          status: envOrDefaultStatus("EMAIL_PROVIDER_EVENT_INITIAL_POSITION").status,
          valueSource: envOrDefaultStatus("EMAIL_PROVIDER_EVENT_INITIAL_POSITION").source,
          value: ingestion.initialPosition,
          consumer: "lib/email/config.ts",
          explanation: "Initial shard position used only before a checkpoint exists.",
        }),
        ...[
          ["EMAIL_PROVIDER_EVENT_RECORD_LIMIT", ingestion.recordLimit],
          ["EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS", ingestion.pollIntervalMs],
          [
            "EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS",
            ingestion.shardRefreshSeconds,
          ],
          ["EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS", ingestion.errorBackoffMs],
          ["EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES", ingestion.maxPayloadBytes],
          [
            "EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS",
            ingestion.shutdownTimeoutMs,
          ],
        ].map(([key, value]) =>
          item({
            key: String(key),
            area: "Provider events",
            status: envOrDefaultStatus(String(key)).status,
            valueSource: envOrDefaultStatus(String(key)).source,
            value: String(value),
            consumer: "lib/email/config.ts",
            explanation: "Effective bounded provider-event consumer setting.",
          }),
        ),
      ],
    },
  ];

  const seen = new Set<string>();
  return groups.map((group) => ({
    group: group.group,
    items: group.items.filter((item) => {
      if (seen.has(item.key)) {
        return false;
      }
      seen.add(item.key);
      return true;
    }),
  }));
}
