import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const POC_CONTROL_ACTIONS = [
  "ping",
  "get_recording_state",
  "stop_recording",
] as const;

export type PocControlAction = (typeof POC_CONTROL_ACTIONS)[number];

export const POC_CONTROL_SIGNED_VERSION = "v1";
export const POC_CONTROL_REPLAY_WINDOW_MS = 5 * 60 * 1000;

export type PocControlSignedFields = {
  version: string;
  action: PocControlAction;
  conferenceName: string;
  operationId: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
};

export type PocControlVerifyInput = PocControlSignedFields & {
  signature: string;
  secret: string;
  nowMs?: number;
  replayWindowMs?: number;
  seenNonces?: ReadonlySet<string>;
};

export type PocControlVerifyResult =
  | { ok: true; fields: PocControlSignedFields }
  | { ok: false; errorCode: string };

export function isPocControlAction(value: string): value is PocControlAction {
  return (POC_CONTROL_ACTIONS as readonly string[]).includes(value);
}

export function hashControlBody(body: string | Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

export function buildControlSigningPayload(fields: PocControlSignedFields): string {
  return [
    fields.version,
    fields.action,
    fields.conferenceName,
    fields.operationId,
    fields.timestamp,
    fields.nonce,
    fields.bodyHash,
  ].join("\n");
}

export function signControlFields(
  fields: PocControlSignedFields,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update(buildControlSigningPayload(fields))
    .digest("hex");
}

export function createControlNonce(): string {
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

export function verifyControlSignature(
  input: PocControlVerifyInput,
): PocControlVerifyResult {
  if (!isPocControlAction(input.action)) {
    return { ok: false, errorCode: "unknown_action" };
  }
  if (input.version !== POC_CONTROL_SIGNED_VERSION) {
    return { ok: false, errorCode: "unsupported_version" };
  }
  if (!input.operationId?.trim()) {
    return { ok: false, errorCode: "missing_operation_id" };
  }
  if (!input.conferenceName?.trim()) {
    return { ok: false, errorCode: "missing_conference_name" };
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
  const windowMs = input.replayWindowMs ?? POC_CONTROL_REPLAY_WINDOW_MS;
  if (Math.abs(nowMs - timestampMs) > windowMs) {
    return { ok: false, errorCode: "expired_timestamp" };
  }

  if (input.seenNonces?.has(input.nonce)) {
    return { ok: false, errorCode: "replayed_nonce" };
  }

  const fields: PocControlSignedFields = {
    version: input.version,
    action: input.action,
    conferenceName: input.conferenceName,
    operationId: input.operationId,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodyHash: input.bodyHash,
  };

  const expected = signControlFields(fields, input.secret);
  if (!safeEqualHex(expected, input.signature.trim().toLowerCase())) {
    return { ok: false, errorCode: "invalid_signature" };
  }

  return { ok: true, fields };
}

export function buildSignedControlHeaders(params: {
  action: PocControlAction;
  conferenceName: string;
  operationId: string;
  secret: string;
  body: string;
  timestamp?: string;
  nonce?: string;
}): { fields: PocControlSignedFields; signature: string; headers: Record<string, string> } {
  const fields: PocControlSignedFields = {
    version: POC_CONTROL_SIGNED_VERSION,
    action: params.action,
    conferenceName: params.conferenceName,
    operationId: params.operationId,
    timestamp: params.timestamp ?? new Date().toISOString(),
    nonce: params.nonce ?? createControlNonce(),
    bodyHash: hashControlBody(params.body),
  };
  const signature = signControlFields(fields, params.secret);
  return {
    fields,
    signature,
    headers: {
      "Content-Type": "application/json",
      "X-Neg-Poc-Version": fields.version,
      "X-Neg-Poc-Action": fields.action,
      "X-Neg-Poc-Conference-Name": fields.conferenceName,
      "X-Neg-Poc-Operation-Id": fields.operationId,
      "X-Neg-Poc-Timestamp": fields.timestamp,
      "X-Neg-Poc-Nonce": fields.nonce,
      "X-Neg-Poc-Body-Hash": fields.bodyHash,
      "X-Neg-Poc-Signature": signature,
    },
  };
}
