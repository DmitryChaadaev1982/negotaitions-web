import {
  mapCallbackErrorCode,
  type PocCallbackResultCode,
} from "@/lib/voximplant/poc/callback-result-codes";
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
import { applySessionRegisteredToState } from "@/lib/voximplant/poc/session-registration";

export type ProcessPocCallbackResult =
  | {
      ok: true;
      status: 200;
      errorCode: "CALLBACK_ACCEPTED";
      event: PocCallbackEventRecord;
      disabled?: undefined;
    }
  | {
      ok: false;
      status: number;
      errorCode: PocCallbackResultCode;
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

  const callSessionHistoryId =
    typeof obj.callSessionHistoryId === "string"
      ? obj.callSessionHistoryId
      : typeof obj.callSessionHistoryId === "number"
        ? String(obj.callSessionHistoryId)
        : null;
  const providerSessionId =
    typeof obj.providerSessionId === "string"
      ? obj.providerSessionId
      : typeof obj.providerSessionId === "number"
        ? String(obj.providerSessionId)
        : null;

  return {
    scenarioKind: typeof obj.scenarioKind === "string" ? obj.scenarioKind : "",
    protocolVersion: Number.isFinite(protocolVersion) ? protocolVersion : NaN,
    eventType,
    action: typeof obj.action === "string" ? obj.action : null,
    operationId: typeof obj.operationId === "string" ? obj.operationId : null,
    conferenceName:
      typeof obj.conferenceName === "string" ? obj.conferenceName : null,
    callSessionHistoryId,
    providerSessionId,
    recorderState:
      typeof obj.recorderState === "string" ? obj.recorderState : null,
    errorCode: typeof obj.errorCode === "string" ? obj.errorCode : null,
    timestamp: typeof obj.timestamp === "string" ? obj.timestamp : "",
    nonce: typeof obj.nonce === "string" ? obj.nonce : "",
    scenarioBuild:
      typeof obj.scenarioBuild === "string" ? obj.scenarioBuild : null,
    scenarioSource:
      typeof obj.scenarioSource === "string" ? obj.scenarioSource : null,
    routingRuleIdentity:
      typeof obj.routingRuleIdentity === "string"
        ? obj.routingRuleIdentity
        : typeof obj.ruleIdentity === "string"
          ? obj.ruleIdentity
          : null,
    mediaSessionAccessSecureUrl:
      typeof obj.mediaSessionAccessSecureUrl === "string"
        ? obj.mediaSessionAccessSecureUrl
        : null,
    mediaSessionAccessUrl:
      typeof obj.mediaSessionAccessUrl === "string"
        ? obj.mediaSessionAccessUrl
        : null,
  };
}

/**
 * Process a POC callback. No Prisma / DB writes — local ignored state only.
 */
export function processPocCallback(params: {
  rawBody: string;
  headers: Headers | Record<string, string | string[] | undefined>;
  env?: NodeJS.ProcessEnv;
  /** Explicit state root (tests). Omit to use repository-root resolver. */
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
      errorCode: "POC_CALLBACK_DISABLED",
      disabled: true,
    };
  }

  let secret: string;
  try {
    secret = getPocCallbackSecret(env);
  } catch {
    return { ok: false, status: 503, errorCode: "CALLBACK_SECRET_MISSING" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(params.rawBody);
  } catch {
    return { ok: false, status: 400, errorCode: "CALLBACK_PAYLOAD_INVALID" };
  }

  const payload = parsePayload(parsedJson);
  if (!payload) {
    return { ok: false, status: 400, errorCode: "CALLBACK_PAYLOAD_INVALID" };
  }

  try {
    assertPocScenarioIdentity({
      scenarioKind: payload.scenarioKind,
      protocolVersion: payload.protocolVersion,
    });
  } catch (error) {
    if (error instanceof PocSafetyError) {
      return { ok: false, status: 400, errorCode: "CALLBACK_PAYLOAD_INVALID" };
    }
    return { ok: false, status: 400, errorCode: "CALLBACK_PAYLOAD_INVALID" };
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

  // Omit cwd → repository-root state path (shared with CLI).
  const state = params.state ?? readPocState(params.cwd);
  if (!state) {
    return { ok: false, status: 409, errorCode: "POC_STATE_MISSING" };
  }

  const seenNonces = new Set(state.seenCallbackNonces);
  const expectedBodyHash = hashCallbackBody(params.rawBody);
  if (
    bodyHashHeader &&
    bodyHashHeader.trim().toLowerCase() !== expectedBodyHash
  ) {
    return { ok: false, status: 401, errorCode: "INVALID_CALLBACK_SIGNATURE" };
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
    return {
      ok: false,
      status: 401,
      errorCode: mapCallbackErrorCode(verified.errorCode),
    };
  }

  const receivedAt = new Date(params.nowMs ?? Date.now()).toISOString();
  const providerSessionId =
    payload.providerSessionId ?? payload.callSessionHistoryId;

  // Ensure persisted records never include secrets / control URLs.
  const safeEvent: PocCallbackEventRecord = {
    eventType: payload.eventType,
    action: payload.action,
    operationId: payload.operationId,
    conferenceName: payload.conferenceName,
    callSessionHistoryId: providerSessionId,
    recorderState: payload.recorderState,
    errorCode: payload.errorCode,
    receivedAt,
    signatureVerified: true,
  };

  let nextState = state;
  if (payload.eventType === "session_registered") {
    const applied = applySessionRegisteredToState(
      state,
      {
        conferenceName: payload.conferenceName,
        callSessionHistoryId: payload.callSessionHistoryId ?? null,
        providerSessionId,
        scenarioBuild: payload.scenarioBuild ?? null,
        scenarioSource: payload.scenarioSource ?? null,
        routingRuleIdentity: payload.routingRuleIdentity ?? null,
        mediaSessionAccessSecureUrl: payload.mediaSessionAccessSecureUrl ?? null,
        mediaSessionAccessUrl: payload.mediaSessionAccessUrl ?? null,
        registeredAt: receivedAt,
      },
      { stateRoot: params.cwd },
    );
    if (!applied.ok) {
      if (params.persist !== false) {
        try {
          writePocState(applied.state, params.cwd);
        } catch {
          return {
            ok: false,
            status: 500,
            errorCode: "CALLBACK_STATE_WRITE_FAILED",
          };
        }
      }
      const mapped = mapCallbackErrorCode(applied.code);
      return {
        ok: false,
        status: 409,
        errorCode: mapped,
      };
    }
    nextState = applied.state;
  }

  const next = appendPocCallbackEvent(nextState, safeEvent, nonce);
  if (params.persist !== false) {
    try {
      writePocState(next, params.cwd);
    } catch {
      return { ok: false, status: 500, errorCode: "CALLBACK_STATE_WRITE_FAILED" };
    }
  }

  return {
    ok: true,
    status: 200,
    errorCode: "CALLBACK_ACCEPTED",
    event: safeEvent,
  };
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
