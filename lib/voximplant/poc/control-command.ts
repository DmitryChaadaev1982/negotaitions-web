import {
  buildSignedControlHeaders,
  type PocControlAction,
} from "@/lib/voximplant/poc/control-signature";
import {
  isHttpTransportAccepted,
  type PocTransportOutcome,
} from "@/lib/voximplant/poc/control-outcomes";
import {
  POC_PROTOCOL_VERSION,
  POC_SCENARIO_KIND,
  PocSafetyError,
} from "@/lib/voximplant/poc/poc-safety";
import { fingerprintControlUrl } from "@/lib/voximplant/poc/url-fingerprint";

export type PocControlResponse = {
  ok: boolean;
  action: string;
  operationId: string | null;
  state: string | null;
  errorCode: string | null;
  scenarioKind: string | null;
  protocolVersion: number | null;
};

export type SendPocControlCommandParams = {
  controlUrl: string;
  action: PocControlAction;
  conferenceName: string;
  operationId: string;
  secret: string;
  body?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  dryRun?: boolean;
  /** Abort / network timeout in ms. */
  timeoutMs?: number;
  /**
   * When true, classify failures after a known-expired media session as
   * MEDIA_SESSION_EXPIRED instead of TRANSPORT_REJECTED.
   */
  mediaSessionExpired?: boolean;
};

export type SendPocControlCommandResult = {
  dryRun: boolean;
  controlUrlFingerprint: string;
  /** Header keys only in public logs — values may contain signatures. */
  requestHeaderKeys: string[];
  requestHeaders: Record<string, string>;
  transportOutcome: PocTransportOutcome | null;
  httpStatus: number | null;
  responseBodyPresent: boolean;
  responseJsonParsed: boolean;
  /** Optional parsed body; never required for TRANSPORT_ACCEPTED. */
  response: PocControlResponse | null;
  /** True only when a matching async callback confirms command acceptance. */
  commandConfirmed: boolean;
};

const DRY_RUN_PLACEHOLDER_SECRET = "poc-dry-run-placeholder-secret";

export function getPocControlSecret(
  env: NodeJS.ProcessEnv = process.env,
  options: { allowDryRunPlaceholder?: boolean } = {},
): string {
  const secret =
    env.VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET?.trim() ||
    env.VOXIMPLANT_POC_CONTROL_SECRET?.trim() ||
    "";
  if (secret && secret.length >= 16) return secret;
  if (options.allowDryRunPlaceholder) {
    return DRY_RUN_PLACEHOLDER_SECRET;
  }
  throw new Error(
    "Missing POC control secret. Set VOXIMPLANT_SERVER_STOP_POC_CONTROL_SECRET (min 16 chars).",
  );
}

function parseProtocolVersion(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parsePocControlResponse(payload: unknown): PocControlResponse {
  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      action: "unknown",
      operationId: null,
      state: null,
      errorCode: "invalid_response",
      scenarioKind: null,
      protocolVersion: null,
    };
  }
  const obj = payload as Record<string, unknown>;
  return {
    ok: Boolean(obj.ok),
    action: typeof obj.action === "string" ? obj.action : "unknown",
    operationId: typeof obj.operationId === "string" ? obj.operationId : null,
    state: typeof obj.state === "string" ? obj.state : null,
    errorCode: typeof obj.errorCode === "string" ? obj.errorCode : null,
    scenarioKind: typeof obj.scenarioKind === "string" ? obj.scenarioKind : null,
    protocolVersion: parseProtocolVersion(obj.protocolVersion),
  };
}

/**
 * @deprecated Synchronous HTTP response-body identity is unsupported by the
 * observed AppEvents.HttpRequest platform contract. Kept only for callback /
 * identity field helpers — do not call on control-URL HTTP responses.
 */
export function verifyPocControlScenarioIdentity(
  response: PocControlResponse,
): void {
  const kindOk = response.scenarioKind === POC_SCENARIO_KIND;
  const versionOk = response.protocolVersion === POC_PROTOCOL_VERSION;
  if (kindOk && versionOk) return;
  throw new PocSafetyError("UNEXPECTED_SCENARIO_IDENTITY", {
    selectedPocRuleId: null,
    selectedPocRuleName: null,
    productionRuleFingerprint: null,
    refusalReason:
      "Callback/identity fields are not the dedicated POC scenario. HTTP 200 alone is never sufficient.",
  });
}

