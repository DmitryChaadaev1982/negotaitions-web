export type RuntimeSettingParser =
  | {
      category: "boolean";
      defaultValue: boolean;
    }
  | {
      category: "integer";
      defaultValue: number;
      min: number;
      max: number;
    }
  | {
      category: "enum";
      defaultValue: string;
      allowedValues: readonly string[];
      invalidUsesDefault?: boolean;
    }
  | {
      category: "string";
      defaultValue: string | null;
    }
  | {
      category: "secret";
      defaultValue: null;
    };

export type RuntimeSettingCondition =
  | "always"
  | "never"
  | "postbox_delivery"
  | "provider_event_ingestion";

export type ServerRuntimeSetting = {
  key: string;
  featureArea: string;
  ownerModules: readonly string[];
  parser: RuntimeSettingParser;
  secret: boolean;
  applicability: RuntimeSettingCondition;
  required: RuntimeSettingCondition;
  diagnostics: {
    group: string | null;
    /** Optional operator label; the registry key is the default label. */
    label?: string;
    description: string;
    representation: "value" | "presence" | "configured_list";
  };
};

function setting<const T extends ServerRuntimeSetting>(definition: T): T {
  return definition;
}

const ENV_PROVIDER_OWNER = ["lib/config/provider-runtime.ts"] as const;
const EMAIL_CONFIG_OWNER = ["lib/email/config.ts"] as const;
const EMAIL_SENSITIVE_OWNER = ["lib/email/sensitive-payload.ts"] as const;
const AUTH_GROUP = "Database / Auth";
const EMAIL_GROUP = "Email foundation";
const PROVIDER_EVENT_GROUP = "Provider-event ingestion";

const stringParser = (defaultValue: string | null): RuntimeSettingParser => ({
  category: "string",
  defaultValue,
});
const booleanParser = (defaultValue = false): RuntimeSettingParser => ({
  category: "boolean",
  defaultValue,
});
const integerParser = (
  defaultValue: number,
  min: number,
  max: number,
): RuntimeSettingParser => ({
  category: "integer",
  defaultValue,
  min,
  max,
});
const secretParser = (): RuntimeSettingParser => ({
  category: "secret",
  defaultValue: null,
});

function diagnostic(
  group: string | null,
  description: string,
  representation: ServerRuntimeSetting["diagnostics"]["representation"] = "value",
) {
  return { group, description, representation };
}

