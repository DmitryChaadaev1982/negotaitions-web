/**
 * Prewarm-only browser auth validation against an existing POC run.
 *
 * Usage:
 *   npm run poc:vox:test-browser-prewarm -- --run-id run-1784566540484-2a36e7
 *
 * No StartConference / provider calls. No POC Session fixture creation.
 */

import {
  printTestBrowserPrewarmResult,
  runTestBrowserPrewarm,
} from "@/lib/voximplant/poc/orchestrator/test-browser-prewarm";

import { loadPocEnvFiles } from "./load-env";

function readArg(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!;
  const pref = `${name}=`;
  const hit = argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

async function main(): Promise<void> {
  loadPocEnvFiles();
  const argv = process.argv.slice(2);
  const runId = readArg(argv, "--run-id");
  if (!runId) {
    console.error("[poc:vox:test-browser-prewarm] --run-id is required");
    process.exitCode = 1;
    return;
  }

  const appBaseUrl =
    readArg(argv, "--app-base-url") ||
    process.env.POC_APP_BASE_URL?.trim() ||
    "http://localhost:3000";

  const result = await runTestBrowserPrewarm({
    runId,
    appBaseUrl,
  });
  printTestBrowserPrewarmResult(result);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[poc:vox:test-browser-prewarm] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
