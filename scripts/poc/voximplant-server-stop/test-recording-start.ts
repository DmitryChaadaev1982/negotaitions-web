/**
 * Provider-free recording-start plan validation.
 *
 * Usage:
 *   npm run poc:vox:test-recording-start -- --create-fixture --confirm-local-db-write
 *
 * Requires the Next.js app running at appBaseUrl (real /recording-control route).
 * Makes zero Voximplant provider calls.
 */

import { loadPocEnvFiles } from "./load-env";

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

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
  const createFixture = hasFlag(argv, "--create-fixture");
  const confirmLocalDbWrite = hasFlag(argv, "--confirm-local-db-write");

  if (!createFixture) {
    console.error(
      "[poc:vox:test-recording-start] require --create-fixture --confirm-local-db-write",
    );
    process.exitCode = 1;
    return;
  }

  const appBaseUrl =
    readArg(argv, "--app-base-url") ||
    process.env.POC_APP_BASE_URL?.trim() ||
    "http://localhost:3000";

  if (!process.env.VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC) {
    process.env.VOXIMPLANT_SERVER_STARTED_CONFERENCE_POC = "true";
  }

  const {
    printProviderFreeRecordingStartResult,
    runProviderFreeRecordingStartTest,
  } = await import("@/lib/voximplant/poc/orchestrator/recording-start");

  const result = await runProviderFreeRecordingStartTest({
    confirmLocalDbWrite,
    appBaseUrl,
  });
  printProviderFreeRecordingStartResult(result);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[poc:vox:test-recording-start] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
