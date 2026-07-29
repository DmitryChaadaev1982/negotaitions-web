#!/usr/bin/env node

import { Stage310FocusedError, runStage310Focused } from "./agent-tooling/run-stage310-focused-lib.mjs";

function printSelection(result) {
  console.log(`Selected Playwright mode: ${result.mode}`);
  console.log("Selected unit tests:");
  for (const file of result.selectedUnitTests) {
    console.log(`- ${file}`);
  }
  if (result.missingUnitCandidates.length > 0) {
    console.log("Absent optional unit candidates:");
    for (const file of result.missingUnitCandidates) {
      console.log(`- ${file}`);
    }
  }
  console.log("Selected E2E tests:");
  for (const file of result.selectedE2eTests) {
    console.log(`- ${file}`);
  }
  if (result.missingE2eCandidates.length > 0) {
    console.log("Absent optional E2E candidates:");
    for (const file of result.missingE2eCandidates) {
      console.log(`- ${file}`);
    }
  }
}

async function main() {
  const result = await runStage310Focused(process.argv.slice(2));
  printSelection(result);
  if (result.stdout?.trim()) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr?.trim()) {
    process.stderr.write(result.stderr);
  }
  if (result.dryRun) {
    console.log("Dry run completed.");
    return;
  }
  if ((result.exitCode ?? 0) !== 0) {
    console.error(`Stage 3.10 focused failed in phase "${result.phase}".`);
    process.exitCode = result.exitCode;
  }
}

main().catch((error) => {
  if (error instanceof Stage310FocusedError) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[stage310-focused-error] ${message}`);
  process.exitCode = 1;
});
