/**
 * Provider-free participant access validation.
 *
 * Usage:
 *   npm run poc:vox:test-participant-access -- --run-id run-1784567966900-bd1a60
 *   npm run poc:vox:test-participant-access -- --create-fixture --confirm-local-db-write
 */

import {
  printTestParticipantAccessResult,
  runCreateFixtureParticipantAccess,
  runTestParticipantAccess,
} from "@/lib/voximplant/poc/orchestrator/test-participant-access";

import { loadPocEnvFiles } from "./load-env";

function readArg(argv: string[], name: string): string | null {
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]!;
  const pref = `${name}=`;
  const hit = argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

async function main(): Promise<void> {
  loadPocEnvFiles();
  const argv = process.argv.slice(2);
  const createFixture = hasFlag(argv, "--create-fixture");
  const confirmLocalDbWrite = hasFlag(argv, "--confirm-local-db-write");
  const runId = readArg(argv, "--run-id");

  const appBaseUrl =
    readArg(argv, "--app-base-url") ||
    process.env.POC_APP_BASE_URL?.trim() ||
    "http://localhost:3000";

  if (createFixture) {
    if (runId) {
      console.error(
        "[poc:vox:test-participant-access] --create-fixture cannot be combined with --run-id",
      );
      process.exitCode = 1;
      return;
    }
    const result = await runCreateFixtureParticipantAccess({
      confirmLocalDbWrite,
      appBaseUrl,
    });
    printTestParticipantAccessResult(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (!runId) {
    console.error(
      "[poc:vox:test-participant-access] require --run-id <id> or --create-fixture --confirm-local-db-write",
    );
    process.exitCode = 1;
    return;
  }

  const result = await runTestParticipantAccess({ runId, appBaseUrl });
  printTestParticipantAccessResult(result);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[poc:vox:test-participant-access] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
