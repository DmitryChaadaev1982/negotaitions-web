/**
 * Manual POC: StartConference → capture media session control URL into ignored local state.
 *
 * Usage:
 *   npm run poc:vox:start-conference -- --dry-run
 *   npm run poc:vox:start-conference -- --confirm-live-poc
 *
 * Live calls require --confirm-live-poc and VOXIMPLANT_SERVER_STOP_POC_RULE_ID.
 * Does not run automatically from tests.
 */

import { randomBytes } from "node:crypto";

import {
  resolvePocManagementConfig,
  sanitizePocManagementConfig,
  startConference,
} from "@/lib/voximplant/poc/management-client";
import {
  formatPocSafetyRefusal,
  POC_CONFERENCE_NAME_PREFIX,
  PocSafetyError,
} from "@/lib/voximplant/poc/poc-safety";
import {
  applyStartConferenceToState,
  createEmptyPocState,
  toPublicPocStateView,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";
import { loadPocEnvFiles } from "./load-env";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  loadPocEnvFiles();
  const dryRun = hasFlag("--dry-run");
  const confirmLivePoc = hasFlag("--confirm-live-poc");

  const config = resolvePocManagementConfig();
  console.log("[poc:vox:start-conference] config", sanitizePocManagementConfig(config));

  if (!config.ruleId) {
    console.log(
      "[poc:vox:start-conference] note",
      "VOXIMPLANT_SERVER_STOP_POC_RULE_ID is not set. Dry-run will not substitute production rule config; live calls will refuse.",
    );
  }

  const timestamp = Date.now();
  const conferenceName =
    process.env.VOXIMPLANT_SERVER_STOP_POC_CONFERENCE_NAME?.trim() ||
    `${POC_CONFERENCE_NAME_PREFIX}${timestamp}`;
  const pocId = `poc-${timestamp}-${randomBytes(3).toString("hex")}`;
  const linkedSessionId =
    process.env.VOXIMPLANT_SERVER_STOP_POC_SESSION_ID?.trim() || null;

  const scriptCustomData = JSON.stringify({
    pocId,
    conferenceName,
    purpose: "voximplant-server-stop-poc",
  });

  const result = await startConference({
    config,
    conferenceName,
    scriptCustomData,
    dryRun,
    confirmLivePoc,
  });

  console.log("[poc:vox:start-conference] request params", {
    conference_name: result.request.conference_name,
    poc_rule_id: result.missingPocRule ? "<missing-poc-rule-id>" : "configured",
    application_id: result.request.application_id ? "configured" : undefined,
    application_name: result.request.application_name ?? undefined,
    has_script_custom_data: Boolean(result.request.script_custom_data),
    dryRun: result.dryRun,
    confirmLivePoc,
    missingPocRule: result.missingPocRule,
  });

  if (dryRun) {
    console.log("[poc:vox:start-conference] dry-run ok — no provider call made");
    console.log("[poc:vox:start-conference] would use conferenceName=", conferenceName);
    if (result.missingPocRule) {
      console.log(
        "[poc:vox:start-conference] would refuse live call until VOXIMPLANT_SERVER_STOP_POC_RULE_ID is set",
      );
    }
    return;
  }

  if (!result.parsed || !result.publicResult) {
    throw new Error("StartConference returned no parsed response.");
  }

  let state = createEmptyPocState({ pocId, conferenceName, linkedSessionId });
  state = applyStartConferenceToState(state, {
    callSessionHistoryId: result.parsed.callSessionHistoryId,
    mediaSessionAccessUrl: result.parsed.mediaSessionAccessUrl,
    mediaSessionAccessSecureUrl: result.parsed.mediaSessionAccessSecureUrl,
    ruleId: result.request.rule_id,
    applicationId: result.request.application_id ?? config.applicationId,
  });
  writePocState(state);

  console.log("[poc:vox:start-conference] result", result.publicResult);
  console.log("[poc:vox:start-conference] state", toPublicPocStateView(state));

  if (result.publicResult.classification !== "success") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  // Never serialize full request/response objects — sanitized refusal only.
  if (error instanceof PocSafetyError) {
    console.error("[poc:vox:start-conference] refused", formatPocSafetyRefusal(error));
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[poc:vox:start-conference] error", message);
  }
  process.exitCode = 1;
});
