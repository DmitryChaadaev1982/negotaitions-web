import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  POC_PROTOCOL_VERSION,
  POC_SCENARIO_KIND,
} from "@/lib/voximplant/poc/poc-safety";

export const POC_CALLBACK_EVENT_TYPES = [
  "command_accepted",
  "command_rejected",
  "recording_started",
  "recording_stopped",
  "scenario_terminating",
] as const;

export type PocCallbackEventType = (typeof POC_CALLBACK_EVENT_TYPES)[number];

export const POC_CALLBACK_SIGNED_VERSION = "v1";
export const POC_CALLBACK_REPLAY_WINDOW_MS = 5 * 60 * 1000;

export type PocCallbackPayload = {
  scenarioKind: string;
  protocolVersion: number;
  eventType: PocCallbackEventType;
  action: string | null;
  operationId: string | null;
  conferenceName: string | null;
  callSessionHistoryId: string | null;
  recorderState: string | null;
  errorCode: string | null;
  timestamp: string;
  nonce: string;
};

export type PocCallbackSignedFields = {
  version: string;
  eventType: PocCallbackEventType;
  action: string;
  operationId: string;
  conferenceName: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
};

export type PocCallbackVerifyInput = PocCallbackSignedFields & {
  signature: string;
  secret: string;
  nowMs?: number;
  replayWindowMs?: number;
  seenNonces?: ReadonlySet<string>;
};

export type PocCallbackVerifyResult =
  | { ok: true; fields: PocCallbackSignedFields }
  | { ok: false; errorCode: string };

const DRY_RUN_PLACEHOLDER_SECRET = "poc-callback-dry-run-placeholder-secret";

export function isPocCallbackEventType(
  value: string,
): value is PocCallbackEventType {
  return (POC_CALLBACK_EVENT_TYPES as readonly string[]).includes(value);
}

export function getPocCallbackSecret(
  env: NodeJS.ProcessEnv = process.env,
  options: { allowDryRunPlaceholder?: boolean } = {},
): string {
  const secret = env.VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET?.trim() || "";
  if (secret && secret.length >= 16) return secret;
  if (options.allowDryRunPlaceholder) {
    return DRY_RUN_PLACEHOLDER_SECRET;
  }
  throw new Error(
    "Missing POC callback secret. Set VOXIMPLANT_SERVER_STOP_POC_CALLBACK_SECRET (min 16 chars).",
  );
}

export function isPocCallbackEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.VOXIMPLANT_SERVER_STOP_POC_CALLBACK_ENABLED?.trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

export function hashCallbackBody(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export function buildCallbackSigningPayload(
  fields: PocCallbackSignedFields,
): string {
  return [
    fields.version,
    fields.eventType,
    fields.action,
    fields.operationId,
    fields.conferenceName,
    fields.timestamp,
    fields.nonce,
    fields.bodyHash,
  ].join("\n");
}

export function signCallbackFields(
  fields: PocCallbackSignedFields,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(buildCallbackSigningPayload(fields))
    .digest("hex");
}

export function createCallbackNonce(): string {
  return randomBytes(16).toString("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "hex");
    const bBuf = Buffer.from(b, "hex");
    if (aBuf.length === 0 || aBuf.length !== bBuf.length) return false;
    return timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

export function verifyCallbackSignature(
  input: PocCallbackVerifyInput,
): PocCallbackVerifyResult {
  if (!isPocCallbackEventType(input.eventType)) {
    return { ok: false, errorCode: "unknown_event_type" };
  }
  if (input.version !== POC_CALLBACK_SIGNED_VERSION) {
    return { ok: false, errorCode: "unsupported_version" };
  }
  if (!input.operationId?.trim()) {
    return { ok: false, errorCode: "missing_operation_id" };
  }
  if (!input.nonce?.trim()) {
    return { ok: false, errorCode: "missing_nonce" };
  }
  if (!input.signature?.trim()) {
    return { ok: false, errorCode: "missing_signature" };
  }

  const timestampMs = Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, errorCode: "invalid_timestamp" };
  }

  const nowMs = input.nowMs ?? Date.now();
  const windowMs = input.replayWindowMs ?? POC_CALLBACK_REPLAY_WINDOW_MS;
  if (Math.abs(nowMs - timestampMs) > windowMs) {
    return { ok: false, errorCode: "expired_timestamp" };
  }

  if (input.seenNonces?.has(input.nonce)) {
    return { ok: false, errorCode: "replayed_nonce" };
  }

  const fields: PocCallbackSignedFields = {
    version: input.version,
    eventType: input.eventType,
    action: input.action,
    operationId: input.operationId,
    conferenceName: input.conferenceName,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodyHash: input.bodyHash,
  };

  const expected = signCallbackFields(fields, input.secret);
  if (!safeEqualHex(expected, input.signature.trim().toLowerCase())) {
    return { ok: false, errorCode: "invalid_signature" };
  }

  return { ok: true, fields };
}

export function buildPocCallbackPayload(params: {
  eventType: PocCallbackEventType;
  action?: string | null;
  operationId?: string | null;
  conferenceName?: string | null;
  callSessionHistoryId?: string | null;
  recorderState?: string | null;
  errorCode?: string | null;
  timestamp?: string;
  nonce?: string;
}): PocCallbackPayload {
  return {
    scenarioKind: POC_SCENARIO_KIND,
    protocolVersion: POC_PROTOCOL_VERSION,
    eventType: params.eventType,
    action: params.action ?? null,
    operationId: params.operationId ?? null,
    conferenceName: params.conferenceName ?? null,
    callSessionHistoryId: params.callSessionHistoryId ?? null,
    recorderState: params.recorderState ?? null,
    errorCode: params.errorCode ?? null,
    timestamp: params.timestamp ?? new Date().toISOString(),
    nonce: params.nonce ?? createCallbackNonce(),
  };
}

export function buildSignedCallbackRequest(params: {
  payload: PocCallbackPayload;
  secret: string;
}): {
  body: string;
  fields: PocCallbackSignedFields;
  signature: string;
  headers: Record<string, string>;
} {
  const body = JSON.stringify(params.payload);
  const fields: PocCallbackSignedFields = {
    version: POC_CALLBACK_SIGNED_VERSION,
    eventType: params.payload.eventType,
    action: params.payload.action ?? "",
    operationId: params.payload.operationId ?? "",
    conferenceName: params.payload.conferenceName ?? "",
    timestamp: params.payload.timestamp,
    nonce: params.payload.nonce,
    bodyHash: hashCallbackBody(body),
  };
  const signature = signCallbackFields(fields, params.secret);
  return {
    body,
    fields,
    signature,
    headers: {
      "Content-Type": "application/json",
      "X-Neg-Poc-Callback-Version": fields.version,
      "X-Neg-Poc-Callback-Event-Type": fields.eventType,
      "X-Neg-Poc-Callback-Action": fields.action,
      "X-Neg-Poc-Callback-Operation-Id": fields.operationId,
      "X-Neg-Poc-Callback-Conference-Name": fields.conferenceName,
      "X-Neg-Poc-Callback-Timestamp": fields.timestamp,
      "X-Neg-Poc-Callback-Nonce": fields.nonce,
      "X-Neg-Poc-Callback-Body-Hash": fields.bodyHash,
      "X-Neg-Poc-Callback-Signature": signature,
    },
  };
}
