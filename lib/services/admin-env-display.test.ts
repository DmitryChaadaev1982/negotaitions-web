import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildAdminEnvDescriptors,
  getAdminEnvironmentDisplayGroups,
  type AdminEnvDescriptor,
} from "@/lib/services/admin-env-display";
import {
  SERVER_RUNTIME_SETTING_KEYS,
  SERVER_RUNTIME_SETTINGS,
} from "@/lib/config/server-runtime-settings";
import { verifyRuntimeConfiguration } from "../../scripts/verify-runtime-config-drift";

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

const EXPECTED_DIAGNOSTIC_KEYS = SERVER_RUNTIME_SETTING_KEYS;
const EXPECTED_SECRET_KEYS = SERVER_RUNTIME_SETTING_KEYS.filter(
  (key) => SERVER_RUNTIME_SETTINGS[key].secret,
);

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

test("deployment settings have no parser default or intrinsic diagnostics source", () => {
  const byKey = new Map(descriptors().map((descriptor) => [descriptor.key, descriptor]));
  for (const key of SERVER_RUNTIME_SETTING_KEYS) {
    const definition = SERVER_RUNTIME_SETTINGS[key];
    if (definition.classification !== "deployment") continue;
    assert.equal(
      "defaultValue" in definition.parser,
      false,
      `${key} retained a deployment fallback`,
    );
    assert.notEqual(
      byKey.get(key)?.valueSource,
      "intrinsic",
      `${key} reported an intrinsic/default source`,
    );
  }
});

test("no descriptor is duplicated and every descriptor reaches a display group", () => {
  const keys = descriptors().map((descriptor) => descriptor.key);
  assert.equal(new Set(keys).size, keys.length, "duplicate descriptor key");
  assert.deepEqual(
    rows().map((item) => item.key).sort(),
    [...keys].sort(),
  );
});

test("AST enforcement proves registry and runtime-consumer equality", () => {
  assert.deepEqual(verifyRuntimeConfiguration(), []);
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

test("admin diagnostics report missing deployment settings without restoring defaults", () => {
  const items = withEnv(
    {
      PASSWORD_RESET_TOKEN_TTL_MINUTES: undefined,
      YANDEX_POSTBOX_REGION: undefined,
      YANDEX_POSTBOX_ENDPOINT: undefined,
      EMAIL_PROVIDER: "disabled",
      EMAIL_DELIVERY_ENABLED: "false",
    },
    rows,
  );

  const ttl = items.find((item) => item.key === "PASSWORD_RESET_TOKEN_TTL_MINUTES");
  assert.equal(ttl?.status, "missing_required");
  assert.equal(ttl?.valueSource, "missing");
  assert.equal(ttl?.value, null);
  for (const key of ["YANDEX_POSTBOX_REGION", "YANDEX_POSTBOX_ENDPOINT"]) {
    const item = items.find((row) => row.key === key);
    assert.equal(item?.status, "not_applicable");
    assert.equal(item?.valueSource, "not_applicable");
    assert.equal(item?.value, null);
  }
});

test("removed operational defaults cannot reappear through parser or diagnostics", () => {
  const items = withEnv(
    {
      EMAIL_WORKER_BATCH_SIZE: undefined,
      EMAIL_FROM_NOTIFICATIONS: undefined,
    },
    rows,
  );

  for (const key of ["EMAIL_WORKER_BATCH_SIZE", "EMAIL_FROM_NOTIFICATIONS"]) {
    const item = items.find((row) => row.key === key);
    assert.equal(item?.status, "missing_required");
    assert.equal(item?.valueSource, "missing");
    assert.equal(item?.value, null);
  }
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
      YANDEX_POSTBOX_ALLOWED_SENDERS: undefined,
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
    "YANDEX_POSTBOX_ACCESS_KEY_ID",
    "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
    "YANDEX_POSTBOX_REGION",
    "YANDEX_POSTBOX_ENDPOINT",
    "YANDEX_POSTBOX_CONFIGURATION_SET",
    "YANDEX_POSTBOX_ALLOWED_SENDERS",
  ]) {
    const item = items.find((row) => row.key === key);
    assert.equal(
      item?.status,
      "not_applicable",
      `${key} was reported as missing while its feature is disabled`,
    );
    assert.equal(item?.required, false);
  }
  const payloadKey = items.find((row) => row.key === "EMAIL_SENSITIVE_PAYLOAD_KEY");
  assert.equal(payloadKey?.status, "missing_required");
  assert.equal(payloadKey?.required, true);
  assert.equal(payloadKey?.applicable, true);
  assert.equal(
    items.some((item) => item.status === "missing_required" && !item.required),
    false,
  );
});

test("sensitive payload key is required independently of delivery and provider state", () => {
  const missing = withEnv(
    {
      EMAIL_DELIVERY_ENABLED: "false",
      EMAIL_PROVIDER: "disabled",
      EMAIL_SENSITIVE_PAYLOAD_KEY: undefined,
    },
    rows,
  ).find((row) => row.key === "EMAIL_SENSITIVE_PAYLOAD_KEY");
  assert.equal(missing?.status, "missing_required");
  assert.equal(missing?.required, true);
  assert.equal(missing?.applicable, true);
  assert.equal(missing?.value, null);

  const configured = withEnv(
    {
      EMAIL_DELIVERY_ENABLED: "false",
      EMAIL_PROVIDER: "disabled",
      EMAIL_SENSITIVE_PAYLOAD_KEY: Buffer.alloc(32, 8).toString("base64"),
    },
    rows,
  ).find((row) => row.key === "EMAIL_SENSITIVE_PAYLOAD_KEY");
  assert.equal(configured?.status, "configured");
  assert.equal(configured?.value, null);
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

test("all Postbox runtime requirements become visible only when delivery uses Postbox", () => {
  const items = withEnv(
    {
      EMAIL_DELIVERY_ENABLED: "true",
      EMAIL_PROVIDER: "yandex_postbox",
      YANDEX_POSTBOX_REGION: undefined,
      YANDEX_POSTBOX_ENDPOINT: undefined,
      YANDEX_POSTBOX_ACCESS_KEY_ID: undefined,
      YANDEX_POSTBOX_SECRET_ACCESS_KEY: undefined,
      YANDEX_POSTBOX_ALLOWED_SENDERS: undefined,
    },
    rows,
  );

  for (const key of [
    "YANDEX_POSTBOX_REGION",
    "YANDEX_POSTBOX_ENDPOINT",
    "YANDEX_POSTBOX_ACCESS_KEY_ID",
    "YANDEX_POSTBOX_SECRET_ACCESS_KEY",
    "YANDEX_POSTBOX_ALLOWED_SENDERS",
  ]) {
    const item = items.find((row) => row.key === key);
    assert.equal(item?.status, "missing_required", `${key} was not required`);
    assert.equal(item?.valueSource, "missing");
    assert.equal(item?.required, true);
    assert.equal(item?.applicable, true);
    assert.equal(item?.value, null);
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
