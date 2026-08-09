export type RuntimeSettingParser =
  | {
      category: "boolean";
      defaultValue?: boolean;
    }
  | {
      category: "integer";
      defaultValue?: number;
      min: number;
      max: number;
    }
  | {
      category: "enum";
      defaultValue?: string;
      allowedValues: readonly string[];
    }
  | {
      category: "string";
      defaultValue?: string;
    }
  | {
      category: "secret";
    };

export type RuntimeSettingClassification =
  | "deployment"
  | "intrinsic"
  | "test_scaffolding";

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
  classification: RuntimeSettingClassification;
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

function deploymentSetting<
  const T extends Omit<ServerRuntimeSetting, "classification">,
>(definition: T): T & { classification: "deployment" } {
  return { ...definition, classification: "deployment" };
}

function intrinsicSetting<
  const T extends Omit<ServerRuntimeSetting, "classification">,
>(definition: T): T & { classification: "intrinsic" } {
  return { ...definition, classification: "intrinsic" };
}

const ENV_PROVIDER_OWNER = ["lib/config/provider-runtime.ts"] as const;
const EMAIL_CONFIG_OWNER = ["lib/email/config.ts"] as const;
const EMAIL_SENSITIVE_OWNER = ["lib/email/sensitive-payload.ts"] as const;
const AUTH_GROUP = "Database / Auth";
const EMAIL_GROUP = "Email foundation";
const PROVIDER_EVENT_GROUP = "Provider-event ingestion";

const stringParser = (): RuntimeSettingParser => ({ category: "string" });
const booleanParser = (): RuntimeSettingParser => ({ category: "boolean" });
const integerParser = (
  min: number,
  max: number,
): RuntimeSettingParser => ({
  category: "integer",
  min,
  max,
});
const secretParser = (): RuntimeSettingParser => ({ category: "secret" });

function diagnostic(
  group: string | null,
  description: string,
  representation: ServerRuntimeSetting["diagnostics"]["representation"] = "value",
) {
  return { group, description, representation };
}

