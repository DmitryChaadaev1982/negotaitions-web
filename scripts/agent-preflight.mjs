#!/usr/bin/env node

import { collectPreflightSnapshot, formatPreflightReport, writePreflightSnapshot } from "./agent-tooling/agent-preflight-lib.mjs";
import { loadRepositoryEnv } from "./agent-tooling/common.mjs";

async function main() {
  loadRepositoryEnv(process.cwd());
  const jsonOnly = process.argv.slice(2).includes("--json");
  const snapshot = await collectPreflightSnapshot();
  await writePreflightSnapshot(snapshot, snapshot.repositoryRoot);
  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${formatPreflightReport(snapshot)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[agent-preflight-error] ${message}`);
  process.exitCode = 1;
});
