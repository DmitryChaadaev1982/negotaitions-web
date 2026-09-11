import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { applyTestRuntimeDefaults } from "./scripts/test-unit-env-bootstrap.mjs";
import { buildE2eServerEnvironment } from "./tests/e2e/helpers/e2e-database";
import { resolveManagedPlaywrightVideoProvider } from "./tests/e2e/helpers/playwright-video-provider";

applyTestRuntimeDefaults({ overwrite: true });

const port = 3100;
const localBaseUrl = `http://127.0.0.1:${port}`;
const explicitModeRaw = process.env.PLAYWRIGHT_SERVER_MODE?.trim().toLowerCase() || "";
const isExplicitMode = explicitModeRaw.length > 0;

if (isExplicitMode && !["managed", "live"].includes(explicitModeRaw)) {
  throw new Error(
    `INVALID_PLAYWRIGHT_SERVER_MODE: unsupported PLAYWRIGHT_SERVER_MODE="${explicitModeRaw}"`,
  );
}

const legacyExternalBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  "";

const managedMode = explicitModeRaw === "managed";
const liveMode = explicitModeRaw === "live";
const useLegacyExternalBaseUrl = !isExplicitMode && Boolean(legacyExternalBaseUrl);
const resolvedBaseUrl = liveMode
  ? process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://localhost:3000"
  : useLegacyExternalBaseUrl
    ? legacyExternalBaseUrl
    : localBaseUrl;
const enableWebServer = managedMode || (!isExplicitMode && !useLegacyExternalBaseUrl);
const isInventoryOnly = process.argv.includes("--list");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: resolvedBaseUrl,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
            : {}),
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: enableWebServer && !isInventoryOnly
    ? {
        command: `npx next dev -p ${port}`,
        url: localBaseUrl,
        reuseExistingServer: false,
        timeout: 120_000,
        env: buildE2eServerEnvironment({
          APP_URL: localBaseUrl,
          BASE_URL: localBaseUrl,
          PLAYWRIGHT_BASE_URL: localBaseUrl,
          NEXT_PUBLIC_APP_URL: localBaseUrl,
          NEXT_DIST_DIR: ".next-e2e",
          VIDEO_PROVIDER: resolveManagedPlaywrightVideoProvider(),
          EMAIL_PROVIDER: "fake",
          EMAIL_DELIVERY_ENABLED: "true",
          EMAIL_ADMIN_TEST_ENABLED:
            process.env.PLAYWRIGHT_EMAIL_ADMIN_TEST_ENABLED ?? "true",
          EMAIL_LOCAL_PREVIEW_ENABLED:
            process.env.PLAYWRIGHT_EMAIL_LOCAL_PREVIEW_ENABLED ?? "true",
          EMAIL_CANONICAL_BASE_URL: "https://local.negotaitions.ru",
          ADMIN_EMAILS: "admin@example.com",
          EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "false",
          EMAIL_OPERATOR_NAME: "Playwright Operator",
          EMAIL_FROM_NO_REPLY: "no-reply@example.com",
          EMAIL_FROM_NOTIFICATIONS: "notifications@example.com",
          EMAIL_FROM_INVITATIONS: "invitations@example.com",
          EMAIL_REPLY_TO_SUPPORT: "support@example.com",
          EMAIL_REPLY_TO_SECURITY: "security@example.com",
          EMAIL_REPLY_TO_BUSINESS: "business@example.com",
          TRUSTED_PROXY_ENABLED:
            process.env.PLAYWRIGHT_TRUSTED_PROXY_ENABLED ?? "false",
          EXTERNAL_SERVICES_MODE: "mock",
          RECORDING_MODE: "mock",
          TRANSCRIPTION_MODE: "mock",
          POST_TRANSCRIPTION_LAB: process.env.POST_TRANSCRIPTION_LAB ?? "",
          LIVEKIT_URL: "wss://mock-livekit.invalid",
          LIVEKIT_API_KEY: "mock-livekit-key",
          LIVEKIT_API_SECRET: "mock-livekit-secret",
          // Keep focused/local E2E deterministic regardless of developer .env.
          VOXIMPLANT_SERVER_STOP_MODE:
            process.env.PLAYWRIGHT_VOXIMPLANT_SERVER_STOP_MODE?.trim() || "disabled",
          // Disabled by default in tests to prevent unintended OpenAI charges
          // and to keep tests deterministic. Enable per-test-run when needed.
          AUTO_TRANSCRIBE_AFTER_RECORDING: "false",
        }),
      }
    : undefined,
  metadata: {
    runtimeMode: isExplicitMode ? explicitModeRaw : "legacy-auto",
    baseURLSource: liveMode ? "playwright-server-mode-live" : "playwright-local-config",
    baseURL: resolvedBaseUrl,
  },
});
