import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAdminEnvDescriptors,
  getAdminEnvironmentDisplayGroups,
  type AdminEnvDescriptor,
} from "@/lib/services/admin-env-display";

function withEnv<T>(patch: Record<string, string | undefined>, operation: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function rows() {
  return getAdminEnvironmentDisplayGroups().flatMap((group) => group.items);
}

/**
 * The agreed in-scope diagnostics surface. This list and the descriptor
 * registry are asserted equal in both directions, so adding a runtime setting
 * without a descriptor, or leaving a descriptor for a key nothing consumes,
 * fails the suite instead of silently drifting.
 */
const EXPECTED_DIAGNOSTIC_KEYS = [
  // Provider selection
  "VIDEO_PROVIDER",
  "TRANSCRIPTION_PROVIDER",
  "AI_ANALYSIS_PROVIDER",
  // Database and authentication
  "DATABASE_URL",
  "AUTH_SECRET",
  "ADMIN_EMAILS",
  "TRUSTED_PROXY_ENABLED",
  "CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS",
  // Password reset
  "PASSWORD_RESET_TOKEN_TTL_MINUTES",
  "PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS",
  "PASSWORD_RESET_MAX_REQUESTS_PER_HOUR",
  "PASSWORD_RESET_RESPONSE_FLOOR_MS",
  // Email foundation
  "EMAIL_DELIVERY_ENABLED",
  "EMAIL_PROVIDER",
  "EMAIL_CANONICAL_BASE_URL",
  "EMAIL_LOCAL_PREVIEW_ENABLED",
  "EMAIL_ADMIN_TEST_ENABLED",
  "EMAIL_OPERATOR_NAME",
  "EMAIL_FROM_NO_REPLY",
  "EMAIL_FROM_NOTIFICATIONS",
  "EMAIL_FROM_INVITATIONS",
  "EMAIL_REPLY_TO_SUPPORT",
  "EMAIL_REPLY_TO_SECURITY",
  "EMAIL_REPLY_TO_BUSINESS",
  "EMAIL_SENSITIVE_PAYLOAD_KEY",
  "YANDEX_POSTBOX_REGION",
  "YANDEX_POSTBOX_ENDPOINT",
  "YANDEX_POSTBOX_CONFIGURATION_SET",
  "YANDEX_POSTBOX_ACCESS_KEY_ID",
  "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
  // Email worker
  "EMAIL_WORKER_BATCH_SIZE",
  "EMAIL_MAX_ATTEMPTS",
  "EMAIL_RETRY_BASE_SECONDS",
  "EMAIL_RETRY_MAX_SECONDS",
  "EMAIL_PROCESSING_LEASE_SECONDS",
  "EMAIL_PROVIDER_REQUEST_TIMEOUT_MS",
  "EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS",
  // Retention
  "EMAIL_CONTENT_RETENTION_DAYS",
  "EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS",
  "EMAIL_PROVIDER_ID_RETENTION_DAYS",
  "EMAIL_PROVIDER_EVENT_RETENTION_DAYS",
  "EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS",
  // Provider-event reconciliation
  "EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS",
  "EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS",
  // Provider-event ingestion
  "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
  "YANDEX_DATA_STREAMS_ENDPOINT",
  "YANDEX_DATA_STREAMS_STREAM_NAME",
  "YANDEX_DATA_STREAMS_REGION",
  "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
  "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
  "EMAIL_PROVIDER_EVENT_INITIAL_POSITION",
  "EMAIL_PROVIDER_EVENT_RECORD_LIMIT",
  "EMAIL_PROVIDER_EVENT_POLL_INTERVAL_MS",
  "EMAIL_PROVIDER_EVENT_SHARD_REFRESH_SECONDS",
  "EMAIL_PROVIDER_EVENT_ERROR_BACKOFF_MS",
  "EMAIL_PROVIDER_EVENT_MAX_PAYLOAD_BYTES",
  "EMAIL_PROVIDER_EVENT_SHUTDOWN_TIMEOUT_MS",
  "EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY",
  "EMAIL_PROVIDER_EVENT_SHARD_SLICE_MAX_POLLS",
  "EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES",
] as const;

/** Every key classified as a secret. Its value must always serialize as null. */
const EXPECTED_SECRET_KEYS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "EMAIL_SENSITIVE_PAYLOAD_KEY",
  "YANDEX_POSTBOX_ACCESS_KEY_ID",
  "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
  "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
  "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
] as const;

function descriptors(): AdminEnvDescriptor[] {
  return buildAdminEnvDescriptors();
}

test("descriptor keys and the in-scope runtime key set are equal in both directions", () => {
  const actual = new Set(descriptors().map((descriptor) => descriptor.key));
  const expected = new Set<string>(EXPECTED_DIAGNOSTIC_KEYS);

  const missingDescriptors = [...expected].filter((key) => !actual.has(key));
  const unexpectedDescriptors = [...actual].filter((key) => !expected.has(key));
  assert.deepEqual(missingDescriptors, [], "in-scope keys without a descriptor");
  assert.deepEqual(
    unexpectedDescriptors,
    [],
    "descriptors for out-of-scope or unconsumed keys",
  );
  assert.equal(actual.size, EXPECTED_DIAGNOSTIC_KEYS.length);
});

