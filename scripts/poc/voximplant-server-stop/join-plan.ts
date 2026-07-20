/**
 * Local POC WebSDK join-plan diagnostic (no provider calls).
 *
 * Usage:
 *   npm run poc:vox:join-plan -- --session-id <sessionId>
 *   npm run poc:vox:join-plan   # uses active run linkedSessionId
 */

import { planPocConferenceJoin } from "@/lib/voximplant/poc/conference-join-flag";
import { getPocStatePath } from "@/lib/voximplant/poc/poc-paths";
import { readCurrentPointer } from "@/lib/voximplant/poc/poc-run-store";
import { loadPocEnvFiles } from "./load-env";

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]!;
  const pref = `${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : null;
}

function main(): void {
  loadPocEnvFiles();

  const pointer = readCurrentPointer();
  const sessionId =
    readArg("--session-id") ||
    pointer?.linkedSessionId ||
    "";

  if (!sessionId) {
    console.error(
      "[poc:vox:join-plan] missing --session-id (and no active run linkedSessionId)",
    );
    process.exitCode = 1;
    return;
  }

  const plan = planPocConferenceJoin({ sessionId });

  // Never print control URL.
  console.log("[poc:vox:join-plan]", {
    featureFlagEnabled: plan.featureFlagEnabled,
    activeRunId: plan.activeRunId,
    requestedSessionId: plan.requestedSessionId,
    sessionIdMatch: plan.sessionIdMatch,
    pocStateFound: plan.pocStateFound,
    stateLinkedSessionId: plan.stateLinkedSessionId,
    stateConferenceName: plan.stateConferenceName,
    runtimeStatus: plan.runtimeStatus,
    expiresAt: plan.expiresAt,
    selectedConferenceName: plan.selectedConferenceName,
    selectionSource: plan.selectionSource,
    refusalOrFallbackReason: plan.refusalOrFallbackReason,
    wouldSelectIfActive: plan.wouldSelectIfActive,
    statePath: getPocStatePath(),
  });
}

main();
