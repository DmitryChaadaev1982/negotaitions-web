import { createHash, createHmac, timingSafeEqual } from "crypto";

export const VOX_SERVER_STOP_PROTOCOL_VERSION = "v1";

export const VOX_SERVER_STOP_HEADER_PROTOCOL = "x-vox-stop-protocol";
export const VOX_SERVER_STOP_HEADER_TIMESTAMP = "x-vox-stop-timestamp";
export const VOX_SERVER_STOP_HEADER_NONCE = "x-vox-stop-nonce";
export const VOX_SERVER_STOP_HEADER_BODY_HASH = "x-vox-stop-body-sha256";
export const VOX_SERVER_STOP_HEADER_SIGNATURE = "x-vox-stop-signature";

export type VoxServerStopSignatureHeaders = {
  [VOX_SERVER_STOP_HEADER_PROTOCOL]: string;
  [VOX_SERVER_STOP_HEADER_TIMESTAMP]: string;
  [VOX_SERVER_STOP_HEADER_NONCE]: string;
  [VOX_SERVER_STOP_HEADER_BODY_HASH]: string;
  [VOX_SERVER_STOP_HEADER_SIGNATURE]: string;
};

export type VerifiedServerStopSignature = {
  protocolVersion: string;
  timestampSeconds: number;
  nonce: string;
  bodyHashHex: string;
};

export type VerifyServerStopSignatureFailure =
  | "MALFORMED_HEADERS"
  | "UNSUPPORTED_PROTOCOL"
  | "TIMESTAMP_EXPIRED"
  | "BODY_HASH_MISMATCH"
  | "SIGNATURE_INVALID";

export type VerifyServerStopSignatureResult =
  | { ok: true; verified: VerifiedServerStopSignature }
  | { ok: false; reason: VerifyServerStopSignatureFailure };

function parseTimestampSeconds(raw: string): number | null {
  if (!/^\d{1,16}$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function createSignatureInput(input: {
  protocolVersion: string;
  timestampSeconds: string;
  nonce: string;
  bodyHashHex: string;
}) {
  return [
    input.protocolVersion,
    input.timestampSeconds,
    input.nonce,
    input.bodyHashHex,
  ].join("\n");
}

export function computeServerStopBodyHashHex(rawBody: Buffer) {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function computeServerStopSignatureHex(input: {
  protocolVersion: string;
  timestampSeconds: string;
  nonce: string;
  bodyHashHex: string;
  secret: string;
}) {
  const signatureInput = createSignatureInput(input);
  return createHmac("sha256", input.secret).update(signatureInput).digest("hex");
}

export function buildServerStopSignedHeaders(input: {
  rawBody: Buffer;
  secret: string;
  nonce: string;
  timestampSeconds?: number;
  protocolVersion?: string;
}): VoxServerStopSignatureHeaders {
  const protocolVersion =
    input.protocolVersion ?? VOX_SERVER_STOP_PROTOCOL_VERSION;
  const timestampSeconds = String(
    input.timestampSeconds ?? Math.floor(Date.now() / 1000),
  );
  const bodyHashHex = computeServerStopBodyHashHex(input.rawBody);
  const signatureHex = computeServerStopSignatureHex({
    protocolVersion,
    timestampSeconds,
    nonce: input.nonce,
    bodyHashHex,
    secret: input.secret,
  });

  return {
    [VOX_SERVER_STOP_HEADER_PROTOCOL]: protocolVersion,
    [VOX_SERVER_STOP_HEADER_TIMESTAMP]: timestampSeconds,
    [VOX_SERVER_STOP_HEADER_NONCE]: input.nonce,
    [VOX_SERVER_STOP_HEADER_BODY_HASH]: bodyHashHex,
    [VOX_SERVER_STOP_HEADER_SIGNATURE]: signatureHex,
  };
}

export function verifyServerStopCallbackSignature(input: {
  headers: Pick<Headers, "get">;
  rawBody: Buffer;
  secret: string;
  replayWindowSeconds: number;
  now?: Date;
}): VerifyServerStopSignatureResult {
  const protocolVersion = input.headers.get(VOX_SERVER_STOP_HEADER_PROTOCOL)?.trim();
  const timestampRaw = input.headers.get(VOX_SERVER_STOP_HEADER_TIMESTAMP)?.trim();
  const nonce = input.headers.get(VOX_SERVER_STOP_HEADER_NONCE)?.trim();
  const bodyHashHex = input.headers.get(VOX_SERVER_STOP_HEADER_BODY_HASH)?.trim();
  const receivedSignatureHex = input.headers
    .get(VOX_SERVER_STOP_HEADER_SIGNATURE)
    ?.trim()
    .toLowerCase();

  if (
    !protocolVersion ||
    !timestampRaw ||
    !nonce ||
    !bodyHashHex ||
    !receivedSignatureHex
  ) {
    return { ok: false, reason: "MALFORMED_HEADERS" };
  }

  if (protocolVersion !== VOX_SERVER_STOP_PROTOCOL_VERSION) {
    return { ok: false, reason: "UNSUPPORTED_PROTOCOL" };
  }

  const timestampSeconds = parseTimestampSeconds(timestampRaw);
  if (!timestampSeconds) {
    return { ok: false, reason: "MALFORMED_HEADERS" };
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > input.replayWindowSeconds) {
    return { ok: false, reason: "TIMESTAMP_EXPIRED" };
  }

  const computedBodyHashHex = computeServerStopBodyHashHex(input.rawBody);
  if (computedBodyHashHex !== bodyHashHex.toLowerCase()) {
    return { ok: false, reason: "BODY_HASH_MISMATCH" };
  }

  const expectedSignatureHex = computeServerStopSignatureHex({
    protocolVersion,
    timestampSeconds: timestampRaw,
    nonce,
    bodyHashHex: bodyHashHex.toLowerCase(),
    secret: input.secret,
  });

  const expectedBuffer = Buffer.from(expectedSignatureHex, "hex");
  let receivedBuffer: Buffer;
  try {
    receivedBuffer = Buffer.from(receivedSignatureHex, "hex");
  } catch {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  return {
    ok: true,
    verified: {
      protocolVersion,
      timestampSeconds,
      nonce,
      bodyHashHex: bodyHashHex.toLowerCase(),
    },
  };
}
