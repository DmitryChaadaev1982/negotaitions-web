import { parseServerRuntimeSetting } from "@/lib/config/server-runtime-settings";
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
    region: string | null;
    endpoint: string | null;
    allowedSenders: readonly string[];
    accessKeyId: string | null;
    secretAccessKey: string | null;
    configurationSetName: string | null;
  };
};

function parseProvider(): EmailProviderName {
  return parseServerRuntimeSetting("EMAIL_PROVIDER") as EmailProviderName;
}

function parseCanonicalBaseUrl(): string {
  const raw = parseServerRuntimeSetting("EMAIL_CANONICAL_BASE_URL") as string;
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
  const isProduction =
    parseServerRuntimeSetting("NODE_ENV") === "production";
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

function parseProviderEventInitialPosition(): EmailProviderEventInitialPosition {
  return parseServerRuntimeSetting(
    "EMAIL_PROVIDER_EVENT_INITIAL_POSITION",
  ) as EmailProviderEventInitialPosition;
}

function parsePostboxAllowedSenders(): string[] {
  const raw = parseServerRuntimeSetting("YANDEX_POSTBOX_ALLOWED_SENDERS") as
    | string
    | null;
  if (!raw) return [];
  const senders = raw
    .split(",")
    .map((value) =>
      validateEmailAddress(value.trim(), "YANDEX_POSTBOX_ALLOWED_SENDERS"),
    )
    .filter(Boolean);
  if (senders.length === 0) {
    throw new Error("YANDEX_POSTBOX_ALLOWED_SENDERS must not be empty.");
  }
  return [...new Set(senders.map((value) => value.toLowerCase()))];
}

function parsePostboxEndpoint(): string | null {
  const raw = parseServerRuntimeSetting("YANDEX_POSTBOX_ENDPOINT") as
    | string
    | null;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid YANDEX_POSTBOX_ENDPOINT.");
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
      "YANDEX_POSTBOX_ENDPOINT must be an HTTPS origin without credentials, path, query, or fragment.",
    );
  }
  return url.origin;
}

