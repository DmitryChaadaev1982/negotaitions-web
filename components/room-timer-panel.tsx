"use client";

import { useEffect, useState } from "react";

import { NegotiationState } from "@/app/generated/prisma/enums";
import type { ControlState } from "@/lib/negotiation-control";
import { formatSecondsAsMmSs } from "@/lib/negotiation-duration";
import {
  coalesceFinishLineDeadlineMs,
  computeFinishLineClientDeadlineMs,
} from "@/lib/live-session-presentation";
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
  const [finishLineDeadlineMs, setFinishLineDeadlineMs] = useState<number | null>(
    null,
  );
  const [finishLineClockMs, setFinishLineClockMs] = useState(() => Date.now());

  useEffect(() => {
    if (negotiationState !== NegotiationState.FINISHED) {
      queueMicrotask(() => setFinishLineDeadlineMs(null));
      return;
    }
    const candidateDeadlineMs = computeFinishLineClientDeadlineMs({
      negotiationEndedAt: controlState.negotiationEndedAt ?? null,
      serverNow: controlState.serverNow ?? null,
      clientNowMs: Date.now(),
    });
    queueMicrotask(() => {
      setFinishLineDeadlineMs((currentDeadlineMs) =>
        coalesceFinishLineDeadlineMs(currentDeadlineMs, candidateDeadlineMs),
      );
    });
  }, [
    controlState.negotiationEndedAt,
    controlState.serverNow,
    negotiationState,
  ]);

  useEffect(() => {
    if (finishLineDeadlineMs == null) {
      return;
    }
    const remainingMs = finishLineDeadlineMs - Date.now();
    if (remainingMs <= 0) {
      queueMicrotask(() => setFinishLineClockMs(Date.now()));
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setFinishLineClockMs(Date.now());
    }, remainingMs + 1);
    return () => window.clearTimeout(timeoutId);
  }, [finishLineDeadlineMs]);

  const finishLineActive =
    negotiationState === NegotiationState.FINISHED &&
    finishLineDeadlineMs != null &&
    finishLineClockMs < finishLineDeadlineMs;

  const isManualFinish =
    negotiationState === NegotiationState.FINISHED && remainingSeconds > 0;
  const stateMessage = buildRoomTimerPresentation({
    ...controlState,
    finishLineActive,
  });
  const isFinalTenState = stateMessage.presentationState === "FINAL_10_SECONDS";

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
  const visibleTimerCount =
    Number(Boolean(preparationLabel)) + Number(Boolean(negotiationLabel));

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
      : stateMessage.tone === "critical"
        ? "text-rose-300"
        : stateMessage.tone === "warning"
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
      <div
        className={
          visibleTimerCount <= 1
            ? "flex justify-center gap-2"
            : "grid grid-cols-1 gap-2 sm:grid-cols-2"
        }
      >
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
      <p className="mt-2 text-sm font-medium text-white/90 sm:text-base">
        <span className="inline-flex h-24 w-24 shrink-0 items-center justify-center align-middle">
          <img
            src={stateMessage.badgePath}
            alt=""
            aria-hidden="true"
            className="h-24 w-24 object-contain"
            decoding="async"
            data-testid="room-status-badge-image"
          />
        </span>
        <span className="ml-2 align-middle">{t(stateMessage.titleKey)}</span>
      </p>
      {stateMessage.subtitleKey ? (
        <p className="mt-0.5 text-[10px] text-white/60 sm:text-xs">
          {t(stateMessage.subtitleKey)}
        </p>
      ) : null}
    </div>
  );
}
