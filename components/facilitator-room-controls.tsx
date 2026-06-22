"use client";

import type { ControlAction, ControlState } from "@/lib/negotiation-control";
import {
  MAX_NEGOTIATION_DURATION_MINUTES,
  MIN_NEGOTIATION_DURATION_MINUTES,
  secondsToDisplayMinutes,
} from "@/lib/negotiation-duration";
import { useI18n } from "@/lib/i18n/useI18n";
import { useCallback, useState } from "react";

type FacilitatorRoomControlsProps = {
  sessionId: string;
  joinToken: string;
  controlState: ControlState;
  onControlStateChange: (state: ControlState) => void;
  onRecordingStateChange?: (state: {
    status: string;
    errorMessage: string | null;
  } | null) => void;
};

type LobbyControlsProps = {
  sessionId: string;
  joinToken: string;
  controlState: ControlState;
  onControlStateChange: (state: ControlState) => void;
  isSubmitting: boolean;
  setIsSubmitting: (value: boolean) => void;
  onStart: () => void;
  actionButtonClass: string;
};

function LobbyControls({
  sessionId,
  joinToken,
  controlState,
  onControlStateChange,
  isSubmitting,
  setIsSubmitting,
  onStart,
  actionButtonClass,
}: LobbyControlsProps) {
  const { t } = useI18n();
  const [durationMinutes, setDurationMinutes] = useState(
    secondsToDisplayMinutes(controlState.durationSeconds),
  );
  const [durationError, setDurationError] = useState<string | null>(null);

  const saveDuration = useCallback(async () => {
    setDurationError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/sessions/${sessionId}/duration`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ joinToken, durationMinutes }),
      });

      const payload = (await response.json()) as
        | { durationSeconds: number; error?: string }
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : t("room.unableToUpdateDuration"),
        );
      }

      if ("durationSeconds" in payload) {
        onControlStateChange({
          ...controlState,
          durationSeconds: payload.durationSeconds,
          remainingSeconds: payload.durationSeconds,
        });
      }
    } catch (durationUpdateError) {
      setDurationError(
        durationUpdateError instanceof Error
          ? durationUpdateError.message
          : t("room.unableToUpdateDuration"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [
    controlState,
    durationMinutes,
    joinToken,
    onControlStateChange,
    sessionId,
    setIsSubmitting,
    t,
  ]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex items-center gap-2">
        <label htmlFor="room-duration-minutes" className="sr-only">
          {t("room.durationMinutesLabel")}
        </label>
        <input
          id="room-duration-minutes"
          type="number"
          min={MIN_NEGOTIATION_DURATION_MINUTES}
          max={MAX_NEGOTIATION_DURATION_MINUTES}
          value={durationMinutes}
          onChange={(event) =>
            setDurationMinutes(Number(event.target.value))
          }
          className="w-20 rounded-md border border-slate-600 bg-slate-800 px-2 py-2 text-sm text-white"
          aria-label={t("room.durationMinutesLabel")}
        />
        <span className="text-sm text-slate-400">{t("room.min")}</span>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void saveDuration()}
          className={`${actionButtonClass} border border-slate-600 text-white hover:bg-slate-800`}
        >
          {t("room.save")}
        </button>
      </div>
      {durationError ? (
        <p className="w-full text-xs text-rose-400 sm:w-auto">{durationError}</p>
      ) : null}
      <button
        type="button"
        disabled={isSubmitting}
        onClick={onStart}
        className={`${actionButtonClass} bg-emerald-600 text-white hover:bg-emerald-500`}
      >
        {t("room.startNegotiation")}
      </button>
    </div>
  );
}

export function FacilitatorRoomControls({
  sessionId,
  joinToken,
  controlState,
  onControlStateChange,
  onRecordingStateChange,
}: FacilitatorRoomControlsProps) {
  const { t } = useI18n();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recordingWarning, setRecordingWarning] = useState<string | null>(null);

  const runAction = useCallback(
    async (action: ControlAction) => {
      setIsSubmitting(true);
      setRecordingWarning(null);

      try {
        const response = await fetch(`/api/sessions/${sessionId}/control`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joinToken, action }),
        });

        const payload = (await response.json()) as ControlState & {
          error?: string;
          recordingWarning?: string;
          recording?: { status: string; errorMessage: string | null } | null;
        };

        if (!response.ok) {
          throw new Error(
            payload.error ? payload.error : "Unable to update negotiation state.",
          );
        }

        onControlStateChange(payload);
        onRecordingStateChange?.(payload.recording ?? null);

        if (payload.recordingWarning) {
          setRecordingWarning(payload.recordingWarning);
        }
      } catch (actionError) {
        console.error(actionError);
      } finally {
        setIsSubmitting(false);
      }
    },
    [joinToken, onControlStateChange, onRecordingStateChange, sessionId],
  );

  const { negotiationState } = controlState;

  const actionButtonClass =
    "inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

  const statusMessage = {
    LOBBY: t("room.readyToStart"),
    RUNNING: t("room.negotiationInProgress"),
    PAUSED: t("room.negotiationPaused"),
    FINISHED: t("room.negotiationFinishedDebrief"),
  }[negotiationState];

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {t("room.facilitatorControls")}
        </p>
        <p className="mt-0.5 text-sm text-slate-300">{statusMessage}</p>
        {recordingWarning ? (
          <p className="mt-1 max-w-xl text-xs text-amber-300">{recordingWarning}</p>
        ) : null}
      </div>

      {negotiationState === "LOBBY" ? (
        <LobbyControls
          key={controlState.durationSeconds}
          sessionId={sessionId}
          joinToken={joinToken}
          controlState={controlState}
          onControlStateChange={onControlStateChange}
          isSubmitting={isSubmitting}
          setIsSubmitting={setIsSubmitting}
          onStart={() => void runAction("START")}
          actionButtonClass={actionButtonClass}
        />
      ) : null}

      {negotiationState === "RUNNING" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void runAction("PAUSE")}
            className={`${actionButtonClass} bg-amber-600 text-white hover:bg-amber-500`}
          >
            {t("room.pauseNegotiation")}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void runAction("FINISH")}
            className={`${actionButtonClass} border border-slate-600 text-white hover:bg-slate-800`}
          >
            {t("room.finishEarly")}
          </button>
        </div>
      ) : null}

      {negotiationState === "PAUSED" ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void runAction("RESUME")}
            className={`${actionButtonClass} bg-emerald-600 text-white hover:bg-emerald-500`}
          >
            {t("room.resumeNegotiation")}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => void runAction("FINISH")}
            className={`${actionButtonClass} border border-slate-600 text-white hover:bg-slate-800`}
          >
            {t("room.finishEarly")}
          </button>
        </div>
      ) : null}

      {negotiationState === "FINISHED" ? (
        <p className="text-sm text-slate-400">{t("room.sessionCompleteDebrief")}</p>
      ) : null}
    </div>
  );
}
