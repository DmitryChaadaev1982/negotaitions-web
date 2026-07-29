/**
 * Shared browser <-> VoxEngine scenario message contract for recording control.
 *
 * Stage 2 is additive only: it provides typed protocol helpers without changing
 * existing runtime behavior.
 */

export type RecordingControlAction =
  | "start"
  | "pause"
  | "resume"
  | "stop"
  | "status";

export type RecordingStatus =
  | "idle"
  | "starting"
  | "recording"
  | "paused"
  | "resuming"
  | "stopping"
  | "stopped"
  | "error"
  | "not_recording";

export type VoximplantRoomRole =
  | "participant_a"
  | "participant_b"
  | "facilitator"
  | "observer"
  | "unknown";

export const RECORDING_CONTROL_PROTOCOL_VERSION = "rc2-hmac-sha256-v1";

export type RecordingControlSignedClaims = {
  protocolVersion: typeof RECORDING_CONTROL_PROTOCOL_VERSION;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  action: RecordingControlAction;
  requestId: string;
  sessionId: string;
  conferenceName: string;
  participantId: string;
  controllerUserId: string;
  controllerRole: string;
  canControlRecording: boolean;
  webhookBaseUrl: string;
};

export type RecordingControlMessage = {
  type: "recording_control";
  protocolVersion: typeof RECORDING_CONTROL_PROTOCOL_VERSION;
  claims: RecordingControlSignedClaims;
  signature: string;
};

export type RecordingStatusMessage = {
  type: "recording_status";
  requestId?: string | null;
  status: RecordingStatus;
  message?: string;
  recordingUrl?: string | null;
  recordingId?: string | null;
  objectKey?: string | null;
  pausedAt?: string | null;
  resumedAt?: string | null;
  errorCode?: string | null;
  /** Stage 5.4.9: build ID stamped by vox:scenario:prepare; echoed from VoxEngine status messages. */
  scenarioBuildId?: string | null;
  /** Stage 5.4.9: source scenario name for runtime cross-check. */
  scenarioSourceName?: string | null;
};

const CONTROL_ACTIONS: ReadonlySet<RecordingControlAction> = new Set([
  "start",
  "pause",
  "resume",
  "stop",
  "status",
]);

const RECORDING_STATUSES: ReadonlySet<RecordingStatus> = new Set([
  "idle",
  "starting",
  "recording",
  "paused",
  "resuming",
  "stopping",
  "stopped",
  "error",
  "not_recording",
]);

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === "object" && value !== null;
}

function isOptionalStringOrNull(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function parseRawJsonObject(raw: unknown): PlainObject | null {
  if (isPlainObject(raw)) {
    return raw;
  }
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecordingControlAction(value: unknown): value is RecordingControlAction {
  return typeof value === "string" && CONTROL_ACTIONS.has(value as RecordingControlAction);
}

function isRecordingStatus(value: unknown): value is RecordingStatus {
  return typeof value === "string" && RECORDING_STATUSES.has(value as RecordingStatus);
}

function isFinitePositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && Math.trunc(value) === value;
}

export function isRecordingControlMessage(
  value: unknown,
): value is RecordingControlMessage {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.type !== "recording_control") {
    return false;
  }
  if (value.protocolVersion !== RECORDING_CONTROL_PROTOCOL_VERSION) {
    return false;
  }
  if (typeof value.signature !== "string" || !value.signature.trim()) {
    return false;
  }

  const claims = value.claims;
  if (!isPlainObject(claims)) {
    return false;
  }
  if (claims.protocolVersion !== RECORDING_CONTROL_PROTOCOL_VERSION) {
    return false;
  }
  if (!isFinitePositiveInteger(claims.issuedAt)) {
    return false;
  }
  if (!isFinitePositiveInteger(claims.expiresAt)) {
    return false;
  }
  if (typeof claims.nonce !== "string" || !claims.nonce.trim()) {
    return false;
  }
  if (!isRecordingControlAction(claims.action)) {
    return false;
  }
  if (typeof claims.requestId !== "string" || !claims.requestId.trim()) {
    return false;
  }
  if (typeof claims.sessionId !== "string" || !claims.sessionId.trim()) {
    return false;
  }
  if (typeof claims.conferenceName !== "string" || !claims.conferenceName.trim()) {
    return false;
  }
  if (typeof claims.participantId !== "string" || !claims.participantId.trim()) {
    return false;
  }
  if (typeof claims.controllerUserId !== "string" || !claims.controllerUserId.trim()) {
    return false;
  }
  if (typeof claims.controllerRole !== "string" || !claims.controllerRole.trim()) {
    return false;
  }
  if (typeof claims.canControlRecording !== "boolean") {
    return false;
  }
  if (typeof claims.webhookBaseUrl !== "string" || !claims.webhookBaseUrl.trim()) {
    return false;
  }
  return true;
}

export function isRecordingStatusMessage(
  value: unknown,
): value is RecordingStatusMessage {
  if (!isPlainObject(value)) {
    return false;
  }
  if (value.type !== "recording_status") {
    return false;
  }
  if (!isRecordingStatus(value.status)) {
    return false;
  }

  return (
    isOptionalStringOrNull(value.requestId) &&
    isOptionalStringOrNull(value.message) &&
    isOptionalStringOrNull(value.recordingUrl) &&
    isOptionalStringOrNull(value.recordingId) &&
    isOptionalStringOrNull(value.objectKey) &&
    isOptionalStringOrNull(value.pausedAt) &&
    isOptionalStringOrNull(value.resumedAt) &&
    isOptionalStringOrNull(value.errorCode)
  );
}

export function parseScenarioMessage(
  raw: unknown,
): RecordingStatusMessage | RecordingControlMessage | null {
  const parsed = parseRawJsonObject(raw);
  if (!parsed) {
    return null;
  }

  if (isRecordingControlMessage(parsed)) {
    return parsed;
  }
  if (isRecordingStatusMessage(parsed)) {
    return parsed;
  }
  return null;
}

type RecordingControlMessageOptions = {
  claims: RecordingControlSignedClaims;
  signature: string;
};

export function createRecordingControlMessage(
  options: RecordingControlMessageOptions,
): RecordingControlMessage {
  return {
    type: "recording_control",
    protocolVersion: RECORDING_CONTROL_PROTOCOL_VERSION,
    claims: options.claims,
    signature: options.signature,
  };
}

/**
 * Future reminder for recording->transcription stages:
 * speaker mapping must remain dynamic (speaker_1, speaker_2, speaker_3, ...).
 * Do not assume only Participant A/B in Voximplant-specific logic.
 */