function classifyTransportFailure(params: {
  mediaSessionExpired?: boolean;
  timedOut?: boolean;
}): PocTransportOutcome {
  if (params.mediaSessionExpired) return "MEDIA_SESSION_EXPIRED";
  if (params.timedOut) return "TRANSPORT_TIMEOUT";
  return "TRANSPORT_REJECTED";
}

/**
 * Send a signed control command.
 *
 * HTTP 2xx ⇒ TRANSPORT_ACCEPTED only.
 * Empty / non-JSON 2xx bodies are valid and must not yield
 * UNEXPECTED_SCENARIO_IDENTITY.
 */
export async function sendPocControlCommand(
  params: SendPocControlCommandParams,
): Promise<SendPocControlCommandResult> {
  const bodyObject = {
    action: params.action,
    conferenceName: params.conferenceName,
    operationId: params.operationId,
    ...(params.body ?? {}),
  };
  const body = JSON.stringify(bodyObject);
  const signed = buildSignedControlHeaders({
    action: params.action,
    conferenceName: params.conferenceName,
    operationId: params.operationId,
    secret: params.secret,
    body,
  });

  const controlUrlFingerprint = fingerprintControlUrl(params.controlUrl);
  const requestHeaderKeys = Object.keys(signed.headers).sort();

  if (params.dryRun) {
    return {
      dryRun: true,
      controlUrlFingerprint,
      requestHeaderKeys,
      requestHeaders: signed.headers,
      transportOutcome: null,
      response: null,
      httpStatus: null,
      responseBodyPresent: false,
      responseJsonParsed: false,
      commandConfirmed: false,
    };
  }

  if (params.mediaSessionExpired) {
    return {
      dryRun: false,
      controlUrlFingerprint,
      requestHeaderKeys,
      requestHeaders: signed.headers,
      transportOutcome: "MEDIA_SESSION_EXPIRED",
      response: null,
      httpStatus: null,
      responseBodyPresent: false,
      responseJsonParsed: false,
      commandConfirmed: false,
    };
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const timeoutMs = params.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(params.controlUrl, {
      method: "POST",
      headers: signed.headers,
      body,
      signal: controller.signal,
    });

    const rawText = await response.text();
    const responseBodyPresent = rawText.trim().length > 0;
    let parsed: PocControlResponse | null = null;
    let responseJsonParsed = false;

    if (responseBodyPresent) {
      try {
        parsed = parsePocControlResponse(JSON.parse(rawText));
        responseJsonParsed = true;
      } catch {
        // Empty/non-JSON 2xx is valid transport behavior.
        parsed = null;
        responseJsonParsed = false;
      }
    }

    const transportOutcome: PocTransportOutcome = isHttpTransportAccepted(
      response.status,
    )
      ? "TRANSPORT_ACCEPTED"
      : classifyTransportFailure({
          mediaSessionExpired: params.mediaSessionExpired,
        });

    return {
      dryRun: false,
      controlUrlFingerprint,
      requestHeaderKeys,
      requestHeaders: signed.headers,
      transportOutcome,
      response: parsed,
      httpStatus: response.status,
      responseBodyPresent,
      responseJsonParsed,
      // HTTP alone never confirms command execution.
      commandConfirmed: false,
    };
  } catch (error) {
    const timedOut =
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof Error && /timeout/i.test(error.message));
    return {
      dryRun: false,
      controlUrlFingerprint,
      requestHeaderKeys,
      requestHeaders: signed.headers,
      transportOutcome: classifyTransportFailure({
        mediaSessionExpired: params.mediaSessionExpired,
        timedOut,
      }),
      response: null,
      httpStatus: null,
      responseBodyPresent: false,
      responseJsonParsed: false,
      commandConfirmed: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function buildDeterministicStopOperationId(conferenceName: string): string {
  return `poc-stop-${conferenceName}`;
}

/** Expected ping identity for callback confirmation (must match scenario). */
export const EXPECTED_POC_PING_IDENTITY = {
  scenarioKind: POC_SCENARIO_KIND,
  protocolVersion: POC_PROTOCOL_VERSION,
} as const;
