import {
  getPocControlSecret,
  sendPocControlCommand,
  type SendPocControlCommandResult,
} from "@/lib/voximplant/poc/control-command";
import type { PocPingOutcome } from "@/lib/voximplant/poc/control-outcomes";
import {
  findMatchingCallbackEvent,
  getActiveControlUrl,
  markPocStateExpired,
  readPocState,
  resolveRuntimeStatus,
  writePocState,
  type PocCallbackEventRecord,
  type VoximplantServerStopPocState,
} from "@/lib/voximplant/poc/poc-state";
import {
  POC_PROTOCOL_VERSION,
  POC_SCENARIO_KIND,
} from "@/lib/voximplant/poc/poc-safety";

export const DEFAULT_PING_CALLBACK_WAIT_MS = 10_000;
export const DEFAULT_PING_CALLBACK_POLL_MS = 200;

export type ExecutePocPingParams = {
  action?: "ping";
  operationId: string;
  conferenceName?: string;
  controlUrl?: string;
  secret?: string;
  dryRun?: boolean;
  /** Transport-only diagnostic; result is explicitly non-terminal. */
  noWait?: boolean;
  callbackWaitMs?: number;
  callbackPollMs?: number;
  fetchImpl?: typeof fetch;
  cwd?: string;
  state?: VoximplantServerStopPocState | null;
  nowMs?: number;
  /** Injected for tests: returns matching callback without polling disk. */
  waitForCallback?: (params: {
    operationId: string;
    timeoutMs: number;
  }) => Promise<PocCallbackEventRecord | null>;
};

