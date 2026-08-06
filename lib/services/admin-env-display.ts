import {
  getAiAnalysisProvider,
  getTranscriptionProvider,
  getVideoProvider,
} from "@/lib/env";
import { resolveCredentialDispatchFenceTimeoutMs } from "@/lib/auth/credential-dispatch-fence";
import { getPasswordResetConfig } from "@/lib/auth/password-reset-config";
import { getForgotPasswordTimingFloorMs } from "@/lib/auth/response-timing-floor";
import { isTrustedProxyEnabled } from "@/lib/auth/trusted-proxy";
import { EMAIL_SENSITIVE_PAYLOAD_KEY_ENV } from "@/lib/email/sensitive-payload";
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

/**
 * Explicit typed registry for the in-scope runtime settings.
 *
 * Every descriptor must correspond to a key that runtime code actually reads,
 * and every in-scope runtime key must have a descriptor. Both directions are
 * enforced by drift tests in `admin-env-display.test.ts`, so a new setting
 * cannot silently appear in or disappear from operator diagnostics.
 */
export type AdminEnvDescriptor = {
  key: string;
  group: string | null;
  area: string;
  isSecret: boolean;
  consumer: string;
  explanation: string;
  status: AdminEnvDisplayItem["status"];
  valueSource: AdminEnvDisplayItem["valueSource"];
  value?: string | number | boolean | null;
  applicable?: boolean;
  required?: boolean;
};

