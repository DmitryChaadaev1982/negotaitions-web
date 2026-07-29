#!/usr/bin/env node

import {
  checkBaseline,
  clearBaseline,
  formatShowOutput,
  recordBaseline,
  showBaseline,
} from "./agent-tooling/agent-validation-baseline-lib.mjs";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || !["show", "check", "record", "clear"].includes(command)) {
    console.error("Usage: node scripts/agent-validation-baseline.mjs <show|check|record|clear> [flags]");
    process.exitCode = 1;
    return;
  }

  if (command === "show") {
    const result = await showBaseline(process.cwd());
    console.log(formatShowOutput(result));
    return;
  }

  if (command === "check") {
    const result = await checkBaseline(process.cwd());
    console.log(formatShowOutput(result));
    process.exitCode = result.exitCode;
    return;
  }

  if (command === "record") {
    const result = await recordBaseline(process.cwd(), rest);
    console.log(`Baseline recorded at ${result.baselinePath}`);
    return;
  }

  const result = await clearBaseline(process.cwd());
  console.log(`${result.removed ? "Removed" : "No baseline found at"} ${result.baselinePath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-baseline-error] ${message}`);
  process.exitCode = 1;
});