export const SERVER_RUNTIME_SETTINGS = {
  NODE_ENV: setting({
    key: "NODE_ENV",
    featureArea: "Runtime",
    ownerModules: [
      "lib/prisma.ts",
      "lib/email/config.ts",
      "lib/auth/session.ts",
      "lib/auth/client-ip.ts",
      "lib/auth/credential-concurrency.ts",
      "lib/auth/credential-dispatch-fence.ts",
      "next.config.ts",
    ],
    parser: {
      category: "enum",
      defaultValue: "development",
      allowedValues: ["development", "test", "production"],
      invalidUsesDefault: true,
    },
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(null, "Effective Node runtime mode."),
  }),
  VIDEO_PROVIDER: setting({
    key: "VIDEO_PROVIDER",
    featureArea: "Video",
    ownerModules: ENV_PROVIDER_OWNER,
    parser: {
      category: "enum",
      defaultValue: "livekit",
      allowedValues: ["livekit", "voximplant"],
      invalidUsesDefault: true,
    },
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(null, "Effective video provider."),
  }),
  TRANSCRIPTION_PROVIDER: setting({
    key: "TRANSCRIPTION_PROVIDER",
    featureArea: "Transcription",
    ownerModules: ENV_PROVIDER_OWNER,
    parser: {
      category: "enum",
      defaultValue: "openai",
      allowedValues: ["openai", "yandex_speechkit"],
      invalidUsesDefault: true,
    },
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(null, "Effective transcription provider."),
  }),
  AI_ANALYSIS_PROVIDER: setting({
    key: "AI_ANALYSIS_PROVIDER",
    featureArea: "AI analysis",
    ownerModules: ENV_PROVIDER_OWNER,
    parser: {
      category: "enum",
      defaultValue: "openai",
      allowedValues: ["openai", "yandex"],
      invalidUsesDefault: true,
    },
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(null, "Effective AI analysis provider."),
  }),
  DATABASE_URL: setting({
    key: "DATABASE_URL",
    featureArea: "Database",
    ownerModules: [
      "lib/prisma.ts",
      "lib/auth/credential-dispatch-fence.ts",
      "lib/email/provider-event-consumer.ts",
    ],
    parser: secretParser(),
    secret: true,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(AUTH_GROUP, "Required durable database connection.", "presence"),
  }),
  AUTH_SECRET: setting({
    key: "AUTH_SECRET",
    featureArea: "Authentication",
    ownerModules: [
      "lib/auth/client-ip.ts",
      "lib/auth/password-reset-rate-limit.ts",
    ],
    parser: secretParser(),
    secret: true,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(AUTH_GROUP, "HMAC key for trusted client identity.", "presence"),
  }),
  ADMIN_EMAILS: setting({
    key: "ADMIN_EMAILS",
    featureArea: "Authentication",
    ownerModules: ["lib/auth/admin.ts"],
    parser: stringParser(""),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(AUTH_GROUP, "Bootstrap admin allowlist.", "configured_list"),
  }),
  TRUSTED_PROXY_ENABLED: setting({
    key: "TRUSTED_PROXY_ENABLED",
    featureArea: "Authentication",
    ownerModules: ["lib/auth/trusted-proxy.ts"],
    parser: booleanParser(false),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(AUTH_GROUP, "Effective trusted-proxy mode."),
  }),
  CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS: setting({
    key: "CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS",
    featureArea: "Authentication",
    ownerModules: ["lib/auth/credential-dispatch-fence.ts"],
    parser: integerParser(5_000, 50, 30_000),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(AUTH_GROUP, "Credential dispatch fence timeout."),
  }),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: setting({
    key: "PASSWORD_RESET_TOKEN_TTL_MINUTES",
    featureArea: "Password reset",
    ownerModules: ["lib/auth/password-reset-config.ts"],
    parser: integerParser(30, 5, 1_440),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Password reset", "Reset token lifetime."),
  }),
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: setting({
    key: "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
    featureArea: "Password reset",
    ownerModules: ["lib/auth/password-reset-config.ts"],
    parser: integerParser(60, 10, 3_600),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Password reset", "Per-account request cooldown."),
  }),
  PASSWORD_RESET_MAX_REQUESTS_PER_HOUR: setting({
    key: "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
    featureArea: "Password reset",
    ownerModules: ["lib/auth/password-reset-config.ts"],
    parser: integerParser(5, 1, 100),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Password reset", "Per-account hourly request limit."),
  }),
  PASSWORD_RESET_RESPONSE_FLOOR_MS: setting({
    key: "PASSWORD_RESET_RESPONSE_FLOOR_MS",
    featureArea: "Password reset",
    ownerModules: ["lib/auth/response-timing-floor.ts"],
    parser: integerParser(180, 0, 400),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Password reset", "Public response timing floor."),
  }),
  EMAIL_DELIVERY_ENABLED: setting({
    key: "EMAIL_DELIVERY_ENABLED",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: booleanParser(false),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Email delivery feature flag."),
  }),
  EMAIL_PROVIDER: setting({
    key: "EMAIL_PROVIDER",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: {
      category: "enum",
      defaultValue: "disabled",
      allowedValues: ["disabled", "yandex_postbox", "fake"],
    },
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Effective email provider."),
  }),
  EMAIL_CANONICAL_BASE_URL: setting({
    key: "EMAIL_CANONICAL_BASE_URL",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("https://negotaitions.ru"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Canonical account-security email origin."),
  }),
  EMAIL_LOCAL_PREVIEW_ENABLED: setting({
    key: "EMAIL_LOCAL_PREVIEW_ENABLED",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: booleanParser(false),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Local email preview feature flag."),
  }),
  EMAIL_ADMIN_TEST_ENABLED: setting({
    key: "EMAIL_ADMIN_TEST_ENABLED",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: booleanParser(false),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Admin test-email feature flag."),
  }),
  EMAIL_OPERATOR_NAME: setting({
    key: "EMAIL_OPERATOR_NAME",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("Чаадаев Дмитрий Владимирович"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Operational email footer identity."),
  }),
  EMAIL_FROM_NO_REPLY: setting({
    key: "EMAIL_FROM_NO_REPLY",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("no-reply@negotaitions.ru"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated no-reply sender."),
  }),
  EMAIL_FROM_NOTIFICATIONS: setting({
    key: "EMAIL_FROM_NOTIFICATIONS",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("notifications@negotaitions.ru"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated notification sender."),
  }),
  EMAIL_FROM_INVITATIONS: setting({
    key: "EMAIL_FROM_INVITATIONS",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("invitations@negotaitions.ru"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated invitation sender."),
  }),
  EMAIL_REPLY_TO_SUPPORT: setting({
    key: "EMAIL_REPLY_TO_SUPPORT",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("support@negotaitions.ru"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated support reply-to."),
  }),
  EMAIL_REPLY_TO_SECURITY: setting({
    key: "EMAIL_REPLY_TO_SECURITY",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("security@negotaitions.ru"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated security reply-to."),
  }),
  EMAIL_REPLY_TO_BUSINESS: setting({
    key: "EMAIL_REPLY_TO_BUSINESS",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("business@negotaitions.ru"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated business reply-to."),
  }),
  EMAIL_SENSITIVE_PAYLOAD_KEY: setting({
    key: "EMAIL_SENSITIVE_PAYLOAD_KEY",
    featureArea: "Email",
    ownerModules: EMAIL_SENSITIVE_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Password-reset payload AEAD key.", "presence"),
  }),
  YANDEX_POSTBOX_REGION: setting({
    key: "YANDEX_POSTBOX_REGION",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("ru-central1"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Postbox API signing region."),
  }),
  YANDEX_POSTBOX_ENDPOINT: setting({
    key: "YANDEX_POSTBOX_ENDPOINT",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("https://postbox.cloud.yandex.net"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Postbox SES-compatible endpoint."),
  }),
  YANDEX_POSTBOX_CONFIGURATION_SET: setting({
    key: "YANDEX_POSTBOX_CONFIGURATION_SET",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(null),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Optional Postbox configuration set."),
  }),
  YANDEX_POSTBOX_ACCESS_KEY_ID: setting({
    key: "YANDEX_POSTBOX_ACCESS_KEY_ID",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "postbox_delivery",
    required: "postbox_delivery",
    diagnostics: diagnostic(EMAIL_GROUP, "Postbox access key state.", "presence"),
  }),
  YANDEX_POSTBOX_SECRET_ACCESS_KEY: setting({
    key: "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "postbox_delivery",
    required: "postbox_delivery",
    diagnostics: diagnostic(EMAIL_GROUP, "Postbox secret key state.", "presence"),
  }),
  EMAIL_WORKER_BATCH_SIZE: setting({
    key: "EMAIL_WORKER_BATCH_SIZE",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(25, 1, 500),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email worker", "Delivery worker batch size."),
  }),
  EMAIL_MAX_ATTEMPTS: setting({
    key: "EMAIL_MAX_ATTEMPTS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(5, 1, 20),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email worker", "Maximum delivery attempts."),
  }),
  EMAIL_RETRY_BASE_SECONDS: setting({
    key: "EMAIL_RETRY_BASE_SECONDS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(60, 10, 3_600),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email worker", "Retry base delay."),
  }),
  EMAIL_RETRY_MAX_SECONDS: setting({
    key: "EMAIL_RETRY_MAX_SECONDS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(43_200, 60, 86_400),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email worker", "Retry maximum delay."),
  }),
  EMAIL_PROCESSING_LEASE_SECONDS: setting({
    key: "EMAIL_PROCESSING_LEASE_SECONDS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(600, 60, 7_200),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email worker", "Worker processing lease."),
  }),
  EMAIL_PROVIDER_REQUEST_TIMEOUT_MS: setting({
    key: "EMAIL_PROVIDER_REQUEST_TIMEOUT_MS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(30_000, 1_000, 600_000),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email worker", "Provider request timeout."),
  }),
  EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS: setting({
    key: "EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(30, 5, 600),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email worker", "Provider timeout safety margin."),
  }),
  EMAIL_CONTENT_RETENTION_DAYS: setting({
    key: "EMAIL_CONTENT_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(90, 1, 3_650),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email retention", "Message content retention."),
  }),
  EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS: setting({
    key: "EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(365, 1, 3_650),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email retention", "Delivery attempt retention."),
  }),
  EMAIL_PROVIDER_ID_RETENTION_DAYS: setting({
    key: "EMAIL_PROVIDER_ID_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(365, 1, 3_650),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email retention", "Provider id retention."),
  }),
  EMAIL_PROVIDER_EVENT_RETENTION_DAYS: setting({
    key: "EMAIL_PROVIDER_EVENT_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(730, 1, 3_650),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email retention", "Provider event retention."),
  }),
  EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS: setting({
    key: "EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(730, 1, 3_650),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Email retention", "Bounce/complaint retention."),
  }),
  EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS: setting({
    key: "EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(86_400, 60, 604_800),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Provider-event reconciliation", "Reconciliation window."),
  }),
  EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS: setting({
    key: "EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(60, 5, 3_600),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic("Provider-event reconciliation", "Reconciliation retry delay."),
  }),
  EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: setting({
    key: "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: booleanParser(false),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Provider-event ingestion feature flag."),
  }),
  YANDEX_DATA_STREAMS_ENDPOINT: setting({
    key: "YANDEX_DATA_STREAMS_ENDPOINT",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(null),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams HTTPS endpoint."),
  }),
  YANDEX_DATA_STREAMS_STREAM_NAME: setting({
    key: "YANDEX_DATA_STREAMS_STREAM_NAME",
    featureArea: "Provider events",
    ownerModules: [
      "lib/email/config.ts",
      "lib/email/provider-event-consumer.ts",
    ],
    parser: stringParser(null),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams stream name."),
  }),
  YANDEX_DATA_STREAMS_REGION: setting({
    key: "YANDEX_DATA_STREAMS_REGION",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser("ru-central1"),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams signing region."),
  }),
  YANDEX_DATA_STREAMS_ACCESS_KEY_ID: setting({
    key: "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams access key state.", "presence"),
  }),
  YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: setting({
    key: "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams secret key state.", "presence"),
  }),
  EMAIL_PROVIDER_EVENT_INITIAL_POSITION: setting({
    key: "EMAIL_PROVIDER_EVENT_INITIAL_POSITION",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: {
      category: "enum",
      defaultValue: "LATEST",
      allowedValues: ["LATEST", "TRIM_HORIZON"],
    },
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Initial stream position."),
  }),
  EMAIL_PROVIDER_EVENT_RECORD_LIMIT: setting({
    key: "EMAIL_PROVIDER_EVENT_RECORD_LIMIT",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(100, 1, 1_000),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "GetRecords batch limit."),
  }),
  EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS: setting({
    key: "EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1_000, 200, 5_000),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Per-shard polling interval."),
  }),
  EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS: setting({
    key: "EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(60, 10, 3_600),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Shard refresh interval."),
  }),
  EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS: setting({
    key: "EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(2_000, 100, 60_000),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Transient error backoff."),
  }),
  EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES: setting({
    key: "EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(262_144, 1_024, 1_048_576),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Maximum provider-event payload."),
  }),
  EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS: setting({
    key: "EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(15_000, 1_000, 20_000),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Consumer shutdown timeout."),
  }),
  EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY: setting({
    key: "EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(2, 1, 16),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Shard slice concurrency."),
  }),
  EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS: setting({
    key: "EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(4, 1, 50),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Polls per fair shard slice."),
  }),
  EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES: setting({
    key: "EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(5, 1, 50),
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Consecutive failure limit."),
  }),
} as const satisfies Record<string, ServerRuntimeSetting>;

