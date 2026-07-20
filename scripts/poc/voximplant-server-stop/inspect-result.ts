/**
 * Manual POC: inspect sanitized local state / clear state.
 *
 * Usage:
 *   npm run poc:vox:status
 *   npm run poc:vox:clear-state
 */

import {
  clearPocState,
  getPocStatePath,
  readPocState,
  toPublicPocStateView,
} from "@/lib/voximplant/poc/poc-state";
import { loadPocEnvFiles } from "./load-env";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function main(): void {
  loadPocEnvFiles();

  const clear = hasFlag("--clear") || (process.argv[1] ?? "").includes("clear-state");
  if (clear) {
    const removed = clearPocState();
    console.log("[poc:vox:status] clear", {
      removed,
      path: getPocStatePath(),
    });
    return;
  }

  const state = readPocState();
  if (!state) {
    console.log("[poc:vox:status] no POC state file", { path: getPocStatePath() });
    process.exitCode = 1;
    return;
  }

  console.log("[poc:vox:status]", toPublicPocStateView(state));
}

main();
