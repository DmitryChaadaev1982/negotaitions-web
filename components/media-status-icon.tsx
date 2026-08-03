"use client";

import type {
  ParticipantConnectionStatus,
  ParticipantMediaStatus,
} from "@/lib/voximplant/participant-presence-media-model";

type MediaStatusKind = "mic" | "camera";

function iconTone(
  status: ParticipantMediaStatus,
  connection: ParticipantConnectionStatus,
): string {
  if (connection !== "connected" || status === "unknown") {
    return "text-slate-300 bg-slate-700/70 border-slate-500/60";
  }
  return status === "on"
    ? "text-emerald-200 bg-emerald-700/55 border-emerald-400/70"
    : "text-rose-200 bg-rose-700/55 border-rose-400/70";
}

export function MediaStatusIconBadge({
  kind,
  status,
  connectionStatus = "connected",
  label,
  className = "",
  testId,
  onClick,
  disabled = false,
  busy = false,
  pressed,
}: {
  kind: MediaStatusKind;
  status: ParticipantMediaStatus;
  connectionStatus?: ParticipantConnectionStatus;
  label: string;
  className?: string;
  testId?: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  pressed?: boolean;
}) {
  const commonClassName = `inline-flex h-6 w-6 items-center justify-center rounded-full border ${iconTone(status, connectionStatus)} ${className}`;
  if (onClick) {
    return (
      <button
        type="button"
        className={`${commonClassName} transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617] disabled:cursor-not-allowed disabled:opacity-60 ${
          disabled || busy ? "" : "hover:scale-105"
        }`}
        title={label}
        aria-label={label}
        aria-pressed={pressed}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        onClick={onClick}
        data-testid={testId}
        data-media-kind={kind}
        data-status={connectionStatus === "connected" ? status : "unknown"}
      >
        {kind === "mic" ? <MicStatusIcon status={status} /> : <CameraStatusIcon status={status} />}
      </button>
    );
  }

  return (
    <span
      className={commonClassName}
      title={label}
      aria-label={label}
      role="img"
      data-testid={testId}
      data-media-kind={kind}
      data-status={connectionStatus === "connected" ? status : "unknown"}
    >
      {kind === "mic" ? <MicStatusIcon status={status} /> : <CameraStatusIcon status={status} />}
    </span>
  );
}

function MicStatusIcon({ status }: { status: ParticipantMediaStatus }) {
  const showOffSlash = status === "off";
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="9" y="3" width="6" height="10" rx="3" ry="3" fill="currentColor" />
      <path
        d="M7 10v1a5 5 0 0 0 10 0v-1M12 16v4M9 20h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showOffSlash ? (
        <path
          d="M4 4l16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}

function CameraStatusIcon({ status }: { status: ParticipantMediaStatus }) {
  const showOffSlash = status === "off";
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <rect
        x="3"
        y="7"
        width="13"
        height="10"
        rx="2"
        ry="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M16 10l5-2v8l-5-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {showOffSlash ? (
        <path
          d="M4 4l16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ) : null}
    </svg>
  );
}
