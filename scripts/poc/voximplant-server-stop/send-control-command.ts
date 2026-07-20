/**
 * Manual POC: send signed HTTP control commands to media_session_access_url.
 *
 * Usage:
 *   npm run poc:vox:ping
 *   npm run poc:vox:ping -- --no-wait
 *   npm run poc:vox:stop-recording
 *   npm run poc:vox:ping -- --dry-run
 */

import { buildDryRunPocCallback } from "@/lib/voximplant/poc/callback-handler";
import {
  buildDeterministicStopOperationId,
  getPocControlSecret,
  sendPocControlCommand,
} from "@/lib/voximplant/poc/control-command";
import type { PocControlAction } from "@/lib/voximplant/poc/control-signature";
import { sanitizePocDiagnosticLog } from "@/lib/voximplant/poc/log-sanitize";
import { executePocPing } from "@/lib/voximplant/poc/ping-command";
import {
  formatPocSafetyRefusal,
  PocSafetyError,
} from "@/lib/voximplant/poc/poc-safety";
import {
  getActiveControlUrl,
  markPocStateExpired,
  readPocState,
  recordStopTransportAccepted,
  resolveRuntimeStatus,
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
  const noWait = hasFlag("--no-wait");
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
    const callbackDryRun = buildDryRunPocCallback({
      eventType: "command_accepted",
      action,
      operationId,
      conferenceName,
      recorderState: "absent",
    });
    console.log(
      "[poc:vox:control] dry-run request construction",
      sanitizePocDiagnosticLog({
        action,
        operationId,
        conferenceName,
        controlUrlFingerprint: result.controlUrlFingerprint,
        headerKeys: result.requestHeaderKeys,
        transportSemantics: "HTTP_2xx_means_TRANSPORT_ACCEPTED_only",
        controlSecretConfigured: Boolean(
          process.env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET?.trim() ||
            process.env.VOXIMPLANT_POC_CONTROL_SECRET?.trim(),
        ),
        callbackSecretConfigured: Boolean(
          process.env.VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET?.trim(),
        ),
        callbackDryRun: {
          eventType: callbackDryRun.payload.eventType,
          headerKeys: callbackDryRun.headerKeys,
          bodyLength: callbackDryRun.bodyLength,
          signatureFingerprint: callbackDryRun.signatureFingerprint,
        },
      }),
    );
    console.log("[poc:vox:control] dry-run ok — no provider call made");
    return;
  }

  if (!state) {
    throw new Error(
      "POC state missing. Run npm run poc:vox:start-conference -- --confirm-live-poc first.",
    );
  }

  const runtimeStatus = resolveRuntimeStatus(state);
  if (!dryRun && runtimeStatus === "EXPIRED") {
    writePocState(markPocStateExpired(state));
    console.error(
      "[poc:vox:control] MEDIA_SESSION_EXPIRED — idle POC session ended (~60s without WebSDK). Require a fresh StartConference; do not reuse the control URL.",
      toPublicPocStateView(markPocStateExpired(state)),
    );
    process.exitCode = 1;
    return;
  }

  const controlUrl = getActiveControlUrl(state);
  if (!controlUrl) {
    throw new Error(
      "POC state has no control URL (private control state missing or run terminal). Re-run start-conference.",
    );
  }

  if (action === "ping") {
    const operationId = `poc-ping-${Date.now()}`;
    const ping = await executePocPing({
      operationId,
      conferenceName: state.conferenceName,
      controlUrl,
      secret,
      dryRun,
      noWait,
      state,
    });

    const callbackDryRun = dryRun
      ? buildDryRunPocCallback({
          eventType: "command_accepted",
          action: "ping",
          operationId,
          conferenceName: state.conferenceName,
          recorderState: "absent",
        })
      : null;

    console.log(
      "[poc:vox:control] ping",
      sanitizePocDiagnosticLog({
        operationId,
        conferenceName: state.conferenceName,
        controlUrlFingerprint: ping.transport.controlUrlFingerprint,
        dryRun: ping.dryRun,
        nonTerminal: ping.nonTerminal,
        transportOutcome: ping.transport.transportOutcome,
        httpStatus: ping.transport.httpStatus,
        responseBodyPresent: ping.transport.responseBodyPresent,
        responseJsonParsed: ping.transport.responseJsonParsed,
        commandConfirmed: ping.transport.commandConfirmed,
        pingOutcome: ping.pingOutcome,
        runtimeStatus: ping.runtimeStatus ?? runtimeStatus,
        callbackDryRun: callbackDryRun
          ? {
              eventType: callbackDryRun.payload.eventType,
              headerKeys: callbackDryRun.headerKeys,
              bodyLength: callbackDryRun.bodyLength,
              signatureFingerprint: callbackDryRun.signatureFingerprint,
            }
          : undefined,
        note:
          ping.pingOutcome === "PING_TRANSPORT_ONLY"
            ? "TRANSPORT_ONLY (--no-wait): not command success; not Checkpoint A confirmation"
            : undefined,
      }),
    );

    if (!dryRun) {
      const latest = readPocState() ?? state;
      latest.lastCommand = {
        action: "ping",
        ok: ping.pingOutcome === "PING_COMMAND_CONFIRMED",
        operationId,
        state: null,
        errorCode:
          ping.pingOutcome === "PING_COMMAND_CONFIRMED"
            ? null
            : ping.pingOutcome,
        transportOutcome: ping.transport.transportOutcome,
        at: new Date().toISOString(),
      };
      latest.updatedAt = new Date().toISOString();
      writePocState(latest);
      console.log("[poc:vox:control] state", toPublicPocStateView(latest));
    }

    if (dryRun) {
      console.log("[poc:vox:control] dry-run ok — no provider call made");
      return;
    }

    if (ping.pingOutcome !== "PING_COMMAND_CONFIRMED") {
      process.exitCode = 1;
    }
    return;
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
  });

  console.log(
    "[poc:vox:control] sent",
    sanitizePocDiagnosticLog({
      action,
      operationId,
      conferenceName: state.conferenceName,
      controlUrlFingerprint: result.controlUrlFingerprint,
      dryRun: result.dryRun,
      transportOutcome: result.transportOutcome,
      httpStatus: result.httpStatus,
      responseBodyPresent: result.responseBodyPresent,
      commandConfirmed: result.commandConfirmed,
      note: "HTTP 2xx is TRANSPORT_ACCEPTED only; await signed callback for command/terminal evidence",
    }),
  );

  if (dryRun) {
    console.log("[poc:vox:control] dry-run ok — no provider call made");
    return;
  }

  let next = state;
  next.lastCommand = {
    action,
    ok: result.transportOutcome === "TRANSPORT_ACCEPTED",
    operationId,
    state: result.response?.state ?? null,
    errorCode: result.response?.errorCode ?? null,
    transportOutcome: result.transportOutcome,
    at: new Date().toISOString(),
  };
  if (
    action === "stop_recording" &&
    result.transportOutcome === "TRANSPORT_ACCEPTED"
  ) {
    next = recordStopTransportAccepted(next, operationId);
  }
  if (result.transportOutcome === "MEDIA_SESSION_EXPIRED") {
    next = markPocStateExpired(next);
  }
  next.updatedAt = new Date().toISOString();
  writePocState(next);
  console.log("[poc:vox:control] state", toPublicPocStateView(next));

  if (result.transportOutcome !== "TRANSPORT_ACCEPTED") {
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
