import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NextResponse } from "next/server";

import {
  ADMIN_HEALTH_EMERGENCY_RESPONSE,
  ADMIN_HEALTH_ERROR_CODE,
  createAdminHealthGet,
} from "@/lib/services/admin-health-route-handler";

type Dependencies = Parameters<typeof createAdminHealthGet>[0];

const usage = {
  livekitRecordingMinutes: 0,
  voximplantConferenceMinutes: 0,
  openAiTranscriptionMinutes: 0,
  openAiTranscriptionBytes: 0,
  yandexSpeechKitMinutes: 0,
  yandexAiAnalysisRuns: 0,
  storageUploadedBytes: 0,
  storageDownloadedBytes: 0,
  recordingsCreated: 0,
};

function dependencies(
  overrides: Partial<Dependencies> = {},
): Dependencies {
  return {
    authorize: async () => ({ user: {} as never, response: null }),
    hasRecentErrors: async () => false,
    findRecentEvents: async () => [],
    getUsage: async () => usage,
    getWebhookState: async () => ({
      nodeEnv: "test",
      overrideEnabledRaw: null,
      overrideEnabled: false,
      envDefault: null,
      override: null,
      savedOverridePresent: false,
      savedOverrideActive: false,
      effective: null,
      effectiveSource: "invalid",
    }),
    getWebhookFallback: () => null,
    getConfig: () => ({ envGroups: [] }) as never,
    ...overrides,
  };
}

function isDeeplyFrozen(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeeplyFrozen);
}

test("route emergency fallback is literal, deterministic, bounded, and leak-free", async () => {
  const markerA = "emergency-marker-a-7f31";
  const markerB = "emergency-marker-b-2c84";
  const previous = {
    webhook: process.env.VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL,
    endpoint: process.env.YANDEX_DATA_STREAMS_ENDPOINT,
  };
  let configCalls = 0;
  let resolverCalls = 0;
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };

  try {
    process.env.VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL =
      `https://${markerA}.example`;
    process.env.YANDEX_DATA_STREAMS_ENDPOINT = `https://${markerA}.example`;
    const handler = createAdminHealthGet(
      dependencies({
        getConfig: () => {
          configCalls += 1;
          throw new Error(markerA);
        },
        getWebhookState: async () => {
          resolverCalls += 1;
          throw new Error(markerA);
        },
      }),
    );

    const first = await handler();
    const firstText = await first.text();
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.ok(firstText.length < 2_048);
    assert.doesNotMatch(firstText, new RegExp(markerA));
    assert.doesNotMatch(firstText, /https?:\/\//);
    assert.equal(configCalls, 1);
    assert.equal(resolverCalls, 0);

    process.env.VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL =
      `https://${markerB}.example`;
    process.env.YANDEX_DATA_STREAMS_ENDPOINT = `https://${markerB}.example`;
    const second = await handler();
    const secondText = await second.text();
    assert.equal(secondText, firstText);
    assert.doesNotMatch(secondText, new RegExp(markerB));
    assert.equal(resolverCalls, 0);

    const payload = JSON.parse(firstText) as Record<string, unknown>;
    assert.equal(payload.errorCode, ADMIN_HEALTH_ERROR_CODE);
    assert.equal("voximplantRecordingWebhook" in payload, false);
    assert.ok(isDeeplyFrozen(ADMIN_HEALTH_EMERGENCY_RESPONSE));
    assert.doesNotMatch(JSON.stringify(logs), new RegExp(`${markerA}|${markerB}`));
  } finally {
    console.error = originalError;
    if (previous.webhook === undefined) {
      delete process.env.VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL;
    } else {
      process.env.VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL = previous.webhook;
    }
    if (previous.endpoint === undefined) {
      delete process.env.YANDEX_DATA_STREAMS_ENDPOINT;
    } else {
      process.env.YANDEX_DATA_STREAMS_ENDPOINT = previous.endpoint;
    }
  }
});

test("unauthorized callers are rejected before diagnostics or fallback", async () => {
  let configCalls = 0;
  const handler = createAdminHealthGet(
    dependencies({
      authorize: async () => ({
        user: null,
        response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      }),
      getConfig: () => {
        configCalls += 1;
        throw new Error("must not run");
      },
    }),
  );

  const response = await handler();
  assert.equal(response.status, 401);
  assert.equal(configCalls, 0);
});

test("fallback source contains no environment-derived resolver", () => {
  const source = readFileSync(
    "lib/services/admin-health-route-handler.ts",
    "utf8",
  );
  const start = source.indexOf(
    "export const ADMIN_HEALTH_EMERGENCY_RESPONSE",
  );
  const end = source.indexOf("type AdminHealthEvent", start);
  assert.ok(start >= 0 && end > start);
  const fallbackSource = source.slice(start, end);
  for (const forbidden of [
    "process.env",
    "getEnvironmentConfigStatus",
    "getEmailConfig",
    "getVoximplantRecordingWebhook",
    "buildVoximplantRecordingWebhook",
    "trustedProxy",
  ]) {
    assert.equal(
      fallbackSource.includes(forbidden),
      false,
      `fallback references ${forbidden}`,
    );
  }
  assert.match(
    source,
    /NextResponse\.json\(\s*ADMIN_HEALTH_EMERGENCY_RESPONSE,/,
  );
  const routeSource = readFileSync("app/api/admin/health/route.ts", "utf8");
  assert.match(routeSource, /createAdminHealthGet\(\{/);
});
