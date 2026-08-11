"use client";

import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n/useI18n";

type MediaControlState = "on" | "off" | "locked";

type VoximplantMediaControlsProps = {
  joined: boolean;
  disabled?: boolean;
  busy?: boolean;
  micState: MediaControlState;
  cameraState: MediaControlState;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  trailingMediaControl?: ReactNode;
  statusText?: string | null;
  testIdPrefix?: string;
};

function stateClass(state: MediaControlState): string {
  if (state === "on") {
    return "border-emerald-500/60 bg-emerald-900/40 text-emerald-100 hover:bg-emerald-900/55";
  }
  if (state === "locked") {
    return "border-slate-500/60 bg-slate-700/40 text-slate-200 hover:bg-slate-700/55";
  }
  return "border-rose-500/60 bg-rose-900/35 text-rose-100 hover:bg-rose-900/50";
}

export function VoximplantMediaControls({
  joined,
  disabled,
  busy,
  micState,
  cameraState,
  onToggleMic,
  onToggleCamera,
  trailingMediaControl,
  statusText,
  testIdPrefix = "vox",
}: VoximplantMediaControlsProps) {
  const { t } = useI18n();

  const micLabel =
    micState === "on"
      ? t("room.mediaMicOn")
      : micState === "locked"
        ? t("room.mediaMicLocked")
        : t("room.mediaMicOff");
  const cameraLabel =
    cameraState === "on"
      ? t("room.mediaCameraOn")
      : cameraState === "locked"
        ? t("room.mediaCameraBusyOrUnavailable")
        : t("room.mediaCameraOff");

  return (
    <div className="lk-control-bar flex flex-wrap items-center gap-2 px-3 py-2">
      <button
        type="button"
        onClick={onToggleMic}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${stateClass(micState)}`}
        disabled={!joined || disabled || busy}
        title={micLabel}
        aria-label={micLabel}
        data-state={micState}
        data-testid={`${testIdPrefix}-mic-toggle`}
      >
        {micLabel}
      </button>
      <button
        type="button"
        onClick={onToggleCamera}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${stateClass(cameraState)}`}
        disabled={!joined || disabled || busy}
        title={cameraLabel}
        aria-label={cameraLabel}
        data-state={cameraState}
        data-testid={`${testIdPrefix}-camera-toggle`}
      >
        {cameraLabel}
      </button>
      {trailingMediaControl}
      {statusText ? (
        <span className="basis-full text-xs text-slate-400 sm:ml-auto sm:basis-auto">
          {statusText}
        </span>
      ) : null}
    </div>
  );
}
