import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { buildE2eServerEnvironment } from "./tests/e2e/helpers/e2e-database";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const envBaseUrl =
  process.env.PLAYWRIGHT_BASE_URL?.trim() ||
  process.env.BASE_URL?.trim() ||
  process.env.APP_URL?.trim() ||
  "";
const fallbackBaseUrl = `http://127.0.0.1:${port}`;
const resolvedBaseUrl = envBaseUrl || fallbackBaseUrl;
const useExternalBaseUrl = Boolean(envBaseUrl);

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
  webServer: useExternalBaseUrl
    ? undefined
    : {
        command: `npx next dev -p ${port}`,
        url: fallbackBaseUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: buildE2eServerEnvironment({
          APP_URL: fallbackBaseUrl,
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