export type ServerRuntimeSettingKey = keyof typeof SERVER_RUNTIME_SETTINGS;

export const SERVER_RUNTIME_SETTING_KEYS = Object.freeze(
  Object.keys(SERVER_RUNTIME_SETTINGS) as ServerRuntimeSettingKey[],
);

export function isServerRuntimeSettingKey(
  value: string,
): value is ServerRuntimeSettingKey {
  return Object.prototype.hasOwnProperty.call(SERVER_RUNTIME_SETTINGS, value);
}

export function readServerRuntimeSettingRaw(
  key: ServerRuntimeSettingKey,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | null {
  const raw = env[key]?.trim();
  return raw ? raw : null;
}

export function parseServerRuntimeSetting(
  key: ServerRuntimeSettingKey,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | number | boolean | null {
  const definition = SERVER_RUNTIME_SETTINGS[key];
  const raw = readServerRuntimeSettingRaw(key, env);
  const parser = definition.parser;

  if (parser.category === "secret" || parser.category === "string") {
    return raw ?? parser.defaultValue;
  }
  if (parser.category === "boolean") {
    if (!raw) return parser.defaultValue;
    const normalized = raw.toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    throw new Error(`Invalid boolean runtime setting: ${key}.`);
  }
  if (parser.category === "integer") {
    if (!raw) return parser.defaultValue;
    const parsed = Number(raw);
    if (
      !Number.isInteger(parsed) ||
      parsed < parser.min ||
      parsed > parser.max
    ) {
      throw new Error(`Invalid bounded integer runtime setting: ${key}.`);
    }
    return parsed;
  }

  if (!raw) return parser.defaultValue;
  const normalized =
    key === "EMAIL_PROVIDER_EVENT_INITIAL_POSITION"
      ? raw.toUpperCase()
      : raw.toLowerCase();
  const allowedValues: readonly string[] = parser.allowedValues;
  if (allowedValues.includes(normalized)) return normalized;
  if (
    "invalidUsesDefault" in parser &&
    parser.invalidUsesDefault
  ) {
    return parser.defaultValue;
  }
  throw new Error(`Invalid enum runtime setting: ${key}.`);
}