function parseDataStreamsEndpoint(enabled: boolean): string | null {
  const raw = parseServerRuntimeSetting("YANDEX_DATA_STREAMS_ENDPOINT") as
    | string
    | null;
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

const SIMPLE_DATA_STREAMS_STREAM_NAME_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const DATA_STREAMS_RESOURCE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const DATA_STREAMS_FULL_PATH_MAX_LENGTH = 512;

function parseDataStreamsStreamName(
  enabled: boolean,
  expectedRegion: string,
): string | null {
  const streamName = parseServerRuntimeSetting(
    "YANDEX_DATA_STREAMS_STREAM_NAME",
  ) as string | null;
  if (!streamName) {
    if (enabled) {
      throw new Error(
        "YANDEX_DATA_STREAMS_STREAM_NAME is required when provider-event ingestion is enabled.",
      );
    }
    return null;
  }
  if (SIMPLE_DATA_STREAMS_STREAM_NAME_RE.test(streamName)) {
    return streamName;
  }

  const rejectsPathMeta =
    streamName.includes("?") ||
    streamName.includes("#") ||
    streamName.includes("://") ||
    streamName.includes("\\");
  if (
    !streamName.startsWith("/") ||
    streamName.length > DATA_STREAMS_FULL_PATH_MAX_LENGTH ||
    rejectsPathMeta
  ) {
    throw new Error(
      "Invalid YANDEX_DATA_STREAMS_STREAM_NAME. Expected either a simple 1..128 stream name (letters, digits, underscore, dot, colon, hyphen) or a full Yandex stream path '/<region>/<folder-id>/<database-id>/<stream-name>'.",
    );
  }

  const components = streamName.split("/");
  if (components.length !== 5) {
    throw new Error(
      "Invalid YANDEX_DATA_STREAMS_STREAM_NAME. Full stream path must be exactly '/<region>/<folder-id>/<database-id>/<stream-name>'.",
    );
  }

  const [, region, folderId, databaseId, streamLeaf] = components;
  if (
    !region ||
    !folderId ||
    !databaseId ||
    !streamLeaf ||
    folderId.includes("..") ||
    databaseId.includes("..") ||
    streamLeaf.includes("..")
  ) {
    throw new Error(
      "Invalid YANDEX_DATA_STREAMS_STREAM_NAME. Full stream path contains malformed components.",
    );
  }
  if (region !== expectedRegion) {
    throw new Error(
      "Invalid YANDEX_DATA_STREAMS_STREAM_NAME. Stream path region must match YANDEX_DATA_STREAMS_REGION.",
    );
  }
  if (
    !DATA_STREAMS_RESOURCE_ID_RE.test(folderId) ||
    !DATA_STREAMS_RESOURCE_ID_RE.test(databaseId) ||
    !SIMPLE_DATA_STREAMS_STREAM_NAME_RE.test(streamLeaf)
  ) {
    throw new Error(
      "Invalid YANDEX_DATA_STREAMS_STREAM_NAME. Full stream path components must use safe identifiers, and stream-name must be 1..128 characters: letters, digits, underscore, dot, colon, or hyphen.",
    );
  }

  return streamName;
}

export function getEmailConfig(): EmailConfig {
  const deliveryEnabled = parseServerRuntimeSetting(
    "EMAIL_DELIVERY_ENABLED",
  ) as boolean;
  const providerEventIngestionEnabled = parseServerRuntimeSetting(
    "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
  ) as boolean;
  const provider = parseProvider();
  const yandexRegion = parseServerRuntimeSetting("YANDEX_POSTBOX_REGION") as
    | string
    | null;
  const yandexEndpoint = parsePostboxEndpoint();
  const yandexAllowedSenders = parsePostboxAllowedSenders();
  const yandexAccessKeyId = parseServerRuntimeSetting(
    "YANDEX_POSTBOX_ACCESS_KEY_ID",
  ) as string | null;
  const yandexSecretAccessKey = parseServerRuntimeSetting(
    "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
  ) as string | null;
  const dataStreamsAccessKeyId = parseServerRuntimeSetting(
    "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
  ) as string | null;
  const dataStreamsSecretAccessKey = parseServerRuntimeSetting(
    "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
  ) as string | null;

  if (deliveryEnabled && provider === "disabled") {
    throw new Error("EMAIL_PROVIDER must not be disabled when EMAIL_DELIVERY_ENABLED=true.");
  }
  if (deliveryEnabled && provider === "yandex_postbox") {
    if (
      !yandexRegion ||
      !yandexEndpoint ||
      !yandexAccessKeyId ||
      !yandexSecretAccessKey
    ) {
      throw new Error(
        "Missing required Yandex Postbox runtime configuration for enabled email delivery.",
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

  const processingLeaseSeconds = parseServerRuntimeSetting(
    "EMAIL_PROCESSING_LEASE_SECONDS",
  ) as number;
  const providerRequestTimeoutMs = parseServerRuntimeSetting(
    "EMAIL_PROVIDER_REQUEST_TIMEOUT_MS",
  ) as number;
  const providerRequestSafetyMarginSeconds = parseServerRuntimeSetting(
    "EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS",
  ) as number;
  if (
    providerRequestTimeoutMs >=
    (processingLeaseSeconds - providerRequestSafetyMarginSeconds) * 1000
  ) {
    throw new Error(
      "EMAIL_PROVIDER_REQUEST_TIMEOUT_MS must be shorter than EMAIL_PROCESSING_LEASE_SECONDS minus EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS.",
    );
  }
  const dataStreamsRegion = parseServerRuntimeSetting(
    "YANDEX_DATA_STREAMS_REGION",
  ) as string;
  const from = {
    "no-reply": validateEmailAddress(
      parseServerRuntimeSetting("EMAIL_FROM_NO_REPLY") as string,
      "EMAIL_FROM_NO_REPLY",
    ),
    notifications: validateEmailAddress(
      parseServerRuntimeSetting("EMAIL_FROM_NOTIFICATIONS") as string,
      "EMAIL_FROM_NOTIFICATIONS",
    ),
    invitations: validateEmailAddress(
      parseServerRuntimeSetting("EMAIL_FROM_INVITATIONS") as string,
      "EMAIL_FROM_INVITATIONS",
    ),
  };
  if (
    deliveryEnabled &&
    provider === "yandex_postbox" &&
    Object.values(from).some(
      (sender) => !yandexAllowedSenders.includes(sender.toLowerCase()),
    )
  ) {
    throw new Error(
      "Every EMAIL_FROM_* address must be present in YANDEX_POSTBOX_ALLOWED_SENDERS when Postbox delivery is enabled.",
    );
  }

  return {
    deliveryEnabled,
    localPreviewEnabled: parseServerRuntimeSetting(
      "EMAIL_LOCAL_PREVIEW_ENABLED",
    ) as boolean,
    provider,
    canonicalBaseUrl: parseCanonicalBaseUrl(),
    from,
    replyTo: {
      support: validateEmailAddress(
        parseServerRuntimeSetting("EMAIL_REPLY_TO_SUPPORT") as string,
        "EMAIL_REPLY_TO_SUPPORT",
      ),
      security: validateEmailAddress(
        parseServerRuntimeSetting("EMAIL_REPLY_TO_SECURITY") as string,
        "EMAIL_REPLY_TO_SECURITY",
      ),
      business: validateEmailAddress(
        parseServerRuntimeSetting("EMAIL_REPLY_TO_BUSINESS") as string,
        "EMAIL_REPLY_TO_BUSINESS",
      ),
    },
    operatorName: parseServerRuntimeSetting("EMAIL_OPERATOR_NAME") as string,
    workerBatchSize: parseServerRuntimeSetting("EMAIL_WORKER_BATCH_SIZE") as number,
    maxAttempts: parseServerRuntimeSetting("EMAIL_MAX_ATTEMPTS") as number,
    retryBaseSeconds: parseServerRuntimeSetting("EMAIL_RETRY_BASE_SECONDS") as number,
    retryMaxSeconds: parseServerRuntimeSetting("EMAIL_RETRY_MAX_SECONDS") as number,
    processingLeaseSeconds,
    providerRequestTimeoutMs,
    providerRequestSafetyMarginSeconds,
    providerEventReconciliationWindowSeconds: parseServerRuntimeSetting(
      "EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS",
    ) as number,
    providerEventReconciliationDelaySeconds: parseServerRuntimeSetting(
      "EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS",
    ) as number,
    contentRetentionDays: parseServerRuntimeSetting(
      "EMAIL_CONTENT_RETENTION_DAYS",
    ) as number,
    deliveryAttemptRetentionDays: parseServerRuntimeSetting(
      "EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS",
    ) as number,
    providerIdRetentionDays: parseServerRuntimeSetting(
      "EMAIL_PROVIDER_ID_RETENTION_DAYS",
    ) as number,
    providerEventRetentionDays: parseServerRuntimeSetting(
      "EMAIL_PROVIDER_EVENT_RETENTION_DAYS",
    ) as number,
    bounceComplaintRetentionDays: parseServerRuntimeSetting(
      "EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS",
    ) as number,
    adminTestEnabled: parseServerRuntimeSetting(
      "EMAIL_ADMIN_TEST_ENABLED",
    ) as boolean,
    providerEventIngestion: {
      enabled: providerEventIngestionEnabled,
      endpoint: parseDataStreamsEndpoint(providerEventIngestionEnabled),
      region: dataStreamsRegion,
      streamName: parseDataStreamsStreamName(
        providerEventIngestionEnabled,
        dataStreamsRegion,
      ),
      accessKeyId: dataStreamsAccessKeyId,
      secretAccessKey: dataStreamsSecretAccessKey,
      initialPosition: parseProviderEventInitialPosition(),
      recordLimit: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_RECORD_LIMIT",
      ) as number,
      pollIntervalMs: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS",
      ) as number,
      shardRefreshSeconds: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS",
      ) as number,
      errorBackoffMs: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS",
      ) as number,
      maxPayloadBytes: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES",
      ) as number,
      shutdownTimeoutMs: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS",
      ) as number,
      shardConcurrency: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY",
      ) as number,
      shardSliceMaxPolls: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS",
      ) as number,
      maxConsecutiveFailures: parseServerRuntimeSetting(
        "EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES",
      ) as number,
    },
    yandexPostbox: {
      region: yandexRegion,
      endpoint: yandexEndpoint,
      allowedSenders: yandexAllowedSenders,
      accessKeyId: yandexAccessKeyId,
      secretAccessKey: yandexSecretAccessKey,
      configurationSetName: parseServerRuntimeSetting(
        "YANDEX_POSTBOX_CONFIGURATION_SET",
      ) as string | null,
    },
  };
}
