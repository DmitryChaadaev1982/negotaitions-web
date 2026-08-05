#!/usr/bin/env node

import { runValidateAgent } from "./agent-tooling/validate-agent-lib.mjs";

async function main() {
  const result = await runValidateAgent(process.argv.slice(2));
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[validate-agent-error] ${message}`);
  process.exitCode = 1;
});
