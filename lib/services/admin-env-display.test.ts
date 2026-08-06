import assert from "node:assert/strict";
import test from "node:test";

import { getAdminEnvironmentDisplayGroups } from "@/lib/services/admin-env-display";

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

  assert.ok(items.find((item) => item.key === "PASSWORD_RESET_TOKEN_TTL_MINUTES"));
  assert.equal(
    items.find((item) => item.key === "PASSWORD_RESET_TOKEN_TTL_MINUTES")?.status,
    "using_effective_default",
  );
  assert.equal(
    items.find((item) => item.key === "PASSWORD_RESET_TOKEN_TTL_MINUTES")?.value,
    "30",
  );
  assert.equal(
    items.find((item) => item.key === "YANDEX_POSTBOX_REGION")?.value,
    "ru-central1",
  );
  assert.equal(
    items.find((item) => item.key === "YANDEX_POSTBOX_ENDPOINT")?.value,
    "https://postbox.cloud.yandex.net",
  );
});

test("admin diagnostics show trusted proxy runtime value and do not serialize secrets", () => {
  const groups = withEnv(
    {
      TRUSTED_PROXY_ENABLED: "true",
      YANDEX_DATA_STREAMS_ACCESS_KEY_ID: "akid-secret-fragment",
      YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: "secret-access-fragment",
      EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "false",
      EMAIL_PROVIDER: "disabled",
      EMAIL_DELIVERY_ENABLED: "false",
    },
    getAdminEnvironmentDisplayGroups,
  );
  const items = groups.flatMap((group) => group.items);

  assert.equal(
    items.find((item) => item.key === "TRUSTED_PROXY_ENABLED")?.value,
    "true",
  );
  assert.equal(
    items.find((item) => item.key === "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED")
      ?.status,
    "disabled_by_design",
  );
  assert.equal(
    items.find((item) => item.key === "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY")
      ?.value,
    null,
  );
  assert.doesNotMatch(JSON.stringify(groups), /secret-access-fragment/);
  assert.doesNotMatch(JSON.stringify(groups), /akid-secret-fragment/);
});

test("admin diagnostics rows are tied to runtime consumers and omit obsolete public rows", () => {
  const items = rows();
  for (const item of items) {
    assert.match(item.consumer, /^lib\//);
    if (item.isSecret) assert.equal(item.value, null);
  }
  assert.equal(items.some((item) => item.key === "NEXT_PUBLIC_APP_URL"), false);
  assert.equal(
    items.some((item) => item.status === "missing_required" && !item.required),
    false,
  );
});
