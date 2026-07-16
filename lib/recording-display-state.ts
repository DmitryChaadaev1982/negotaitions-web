export type RecordingDisplayState =
  | "active"
  | "paused"
  | "stopping"
  | "completed"
  | "failed"
  | "none";

export type RecordingDisplayPresentation = {
  state: RecordingDisplayState;
  labelKey:
    | "recording.recordingInProgress"
    | "recording.recordingPaused"
    | "recording.recordingStopping"
    | "recording.recordingCompleted"
    | "recording.recordingFailed"
    | "recording.noRecording";
  className: string;
};

function normalizeRecordingStatus(status: string | null | undefined) {
  if (!status) {
    return null;
  }

  return status.toUpperCase();
}

function normalizeStopOperationState(state: string | null | undefined) {
  if (!state) {
    return null;
  }

  return state.toUpperCase();
}

function isFailedStatus(status: string | null) {
  return status === "FAILED";
}

function isCompletedStatus(status: string | null) {
  return status === "COMPLETED" || status === "STOPPED" || status === "PROCESSING";
}

function hasDurableStopIntent(state: string | null) {
  return state === "PENDING" || state === "DELIVERING" || state === "DELIVERED";
}

function isPausedStatus(status: string | null) {
  return status === "PAUSED";
}

function isActiveStatus(status: string | null) {
  return status === "RECORDING" || status === "STARTING";
}

export function getRecordingDisplayState(input: {
  recordingStatus: string | null | undefined;
  stopOperationState?: string | null | undefined;
  sessionStatus?: string | null | undefined;
  negotiationState?: string | null | undefined;
  roomLifecycle?: string | null | undefined;
}): RecordingDisplayState {
  const recordingStatus = normalizeRecordingStatus(input.recordingStatus);
  const stopOperationState = normalizeStopOperationState(input.stopOperationState);

  if (isFailedStatus(recordingStatus)) {
    return "failed";
  }

  if (isCompletedStatus(recordingStatus)) {
    return "completed";
  }

  if (hasDurableStopIntent(stopOperationState)) {
    return "stopping";
  }

  if (isPausedStatus(recordingStatus)) {
    return "paused";
  }

  if (isActiveStatus(recordingStatus)) {
    return "active";
  }

  return "none";
}

export function getRecordingDisplayPresentation(
  state: RecordingDisplayState,
): RecordingDisplayPresentation {
  if (state === "active") {
    return {
      state,
      labelKey: "recording.recordingInProgress",
      className: "text-rose-300",
    };
  }
  if (state === "paused") {
    return {
      state,
      labelKey: "recording.recordingPaused",
      className: "text-amber-300",
    };
  }
  if (state === "stopping") {
    return {
      state,
      labelKey: "recording.recordingStopping",
      className: "text-amber-300",
    };
  }
  if (state === "completed") {
    return {
      state,
      labelKey: "recording.recordingCompleted",
      className: "text-emerald-300",
    };
  }
  if (state === "failed") {
    return {
      state,
      labelKey: "recording.recordingFailed",
      className: "text-rose-300",
    };
  }

  return {
    state: "none",
    labelKey: "recording.noRecording",
    className: "text-slate-400",
  };
}
