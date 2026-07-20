/**
 * Bounded automated Voximplant server-stop POC orchestrator.
 *
 * Usage:
 *   npm run poc:vox:run -- --dry-run
 *   npm run poc:vox:run -- --mode=transport --confirm-live-poc
 *   npm run poc:vox:run -- --mode=full --confirm-live-poc --confirm-local-db-write
 */

import { parsePocOrchestratorArgs } from "@/lib/voximplant/poc/orchestrator/cli-args";
import {
  buildDryRunPlan,
  printHumanReport,
  runPocOrchestrator,
} from "@/lib/voximplant/poc/orchestrator/run-orchestrator";
import { loadPocEnvFiles } from "./load-env";

async function main(): Promise<void> {
  loadPocEnvFiles();
  const options = parsePocOrchestratorArgs();

  if (options.dryRun) {
    const plan = buildDryRunPlan(options);
    console.log("[poc:vox:run] dry-run plan", plan);
    console.log("[poc:vox:run] dry-run ok — no DB write, no provider call, no browser");
    const report = await runPocOrchestrator(options);
    printHumanReport(report, options.stateRoot);
    return;
  }

  const report = await runPocOrchestrator(options);
  printHumanReport(report, options.stateRoot);

  if (report.result !== "PASS" && report.result !== "DRY_RUN_PASS") {
    console.log("[poc:vox:run] cleanup hint", {
      command: `npm run poc:vox:cleanup -- --run-id ${report.runId} --confirm-cleanup --confirm-local-db-write`,
      keepSession: options.keepSession,
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[poc:vox:run] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
