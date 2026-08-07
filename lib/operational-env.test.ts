import assert from "node:assert/strict";
import test from "node:test";

import { getEmailConfig } from "@/lib/email/config";
import {
  bootstrapOperationalEnv,
  shouldLoadLocalOperationalEnv,
} from "@/lib/operational-env";

const ENV_KEYS = [
  "NODE_ENV",
  "EMAIL_DELIVERY_ENABLED",
  "EMAIL_PROVIDER",
  "EMAIL_PROVIDER_EVENT_INGESTION_ENABLED",
  "EMAIL_CANONICAL_BASE_URL",
  "YANDEX_DATA_STREAMS_ACCESS_KEY_ID",
  "YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY",
  "YANDEX_DATA_STREAMS_ENDPOINT",
  "YANDEX_DATA_STREAMS_STREAM_NAME",
] as const;

function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) previous.set(key, process.env[key]);
  try {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production operational bootstrap skips app env loading", () => {
  let calls = 0;
  const result = bootstrapOperationalEnv({
    nodeEnv: "production",
    projectDir: "/repo",
    loadEnvConfig: () => {
      calls += 1;
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.loaded, false);
  assert.equal(shouldLoadLocalOperationalEnv("production"), false);
});

test("non-production operational bootstrap retains local env loading", () => {
  let loadedProjectDir: string | null = null;
  const result = bootstrapOperationalEnv({
    nodeEnv: "development",
    projectDir: "/repo",
    loadEnvConfig: (projectDir) => {
      loadedProjectDir = projectDir;
    },
  });

  assert.equal(result.loaded, true);
  assert.equal(loadedProjectDir, "/repo");
  assert.equal(shouldLoadLocalOperationalEnv("test"), true);
});

test("missing production provider-event env fails validation instead of loading app env", () => {
  withEnv(
    {
      NODE_ENV: "production",
      EMAIL_DELIVERY_ENABLED: "false",
      EMAIL_PROVIDER: "disabled",
      EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "true",
      EMAIL_CANONICAL_BASE_URL: "https://negotaitions.ru",
      YANDEX_DATA_STREAMS_ACCESS_KEY_ID: undefined,
      YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY: undefined,
      YANDEX_DATA_STREAMS_ENDPOINT: undefined,
      YANDEX_DATA_STREAMS_STREAM_NAME: undefined,
    },
    () => {
      bootstrapOperationalEnv({
        loadEnvConfig: () => {
          process.env.YANDEX_DATA_STREAMS_ACCESS_KEY_ID = "would-have-loaded";
          process.env.YANDEX_DATA_STREAMS_SECRET_ACCESS_KEY = "would-have-loaded";
        },
      });

      assert.throws(
        () => getEmailConfig(),
        /Missing Yandex Data Streams credentials for enabled provider-event ingestion\./,
      );
    },
  );
});
