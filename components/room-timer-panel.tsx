"use client";

import { NegotiationState, ParticipantType } from "@/app/generated/prisma/enums";
import type { ControlState } from "@/lib/negotiation-control";
import { formatSecondsAsMmSs } from "@/lib/negotiation-duration";
import { useI18n } from "@/lib/i18n/useI18n";

function getStateMessage(
  negotiationState: NegotiationState,
  participantType: ParticipantType,
  controlState: ControlState,
  t: ReturnType<typeof useI18n>["t"],
) {
  switch (negotiationState) {
    case NegotiationState.PREPARATION:
      return {
        title: t("room.preparation"),
        subtitle: t("room.participantsCanPrepare"),
      };
    case NegotiationState.PREPARATION_RUNNING:
      return {
        title: t("room.preparation"),
        subtitle: controlState.preparationTimeOver ? t("room.preparationTimeOver") : null,
      };
    case NegotiationState.PREPARATION_PAUSED:
      return {
        title: t("room.preparationPaused"),
        subtitle: null,
      };
    case NegotiationState.READY_TO_START:
      return {
        title: controlState.preparationTimeOver
          ? t("room.preparationTimeOver")
          : t("room.readyToStartNegotiation"),
        subtitle: null,
      };
    case NegotiationState.RUNNING:
      return {
        title: t("room.negotiationInProgress"),
        subtitle:
          participantType === ParticipantType.PARTICIPANT
            ? null
            : t("room.microphoneMutedDuringNegotiation"),
      };
    case NegotiationState.PAUSED:
      return {
        title: t("room.pausedByFacilitator"),
        subtitle: null,
      };
    case NegotiationState.FINISHED:
      return {
        title: t("room.negotiationFinishedDebrief"),
        subtitle: null,
      };
    default:
      return { title: "", subtitle: null };
  }
}

export function RoomTimerPanel({ controlState }: { controlState: ControlState }) {
  const { t } = useI18n();
  const {
    negotiationState,
    remainingSeconds,
    durationSeconds,
    preparationRemainingSeconds,
    preparationDurationSeconds,
  } = controlState;
  const isNegotiationExpired =
    negotiationState === NegotiationState.RUNNING && remainingSeconds === 0;

  const showPreparationTimer =
    negotiationState === NegotiationState.PREPARATION ||
    negotiationState === NegotiationState.PREPARATION_RUNNING ||
    negotiationState === NegotiationState.PREPARATION_PAUSED;

  const showNegotiationTimer =
    negotiationState === NegotiationState.READY_TO_START ||
    negotiationState === NegotiationState.RUNNING ||
    negotiationState === NegotiationState.PAUSED ||
    negotiationState === NegotiationState.FINISHED;

  let preparationLabel: string | null = null;
  if (showPreparationTimer) {
    if (negotiationState === NegotiationState.PREPARATION) {
      preparationLabel = formatSecondsAsMmSs(preparationDurationSeconds);
    } else {
      preparationLabel = formatSecondsAsMmSs(preparationRemainingSeconds);
    }
  }

  let negotiationLabel: string | null = null;
  if (showNegotiationTimer) {
    if (negotiationState === NegotiationState.READY_TO_START) {
      negotiationLabel = formatSecondsAsMmSs(durationSeconds);
    } else if (negotiationState === NegotiationState.FINISHED) {
      negotiationLabel = formatSecondsAsMmSs(remainingSeconds);
    } else {
      negotiationLabel = isNegotiationExpired
        ? "00:00"
        : formatSecondsAsMmSs(remainingSeconds);
    }
  }

  const stateMessage = getStateMessage(
    negotiationState,
    controlState.participantType,
    controlState,
    t,
  );

  return (
    <div
      className="w-full rounded-xl bg-slate-800/90 px-3 py-2 text-center shadow-lg sm:rounded-2xl sm:px-4 sm:py-3"
      data-testid="room-server-timer"
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {preparationLabel ? (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:text-xs">
              {t("room.preparation")}
            </p>
            <div className="font-mono text-xl font-semibold tabular-nums text-slate-300 sm:text-2xl">
              {preparationLabel}
            </div>
          </div>
        ) : null}
        {negotiationLabel ? (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:text-xs">
              {t("room.negotiation")}
            </p>
            <div
              className={`font-mono text-xl font-semibold tabular-nums sm:text-2xl ${
                isNegotiationExpired
                  ? "text-rose-400"
                  : remainingSeconds <= 60 && negotiationState === NegotiationState.RUNNING
                    ? "text-amber-400"
                    : negotiationState === NegotiationState.READY_TO_START
                      ? "text-slate-300"
                      : "text-emerald-400"
              }`}
            >
              {negotiationLabel}
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs font-medium text-white/90 sm:text-sm">{stateMessage.title}</p>
      {stateMessage.subtitle ? (
        <p className="mt-0.5 text-[10px] text-white/60 sm:text-xs">{stateMessage.subtitle}</p>
      ) : null}
    </div>
  );
}
