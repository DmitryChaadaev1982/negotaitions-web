import {
  buildSignedCallbackRequest,
  getPocCallbackSecret,
  hashCallbackBody,
  isPocCallbackEnabled,
  isPocCallbackEventType,
  type PocCallbackPayload,
  verifyCallbackSignature,
} from "@/lib/voximplant/poc/callback-signature";
import {
  assertPocScenarioIdentity,
  POC_PROTOCOL_VERSION,
  POC_SCENARIO_KIND,
  PocSafetyError,
} from "@/lib/voximplant/poc/poc-safety";
import {
  appendPocCallbackEvent,
  readPocState,
  writePocState,
  type PocCallbackEventRecord,
  type VoximplantServerStopPocState,
} from "@/lib/voximplant/poc/poc-state";

export type ProcessPocCallbackResult =
  | {
      ok: true;
      status: 200;
      event: PocCallbackEventRecord;
      disabled?: undefined;
    }
  | {
      ok: false;
      status: number;
      errorCode: string;
      disabled?: boolean;
    };

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }
  return null;
}

function parsePayload(raw: unknown): PocCallbackPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const eventType = typeof obj.eventType === "string" ? obj.eventType : "";
  if (!isPocCallbackEventType(eventType)) return null;

  const protocolVersion =
    typeof obj.protocolVersion === "number"
      ? obj.protocolVersion
      : typeof obj.protocolVersion === "string"
        ? Number(obj.protocolVersion)
        : NaN;

  return {
    scenarioKind: typeof obj.scenarioKind === "string" ? obj.scenarioKind : "",
    protocolVersion: Number.isFinite(protocolVersion) ? protocolVersion : NaN,
    eventType,
    action: typeof obj.action === "string" ? obj.action : null,
    operationId: typeof obj.operationId === "string" ? obj.operationId : null,
    conferenceName:
      typeof obj.conferenceName === "string" ? obj.conferenceName : null,
    callSessionHistoryId:
      typeof obj.callSessionHistoryId === "string"
        ? obj.callSessionHistoryId
        : null,
    recorderState:
      typeof obj.recorderState === "string" ? obj.recorderState : null,
    errorCode: typeof obj.errorCode === "string" ? obj.errorCode : null,
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
    nonce: typeof obj.nonce === "string" ? obj.nonce : "",
  };
}

/**
 * Process a POC callback. No Prisma / DB writes — local ignored state only.
 */
