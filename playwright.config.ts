import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { buildE2eServerEnvironment } from "./tests/e2e/helpers/e2e-database";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const envBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  "";
const fallbackBaseUrl = `http://127.0.0.1:${port}`;
const resolvedBaseUrl = envBaseUrl || fallbackBaseUrl;
const useExternalBaseUrl = Boolean(envBaseUrl);
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
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
  ],
  webServer: useExternalBaseUrl || isInventoryOnly
    ? undefined
    : {
        command: `npx next dev -p ${port}`,
        url: fallbackBaseUrl,
        reuseExistingServer: false,
        timeout: 120_000,
        env: buildE2eServerEnvironment({
          APP_URL: fallbackBaseUrl,
          BASE_URL: fallbackBaseUrl,
          PLAYWRIGHT_BASE_URL: fallbackBaseUrl,
          NEXT_PUBLIC_APP_URL: fallbackBaseUrl,
          NEXT_DIST_DIR: ".next-e2e",
          VIDEO_PROVIDER: "livekit",
          TRANSCRIPTION_PROVIDER: "openai",
          AI_ANALYSIS_PROVIDER: "openai",
          ADMIN_EMAILS: "admin@example.com",
          CREDENTIAL_DISPATCH_FENCE_TIMEOUT_MS: "5000",
          PASSWORD_RESET_TOKEN_TTL_MINUTES: "30",
          PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS: "60",
          PASSWORD_RESET_MAX_REQUESTS_PER_HOUR: "5",
          PASSWORD_RESET_RESPONSE_FLOOR_MS: "180",
          EMAIL_PROVIDER: "fake",
          EMAIL_DELIVERY_ENABLED: "true",
          EMAIL_ADMIN_TEST_ENABLED:
            process.env.PLAYWRIGHT_EMAIL_ADMIN_TEST_ENABLED ?? "true",
          EMAIL_LOCAL_PREVIEW_ENABLED:
            process.env.PLAYWRIGHT_EMAIL_LOCAL_PREVIEW_ENABLED ?? "true",
          EMAIL_CANONICAL_BASE_URL: "https://local.negotaitions.ru",
          EMAIL_OPERATOR_NAME: "Playwright Operator",
          EMAIL_FROM_NO_REPLY: "no-reply@example.com",
          EMAIL_FROM_NOTIFICATIONS: "notifications@example.com",
          EMAIL_FROM_INVITATIONS: "invitations@example.com",
          EMAIL_REPLY_TO_SUPPORT: "support@example.com",
          EMAIL_REPLY_TO_SECURITY: "security@example.com",
          EMAIL_REPLY_TO_BUSINESS: "business@example.com",
          EMAIL_WORKER_BATCH_SIZE: "25",
          EMAIL_MAX_ATTEMPTS: "5",
          EMAIL_RETRY_BASE_SECONDS: "60",
          EMAIL_RETRY_MAX_SECONDS: "43200",
          EMAIL_PROCESSING_LEASE_SECONDS: "600",
          EMAIL_PROVIDER_REQUEST_TIMEOUT_MS: "30000",
          EMAIL_PROVIDER_REQUEST_SAFETY_MARGIN_SECONDS: "30",
          EMAIL_CONTENT_RETENTION_DAYS: "90",
          EMAIL_DELIVERY_ATTEMPT_RETENTION_DAYS: "365",
          EMAIL_PROVIDER_ID_RETENTION_DAYS: "365",
          EMAIL_PROVIDER_EVENT_RETENTION_DAYS: "730",
          EMAIL_BOUNCE_COMPLAINT_RETENTION_DAYS: "730",
          EMAIL_PROVIDER_EVENT_RECONCILIATION_WINDOW_SECONDS: "86400",
          EMAIL_PROVIDER_EVENT_RECONCILIATION_DELAY_SECONDS: "60",
          EMAIL_PROVIDER_EVENT_INGESTION_ENABLED: "false",
          TRUSTED_PROXY_ENABLED:
            process.env.PLAYWRIGHT_TRUSTED_PROXY_ENABLED ?? "false",
          EXTERNAL_SERVICES_MODE: "mock",
          RECORDING_MODE: "mock",
          TRANSCRIPTION_MODE: "mock",
          LIVEKIT_URL: "wss://mock-livekit.invalid",
          LIVEKIT_API_KEY: "mock-livekit-key",
          LIVEKIT_API_SECRET: "mock-livekit-secret",
          // Disabled by default in tests to prevent unintended OpenAI charges
          // and to keep tests deterministic. Enable per-test-run when needed.
          AUTO_TRANSCRIBE_AFTER_RECORDING: "false",
        }),
      },
  metadata: {
    baseURLSource: useExternalBaseUrl ? "env" : "playwright-webserver",
    baseURL: resolvedBaseUrl,
  },
});

