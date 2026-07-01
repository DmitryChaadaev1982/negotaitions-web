type RecordingAction = "start" | "stop" | "status";

export type RecordingStatusPayload = {
  conferenceName: string;
  mode: "scenario_controlled";
  status: "scenario_controlled";
  implemented: false;
  recordingStorage: "s3" | "voximplant_cloud" | "unknown";
  requestedAction: RecordingAction;
  operationId: null;
  callId: null;
  conferenceId: string | null;
  recordingUrl: string | null;
  recordingPath: string | null;
  recordingAssetId: string | null;
  lastActionAt: string;
  message: string;
  diagnostics: string[];
};

const recordingStatusByConference = new Map<string, RecordingStatusPayload>();

function nowIso(): string {
  return new Date().toISOString();
}

function buildDiagnostics(storage: "s3" | "voximplant_cloud" | "unknown"): string[] {
  if (storage === "s3") {
    return [
      "Recording destination is configured in Voximplant Console as S3-compatible storage.",
      "Use VoxEngine logs to capture recording URL/path from RecorderEvents.Started.",
      "Verify saved object in Yandex Object Storage bucket configured in Voximplant Console.",
    ];
  }

  if (storage === "voximplant_cloud") {
    return [
      "Recording destination appears to be Voximplant cloud storage.",
      "Use VoxEngine logs and call history/recordings API to fetch recording URL/id.",
      "Treat this as temporary PoC fallback before forcing S3-compatible storage.",
    ];
  }

  return [
    "Recording storage mode is not explicitly configured.",
    "Confirm storage in Voximplant Console (App -> Recording storage).",
    "Use VoxEngine logs to collect recording URL/path and destination details.",
  ];
}

export function getScenarioControlledRecordingStatus(input: {
  conferenceName: string;
  action: RecordingAction;
  storage: "s3" | "voximplant_cloud" | "unknown";
}): RecordingStatusPayload {
  const existing = recordingStatusByConference.get(input.conferenceName);
  const payload: RecordingStatusPayload = {
    conferenceName: input.conferenceName,
    mode: "scenario_controlled",
    status: "scenario_controlled",
    implemented: false,
    recordingStorage: input.storage,
    requestedAction: input.action,
    operationId: null,
    callId: null,
    conferenceId: input.conferenceName,
    recordingUrl: null,
    recordingPath: null,
    recordingAssetId: null,
    lastActionAt: nowIso(),
    message:
      input.action === "start"
        ? "Manual start API is not implemented in this PoC. Recording is controlled inside VoxEngine scenario based on participant count."
        : input.action === "stop"
          ? "Manual stop API is not implemented in this PoC. Recording stop is controlled inside VoxEngine scenario when participants leave or conference ends."
          : "Scenario-controlled mode active. Use VoxEngine logs for recording URL/path and final storage destination confirmation.",
    diagnostics: buildDiagnostics(input.storage),
  };

  const merged = {
    ...existing,
    ...payload,
    diagnostics: payload.diagnostics,
    lastActionAt: payload.lastActionAt,
  };
  recordingStatusByConference.set(input.conferenceName, merged);
  return merged;
}
