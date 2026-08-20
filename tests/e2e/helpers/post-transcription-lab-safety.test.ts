import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  assertPostTranscriptionLabSafety,
  buildPostTranscriptionLabEnvironment,
  isProductionApplicationHost,
  PostTranscriptionLabSafetyError,
} from "./post-transcription-lab-safety";

const VALID_E2E_URL =
  "postgresql://negotiations:negotiations_password@localhost:5433/negotiations_e2e?schema=public";
const VALID_DEV_URL =
  "postgresql://negotiations:negotiations_password@localhost:5432/negotiations?schema=public";
const YANDEX_URL =
  "postgresql://negotiations:negotiations_password@mdb.yandexcloud.net:6432/negotiations_e2e?schema=public";

const SAFE_LAB_ENV = {
  NODE_ENV: "test",
  POST_TRANSCRIPTION_LAB: "1",
  E2E_DATABASE_URL: VALID_E2E_URL,
  DATABASE_URL: VALID_DEV_URL,
  APP_URL: "http://127.0.0.1:3100",
  PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3100",
  EXTERNAL_SERVICES_MODE: "mock",
  RECORDING_MODE: "mock",
  TRANSCRIPTION_MODE: "mock",
  VOXIMPLANT_SERVER_STOP_MODE: "disabled",
};

test("accepts a local mock lab environment", () => {
  assert.doesNotThrow(() => assertPostTranscriptionLabSafety(SAFE_LAB_ENV));
});

test("refuses NODE_ENV=production", () => {
  assert.throws(
    () =>
      assertPostTranscriptionLabSafety({
        ...SAFE_LAB_ENV,
        NODE_ENV: "production",
      }),
    PostTranscriptionLabSafetyError,
  );
});

test("refuses missing POST_TRANSCRIPTION_LAB", () => {
  assert.throws(
    () =>
      assertPostTranscriptionLabSafety({
        ...SAFE_LAB_ENV,
        POST_TRANSCRIPTION_LAB: undefined,
      }),
    /POST_TRANSCRIPTION_LAB=1/,
  );
});

test("refuses production application hosts", () => {
  assert.equal(isProductionApplicationHost("negotaitions.ru"), true);
  assert.equal(isProductionApplicationHost("www.negotaitions.ru"), true);
  assert.equal(isProductionApplicationHost("127.0.0.1"), false);
  assert.equal(isProductionApplicationHost("local.negotaitions.ru"), false);
  assert.throws(
    () =>
      assertPostTranscriptionLabSafety({
        ...SAFE_LAB_ENV,
        APP_URL: "https://negotaitions.ru",
      }),
    /production application host/,
  );
});

test("refuses Yandex/production database hosts", () => {
  assert.throws(
    () =>
      assertPostTranscriptionLabSafety({
        ...SAFE_LAB_ENV,
        E2E_DATABASE_URL: YANDEX_URL,
      }),
    /E2E database target/,
  );
});

test("refuses live external service modes", () => {
  assert.throws(
    () =>
      assertPostTranscriptionLabSafety({
        ...SAFE_LAB_ENV,
        TRANSCRIPTION_MODE: "live",
      }),
    /TRANSCRIPTION_MODE/,
  );
});

test("production application routes do not import lab seeding", async () => {
  const appRoute = await readFile(
    path.join(process.cwd(), "app/api/sessions/[sessionId]/materials/status/route.ts"),
    "utf8",
  );
  assert.doesNotMatch(appRoute, /post-transcription-lab-seed/);
  assert.doesNotMatch(appRoute, /POST_TRANSCRIPTION_LAB/);
});

test("buildPostTranscriptionLabEnvironment forces mock lab admission flags", () => {
  const env = buildPostTranscriptionLabEnvironment(
    { LAB_SCENARIOS: "S10" },
    { NODE_ENV: "test", E2E_DATABASE_URL: VALID_E2E_URL },
  );
  assert.equal(env.POST_TRANSCRIPTION_LAB, "1");
  assert.equal(env.EXTERNAL_SERVICES_MODE, "mock");
  assert.equal(env.RECORDING_MODE, "mock");
  assert.equal(env.TRANSCRIPTION_MODE, "mock");
  assert.equal(env.LAB_SCENARIOS, "S10");
});

test("buildPostTranscriptionLabEnvironment overrides a live Vox stop mode from .env", () => {
  const env = buildPostTranscriptionLabEnvironment(
    {},
    {
      VOXIMPLANT_SERVER_STOP_MODE: "prefer_server_with_relay_fallback",
    },
  );
  assert.equal(env.VOXIMPLANT_SERVER_STOP_MODE, "disabled");
});