test("no descriptor is duplicated and every descriptor reaches a display group", () => {
  const keys = descriptors().map((descriptor) => descriptor.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate descriptor key");
  assert.deepEqual(
    rows().map((item) => item.key).sort(),
    [...keys].sort(),
  );
});

test("every key the email runtime parser reads has a descriptor", () => {
  // Mechanical reverse check against the real parser: any env key added to
  // lib/email/config.ts without a descriptor fails here.
  const source = readFileSync("lib/email/config.ts", "utf8");
  const consumed = new Set(
    [
      ...source.matchAll(
        /\b((?:EMAIL|YANDEX)_[A-Z0-9_]+)\b/g,
      ),
    ].map((match) => match[1]),
  );
  assert.ok(consumed.size > 40, "parser scan found suspiciously few keys");

  const declared = new Set(descriptors().map((descriptor) => descriptor.key));
  const undocumented = [...consumed].filter((key) => !declared.has(key));
  assert.deepEqual(undocumented, [], "runtime keys missing from diagnostics");
});

test("every descriptor key appears in the source file it names as its consumer", () => {
  for (const descriptor of descriptors()) {
    const source = readFileSync(descriptor.consumer, "utf8");
    assert.ok(
      source.includes(descriptor.key),
      `${descriptor.key} is not read by its declared consumer ${descriptor.consumer}`,
    );
  }
});

test("secret classification is exact and secret values are always null", () => {
  const secretKeys = descriptors()
    .filter((descriptor) => descriptor.isSecret)
    .map((descriptor) => descriptor.key)
    .sort();
  assert.deepEqual(secretKeys, [...EXPECTED_SECRET_KEYS].sort());

  // A new secret added without secret classification changes this set and fails.
  for (const key of EXPECTED_SECRET_KEYS) {
    const descriptor = descriptors().find((item) => item.key === key);
    assert.equal(descriptor?.isSecret, true, `${key} lost its secret classification`);
  }
});

test("secrets serialize as null with no prefix, suffix, length, or fingerprint", () => {
  const marker = "unique-secret-material-9f2c4b";
  const groups = withEnv(
    {
      DATABASE_URL: `postgresql://user:${marker}@localhost:5432/db`,
      AUTH_SECRET: marker,
      EMAIL_SENSITIVE_PAYLOAD_KEY: Buffer.alloc(32, 7).toString("base64"),
      YANDEX_POSTBOX_ACCESS_KEY_ID: `akid-${marker}`,
      YANDEX_POSTBOX_SECRET_ACCESS_KEY: `sk-${marker}`,
      YANDEX_DATA_STREAMS_ACCESS_KEY_ID: `ds-akid-${marker}`,
      YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: `ds-sk-${marker}`,
    },
    getAdminEnvironmentDisplayGroups,
  );
  const items = groups.flatMap((group) => group.items);
  const serialized = JSON.stringify(groups);

  for (const key of EXPECTED_SECRET_KEYS) {
    const item = items.find((row) => row.key === key);
    assert.ok(item, `${key} is missing from diagnostics`);
    assert.equal(item.isSecret, true);
    assert.equal(item.value, null, `${key} serialized a value`);
  }
  assert.doesNotMatch(serialized, new RegExp(marker));
  // No masked, truncated, hashed, or length-bearing representation either.
  assert.doesNotMatch(serialized, /\*{2,}/);
  assert.doesNotMatch(serialized, /"(?:masked|fingerprint|length|prefix|suffix)"/);
});

test("the reversible masking helper is gone", async () => {
  const exported: Record<string, unknown> = await import(
    "@/lib/services/admin-env-display"
  );
  assert.equal("maskSecretValue" in exported, false);
  const source = readFileSync("lib/services/admin-env-display.ts", "utf8");
  assert.equal(source.includes("maskSecretValue"), false);
});

test("admin diagnostics report effective defaults instead of missing raw env", () => {
  const items = withEnv(
    {
      PASSWORD_RESET_TOKEN_TTL_MINUTES: undefined,
      PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: undefined,
      PASSWORD_RESET_MAX_REQUESTS_PER_HOUR: undefined,
      YANDEX_POSTBOX_REGION: undefined,
      YANDEX_POSTBOX_ENDPOINT: undefined,
      EMAIL_PROVIDER: "disabled",
      EMAIL_DELIVERY_ENABLED: "false",
    },
    rows,
  );

  const ttl = items.find((item) => item.key === "PASSWORD_RESET_TOKEN_TTL_MINUTES");
  assert.equal(ttl?.status, "using_effective_default");
  assert.equal(ttl?.value, "30");
  assert.equal(
    items.find((item) => item.key === "YANDEX_POSTBOX_REGION")?.value,
    "ru-central1",
  );
  assert.equal(
    items.find((item) => item.key === "YANDEX_POSTBOX_ENDPOINT")?.value,
    "https://postbox.cloud.yandex.net",
  );
});

test("defaults shown by diagnostics come from the runtime parser", async () => {
  const { getEmailConfig } = await import("@/lib/email/config");
  const items = withEnv(
    {
      EMAIL_WORKER_BATCH_SIZE: undefined,
      EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY: undefined,
      EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES: undefined,
    },
    () => {
      const config = getEmailConfig();
      return {
        rows: rows(),
        workerBatchSize: config.workerBatchSize,
        shardConcurrency: config.providerEventIngestion.shardConcurrency,
        maxConsecutiveFailures:
          config.providerEventIngestion.maxConsecutiveFailures,
      };
    },
  );

  const valueOf = (key: string) =>
    items.rows.find((item) => item.key === key)?.value;
  assert.equal(valueOf("EMAIL_WORKER_BATCH_SIZE"), String(items.workerBatchSize));
  assert.equal(
    valueOf("EMAIL_PROVIDER_EVENT_SHARD_CONCURRENCY"),
    String(items.shardConcurrency),
  );
  assert.equal(
    valueOf("EMAIL_PROVIDER_EVENT_MAX_CONSECUTIVE_FAILURES"),
    String(items.maxConsecutiveFailures),
  );
});

test("disabled feature children are not reported as missing required", () => {
  const items = withEnv(
    {
      EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "false",
      YANDEX_DATA_STREAMS_ENDPOINT: undefined,
      YANDEX_DATA_STREAMS_STREAM_NAME: undefined,
      YANDEX_DATA_STREAMS_ACCESS_KEY_ID: undefined,
      YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: undefined,
      EMAIL_PROVIDER: "disabled",
      EMAIL_DELIVERY_ENABLED: "false",
      EMAIL_SENSITIVE_PAYLOAD_KEY: undefined,
      YANDEX_POSTBOX_ACCESS_KEY_ID: undefined,
      YANDEX_POSTBOX_SECRET_ACCESS_KEY: undefined,
    },
    rows,
  );

  assert.equal(
    items.find((item) => item.key === "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED")
      ?.status,
    "disabled_by_design",
  );
  for (const key of [
    "YANDEX_DATA_STREAMS_ENDPOINT",
    "YANDEX_DATA_STREAMS_STREAM_NAME",
    "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
    "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
    "EMAIL_SENSITIVE_PAYLOAD_KEY",
    "YANDEX_POSTBOX_ACCESS_KEY_ID",
    "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
  ]) {
    const item = items.find((row) => row.key === key);
    assert.equal(
      item?.status,
      "not_applicable",
      `${key} was reported as missing while its feature is disabled`,
    );
    assert.equal(item?.required, false);
  }
  assert.equal(
    items.some((item) => item.status === "missing_required" && !item.required),
    false,
  );
});

test("required children are reported missing once the feature is enabled", () => {
  const items = withEnv(
    {
      EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "true",
      YANDEX_DATA_STREAMS_ENDPOINT: undefined,
      YANDEX_DATA_STREAMS_STREAM_NAME: undefined,
      YANDEX_DATA_STREAMS_ACCESS_KEY_ID: undefined,
      YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: undefined,
    },
    rows,
  );
  for (const key of [
    "YANDEX_DATA_STREAMS_ENDPOINT",
    "YANDEX_DATA_STREAMS_STREAM_NAME",
    "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
    "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
  ]) {
    const item = items.find((row) => row.key === key);
    assert.equal(item?.status, "missing_required", `${key} was not required`);
    assert.equal(item?.required, true);
  }
});

test("admin diagnostics rows are tied to runtime consumers and omit obsolete rows", () => {
  const items = rows();
  for (const item of items) {
    assert.match(item.consumer, /^lib\//);
    assert.ok(item.explanation.length > 0);
    if (item.isSecret) assert.equal(item.value, null);
  }
  assert.equal(items.some((item) => item.key === "NEXT_PUBLIC_APP_URL"), false);
});

test("the documented coverage matrix matches the emitted descriptors exactly", () => {
  const doc = readFileSync(
    "docs/operations/admin-configuration-diagnostics.md",
    "utf8",
  );
  const tableStart = doc.indexOf("## Coverage Matrix");
  assert.ok(tableStart >= 0, "coverage matrix section is missing");

  const documented = new Set(
    [...doc.slice(tableStart).matchAll(/^\| `([A-Z0-9_]+)` \|/gm)].map(
      (match) => match[1],
    ),
  );
  const declared = new Set(descriptors().map((descriptor) => descriptor.key));

  assert.deepEqual(
    [...declared].filter((key) => !documented.has(key)),
    [],
    "descriptors missing from the documented matrix",
  );
  assert.deepEqual(
    [...documented].filter((key) => !declared.has(key)),
    [],
    "documented keys with no descriptor",
  );

  // The matrix must also agree about which keys are secret.
  const documentedSecrets = new Set(
    [...doc.slice(tableStart).matchAll(/^\| `([A-Z0-9_]+)` \|[^\n]*?\| yes \|/gm)].map(
      (match) => match[1],
    ),
  );
  assert.deepEqual(
    [...documentedSecrets].sort(),
    [...EXPECTED_SECRET_KEYS].sort(),
  );
});
