import { getEnvBoolean } from "@/lib/env";
import { validateEmailAddress } from "@/lib/email/address";

export type EmailProviderName = "disabled" | "yandex_postbox" | "fake";

export type EmailSenderKey = "no-reply" | "notifications" | "invitations";
export type EmailReplyToKey = "support" | "security" | "business";
export type EmailProviderEventInitialPosition = "LATEST" | "TRIM_HORIZON";

export type EmailConfig = {
  deliveryEnabled: boolean;
  localPreviewEnabled: boolean;
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
  providerRequestTimeoutMs: number;
  providerRequestSafetyMarginSeconds: number;
  providerEventReconciliationWindowSeconds: number;
  providerEventReconciliationDelaySeconds: number;
  contentRetentionDays: number;
  deliveryAttemptRetentionDays: number;
  providerIdRetentionDays: number;
  providerEventRetentionDays: number;
  bounceComplaintRetentionDays: number;
  adminTestEnabled: boolean;
  providerEventIngestion: {
    enabled: boolean;
    endpoint: string | null;
    region: string;
    streamName: string | null;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    initialPosition: EmailProviderEventInitialPosition;
    recordLimit: number;
    /** Minimum interval between GetRecords calls for the same shard. */
    pollIntervalMs: number;
    shardRefreshSeconds: number;
    errorBackoffMs: number;
    maxPayloadBytes: number;
    shutdownTimeoutMs: number;
    /** Number of shard slices the scheduler may run at the same time. */
    shardConcurrency: number;
    /** Upper bound on GetRecords calls inside one fair scheduling slice. */
    shardSliceMaxPolls: number;
    /** Consecutive transient failures tolerated before the shard fails closed. */
    maxConsecutiveFailures: number;
  };
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

function readOptionalString(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
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
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("EMAIL_CANONICAL_BASE_URL must be an exact origin.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error("EMAIL_CANONICAL_BASE_URL must not include a path.");
  }
  // Reject trailing-dot hosts and explicit non-default ports.
  if (url.hostname.endsWith(".")) {
    throw new Error("EMAIL_CANONICAL_BASE_URL hostname must not end with a dot.");
  }
  if (url.port) {
    throw new Error("EMAIL_CANONICAL_BASE_URL must not include an explicit port.");
  }

  const origin = url.origin;
  const isProduction = process.env.NODE_ENV === "production";
  const approvedProduction = "https://negotaitions.ru";
  const approvedLocal = "https://local.negotaitions.ru";

  if (isProduction) {
    if (url.protocol !== "https:") {
      throw new Error("EMAIL_CANONICAL_BASE_URL must use https in production.");
    }
    if (origin !== approvedProduction) {
      throw new Error(
        "EMAIL_CANONICAL_BASE_URL must be exactly https://negotaitions.ru in production.",
      );
    }
    return approvedProduction;
  }

  // Non-production: exact allowlist only (no arbitrary HTTPS hosts).
  if (origin === approvedProduction || origin === approvedLocal) {
    return origin;
  }
  throw new Error(
    "EMAIL_CANONICAL_BASE_URL must be https://negotaitions.ru or https://local.negotaitions.ru.",
  );
}

function readOptionalSecret(key: string): string | null {
  const value = process.env[key]?.trim();
  return value ? value : null;
}

function parseProviderEventInitialPosition(): EmailProviderEventInitialPosition {
  const raw =
    process.env.EMAIL_PROVIDER_EVENT_INITIAL_POSITION?.trim().toUpperCase() ||
    "LATEST";
  if (raw === "LATEST" || raw === "TRIM_HORIZON") return raw;
  throw new Error(
    "Invalid EMAIL_PROVIDER_EVENT_INITIAL_POSITION. Allowed: LATEST, TRIM_HORIZON.",
  );
}

function parseDataStreamsEndpoint(enabled: boolean): string | null {
  const raw = readOptionalString("YANDEX_DATA_STREAMS_ENDPOINT");
  if (!raw) {
    if (enabled) {
      throw new Error(
        "YANDEX_DATA_STREAMS_ENDPOINT is required when provider-event ingestion is enabled.",
      );
    }
    return null;
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid YANDEX_DATA_STREAMS_ENDPOINT.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error(
      "YANDEX_DATA_STREAMS_ENDPOINT must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  const approvedHosts = new Set(["yds.serverless.yandexcloud.net"]);
  if (!approvedHosts.has(url.hostname)) {
    throw new Error("YANDEX_DATA_STREAMS_ENDPOINT must be an approved Yandex Data Streams endpoint.");
  }
  return url.origin;
}

function parseDataStreamsStreamName(enabled: boolean): string | null {
  const streamName = readOptionalString("YANDEX_DATA_STREAMS_STREAM_NAME");
  if (!streamName) {
    if (enabled) {
      throw new Error(
        "YANDEX_DATA_STREAMS_STREAM_NAME is required when provider-event ingestion is enabled.",
      );
    }
    return null;
  }
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(streamName)) {
    throw new Error(
      "Invalid YANDEX_DATA_STREAMS_STREAM_NAME. Expected 1..128 characters: letters, digits, underscore, dot, colon, or hyphen.",
    );
  }
  return streamName;
}

export function getEmailConfig(): EmailConfig {
  const deliveryEnabled = getEnvBoolean("EMAIL_DELIVERY_ENABLED", false);
  const providerEventIngestionEnabled = getEnvBoolean(
    "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
    false,
  );
  const provider = parseProvider();
  const yandexAccessKeyId = readOptionalSecret("YANDEX_POSTBOX_ACCESS_KEY_ID");
  const yandexSecretAccessKey = readOptionalSecret("YANDEX_POSTBOX_SECRET_ACCESS_KEY");
  const dataStreamsAccessKeyId = readOptionalSecret(
    "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
  );
  const dataStreamsSecretAccessKey = readOptionalSecret(
    "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
  );

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
  if (providerEventIngestionEnabled) {
    if (!dataStreamsAccessKeyId || !dataStreamsSecretAccessKey) {
      throw new Error(
        "Missing Yandex Data Streams credentials for enabled provider-event ingestion.",
      );
    }
  }

  const processingLeaseSeconds = parseBoundedInteger(
    "EMAIL_PROCESSING_LEASE_SECONDS",
    600,
    60,
    7200,
  );
  const providerRequestTimeoutMs = parseBoundedInteger(
    "EMAIL_PROVIDER_REQUEST_TIMEOUT_MS",
    30000,
    1000,
    600000,
  );
  const providerRequestSafetyMarginSeconds = parseBoundedInteger(
    "EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS",
    30,
    5,
    600,
  );
  if (
    providerRequestTimeoutMs >=
    (processingLeaseSeconds - providerRequestSafetyMarginSeconds) * 1000
  ) {
    throw new Error(
      "EMAIL_PROVIDER_REQUEST_TIMEOUT_MS must be shorter than EMAIL_PROCESSING_LEASE_SECONDS minus EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS.",
    );
  }

  return {
    deliveryEnabled,
    localPreviewEnabled: getEnvBoolean("EMAIL_LOCAL_PREVIEW_ENABLED", false),
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
    processingLeaseSeconds,
    providerRequestTimeoutMs,
    providerRequestSafetyMarginSeconds,
    providerEventReconciliationWindowSeconds: parseBoundedInteger(
      "EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS",
      86400,
      60,
      604800,
    ),
    providerEventReconciliationDelaySeconds: parseBoundedInteger(
      "EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS",
      60,
      5,
      3600,
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
    providerEventIngestion: {
      enabled: providerEventIngestionEnabled,
      endpoint: parseDataStreamsEndpoint(providerEventIngestionEnabled),
      region: readOptionalString("YANDEX_DATA_STREAMS_REGION") ?? "ru-central1",
      streamName: parseDataStreamsStreamName(providerEventIngestionEnabled),
      accessKeyId: dataStreamsAccessKeyId,
      secretAccessKey: dataStreamsSecretAccessKey,
      initialPosition: parseProviderEventInitialPosition(),
      recordLimit: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_RECORD_LIMIT",
        100,
        1,
        1000,
      ),
      pollIntervalMs: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS",
        1000,
        200,
        5000,
      ),
      shardRefreshSeconds: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS",
        60,
        10,
        3600,
      ),
      errorBackoffMs: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS",
        2000,
        100,
        60000,
      ),
      maxPayloadBytes: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES",
        262144,
        1024,
        1048576,
      ),
      shutdownTimeoutMs: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS",
        15000,
        1000,
        120000,
      ),
      shardConcurrency: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY",
        2,
        1,
        16,
      ),
      shardSliceMaxPolls: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS",
        4,
        1,
        50,
      ),
      maxConsecutiveFailures: parseBoundedInteger(
        "EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES",
        5,
        1,
        50,
      ),
    },
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
