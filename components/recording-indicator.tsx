"use client";

import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";
import { useI18n } from "@/lib/i18n/useI18n";

type RecordingIndicatorProps = {
  status: string | null | undefined;
  negotiationState?: NegotiationState;
  participantType: ParticipantType;
  isFacilitator: boolean;
  errorMessage?: string | null;
};

function resolveEffectiveStatus(
  status: string,
  negotiationState?: NegotiationState,
) {
  if (
    negotiationState === "PAUSED" &&
    (status === "RECORDING" || status === "STARTING" || status === "PAUSED")
  ) {
    return "RECORDING";
  }

  return status;
}

function getIndicatorLabel(
  status: string,
  labels: {
    recording: string;
    paused: string;
    failed: string;
    processing: string;
    completed: string;
  },
) {
  switch (status) {
    case "RECORDING":
    case "STARTING":
      return labels.recording;
    case "PAUSED":
      return labels.paused;
    case "FAILED":
      return labels.failed;
    case "PROCESSING":
    case "STOPPED":
      return labels.processing;
    case "COMPLETED":
      return labels.completed;
    default:
      return null;
  }
}

function getIndicatorClass(status: string) {
  switch (status) {
    case "RECORDING":
    case "STARTING":
      return "border-rose-500/40 bg-rose-500/15 text-rose-200";
    case "PAUSED":
      return "border-amber-500/40 bg-amber-500/15 text-amber-100";
    case "FAILED":
      return "border-amber-500/40 bg-amber-500/15 text-amber-100";
    case "PROCESSING":
    case "STOPPED":
      return "border-blue-500/40 bg-blue-500/15 text-blue-100";
    case "COMPLETED":
      return "border-emerald-500/40 bg-emerald-500/15 text-emerald-100";
    default:
      return "border-slate-600/40 bg-slate-800/60 text-slate-300";
  }
}

export function RecordingIndicator({
  status,
  negotiationState,
  participantType,
  isFacilitator,
  errorMessage,
}: RecordingIndicatorProps) {
  const { t } = useI18n();

  if (!status || status === "NOT_STARTED") {
    return null;
  }

  const effectiveStatus = resolveEffectiveStatus(status, negotiationState);

  const label = getIndicatorLabel(effectiveStatus, {
    recording: t("room.recordingIndicator"),
    paused: t("room.recordingPausedIndicator"),
    failed: t("room.recordingFailedIndicator"),
    processing: t("room.recordingProcessingIndicator"),
    completed: t("room.recordingCompletedIndicator"),
  });
  if (!label) {
    return null;
  }

  const showFailureDetails =
    isFacilitator &&
    participantType === ParticipantType.FACILITATOR &&
    effectiveStatus === "FAILED";

  return (
    <div className="space-y-1">
      <span
        data-testid="recording-status"
        data-status={effectiveStatus}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${getIndicatorClass(effectiveStatus)}`}
      >
        <span className="h-2 w-2 rounded-full bg-current opacity-80" aria-hidden="true" />
        {label}
      </span>
      {showFailureDetails ? (
        <p className="max-w-md text-xs text-amber-300">
          {errorMessage ?? t("room.recordingFailedWarning")}
        </p>
      ) : null}
    </div>
  );
}
