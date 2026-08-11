"use client";

import { NegotiationState } from "@/app/generated/prisma/enums";
import type { ControlState } from "@/lib/negotiation-control";
import { formatSecondsAsMmSs } from "@/lib/negotiation-duration";
import {
  buildRoomTimerPresentation,
  isNegotiationTimerVisible,
  isPreparationTimerVisible,
} from "@/lib/room-timer-presentation";
import { useI18n } from "@/lib/i18n/useI18n";

export function RoomTimerPanel({ controlState }: { controlState: ControlState }) {
  const { t } = useI18n();
  const {
    negotiationState,
    remainingSeconds,
    durationSeconds,
    preparationRemainingSeconds,
    preparationDurationSeconds,
  } = controlState;
  const isManualFinish =
    negotiationState === NegotiationState.FINISHED && remainingSeconds > 0;
  const stateMessage = buildRoomTimerPresentation(controlState);
  const isFinalMinuteState =
    negotiationState === NegotiationState.RUNNING &&
    remainingSeconds > 10 &&
    remainingSeconds <= 60;
  const isFinalTenState =
    negotiationState === NegotiationState.RUNNING &&
    remainingSeconds > 0 &&
    remainingSeconds <= 10;

  const showPreparationTimer = isPreparationTimerVisible(negotiationState);
  const showNegotiationTimer = isNegotiationTimerVisible(negotiationState);

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
      negotiationLabel = isManualFinish
        ? formatSecondsAsMmSs(remainingSeconds)
        : "00:00";
    } else {
      negotiationLabel = formatSecondsAsMmSs(remainingSeconds);
    }
  }

  const panelToneClass =
    stateMessage.tone === "finished"
      ? "border border-emerald-400/70 bg-emerald-900/30"
      : stateMessage.tone === "critical"
        ? "border border-rose-400/70 bg-rose-900/25"
        : stateMessage.tone === "warning"
          ? "border border-amber-400/70 bg-amber-900/25"
          : "border border-slate-700/70 bg-slate-800/90";
  const timerDigitClass =
    stateMessage.tone === "finished"
      ? "text-emerald-200"
      : isFinalTenState
        ? "text-rose-300"
        : isFinalMinuteState
          ? "text-amber-300"
          : negotiationState === NegotiationState.READY_TO_START
            ? "text-slate-300"
            : negotiationState === NegotiationState.PREPARATION ||
                negotiationState === NegotiationState.PREPARATION_RUNNING ||
                negotiationState === NegotiationState.PREPARATION_PAUSED
              ? "text-slate-300"
              : "text-emerald-300";

  return (
    <div
      className={`w-full rounded-xl px-3 py-2 text-center shadow-lg sm:rounded-2xl sm:px-4 sm:py-3 ${panelToneClass}`}
      data-testid="room-server-timer"
      data-state={stateMessage.presentationState}
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
              className={`font-mono text-xl font-semibold tabular-nums sm:text-2xl ${timerDigitClass} ${
                isFinalTenState
                  ? "motion-safe:scale-105 motion-safe:transition-transform motion-reduce:scale-100"
                  : ""
              }`}
            >
              {negotiationLabel}
            </div>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs font-medium text-white/90 sm:text-sm">
        <span
          className="mr-1 inline-block rounded border border-white/40 px-1 text-[10px] align-middle uppercase tracking-wide text-white/80"
          aria-hidden="true"
        >
          {stateMessage.icon}
        </span>
        <span className="align-middle">{t(stateMessage.titleKey)}</span>
      </p>
      {stateMessage.subtitleKey ? (
        <p className="mt-0.5 text-[10px] text-white/60 sm:text-xs">
          {t(stateMessage.subtitleKey)}
        </p>
      ) : null}
    </div>
  );
}
