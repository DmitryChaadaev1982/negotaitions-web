import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { buildE2eServerEnvironment } from "./tests/e2e/helpers/e2e-database";

const port = 3100;
const localBaseUrl = `http://127.0.0.1:${port}`;

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
    baseURL: localBaseUrl,
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
  webServer: {
    command: `npx next dev -p ${port}`,
    url: localBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: buildE2eServerEnvironment({
      APP_URL: localBaseUrl,
      BASE_URL: localBaseUrl,
      PLAYWRIGHT_BASE_URL: localBaseUrl,
      NEXT_PUBLIC_APP_URL: localBaseUrl,
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
    runtimeMode: "local-deterministic",
    baseURLSource: "playwright-local-config",
    baseURL: localBaseUrl,
  },
});