function readEnv(key: string): string | null {
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Secret descriptors never carry a value. There is deliberately no masking,
 * prefix, suffix, length, or fingerprint: any of those leak key material to
 * every admin session and to anything that logs the response.
 */
function toItem(descriptor: AdminEnvDescriptor): AdminEnvDisplayItem {
  return {
    key: descriptor.key,
    area: descriptor.area,
    status: descriptor.status,
    valueSource: descriptor.valueSource,
    configured:
      descriptor.status === "configured" ||
      descriptor.status === "using_effective_default",
    isSecret: descriptor.isSecret,
    value: descriptor.isSecret
      ? null
      : descriptor.value === undefined || descriptor.value === null
        ? null
        : String(descriptor.value),
    applicable: descriptor.applicable ?? true,
    required: descriptor.required ?? false,
    consumer: descriptor.consumer,
    explanation: descriptor.explanation,
  };
}

function envOrDefault(key: string): {
  status: AdminEnvDisplayItem["status"];
  valueSource: AdminEnvDisplayItem["valueSource"];
} {
  return readEnv(key)
    ? { status: "configured", valueSource: "environment" }
    : { status: "using_effective_default", valueSource: "default" };
}

function secretState(
  key: string,
  params: { applicable: boolean; required: boolean },
): {
  status: AdminEnvDisplayItem["status"];
  valueSource: AdminEnvDisplayItem["valueSource"];
} {
  if (!params.applicable) {
    return { status: "not_applicable", valueSource: "not_applicable" };
  }
  if (readEnv(key)) {
    return { status: "configured", valueSource: "environment" };
  }
  return params.required
    ? { status: "missing_required", valueSource: "environment" }
    : { status: "not_applicable", valueSource: "not_applicable" };
}

function requiredWhenEnabled(
  key: string,
  enabled: boolean,
  present: boolean,
): { status: AdminEnvDisplayItem["status"]; valueSource: AdminEnvDisplayItem["valueSource"] } {
  if (present) return { status: "configured", valueSource: "environment" };
  if (!enabled) return { status: "not_applicable", valueSource: "not_applicable" };
  void key;
  return { status: "missing_required", valueSource: "environment" };
}

const EMAIL_CONFIG_CONSUMER = "lib/email/config.ts";
const EMAIL_SENSITIVE_PAYLOAD_CONSUMER = "lib/email/sensitive-payload.ts";
const PROVIDER_EVENT_EXPLANATION =
  "Effective bounded provider-event consumer setting.";

/** Descriptors whose effective value comes from the email runtime parser. */
const EMAIL_OWNED_CONSUMERS = new Set([
  EMAIL_CONFIG_CONSUMER,
  EMAIL_SENSITIVE_PAYLOAD_CONSUMER,
]);

function readEnvBoolean(key: string): boolean {
  return readEnv(key)?.toLowerCase() === "true";
}

function safeRead<T>(operation: () => T): T | null {
  try {
    return operation();
  } catch {
    return null;
  }
}

/**
 * The email runtime parser fails closed on a rejected environment, but the
 * operator still needs diagnostics in exactly that situation. When the parser
 * throws there is no effective value to report, so email-owned rows fall back
 * to raw presence: an absent required key stays `missing_required` so the
 * operator can see which one to fix, and everything else is `invalid`.
 */
function unresolvedEmailState(
  descriptor: AdminEnvDescriptor,
): Pick<AdminEnvDescriptor, "status" | "valueSource" | "value"> {
  if (descriptor.required && !readEnv(descriptor.key)) {
    return { status: "missing_required", valueSource: "environment", value: null };
  }
  return { status: "invalid", valueSource: "environment", value: null };
}

export function buildAdminEnvDescriptors(): AdminEnvDescriptor[] {
  const passwordReset = safeRead(getPasswordResetConfig);
  const trustedProxyEnabled = safeRead(isTrustedProxyEnabled);
  const credentialFenceTimeoutMs = safeRead(resolveCredentialDispatchFenceTimeoutMs);
  const forgotPasswordFloorMs = safeRead(getForgotPasswordTimingFloorMs);

  let email: ReturnType<typeof getEmailConfig> | null = null;
  try {
    email = getEmailConfig();
  } catch {
    email = null;
  }

  const ingestion = email?.providerEventIngestion ?? null;
  // Feature gating is derived from raw presence when the parser rejected the
  // environment, so required children are still classified correctly.
  const ingestionEnabled =
    ingestion?.enabled ?? readEnvBoolean("EMAIL_PROVIDER_EVENT_INGESTION_ENABLED");
  const deliveryEnabled =
    email?.deliveryEnabled ?? readEnvBoolean("EMAIL_DELIVERY_ENABLED");
  const provider = email?.provider ?? readEnv("EMAIL_PROVIDER")?.toLowerCase() ?? "disabled";
  const deliveryUsesPostbox = deliveryEnabled && provider === "yandex_postbox";

  const boundedProviderEventKeys: Array<[string, number | string | null]> = [
    ["EMAIL_PROVIDER_EVENT_RECORD_LIMIT", ingestion?.recordLimit ?? null],
    ["EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS", ingestion?.pollIntervalMs ?? null],
    [
      "EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS",
      ingestion?.shardRefreshSeconds ?? null,
    ],
    ["EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS", ingestion?.errorBackoffMs ?? null],
    ["EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES", ingestion?.maxPayloadBytes ?? null],
    [
      "EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS",
      ingestion?.shutdownTimeoutMs ?? null,
    ],
    ["EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY", ingestion?.shardConcurrency ?? null],
    [
      "EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS",
      ingestion?.shardSliceMaxPolls ?? null,
    ],
    [
      "EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES",
      ingestion?.maxConsecutiveFailures ?? null,
    ],
  ];

  const emailWorkerKeys: Array<[string, number | null]> = [
    ["EMAIL_WORKER_BATCH_SIZE", email?.workerBatchSize ?? null],
    ["EMAIL_MAX_ATTEMPTS", email?.maxAttempts ?? null],
    ["EMAIL_RETRY_BASE_SECONDS", email?.retryBaseSeconds ?? null],
    ["EMAIL_RETRY_MAX_SECONDS", email?.retryMaxSeconds ?? null],
    ["EMAIL_PROCESSING_LEASE_SECONDS", email?.processingLeaseSeconds ?? null],
    ["EMAIL_PROVIDER_REQUEST_TIMEOUT_MS", email?.providerRequestTimeoutMs ?? null],
    [
      "EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS",
      email?.providerRequestSafetyMarginSeconds ?? null,
    ],
  ];

  const retentionKeys: Array<[string, number | null]> = [
    ["EMAIL_CONTENT_RETENTION_DAYS", email?.contentRetentionDays ?? null],
    [
      "EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS",
      email?.deliveryAttemptRetentionDays ?? null,
    ],
    ["EMAIL_PROVIDER_ID_RETENTION_DAYS", email?.providerIdRetentionDays ?? null],
    [
      "EMAIL_PROVIDER_EVENT_RETENTION_DAYS",
      email?.providerEventRetentionDays ?? null,
    ],
    [
      "EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS",
      email?.bounceComplaintRetentionDays ?? null,
    ],
  ];

  const senderKeys: Array<[string, string | null]> = [
    ["EMAIL_FROM_NO_REPLY", email?.from["no-reply"] ?? null],
    ["EMAIL_FROM_NOTIFICATIONS", email?.from.notifications ?? null],
    ["EMAIL_FROM_INVITATIONS", email?.from.invitations ?? null],
    ["EMAIL_REPLY_TO_SUPPORT", email?.replyTo.support ?? null],
    ["EMAIL_REPLY_TO_SECURITY", email?.replyTo.security ?? null],
    ["EMAIL_REPLY_TO_BUSINESS", email?.replyTo.business ?? null],
  ];

  const descriptors: AdminEnvDescriptor[] = [
    {
      key: "VIDEO_PROVIDER",
      group: null,
      area: "Video",
      isSecret: false,
      status: "configured",
      valueSource: "derived",
      value: getVideoProvider(),
      consumer: "lib/env.ts",
      explanation: "Effective video provider selected by the runtime parser.",
    },
    {
      key: "TRANSCRIPTION_PROVIDER",
      group: null,
      area: "Transcription",
      isSecret: false,
      status: "configured",
      valueSource: "derived",
      value: getTranscriptionProvider(),
      consumer: "lib/env.ts",
      explanation:
        "Effective transcription provider selected by the runtime parser.",
    },
    {
      key: "AI_ANALYSIS_PROVIDER",
      group: null,
      area: "AI analysis",
      isSecret: false,
      status: "configured",
      valueSource: "derived",
      value: getAiAnalysisProvider(),
      consumer: "lib/env.ts",
      explanation:
        "Effective AI analysis provider selected by the runtime parser.",
    },

    {
      key: "DATABASE_URL",
      group: "Database / Auth",
      area: "Database",
      isSecret: true,
      status: readEnv("DATABASE_URL") ? "configured" : "missing_required",
      valueSource: "environment",
      required: true,
      consumer: "lib/prisma.ts",
      explanation: "Required by Prisma for all durable runtime state.",
    },
    {
      key: "AUTH_SECRET",
      group: "Database / Auth",
      area: "Authentication",
      isSecret: true,
      status: readEnv("AUTH_SECRET") ? "configured" : "missing_required",
      valueSource: "environment",
      required: true,
      consumer: "lib/auth/client-ip.ts",
      explanation: "Required to HMAC client identity in production.",
    },
    {
      key: "ADMIN_EMAILS",
      group: "Database / Auth",
      area: "Authentication",
      isSecret: false,
      ...envOrDefault("ADMIN_EMAILS"),
      value: readEnv("ADMIN_EMAILS") ? "configured list" : "empty list",
      consumer: "lib/auth/admin.ts",
      explanation: "Bootstrap admin email allowlist; empty is valid.",
    },
    {
      key: "TRUSTED_PROXY_ENABLED",
      group: "Database / Auth",
      area: "Authentication",
      isSecret: false,
      ...(trustedProxyEnabled === null
        ? { status: "invalid" as const, valueSource: "environment" as const }
        : envOrDefault("TRUSTED_PROXY_ENABLED")),
      value: trustedProxyEnabled,
      consumer: "lib/auth/trusted-proxy.ts",
      explanation:
        "Effective trusted-proxy mode used for client IP and forwarded-origin handling.",
    },
    {
      key: "CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS",
      group: "Database / Auth",
      area: "Authentication",
      isSecret: false,
      ...(credentialFenceTimeoutMs === null
        ? { status: "invalid" as const, valueSource: "environment" as const }
        : envOrDefault("CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS")),
      value: credentialFenceTimeoutMs,
      consumer: "lib/auth/credential-dispatch-fence.ts",
      explanation:
        "Effective bounded wait for the credential dispatch fence before failing closed.",
    },

    {
      key: "PASSWORD_RESET_TOKEN_TTL_MINUTES",
      group: "Password reset",
      area: "Password reset",
      isSecret: false,
      ...(passwordReset === null
        ? { status: "invalid" as const, valueSource: "environment" as const }
        : envOrDefault("PASSWORD_RESET_TOKEN_TTL_MINUTES")),
      value: passwordReset?.ttlMinutes ?? null,
      consumer: "lib/auth/password-reset-config.ts",
      explanation: "Effective reset token lifetime.",
    },
    {
      key: "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
      group: "Password reset",
      area: "Password reset",
      isSecret: false,
      ...(passwordReset === null
        ? { status: "invalid" as const, valueSource: "environment" as const }
        : envOrDefault("PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS")),
      value: passwordReset?.cooldownSeconds ?? null,
      consumer: "lib/auth/password-reset-config.ts",
      explanation: "Effective per-account reset request cooldown.",
    },
    {
      key: "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
      group: "Password reset",
      area: "Password reset",
      isSecret: false,
      ...(passwordReset === null
        ? { status: "invalid" as const, valueSource: "environment" as const }
        : envOrDefault("PASSWORD_RESET_MAX_REQUESTS_PER_HOUR")),
      value: passwordReset?.maxPerAccountPerHour ?? null,
      consumer: "lib/auth/password-reset-config.ts",
      explanation: "Effective per-account hourly reset request limit.",
    },
    {
      key: "PASSWORD_RESET_RESPONSE_FLOOR_MS",
      group: "Password reset",
      area: "Password reset",
      isSecret: false,
      ...(forgotPasswordFloorMs === null
        ? { status: "invalid" as const, valueSource: "environment" as const }
        : envOrDefault("PASSWORD_RESET_RESPONSE_FLOOR_MS")),
      value: forgotPasswordFloorMs,
      consumer: "lib/auth/response-timing-floor.ts",
      explanation:
        "Effective anti-enumeration response floor for public forgot-password intake.",
    },

    {
      key: "EMAIL_DELIVERY_ENABLED",
      group: "Email foundation",
      area: "Email",
      isSecret: false,
      status: deliveryEnabled
        ? envOrDefault("EMAIL_DELIVERY_ENABLED").status
        : "disabled_by_design",
      valueSource: envOrDefault("EMAIL_DELIVERY_ENABLED").valueSource,
      value: deliveryEnabled,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Effective email delivery feature flag.",
    },
    {
      key: "EMAIL_PROVIDER",
      group: "Email foundation",
      area: "Email",
      isSecret: false,
      status:
        provider === "disabled"
          ? "disabled_by_design"
          : envOrDefault("EMAIL_PROVIDER").status,
      valueSource:
        provider === "disabled" && !readEnv("EMAIL_PROVIDER")
          ? "default"
          : "environment",
      value: provider,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Effective email provider.",
    },
    {
      key: "EMAIL_CANONICAL_BASE_URL",
      group: "Email foundation",
      area: "Email",
      isSecret: false,
      ...envOrDefault("EMAIL_CANONICAL_BASE_URL"),
      value: email?.canonicalBaseUrl ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Origin used for account-security email links.",
    },
    {
      key: "EMAIL_LOCAL_PREVIEW_ENABLED",
      group: "Email foundation",
      area: "Email",
      isSecret: false,
      status: email?.localPreviewEnabled
        ? envOrDefault("EMAIL_LOCAL_PREVIEW_ENABLED").status
        : "disabled_by_design",
      valueSource: envOrDefault("EMAIL_LOCAL_PREVIEW_ENABLED").valueSource,
      value: email?.localPreviewEnabled ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation:
        "Local rendered-email preview flag; must stay disabled outside development.",
    },
    {
      key: "EMAIL_ADMIN_TEST_ENABLED",
      group: "Email foundation",
      area: "Email",
      isSecret: false,
      status: email?.adminTestEnabled
        ? envOrDefault("EMAIL_ADMIN_TEST_ENABLED").status
        : "disabled_by_design",
      valueSource: envOrDefault("EMAIL_ADMIN_TEST_ENABLED").valueSource,
      value: email?.adminTestEnabled ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Admin-triggered test email flag; disabled by default.",
    },
    {
      key: "EMAIL_OPERATOR_NAME",
      group: "Email foundation",
      area: "Email",
      isSecret: false,
      ...envOrDefault("EMAIL_OPERATOR_NAME"),
      value: email?.operatorName ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Operator identity rendered in the operational email footer.",
    },
    ...senderKeys.map(([key, value]): AdminEnvDescriptor => ({
      key,
      group: "Email foundation",
      area: "Email",
      isSecret: false,
      ...envOrDefault(key),
      value,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Effective validated sender or reply-to address.",
    })),
    {
      key: EMAIL_SENSITIVE_PAYLOAD_KEY_ENV,
      group: "Email foundation",
      area: "Email",
      isSecret: true,
      ...secretState(EMAIL_SENSITIVE_PAYLOAD_KEY_ENV, {
        applicable: true,
        required: true,
      }),
      applicable: true,
      required: true,
      consumer: EMAIL_SENSITIVE_PAYLOAD_CONSUMER,
      explanation:
        "Dedicated AEAD key for password-reset enqueue; required independently of delivery.",
    },
    {
      key: "YANDEX_POSTBOX_REGION",
      group: "Email foundation",
      area: "Postbox",
      isSecret: false,
      ...envOrDefault("YANDEX_POSTBOX_REGION"),
      value: email?.yandexPostbox.region ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Effective Postbox API signing region.",
    },
    {
      key: "YANDEX_POSTBOX_ENDPOINT",
      group: "Email foundation",
      area: "Postbox",
      isSecret: false,
      ...envOrDefault("YANDEX_POSTBOX_ENDPOINT"),
      value: email?.yandexPostbox.endpoint ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Effective Postbox SES-compatible endpoint.",
    },
    {
      key: "YANDEX_POSTBOX_CONFIGURATION_SET",
      group: "Email foundation",
      area: "Postbox",
      isSecret: false,
      status: email?.yandexPostbox.configurationSetName
        ? "configured"
        : "not_applicable",
      valueSource: email?.yandexPostbox.configurationSetName
        ? "environment"
        : "not_applicable",
      value: email?.yandexPostbox.configurationSetName ?? null,
      applicable: Boolean(email?.yandexPostbox.configurationSetName),
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation:
        "Optional Postbox configuration set; absent is valid unless the selected activation strategy requires it.",
    },
    {
      key: "YANDEX_POSTBOX_ACCESS_KEY_ID",
      group: "Email foundation",
      area: "Postbox",
      isSecret: true,
      ...secretState("YANDEX_POSTBOX_ACCESS_KEY_ID", {
        applicable: deliveryUsesPostbox,
        required: deliveryUsesPostbox,
      }),
      applicable: deliveryUsesPostbox,
      required: deliveryUsesPostbox,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Dedicated Postbox sending access key state.",
    },
    {
      key: "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
      group: "Email foundation",
      area: "Postbox",
      isSecret: true,
      ...secretState("YANDEX_POSTBOX_SECRET_ACCESS_KEY", {
        applicable: deliveryUsesPostbox,
        required: deliveryUsesPostbox,
      }),
      applicable: deliveryUsesPostbox,
      required: deliveryUsesPostbox,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Dedicated Postbox sending secret key state.",
    },

    ...emailWorkerKeys.map(([key, value]): AdminEnvDescriptor => ({
      key,
      group: "Email worker",
      area: "Email worker",
      isSecret: false,
      ...envOrDefault(key),
      value,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Effective bounded delivery-worker setting.",
    })),

    ...retentionKeys.map(([key, value]): AdminEnvDescriptor => ({
      key,
      group: "Email retention",
      area: "Email retention",
      isSecret: false,
      ...envOrDefault(key),
      value,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Effective bounded retention window in days.",
    })),

    {
      key: "EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS",
      group: "Provider-event reconciliation",
      area: "Provider events",
      isSecret: false,
      ...envOrDefault("EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS"),
      value: email?.providerEventReconciliationWindowSeconds ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation:
        "How long an unmatched provider event stays eligible for reconciliation.",
    },
    {
      key: "EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS",
      group: "Provider-event reconciliation",
      area: "Provider events",
      isSecret: false,
      ...envOrDefault("EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS"),
      value: email?.providerEventReconciliationDelaySeconds ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Delay before an unmatched provider event is retried.",
    },

    {
      key: "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
      group: "Provider-event ingestion",
      area: "Provider events",
      isSecret: false,
      status: ingestionEnabled
        ? envOrDefault("EMAIL_PROVIDER_EVENT_INGESTION_ENABLED").status
        : "disabled_by_design",
      valueSource: envOrDefault("EMAIL_PROVIDER_EVENT_INGESTION_ENABLED")
        .valueSource,
      value: ingestionEnabled,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation:
        "Provider-event ingestion is disabled until explicit activation.",
    },
    {
      key: "YANDEX_DATA_STREAMS_ENDPOINT",
      group: "Provider-event ingestion",
      area: "Provider events",
      isSecret: false,
      ...requiredWhenEnabled(
        "YANDEX_DATA_STREAMS_ENDPOINT",
        ingestionEnabled,
        Boolean(readEnv("YANDEX_DATA_STREAMS_ENDPOINT")),
      ),
      value: ingestion?.endpoint ?? null,
      applicable: ingestionEnabled,
      required: ingestionEnabled,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Yandex Data Streams HTTPS endpoint for ingestion.",
    },
    {
      key: "YANDEX_DATA_STREAMS_STREAM_NAME",
      group: "Provider-event ingestion",
      area: "Provider events",
      isSecret: false,
      ...requiredWhenEnabled(
        "YANDEX_DATA_STREAMS_STREAM_NAME",
        ingestionEnabled,
        Boolean(readEnv("YANDEX_DATA_STREAMS_STREAM_NAME")),
      ),
      value: ingestion?.streamName ?? null,
      applicable: ingestionEnabled,
      required: ingestionEnabled,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Yandex Data Streams stream consumed by the worker.",
    },
    {
      key: "YANDEX_DATA_STREAMS_REGION",
      group: "Provider-event ingestion",
      area: "Provider events",
      isSecret: false,
      ...envOrDefault("YANDEX_DATA_STREAMS_REGION"),
      value: ingestion?.region ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: "Effective Data Streams signing region.",
    },
    {
      key: "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
      group: "Provider-event ingestion",
      area: "Provider events",
      isSecret: true,
      ...secretState("YANDEX_DATA_STREAMS_ACCESS_KEY_ID", {
        applicable: ingestionEnabled,
        required: ingestionEnabled,
      }),
      applicable: ingestionEnabled,
      required: ingestionEnabled,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation:
        "Dedicated Data Streams access key state; never shared with Postbox sending.",
    },
    {
      key: "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
      group: "Provider-event ingestion",
      area: "Provider events",
      isSecret: true,
      ...secretState("YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY", {
        applicable: ingestionEnabled,
        required: ingestionEnabled,
      }),
      applicable: ingestionEnabled,
      required: ingestionEnabled,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation:
        "Dedicated Data Streams secret key state; never shared with Postbox sending.",
    },
    {
      key: "EMAIL_PROVIDER_EVENT_INITIAL_POSITION",
      group: "Provider-event ingestion",
      area: "Provider events",
      isSecret: false,
      ...envOrDefault("EMAIL_PROVIDER_EVENT_INITIAL_POSITION"),
      value: ingestion?.initialPosition ?? null,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation:
        "Initial shard position used only before a sequence checkpoint exists.",
    },
    ...boundedProviderEventKeys.map(([key, value]): AdminEnvDescriptor => ({
      key,
      group: "Provider-event ingestion",
      area: "Provider events",
      isSecret: false,
      ...envOrDefault(key),
      value,
      consumer: EMAIL_CONFIG_CONSUMER,
      explanation: PROVIDER_EVENT_EXPLANATION,
    })),
  ];

  if (email) return descriptors;

  return descriptors.map((descriptor) =>
    EMAIL_OWNED_CONSUMERS.has(descriptor.consumer)
      ? { ...descriptor, ...unresolvedEmailState(descriptor) }
      : descriptor,
  );
}

export function getAdminEnvironmentDisplayGroups(): AdminEnvDisplayGroup[] {
  const descriptors = buildAdminEnvDescriptors();
  const groups: AdminEnvDisplayGroup[] = [];
  const byGroup = new Map<string | null, AdminEnvDisplayItem[]>();
  const seen = new Set<string>();

  for (const descriptor of descriptors) {
    if (seen.has(descriptor.key)) continue;
    seen.add(descriptor.key);
    let items = byGroup.get(descriptor.group);
    if (!items) {
      items = [];
      byGroup.set(descriptor.group, items);
      groups.push({ group: descriptor.group, items });
    }
    items.push(toItem(descriptor));
  }

  return groups;
}
