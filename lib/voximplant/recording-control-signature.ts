import { createHmac, randomUUID, timingSafeEqual } from "crypto";

export const VOX_RECORDING_CONTROL_PROTOCOL_VERSION = "rc2-hmac-sha256-v1";
export const VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION =
  "rc3-hmac-sha256-recording-attempt-v1";
export type VoxRecordingControlProtocolVersion =
  | typeof VOX_RECORDING_CONTROL_PROTOCOL_VERSION
  | typeof VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION;
export const VOX_RECORDING_CONTROL_DEFAULT_TTL_SECONDS = 120;
export const VOX_RECORDING_CONTROL_CLOCK_SKEW_SECONDS = 30;

export const VOX_RECORDING_ALLOWED_WEBHOOK_ORIGINS = Object.freeze([
  "https://local.negotaitions.ru",
  "https://negotaitions.ru",
]);

const VOX_RECORDING_ALLOWED_WEBHOOK_ORIGIN_SET: ReadonlySet<string> = new Set(
  VOX_RECORDING_ALLOWED_WEBHOOK_ORIGINS,
);

export type RecordingControlAction =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "status";

export type RecordingControlSignedClaims = {
  protocolVersion: VoxRecordingControlProtocolVersion;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  action: RecordingControlAction;
  requestId: string;
  recordingAttemptId?: string;
  sessionId: string;
  conferenceName: string;
  participantId: string;
  controllerUserId: string;
  controllerRole: string;
  canControlRecording: boolean;
  webhookBaseUrl: string;
};

export type RecordingControlSignedMessage = {
  type: "recording_control";
  protocolVersion: VoxRecordingControlProtocolVersion;
  claims: RecordingControlSignedClaims;
  signature: string;
};

const LEGACY_CLAIM_CANONICAL_ORDER: ReadonlyArray<
  keyof RecordingControlSignedClaims
> = [
  "protocolVersion",
  "issuedAt",
  "expiresAt",
  "nonce",
  "action",
  "requestId",
  "sessionId",
  "conferenceName",
  "participantId",
  "controllerUserId",
  "controllerRole",
  "canControlRecording",
  "webhookBaseUrl",
];

const FENCED_CLAIM_CANONICAL_ORDER: ReadonlyArray<
  keyof RecordingControlSignedClaims
> = [
  ...LEGACY_CLAIM_CANONICAL_ORDER.slice(0, 6),
  "recordingAttemptId",
  ...LEGACY_CLAIM_CANONICAL_ORDER.slice(6),
];

const RECORDING_CONTROL_ACTIONS: ReadonlySet<RecordingControlAction> = new Set([
  "start",
  "pause",
  "resume",
  "stop",
  "status",
]);

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureNoNewLines(value: string, fieldName: string): string {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`Invalid ${fieldName}: newline characters are not allowed.`);
  }
  return value;
}

