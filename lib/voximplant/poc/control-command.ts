import {
  buildSignedControlHeaders,
  type PocControlAction,
} from "@/lib/voximplant/poc/control-signature";
import {
  assertPocScenarioIdentity,
  POC_PROTOCOL_VERSION,
  POC_SCENARIO_KIND,
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
  /** When true (default for action=ping), verify dedicated POC scenario identity. */
  requirePocScenarioIdentity?: boolean;
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
    // Dry-run only: construct signed headers without requiring a live secret.
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
 * Verify ping (or other) response carries dedicated POC scenario identity.
 * A generic HTTP 200 without these fields is rejected.
 */
export function verifyPocControlScenarioIdentity(
  response: PocControlResponse,
): void {
  assertPocScenarioIdentity({
    scenarioKind: response.scenarioKind,
    protocolVersion: response.protocolVersion,
  });
}

export async function sendPocControlCommand(
  params: SendPocControlCommandParams,
): Promise<{
  dryRun: boolean;
  controlUrlFingerprint: string;
  requestHeaders: Record<string, string>;
  response: PocControlResponse | null;
  httpStatus: number | null;
}> {
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

  if (params.dryRun) {
    return {
      dryRun: true,
      controlUrlFingerprint,
      requestHeaders: {
        ...signed.headers,
        // Keep signature present but do not imply a network call occurred.
      },
      response: null,
      httpStatus: null,
    };
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const response = await fetchImpl(params.controlUrl, {
    method: "POST",
    headers: signed.headers,
    body,
  });

  let parsed: PocControlResponse | null = null;
  try {
    parsed = parsePocControlResponse(await response.json());
  } catch {
    parsed = {
      ok: false,
      action: params.action,
      operationId: params.operationId,
      state: null,
      errorCode: "invalid_json_response",
      scenarioKind: null,
      protocolVersion: null,
    };
  }

  const requireIdentity =
    params.requirePocScenarioIdentity ?? params.action === "ping";
  if (requireIdentity && parsed) {
    verifyPocControlScenarioIdentity(parsed);
  }

  return {
    dryRun: false,
    controlUrlFingerprint,
    requestHeaders: signed.headers,
    response: parsed,
    httpStatus: response.status,
  };
}

export function buildDeterministicStopOperationId(conferenceName: string): string {
  return `poc-stop-${conferenceName}`;
}

/** Expected ping identity for docs/tests (must match scenario constants). */
export const EXPECTED_POC_PING_IDENTITY = {
  scenarioKind: POC_SCENARIO_KIND,
  protocolVersion: POC_PROTOCOL_VERSION,
} as const;
