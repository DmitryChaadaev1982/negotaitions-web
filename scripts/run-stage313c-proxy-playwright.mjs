#!/usr/bin/env node

import { PlaywrightModeError, runPlaywrightInMode } from "./agent-tooling/run-playwright-mode-lib.mjs";

async function main() {
  process.env.PLAYWRIGHT_EMAIL_ADMIN_TEST_ENABLED = "false";
  process.env.PLAYWRIGHT_EMAIL_LOCAL_PREVIEW_ENABLED = "false";
  process.env.PLAYWRIGHT_TRUSTED_PROXY_ENABLED = "false";
  process.env.EMAIL_ADMIN_TEST_ENABLED = "false";
  process.env.EMAIL_LOCAL_PREVIEW_ENABLED = "false";
  process.env.TRUSTED_PROXY_ENABLED = "false";

  const result = await runPlaywrightInMode([
    "--mode=managed",
    "--",
    "tests/e2e/stage-3-13c-proxy-and-email-journal.spec.ts",
    "tests/e2e/stage-3-13c-login-logout.spec.ts",
    "--project=chromium",
  ]);

  if (result.skippedExecution) {
    console.log(
      JSON.stringify(
        {
          mode: result.mode,
          command: result.command,
          args: result.args,
          environment: result.environment,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (result.stdout?.trim()) process.stdout.write(result.stdout);
  if (result.stderr?.trim()) process.stderr.write(result.stderr);
  if ((result.exitCode ?? 0) !== 0) process.exitCode = result.exitCode;
}

main().catch((error) => {
  if (error instanceof PlaywrightModeError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[run-stage313c-proxy-playwright-error] ${message}`);
  process.exitCode = 1;
});