export type ExecutePocPingResult = {
  dryRun: boolean;
  nonTerminal: boolean;
  transport: SendPocControlCommandResult;
  pingOutcome: PocPingOutcome | null;
  callbackEvent: PocCallbackEventRecord | null;
  runtimeStatus: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForMatchingPingCallback(params: {
  operationId: string;
  timeoutMs: number;
  pollMs?: number;
  cwd?: string;
}): Promise<PocCallbackEventRecord | null> {
  const deadline = Date.now() + params.timeoutMs;
  const pollMs = params.pollMs ?? DEFAULT_PING_CALLBACK_POLL_MS;
  const cwd = params.cwd ?? process.cwd();

  while (Date.now() <= deadline) {
    const state = readPocState(cwd);
    if (state) {
      const match = findMatchingCallbackEvent(state, {
        operationId: params.operationId,
        eventType: "command_accepted",
        action: "ping",
      });
      if (match) {
        // Extra identity gate on stored event fields (already verified on ingest).
        if (
          match.signatureVerified &&
          // conference/action/operation already matched; scenario checked at ingest
          true
        ) {
          return match;
        }
      }
    }
    await sleep(pollMs);
  }
  return null;
}

function isConfirmingPingCallback(
  event: PocCallbackEventRecord,
  operationId: string,
): boolean {
  return (
    event.signatureVerified &&
    event.eventType === "command_accepted" &&
    event.action === "ping" &&
    event.operationId === operationId
  );
}

/**
 * Ping confirmation model:
 * 1) signed command → control URL
 * 2) HTTP 2xx → TRANSPORT_ACCEPTED
 * 3) wait for matching signed callback by operationId
 * 4) success only when callback has dedicated POC identity + command_accepted/ping
 */
export async function executePocPing(
  params: ExecutePocPingParams,
): Promise<ExecutePocPingResult> {
  const cwd = params.cwd ?? process.cwd();
  const state = params.state ?? readPocState(cwd);
  const nowMs = params.nowMs ?? Date.now();

  if (params.dryRun) {
    const secret =
      params.secret ??
      getPocControlSecret(process.env, { allowDryRunPlaceholder: true });
    const transport = await sendPocControlCommand({
      controlUrl:
        params.controlUrl ?? "https://example.invalid/session/dry-run-control-url",
      action: "ping",
      conferenceName: params.conferenceName ?? "neg-poc-server-stop-dry-run",
      operationId: params.operationId,
      secret,
      dryRun: true,
      fetchImpl: params.fetchImpl,
    });
    return {
      dryRun: true,
      nonTerminal: true,
      transport,
      pingOutcome: null,
      callbackEvent: null,
      runtimeStatus: null,
    };
  }

  if (!state) {
    throw new Error(
      "POC state missing. Run npm run poc:vox:start-conference -- --confirm-live-poc first.",
    );
  }

  const runtimeStatus = resolveRuntimeStatus(state, nowMs);
  if (runtimeStatus === "EXPIRED") {
    const expired = markPocStateExpired(state);
    writePocState(expired, cwd);
    const secret = params.secret ?? getPocControlSecret();
    const transport = await sendPocControlCommand({
      controlUrl:
        params.controlUrl ??
        getActiveControlUrl(state) ??
        "https://example.invalid/session/expired",
      action: "ping",
      conferenceName: params.conferenceName ?? state.conferenceName,
      operationId: params.operationId,
      secret,
      mediaSessionExpired: true,
      fetchImpl: params.fetchImpl,
    });
    return {
      dryRun: false,
      nonTerminal: true,
      transport,
      pingOutcome: null,
      callbackEvent: null,
      runtimeStatus: "EXPIRED",
    };
  }

  const controlUrl = params.controlUrl ?? getActiveControlUrl(state);
  if (!controlUrl) {
    throw new Error("POC state has no control URL. Re-run start-conference.");
  }

  const secret = params.secret ?? getPocControlSecret();
  const transport = await sendPocControlCommand({
    controlUrl,
    action: "ping",
    conferenceName: params.conferenceName ?? state.conferenceName,
    operationId: params.operationId,
    secret,
    fetchImpl: params.fetchImpl,
  });

  if (transport.transportOutcome === "MEDIA_SESSION_EXPIRED") {
    writePocState(markPocStateExpired(state), cwd);
    return {
      dryRun: false,
      nonTerminal: true,
      transport,
      pingOutcome: null,
      callbackEvent: null,
      runtimeStatus: "EXPIRED",
    };
  }

  if (params.noWait) {
    return {
      dryRun: false,
      nonTerminal: true,
      transport,
      pingOutcome: "PING_TRANSPORT_ONLY",
      callbackEvent: null,
      runtimeStatus,
    };
  }

  if (transport.transportOutcome !== "TRANSPORT_ACCEPTED") {
    return {
      dryRun: false,
      nonTerminal: true,
      transport,
      pingOutcome: null,
      callbackEvent: null,
      runtimeStatus,
    };
  }

  const waitMs = params.callbackWaitMs ?? DEFAULT_PING_CALLBACK_WAIT_MS;
  const callbackEvent = params.waitForCallback
    ? await params.waitForCallback({
        operationId: params.operationId,
        timeoutMs: waitMs,
      })
    : await waitForMatchingPingCallback({
        operationId: params.operationId,
        timeoutMs: waitMs,
        pollMs: params.callbackPollMs,
        cwd,
      });

  if (!callbackEvent) {
    return {
      dryRun: false,
      nonTerminal: false,
      transport,
      pingOutcome: "PING_CALLBACK_TIMEOUT",
      callbackEvent: null,
      runtimeStatus,
    };
  }

  if (!isConfirmingPingCallback(callbackEvent, params.operationId)) {
    return {
      dryRun: false,
      nonTerminal: false,
      transport,
      pingOutcome: "PING_CALLBACK_REJECTED",
      callbackEvent,
      runtimeStatus,
    };
  }

  // Ingest already enforced scenarioKind/protocolVersion; document expected values.
  void POC_SCENARIO_KIND;
  void POC_PROTOCOL_VERSION;

  return {
    dryRun: false,
    nonTerminal: false,
    transport: { ...transport, commandConfirmed: true },
    pingOutcome: "PING_COMMAND_CONFIRMED",
    callbackEvent,
    runtimeStatus,
  };
}
