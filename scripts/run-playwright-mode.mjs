#!/usr/bin/env node

import { PlaywrightModeError, runPlaywrightInMode } from "./agent-tooling/run-playwright-mode-lib.mjs";

async function main() {
  const result = await runPlaywrightInMode(process.argv.slice(2));
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

  if ((result.exitCode ?? 0) !== 0) {
    process.exitCode = result.exitCode;
  }
}

main().catch((error) => {
  if (error instanceof PlaywrightModeError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[run-playwright-mode-error] ${message}`);
  process.exitCode = 1;
});
