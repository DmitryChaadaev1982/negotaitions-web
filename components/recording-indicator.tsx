"use client";

import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  getRecordingDisplayPresentation,
  getRecordingDisplayState,
} from "@/lib/recording-display-state";

type RecordingIndicatorProps = {
  status: string | null | undefined;
  stopOperationState?: string | null | undefined;
  negotiationState?: NegotiationState;
  participantType: ParticipantType;
  isFacilitator: boolean;
  errorMessage?: string | null;
};

export function RecordingIndicator({
  status,
  stopOperationState,
  negotiationState,
  participantType,
  isFacilitator,
  errorMessage,
}: RecordingIndicatorProps) {
  const { t } = useI18n();

  const displayState = getRecordingDisplayState({
    recordingStatus: status,
    stopOperationState,
    negotiationState,
  });

  if (displayState === "none") {
    return null;
  }

  const presentation = getRecordingDisplayPresentation(displayState);

  const showFailureDetails =
    isFacilitator &&
    participantType === ParticipantType.FACILITATOR &&
    displayState === "failed";

  return (
    <div className="space-y-1">
      <span
        data-testid="recording-status"
        data-status={status ?? "NOT_STARTED"}
        data-recording-state={presentation.state}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${
          displayState === "active"
            ? "border-rose-500/40 bg-rose-500/15 text-rose-200"
            : displayState === "paused"
              ? "border-amber-500/40 bg-amber-500/15 text-amber-100"
              : displayState === "stopping"
                ? "border-violet-500/40 bg-violet-500/15 text-violet-100"
                : displayState === "completed"
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-100"
                  : "border-rose-500/40 bg-rose-500/15 text-rose-100"
        }`}
      >
        <span className="h-2 w-2 rounded-full bg-current opacity-80" aria-hidden="true" />
        {t(presentation.labelKey)}
      </span>
      {showFailureDetails ? (
        <p className="max-w-md text-xs text-amber-300">
          {errorMessage ?? t("room.recordingFailedWarning")}
        </p>
      ) : null}
    </div>
  );
}