export const SERVER_RUNTIME_SETTINGS = {
  NODE_ENV: intrinsicSetting({
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
    },
    secret: false,
    applicability: "always",
    required: "never",
    diagnostics: diagnostic(null, "Effective Node runtime mode."),
  }),
  VIDEO_PROVIDER: deploymentSetting({
    key: "VIDEO_PROVIDER",
    featureArea: "Video",
    ownerModules: ENV_PROVIDER_OWNER,
    parser: {
      category: "enum",
      allowedValues: ["livekit", "voximplant"],
    },
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(null, "Effective video provider."),
  }),
  TRANSCRIPTION_PROVIDER: deploymentSetting({
    key: "TRANSCRIPTION_PROVIDER",
    featureArea: "Transcription",
    ownerModules: ENV_PROVIDER_OWNER,
    parser: {
      category: "enum",
      allowedValues: ["openai", "yandex_speechkit"],
    },
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(null, "Effective transcription provider."),
  }),
  AI_ANALYSIS_PROVIDER: deploymentSetting({
    key: "AI_ANALYSIS_PROVIDER",
    featureArea: "AI analysis",
    ownerModules: ENV_PROVIDER_OWNER,
    parser: {
      category: "enum",
      allowedValues: ["openai", "yandex"],
    },
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(null, "Effective AI analysis provider."),
  }),
  DATABASE_URL: deploymentSetting({
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
  AUTH_SECRET: deploymentSetting({
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
  ADMIN_EMAILS: deploymentSetting({
    key: "ADMIN_EMAILS",
    featureArea: "Authentication",
    ownerModules: ["lib/auth/admin.ts"],
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(AUTH_GROUP, "Bootstrap admin allowlist.", "configured_list"),
  }),
  TRUSTED_PROXY_ENABLED: deploymentSetting({
    key: "TRUSTED_PROXY_ENABLED",
    featureArea: "Authentication",
    ownerModules: ["lib/auth/trusted-proxy.ts"],
    parser: booleanParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(AUTH_GROUP, "Effective trusted-proxy mode."),
  }),
  CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS: deploymentSetting({
    key: "CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS",
    featureArea: "Authentication",
    ownerModules: ["lib/auth/credential-dispatch-fence.ts"],
    parser: integerParser(50, 30_000),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(AUTH_GROUP, "Credential dispatch fence timeout."),
  }),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: deploymentSetting({
    key: "PASSWORD_RESET_TOKEN_TTL_MINUTES",
    featureArea: "Password reset",
    ownerModules: ["lib/auth/password-reset-config.ts"],
    parser: integerParser(5, 1_440),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Password reset", "Reset token lifetime."),
  }),
  PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: deploymentSetting({
    key: "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
    featureArea: "Password reset",
    ownerModules: ["lib/auth/password-reset-config.ts"],
    parser: integerParser(10, 3_600),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Password reset", "Per-account request cooldown."),
  }),
  PASSWORD_RESET_MAX_REQUESTS_PER_HOUR: deploymentSetting({
    key: "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
    featureArea: "Password reset",
    ownerModules: ["lib/auth/password-reset-config.ts"],
    parser: integerParser(1, 100),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Password reset", "Per-account hourly request limit."),
  }),
  PASSWORD_RESET_RESPONSE_FLOOR_MS: deploymentSetting({
    key: "PASSWORD_RESET_RESPONSE_FLOOR_MS",
    featureArea: "Password reset",
    ownerModules: ["lib/auth/response-timing-floor.ts"],
    parser: integerParser(0, 400),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Password reset", "Public response timing floor."),
  }),
  EMAIL_DELIVERY_ENABLED: deploymentSetting({
    key: "EMAIL_DELIVERY_ENABLED",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: booleanParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Email delivery feature flag."),
  }),
  EMAIL_PROVIDER: deploymentSetting({
    key: "EMAIL_PROVIDER",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: {
      category: "enum",
      allowedValues: ["disabled", "yandex_postbox", "fake"],
    },
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Effective email provider."),
  }),
  EMAIL_CANONICAL_BASE_URL: deploymentSetting({
    key: "EMAIL_CANONICAL_BASE_URL",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Canonical account-security email origin."),
  }),
  EMAIL_LOCAL_PREVIEW_ENABLED: deploymentSetting({
    key: "EMAIL_LOCAL_PREVIEW_ENABLED",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: booleanParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Local email preview feature flag."),
  }),
  EMAIL_ADMIN_TEST_ENABLED: deploymentSetting({
    key: "EMAIL_ADMIN_TEST_ENABLED",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: booleanParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Admin test-email feature flag."),
  }),
  EMAIL_OPERATOR_NAME: deploymentSetting({
    key: "EMAIL_OPERATOR_NAME",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Operational email footer identity."),
  }),
  EMAIL_FROM_NO_REPLY: deploymentSetting({
    key: "EMAIL_FROM_NO_REPLY",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated no-reply sender."),
  }),
  EMAIL_FROM_NOTIFICATIONS: deploymentSetting({
    key: "EMAIL_FROM_NOTIFICATIONS",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated notification sender."),
  }),
  EMAIL_FROM_INVITATIONS: deploymentSetting({
    key: "EMAIL_FROM_INVITATIONS",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated invitation sender."),
  }),
  EMAIL_REPLY_TO_SUPPORT: deploymentSetting({
    key: "EMAIL_REPLY_TO_SUPPORT",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated support reply-to."),
  }),
  EMAIL_REPLY_TO_SECURITY: deploymentSetting({
    key: "EMAIL_REPLY_TO_SECURITY",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated security reply-to."),
  }),
  EMAIL_REPLY_TO_BUSINESS: deploymentSetting({
    key: "EMAIL_REPLY_TO_BUSINESS",
    featureArea: "Email",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Validated business reply-to."),
  }),
  EMAIL_SENSITIVE_PAYLOAD_KEY: deploymentSetting({
    key: "EMAIL_SENSITIVE_PAYLOAD_KEY",
    featureArea: "Email",
    ownerModules: EMAIL_SENSITIVE_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(EMAIL_GROUP, "Password-reset payload AEAD key.", "presence"),
  }),
  YANDEX_POSTBOX_REGION: deploymentSetting({
    key: "YANDEX_POSTBOX_REGION",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "postbox_delivery",
    required: "postbox_delivery",
    diagnostics: diagnostic(EMAIL_GROUP, "Postbox API signing region."),
  }),
  YANDEX_POSTBOX_ENDPOINT: deploymentSetting({
    key: "YANDEX_POSTBOX_ENDPOINT",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "postbox_delivery",
    required: "postbox_delivery",
    diagnostics: diagnostic(EMAIL_GROUP, "Postbox SES-compatible endpoint."),
  }),
  YANDEX_POSTBOX_ALLOWED_SENDERS: deploymentSetting({
    key: "YANDEX_POSTBOX_ALLOWED_SENDERS",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "postbox_delivery",
    required: "postbox_delivery",
    diagnostics: diagnostic(
      EMAIL_GROUP,
      "Comma-separated Postbox-verified sender allowlist.",
    ),
  }),
  YANDEX_POSTBOX_CONFIGURATION_SET: deploymentSetting({
    key: "YANDEX_POSTBOX_CONFIGURATION_SET",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "postbox_delivery",
    required: "never",
    diagnostics: diagnostic(EMAIL_GROUP, "Optional Postbox configuration set."),
  }),
  YANDEX_POSTBOX_ACCESS_KEY_ID: deploymentSetting({
    key: "YANDEX_POSTBOX_ACCESS_KEY_ID",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "postbox_delivery",
    required: "postbox_delivery",
    diagnostics: diagnostic(EMAIL_GROUP, "Postbox access key state.", "presence"),
  }),
  YANDEX_POSTBOX_SECRET_ACCESS_KEY: deploymentSetting({
    key: "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
    featureArea: "Postbox",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "postbox_delivery",
    required: "postbox_delivery",
    diagnostics: diagnostic(EMAIL_GROUP, "Postbox secret key state.", "presence"),
  }),
  EMAIL_WORKER_BATCH_SIZE: deploymentSetting({
    key: "EMAIL_WORKER_BATCH_SIZE",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 500),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email worker", "Delivery worker batch size."),
  }),
  EMAIL_MAX_ATTEMPTS: deploymentSetting({
    key: "EMAIL_MAX_ATTEMPTS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 20),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email worker", "Maximum delivery attempts."),
  }),
  EMAIL_RETRY_BASE_SECONDS: deploymentSetting({
    key: "EMAIL_RETRY_BASE_SECONDS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(10, 3_600),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email worker", "Retry base delay."),
  }),
  EMAIL_RETRY_MAX_SECONDS: deploymentSetting({
    key: "EMAIL_RETRY_MAX_SECONDS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(60, 86_400),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email worker", "Retry maximum delay."),
  }),
  EMAIL_PROCESSING_LEASE_SECONDS: deploymentSetting({
    key: "EMAIL_PROCESSING_LEASE_SECONDS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(60, 7_200),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email worker", "Worker processing lease."),
  }),
  EMAIL_PROVIDER_REQUEST_TIMEOUT_MS: deploymentSetting({
    key: "EMAIL_PROVIDER_REQUEST_TIMEOUT_MS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1_000, 600_000),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email worker", "Provider request timeout."),
  }),
  EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS: deploymentSetting({
    key: "EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS",
    featureArea: "Email worker",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(5, 600),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email worker", "Provider timeout safety margin."),
  }),
  EMAIL_CONTENT_RETENTION_DAYS: deploymentSetting({
    key: "EMAIL_CONTENT_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 3_650),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email retention", "Message content retention."),
  }),
  EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS: deploymentSetting({
    key: "EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 3_650),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email retention", "Delivery attempt retention."),
  }),
  EMAIL_PROVIDER_ID_RETENTION_DAYS: deploymentSetting({
    key: "EMAIL_PROVIDER_ID_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 3_650),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email retention", "Provider id retention."),
  }),
  EMAIL_PROVIDER_EVENT_RETENTION_DAYS: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 3_650),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email retention", "Provider event retention."),
  }),
  EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS: deploymentSetting({
    key: "EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS",
    featureArea: "Email retention",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 3_650),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Email retention", "Bounce/complaint retention."),
  }),
  EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(60, 604_800),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Provider-event reconciliation", "Reconciliation window."),
  }),
  EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(5, 3_600),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic("Provider-event reconciliation", "Reconciliation retry delay."),
  }),
  EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: booleanParser(),
    secret: false,
    applicability: "always",
    required: "always",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Provider-event ingestion feature flag."),
  }),
  YANDEX_DATA_STREAMS_ENDPOINT: deploymentSetting({
    key: "YANDEX_DATA_STREAMS_ENDPOINT",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams HTTPS endpoint."),
  }),
  YANDEX_DATA_STREAMS_STREAM_NAME: deploymentSetting({
    key: "YANDEX_DATA_STREAMS_STREAM_NAME",
    featureArea: "Provider events",
    ownerModules: [
      "lib/email/config.ts",
      "lib/email/provider-event-consumer.ts",
    ],
    parser: stringParser(),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams stream name."),
  }),
  YANDEX_DATA_STREAMS_REGION: deploymentSetting({
    key: "YANDEX_DATA_STREAMS_REGION",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: stringParser(),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams signing region."),
  }),
  YANDEX_DATA_STREAMS_ACCESS_KEY_ID: deploymentSetting({
    key: "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams access key state.", "presence"),
  }),
  YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: deploymentSetting({
    key: "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: secretParser(),
    secret: true,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Data Streams secret key state.", "presence"),
  }),
  EMAIL_PROVIDER_EVENT_INITIAL_POSITION: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_INITIAL_POSITION",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: {
      category: "enum",
      allowedValues: ["LATEST", "TRIM_HORIZON"],
    },
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Initial stream position."),
  }),
  EMAIL_PROVIDER_EVENT_RECORD_LIMIT: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_RECORD_LIMIT",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 1_000),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "GetRecords batch limit."),
  }),
  EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(200, 5_000),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Per-shard polling interval."),
  }),
  EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(10, 3_600),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Shard refresh interval."),
  }),
  EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(100, 60_000),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Transient error backoff."),
  }),
  EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1_024, 1_048_576),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Maximum provider-event payload."),
  }),
  EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1_000, 20_000),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Consumer shutdown timeout."),
  }),
  EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 16),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Shard slice concurrency."),
  }),
  EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 50),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
    diagnostics: diagnostic(PROVIDER_EVENT_GROUP, "Polls per fair shard slice."),
  }),
  EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES: deploymentSetting({
    key: "EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES",
    featureArea: "Provider events",
    ownerModules: EMAIL_CONFIG_OWNER,
    parser: integerParser(1, 50),
    secret: false,
    applicability: "provider_event_ingestion",
    required: "provider_event_ingestion",
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

function rawBooleanConditionValue(
  key: "EMAIL_DELIVERY_ENABLED" | "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): boolean {
  const raw = readServerRuntimeSettingRaw(key, env)?.toLowerCase();
  return raw !== undefined && ["true", "1", "yes", "on"].includes(raw);
}

export function runtimeSettingConditionMatches(
  condition: RuntimeSettingCondition,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  switch (condition) {
    case "always":
      return true;
    case "never":
      return false;
    case "postbox_delivery":
      return (
        rawBooleanConditionValue("EMAIL_DELIVERY_ENABLED", env) &&
        readServerRuntimeSettingRaw("EMAIL_PROVIDER", env)?.toLowerCase() ===
          "yandex_postbox"
      );
    case "provider_event_ingestion":
      return rawBooleanConditionValue(
        "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
        env,
      );
  }
}

export function parseServerRuntimeSetting(
  key: ServerRuntimeSettingKey,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | number | boolean | null {
  const definition = SERVER_RUNTIME_SETTINGS[key];
  const raw = readServerRuntimeSettingRaw(key, env);
  const parser = definition.parser;

  if (!raw) {
    if ("defaultValue" in parser && parser.defaultValue !== undefined) {
      return parser.defaultValue;
    }
    if (runtimeSettingConditionMatches(definition.required, env)) {
      throw new Error(`Missing required runtime setting: ${key}.`);
    }
    return null;
  }

  if (parser.category === "secret" || parser.category === "string") {
    return raw;
  }
  if (parser.category === "boolean") {
    const normalized = raw.toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    throw new Error(`Invalid boolean runtime setting: ${key}.`);
  }
  if (parser.category === "integer") {
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

  const normalized =
    key === "EMAIL_PROVIDER_EVENT_INITIAL_POSITION"
      ? raw.toUpperCase()
      : raw.toLowerCase();
  const allowedValues: readonly string[] = parser.allowedValues;
  if (allowedValues.includes(normalized)) return normalized;
  throw new Error(`Invalid enum runtime setting: ${key}.`);
}
