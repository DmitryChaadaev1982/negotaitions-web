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

export type RecordingControlMessage = {
  type: "recording_control";
  action: RecordingControlAction;
  requestId: string;
  sessionId?: string;
  participantId?: string;
  role?: VoximplantRoomRole;
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

const ROOM_ROLES: ReadonlySet<VoximplantRoomRole> = new Set([
  "participant_a",
  "participant_b",
  "facilitator",
  "observer",
  "unknown",
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

function isVoximplantRoomRole(value: unknown): value is VoximplantRoomRole {
  return typeof value === "string" && ROOM_ROLES.has(value as VoximplantRoomRole);
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
  if (!isRecordingControlAction(value.action)) {
    return false;
  }
  if (typeof value.requestId !== "string" || !value.requestId.trim()) {
    return false;
  }
  if (value.sessionId !== undefined && typeof value.sessionId !== "string") {
    return false;
  }
  if (value.participantId !== undefined && typeof value.participantId !== "string") {
    return false;
  }
  if (value.role !== undefined && !isVoximplantRoomRole(value.role)) {
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
  requestId: string;
  sessionId?: string;
  participantId?: string;
  role?: VoximplantRoomRole;
};

export function createRecordingControlMessage(
  action: RecordingControlAction,
  options: RecordingControlMessageOptions,
): RecordingControlMessage {
  return {
    type: "recording_control",
    action,
    requestId: options.requestId,
    sessionId: options.sessionId,
    participantId: options.participantId,
    role: options.role,
  };
}

/**
 * Future reminder for recording->transcription stages:
 * speaker mapping must remain dynamic (speaker_1, speaker_2, speaker_3, ...).
 * Do not assume only Participant A/B in Voximplant-specific logic.
 */