function normalizeTimestamp(value: number, fieldName: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${fieldName}: expected a positive unix timestamp.`);
  }
  return Math.trunc(value);
}

export function isRecordingControlSecretConfigured(
  secret: string | null | undefined,
): secret is string {
  if (!secret || typeof secret !== "string") {
    return false;
  }
  return secret.trim().length >= 16;
}

export function normalizeRecordingWebhookOrigin(rawValue: string): string | null {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) {
    return null;
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return null;
  }
  if (parsed.search || parsed.hash) {
    return null;
  }
  if (parsed.port) {
    return null;
  }

  const normalizedOrigin = parsed.origin.toLowerCase();
  if (!VOX_RECORDING_ALLOWED_WEBHOOK_ORIGIN_SET.has(normalizedOrigin)) {
    return null;
  }

  const normalizedRaw = trimmed.toLowerCase();
  if (
    normalizedRaw !== normalizedOrigin &&
    normalizedRaw !== `${normalizedOrigin}/`
  ) {
    return null;
  }

  return normalizedOrigin;
}

export function buildRecordingControlCanonicalPayload(
  claims: RecordingControlSignedClaims,
): string {
  const order =
    claims.protocolVersion === VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION
      ? FENCED_CLAIM_CANONICAL_ORDER
      : LEGACY_CLAIM_CANONICAL_ORDER;
  return order.map((fieldName) => {
    const value = claims[fieldName];
    if (typeof value === "boolean") {
      return `${fieldName}=${value ? "true" : "false"}`;
    }
    return `${fieldName}=${String(value)}`;
  }).join("\n");
}

export function computeRecordingControlSignatureHex(input: {
  canonicalPayload: string;
  secret: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(input.canonicalPayload, "utf8")
    .digest("hex");
}

function sanitizeClaims(
  claims: Omit<RecordingControlSignedClaims, "protocolVersion"> & {
    protocolVersion?: VoxRecordingControlProtocolVersion;
  },
): RecordingControlSignedClaims {
  const webhookBaseUrl = normalizeRecordingWebhookOrigin(claims.webhookBaseUrl);
  if (!webhookBaseUrl) {
    throw new Error(
      `Invalid webhookBaseUrl "${claims.webhookBaseUrl}". Expected an allowlisted HTTPS origin.`,
    );
  }

  const issuedAt = normalizeTimestamp(claims.issuedAt, "issuedAt");
  const expiresAt = normalizeTimestamp(claims.expiresAt, "expiresAt");
  if (expiresAt <= issuedAt) {
    throw new Error("Invalid expiresAt: must be greater than issuedAt.");
  }

  const requestId = toTrimmedString(claims.requestId);
  const recordingAttemptId = toTrimmedString(claims.recordingAttemptId);
  const sessionId = toTrimmedString(claims.sessionId);
  const conferenceName = toTrimmedString(claims.conferenceName);
  const participantId = toTrimmedString(claims.participantId);
  const controllerUserId = toTrimmedString(claims.controllerUserId);
  const controllerRole = toTrimmedString(claims.controllerRole);
  const nonce = toTrimmedString(claims.nonce);

  if (!requestId) throw new Error("requestId is required.");
  const protocolVersion =
    claims.protocolVersion ??
    (recordingAttemptId
      ? VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION
      : VOX_RECORDING_CONTROL_PROTOCOL_VERSION);
  if (
    protocolVersion !== VOX_RECORDING_CONTROL_PROTOCOL_VERSION &&
    protocolVersion !== VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION
  ) {
    throw new Error("protocolVersion is invalid.");
  }
  if (
    protocolVersion === VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION &&
    !recordingAttemptId
  ) {
    throw new Error("recordingAttemptId is required for the fenced protocol.");
  }
  if (
    protocolVersion === VOX_RECORDING_CONTROL_PROTOCOL_VERSION &&
    recordingAttemptId
  ) {
    throw new Error("recordingAttemptId is not valid in the legacy protocol.");
  }
  if (!sessionId) throw new Error("sessionId is required.");
  if (!conferenceName) throw new Error("conferenceName is required.");
  if (!participantId) throw new Error("participantId is required.");
  if (!controllerUserId) throw new Error("controllerUserId is required.");
  if (!controllerRole) throw new Error("controllerRole is required.");
  if (!nonce) throw new Error("nonce is required.");
  if (!RECORDING_CONTROL_ACTIONS.has(claims.action)) {
    throw new Error("action is invalid.");
  }

  return {
    protocolVersion,
    issuedAt,
    expiresAt,
    nonce: ensureNoNewLines(nonce, "nonce"),
    action: claims.action,
    requestId: ensureNoNewLines(requestId, "requestId"),
    ...(recordingAttemptId
      ? {
          recordingAttemptId: ensureNoNewLines(
            recordingAttemptId,
            "recordingAttemptId",
          ),
        }
      : {}),
    sessionId: ensureNoNewLines(sessionId, "sessionId"),
    conferenceName: ensureNoNewLines(conferenceName, "conferenceName"),
    participantId: ensureNoNewLines(participantId, "participantId"),
    controllerUserId: ensureNoNewLines(controllerUserId, "controllerUserId"),
    controllerRole: ensureNoNewLines(controllerRole, "controllerRole"),
    canControlRecording: Boolean(claims.canControlRecording),
    webhookBaseUrl,
  };
}

export function createSignedRecordingControlMessage(input: {
  secret: string;
  action: RecordingControlAction;
  requestId: string;
  recordingAttemptId?: string;
  sessionId: string;
  conferenceName: string;
  participantId: string;
  controllerUserId: string;
  controllerRole: string;
  canControlRecording: boolean;
  webhookBaseUrl: string;
  issuedAt?: number;
  expiresAt?: number;
  ttlSeconds?: number;
  nonce?: string;
}): {
  message: RecordingControlSignedMessage;
  scenarioMessageText: string;
  canonicalPayload: string;
} {
  if (!isRecordingControlSecretConfigured(input.secret)) {
    throw new Error(
      "Missing or invalid VOXIMPLANT_RECORDING_CONTROL_SECRET. Expected at least 16 characters.",
    );
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const issuedAt = input.issuedAt ?? nowSeconds;
  const ttlSeconds = input.ttlSeconds ?? VOX_RECORDING_CONTROL_DEFAULT_TTL_SECONDS;
  const expiresAt = input.expiresAt ?? issuedAt + ttlSeconds;

  const claims = sanitizeClaims({
    protocolVersion: input.recordingAttemptId
      ? VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION
      : VOX_RECORDING_CONTROL_PROTOCOL_VERSION,
    issuedAt,
    expiresAt,
    nonce: input.nonce ?? randomUUID(),
    action: input.action,
    requestId: input.requestId,
    recordingAttemptId: input.recordingAttemptId,
    sessionId: input.sessionId,
    conferenceName: input.conferenceName,
    participantId: input.participantId,
    controllerUserId: input.controllerUserId,
    controllerRole: input.controllerRole,
    canControlRecording: input.canControlRecording,
    webhookBaseUrl: input.webhookBaseUrl,
  });

  const canonicalPayload = buildRecordingControlCanonicalPayload(claims);
  const signature = computeRecordingControlSignatureHex({
    canonicalPayload,
    secret: input.secret.trim(),
  });

  const message: RecordingControlSignedMessage = {
    type: "recording_control",
    protocolVersion: claims.protocolVersion,
    claims,
    signature,
  };

  return {
    message,
    scenarioMessageText: JSON.stringify(message),
    canonicalPayload,
  };
}

function secureCompareHex(expectedHex: string, receivedHex: string): boolean {
  let expectedBuffer: Buffer;
  let receivedBuffer: Buffer;
  try {
    expectedBuffer = Buffer.from(expectedHex, "hex");
    receivedBuffer = Buffer.from(receivedHex, "hex");
  } catch {
    return false;
  }
  if (expectedBuffer.length === 0 || receivedBuffer.length === 0) {
    return false;
  }
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

function normalizeSignedMessage(
  value: unknown,
): RecordingControlSignedMessage | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Record<string, unknown>;
  if (envelope.type !== "recording_control") return null;
  if (
    envelope.protocolVersion !== VOX_RECORDING_CONTROL_PROTOCOL_VERSION &&
    envelope.protocolVersion !== VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION
  ) {
    return null;
  }
  if (typeof envelope.signature !== "string") return null;
  if (!envelope.claims || typeof envelope.claims !== "object") return null;
  const claimsRecord = envelope.claims as Record<string, unknown>;

  if (
    (claimsRecord.protocolVersion !== VOX_RECORDING_CONTROL_PROTOCOL_VERSION &&
      claimsRecord.protocolVersion !==
        VOX_RECORDING_CONTROL_FENCED_PROTOCOL_VERSION) ||
    typeof claimsRecord.action !== "string" ||
    typeof claimsRecord.canControlRecording !== "boolean"
  ) {
    return null;
  }

  try {
    const claims = sanitizeClaims({
      protocolVersion: claimsRecord.protocolVersion as VoxRecordingControlProtocolVersion,
      issuedAt: Number(claimsRecord.issuedAt),
      expiresAt: Number(claimsRecord.expiresAt),
      nonce: String(claimsRecord.nonce ?? ""),
      action: claimsRecord.action as RecordingControlAction,
      requestId: String(claimsRecord.requestId ?? ""),
      recordingAttemptId:
        claimsRecord.recordingAttemptId === undefined
          ? undefined
          : String(claimsRecord.recordingAttemptId),
      sessionId: String(claimsRecord.sessionId ?? ""),
      conferenceName: String(claimsRecord.conferenceName ?? ""),
      participantId: String(claimsRecord.participantId ?? ""),
      controllerUserId: String(claimsRecord.controllerUserId ?? ""),
      controllerRole: String(claimsRecord.controllerRole ?? ""),
      canControlRecording: claimsRecord.canControlRecording,
      webhookBaseUrl: String(claimsRecord.webhookBaseUrl ?? ""),
    });
    return {
      type: "recording_control",
      protocolVersion: claims.protocolVersion,
      claims,
      signature: envelope.signature,
    };
  } catch {
    return null;
  }
}

export type VerifyRecordingControlMessageResult =
  | {
      ok: true;
      message: RecordingControlSignedMessage;
      canonicalPayload: string;
    }
  | {
      ok: false;
      reason:
        | "MALFORMED_MESSAGE"
        | "SECRET_MISSING"
        | "SIGNATURE_INVALID"
        | "CLAIMS_NOT_YET_VALID"
        | "CLAIMS_EXPIRED";
    };

export function verifySignedRecordingControlMessage(input: {
  message: unknown;
  secret: string | null | undefined;
  nowSeconds?: number;
}): VerifyRecordingControlMessageResult {
  const normalized = normalizeSignedMessage(input.message);
  if (!normalized) {
    return { ok: false, reason: "MALFORMED_MESSAGE" };
  }

  if (!isRecordingControlSecretConfigured(input.secret)) {
    return { ok: false, reason: "SECRET_MISSING" };
  }

  const canonicalPayload = buildRecordingControlCanonicalPayload(normalized.claims);
  const expectedSignature = computeRecordingControlSignatureHex({
    canonicalPayload,
    secret: input.secret.trim(),
  });
  const receivedSignature = normalized.signature.trim().toLowerCase();
  if (!secureCompareHex(expectedSignature, receivedSignature)) {
    return { ok: false, reason: "SIGNATURE_INVALID" };
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    nowSeconds <
    normalized.claims.issuedAt - VOX_RECORDING_CONTROL_CLOCK_SKEW_SECONDS
  ) {
    return { ok: false, reason: "CLAIMS_NOT_YET_VALID" };
  }
  if (
    nowSeconds >
    normalized.claims.expiresAt + VOX_RECORDING_CONTROL_CLOCK_SKEW_SECONDS
  ) {
    return { ok: false, reason: "CLAIMS_EXPIRED" };
  }

  return {
    ok: true,
    message: normalized,
    canonicalPayload,
  };
}