export function processPocCallback(params: {
  rawBody: string;
  headers: Headers | Record<string, string | string[] | undefined>;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  nowMs?: number;
  state?: VoximplantServerStopPocState | null;
  persist?: boolean;
}): ProcessPocCallbackResult {
  const env = params.env ?? process.env;
  if (!isPocCallbackEnabled(env)) {
    return {
      ok: false,
      status: 404,
      errorCode: "poc_callback_disabled",
      disabled: true,
    };
  }

  let secret: string;
  try {
    secret = getPocCallbackSecret(env);
  } catch {
    return { ok: false, status: 503, errorCode: "callback_secret_not_configured" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(params.rawBody);
  } catch {
    return { ok: false, status: 400, errorCode: "invalid_json" };
  }

  const payload = parsePayload(parsedJson);
  if (!payload) {
    return { ok: false, status: 400, errorCode: "invalid_payload" };
  }

  try {
    assertPocScenarioIdentity({
      scenarioKind: payload.scenarioKind,
      protocolVersion: payload.protocolVersion,
    });
  } catch (error) {
    if (error instanceof PocSafetyError) {
      return { ok: false, status: 400, errorCode: "unexpected_scenario_identity" };
    }
    return { ok: false, status: 400, errorCode: "unexpected_scenario_identity" };
  }

  const version =
    getHeader(params.headers, "X-Neg-Poc-Callback-Version") ?? "v1";
  const timestamp =
    getHeader(params.headers, "X-Neg-Poc-Callback-Timestamp") ??
    payload.timestamp;
  const nonce =
    getHeader(params.headers, "X-Neg-Poc-Callback-Nonce") ?? payload.nonce;
  const bodyHashHeader = getHeader(
    params.headers,
    "X-Neg-Poc-Callback-Body-Hash",
  );
  const signature = getHeader(
    params.headers,
    "X-Neg-Poc-Callback-Signature",
  );

  const cwd = params.cwd ?? process.cwd();
  const state = params.state ?? readPocState(cwd);
  if (!state) {
    // Allow callback persistence bootstrap when state was cleared mid-session:
    // still verify crypto, but require an existing POC state for evidence.
    return { ok: false, status: 409, errorCode: "poc_state_missing" };
  }

  const seenNonces = new Set(state.seenCallbackNonces);
  const expectedBodyHash = hashCallbackBody(params.rawBody);
  if (
    bodyHashHeader &&
    bodyHashHeader.trim().toLowerCase() !== expectedBodyHash
  ) {
    return { ok: false, status: 401, errorCode: "body_hash_mismatch" };
  }

  const verified = verifyCallbackSignature({
    version,
    eventType: payload.eventType,
    action: payload.action ?? "",
    operationId: payload.operationId ?? "",
    conferenceName: payload.conferenceName ?? "",
    timestamp,
    nonce,
    bodyHash: expectedBodyHash,
    signature: signature ?? "",
    secret,
    nowMs: params.nowMs,
    seenNonces,
  });

  if (!verified.ok) {
    return { ok: false, status: 401, errorCode: verified.errorCode };
  }

  const event: PocCallbackEventRecord = {
    eventType: payload.eventType,
    action: payload.action,
    operationId: payload.operationId,
    conferenceName: payload.conferenceName,
    callSessionHistoryId: payload.callSessionHistoryId,
    recorderState: payload.recorderState,
    errorCode: payload.errorCode,
    receivedAt: new Date(params.nowMs ?? Date.now()).toISOString(),
    signatureVerified: true,
  };

  // Ensure persisted records never include secrets / control URLs.
  const safeEvent: PocCallbackEventRecord = {
    eventType: event.eventType,
    action: event.action,
    operationId: event.operationId,
    conferenceName: event.conferenceName,
    callSessionHistoryId: event.callSessionHistoryId,
    recorderState: event.recorderState,
    errorCode: event.errorCode,
    receivedAt: event.receivedAt,
    signatureVerified: true,
  };

  const next = appendPocCallbackEvent(state, safeEvent, nonce);
  if (params.persist !== false) {
    writePocState(next, cwd);
  }

  return { ok: true, status: 200, event: safeEvent };
}

/** Dry-run helper: construct a signed callback without network I/O. */
export function buildDryRunPocCallback(params: {
  eventType: PocCallbackPayload["eventType"];
  action?: string | null;
  operationId?: string | null;
  conferenceName?: string | null;
  callSessionHistoryId?: string | null;
  recorderState?: string | null;
  errorCode?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const secret = getPocCallbackSecret(params.env ?? process.env, {
    allowDryRunPlaceholder: true,
  });
  const payload: PocCallbackPayload = {
    scenarioKind: POC_SCENARIO_KIND,
    protocolVersion: POC_PROTOCOL_VERSION,
    eventType: params.eventType,
    action: params.action ?? null,
    operationId: params.operationId ?? null,
    conferenceName: params.conferenceName ?? null,
    callSessionHistoryId: params.callSessionHistoryId ?? null,
    recorderState: params.recorderState ?? null,
    errorCode: params.errorCode ?? null,
    timestamp: new Date().toISOString(),
    nonce: `dry-run-${Date.now().toString(16)}`,
  };
  const signed = buildSignedCallbackRequest({ payload, secret });
  return {
    payload,
    headerKeys: Object.keys(signed.headers).sort(),
    bodyLength: signed.body.length,
    signaturePresent: Boolean(signed.signature),
    // Never return the raw signature / secret in dry-run logs by default.
    signatureFingerprint: `${signed.signature.slice(0, 8)}…`,
  };
}
