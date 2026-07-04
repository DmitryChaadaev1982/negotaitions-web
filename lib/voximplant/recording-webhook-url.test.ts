import test from "node:test";
import assert from "node:assert/strict";

import { resolveVoximplantRecordingWebhookUrl } from "@/lib/voximplant/recording-webhook-url-resolve";

const ENV_URL = "https://negotaitions.ru";
const SAVED_OVERRIDE = "https://old.trycloudflare.com";

function withEnv(
  entries: Record<string, string | undefined>,
  run: () => void,
) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(entries)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("Case A: override disabled ignores saved override", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL: ENV_URL,
      VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED: "false",
    },
    () => {
      const resolution = resolveVoximplantRecordingWebhookUrl({
        savedOverrideRaw: SAVED_OVERRIDE,
      });

      assert.equal(resolution.overrideEnabled, false);
      assert.equal(resolution.savedOverrideWebhookBaseUrl, SAVED_OVERRIDE);
      assert.equal(resolution.effectiveWebhookBaseUrl, ENV_URL);
      assert.equal(resolution.effectiveSource, "env");
      assert.equal(resolution.warning, undefined);
    },
  );
});

test("Case B: override enabled uses saved override", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL: ENV_URL,
      VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED: "true",
    },
    () => {
      const resolution = resolveVoximplantRecordingWebhookUrl({
        savedOverrideRaw: SAVED_OVERRIDE,
      });

      assert.equal(resolution.overrideEnabled, true);
      assert.equal(resolution.effectiveWebhookBaseUrl, SAVED_OVERRIDE);
      assert.equal(resolution.effectiveSource, "saved_override");
    },
  );
});

test("Case C: override enabled without valid saved override falls back to env", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL: ENV_URL,
      VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED: "true",
    },
    () => {
      const emptyResolution = resolveVoximplantRecordingWebhookUrl({
        savedOverrideRaw: null,
      });
      assert.equal(emptyResolution.effectiveWebhookBaseUrl, ENV_URL);
      assert.equal(emptyResolution.effectiveSource, "env");
      assert.match(emptyResolution.warning ?? "", /no saved override exists/i);

      const invalidResolution = resolveVoximplantRecordingWebhookUrl({
        savedOverrideRaw: "http://localhost:3000",
      });
      assert.equal(invalidResolution.effectiveWebhookBaseUrl, ENV_URL);
      assert.equal(invalidResolution.effectiveSource, "env");
      assert.match(invalidResolution.warning ?? "", /missing or invalid/i);
    },
  );
});

test("Case D: override disabled with no saved override uses env", () => {
  withEnv(
    {
      NODE_ENV: "production",
      VOXIMPLANT_RECORDING_WEBHOOK_BASE_URL: ENV_URL,
      VOXIMPLANT_RECORDING_WEBHOOK_OVERRIDE_ENABLED: "false",
    },
    () => {
      const resolution = resolveVoximplantRecordingWebhookUrl({
        savedOverrideRaw: null,
      });

      assert.equal(resolution.effectiveWebhookBaseUrl, ENV_URL);
      assert.equal(resolution.effectiveSource, "env");
      assert.equal(resolution.savedOverridePresent, false);
    },
  );
});
