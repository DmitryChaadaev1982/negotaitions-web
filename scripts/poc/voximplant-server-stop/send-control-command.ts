/**
 * Manual POC: send signed HTTP control commands to media_session_access_url.
 *
 * Usage:
 *   npm run poc:vox:ping
 *   npm run poc:vox:stop-recording
 *   npm run poc:vox:ping -- --dry-run
 */

import {
  buildDeterministicStopOperationId,
  getPocControlSecret,
  sendPocControlCommand,
} from "@/lib/voximplant/poc/control-command";
import type { PocControlAction } from "@/lib/voximplant/poc/control-signature";
import {
  formatPocSafetyRefusal,
  PocSafetyError,
} from "@/lib/voximplant/poc/poc-safety";
import {
  getActiveControlUrl,
  readPocState,
  toPublicPocStateView,
  writePocState,
} from "@/lib/voximplant/poc/poc-state";
import { loadPocEnvFiles } from "./load-env";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function resolveAction(): PocControlAction {
  const fromArg = process.argv.find((arg) => arg.startsWith("--action="));
  if (fromArg) {
    const value = fromArg.slice("--action=".length);
    if (
      value === "ping" ||
      value === "get_recording_state" ||
      value === "stop_recording"
    ) {
      return value;
    }
    throw new Error(`Unsupported action: ${value}`);
  }

  const script = process.argv[1] ?? "";
  if (script.includes("ping")) return "ping";
  if (script.includes("stop")) return "stop_recording";
  if (script.includes("status") || script.includes("get_recording")) {
    return "get_recording_state";
  }

  const positional = process.argv[2];
  if (
    positional === "ping" ||
    positional === "get_recording_state" ||
    positional === "stop_recording"
  ) {
    return positional;
  }

  throw new Error(
    "Specify action via npm script, --action=, or positional argument.",
  );
}

async function main(): Promise<void> {
  loadPocEnvFiles();
  const dryRun = hasFlag("--dry-run");
  const action = resolveAction();

  const state = readPocState();
  const secret = getPocControlSecret(process.env, {
    allowDryRunPlaceholder: dryRun,
  });

  if (dryRun && !state) {
    const conferenceName = "neg-poc-server-stop-dry-run";
    const operationId =
      action === "stop_recording"
        ? buildDeterministicStopOperationId(conferenceName)
        : `poc-${action}-dry-run`;
    const result = await sendPocControlCommand({
      controlUrl: "https://example.invalid/session/dry-run-control-url",
      action,
      conferenceName,
      operationId,
      secret,
      dryRun: true,
    });
    console.log("[poc:vox:control] dry-run request construction", {
      action,
      operationId,
      conferenceName,
      controlUrlFingerprint: result.controlUrlFingerprint,
      headerKeys: Object.keys(result.requestHeaders).sort(),
      expectedScenarioKind: "voximplant_server_stop_poc",
      expectedProtocolVersion: 1,
      controlSecretConfigured: Boolean(
        process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET?.trim() ||
          process.env.VOXIMPLANT_POC_CONTROL_SECRET?.trim(),
      ),
    });
    console.log("[poc:vox:control] dry-run ok — no provider call made");
    return;
  }

  if (!state) {
    throw new Error(
      "POC state missing. Run npm run poc:vox:start-conference -- --confirm-live-poc first.",
    );
  }

  const controlUrl = getActiveControlUrl(state);
  if (!controlUrl) {
    throw new Error("POC state has no control URL. Re-run start-conference.");
  }

  const operationId =
    action === "stop_recording"
      ? buildDeterministicStopOperationId(state.conferenceName)
      : `poc-${action}-${Date.now()}`;

  const result = await sendPocControlCommand({
    controlUrl,
    action,
    conferenceName: state.conferenceName,
    operationId,
    secret,
    dryRun,
    requirePocScenarioIdentity: action === "ping",
  });

  console.log("[poc:vox:control] sent", {
    action,
    operationId,
    conferenceName: state.conferenceName,
    controlUrlFingerprint: result.controlUrlFingerprint,
    dryRun: result.dryRun,
    httpStatus: result.httpStatus,
  });

  if (dryRun) {
    console.log("[poc:vox:control] dry-run ok — no provider call made");
    return;
  }

  // Print only sanitized response fields — never the full request/response object.
  console.log("[poc:vox:control] response", {
    ok: result.response?.ok ?? null,
    action: result.response?.action ?? null,
    operationId: result.response?.operationId ?? null,
    state: result.response?.state ?? null,
    errorCode: result.response?.errorCode ?? null,
    scenarioKind: result.response?.scenarioKind ?? null,
    protocolVersion: result.response?.protocolVersion ?? null,
  });

  state.lastCommand = {
    action,
    ok: Boolean(result.response?.ok),
    operationId: result.response?.operationId ?? operationId,
    state: result.response?.state ?? null,
    errorCode: result.response?.errorCode ?? null,
    at: new Date().toISOString(),
  };
  state.updatedAt = new Date().toISOString();
  writePocState(state);
  console.log("[poc:vox:control] state", toPublicPocStateView(state));

  if (!result.response?.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  if (error instanceof PocSafetyError) {
    console.error("[poc:vox:control] refused", formatPocSafetyRefusal(error));
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[poc:vox:control] error", message);
  }
  process.exitCode = 1;
});
