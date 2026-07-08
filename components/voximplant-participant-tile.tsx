"use client";

import { useEffect, useRef } from "react";

import type {
  ParticipantConnectionStatus,
  ParticipantMediaStatus,
} from "@/lib/voximplant/participant-presence-media-model";

function MicLevelBar({ level, muted }: { level: number; muted: boolean }) {
  const filled = muted ? 0 : Math.min(100, level);
  return (
    <div className="flex items-center gap-1">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-700">
        <div
          className={`h-full rounded-full transition-all duration-75 ${
            filled > 40 ? "bg-green-400" : filled > 15 ? "bg-green-500" : "bg-green-600"
          }`}
          style={{ width: `${filled}%` }}
        />
      </div>
    </div>
  );
}

export function VoximplantParticipantTile({
  stream,
  muted,
  title,
  subtitle,
  connectionStatus,
  micStatus,
  cameraStatus,
  micLabel,
  cameraLabel,
  micLevel,
  isSpeaking,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  title: string;
  subtitle?: string;
  connectionStatus: ParticipantConnectionStatus;
  micStatus: ParticipantMediaStatus;
  cameraStatus: ParticipantMediaStatus;
  micLabel: string;
  cameraLabel: string;
  micLevel?: number;
  isSpeaking?: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
  }, [stream]);

  const iconTone = (
    status: ParticipantMediaStatus,
    connection: ParticipantConnectionStatus,
  ): string => {
    if (connection !== "connected" || status === "unknown") {
      return "text-slate-300 bg-slate-700/70 border-slate-500/60";
    }
    return status === "on"
      ? "text-emerald-200 bg-emerald-700/55 border-emerald-400/70"
      : "text-rose-200 bg-rose-700/55 border-rose-400/70";
  };

  return (
    <div
      className={`relative box-border min-w-0 overflow-hidden rounded-xl border bg-slate-900 transition-all duration-150 ${
        isSpeaking
          ? "border-green-400 shadow-[0_0_0_2px_rgba(74,222,128,0.4)]"
          : connectionStatus !== "connected"
            ? "border-slate-600/70"
            : micStatus === "on"
              ? "border-emerald-600/80"
              : micStatus === "off"
                ? "border-rose-700/70"
                : "border-slate-600/70"
      } ${className ?? ""}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="aspect-video h-full w-full bg-slate-950 object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <div className="min-w-0">
          <span className="block truncate text-sm text-slate-100">{title}</span>
          {subtitle ? (
            <span className="block truncate text-xs text-slate-300">{subtitle}</span>
          ) : null}
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${iconTone(micStatus, connectionStatus)}`}
              title={micLabel}
              aria-label={micLabel}
              role="img"
              data-testid="participant-tile-mic-status-icon"
              data-status={connectionStatus === "connected" ? micStatus : "unknown"}
            >
              <MicStatusIcon status={micStatus} />
            </span>
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${iconTone(cameraStatus, connectionStatus)}`}
              title={cameraLabel}
              aria-label={cameraLabel}
              role="img"
              data-testid="participant-tile-camera-status-icon"
              data-status={connectionStatus === "connected" ? cameraStatus : "unknown"}
            >
              <CameraStatusIcon status={cameraStatus} />
            </span>
          </div>
        </div>
        {micLevel !== undefined && (
          <MicLevelBar level={micLevel} muted={muted} />
        )}
      </div>
    </div>
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
      <rect x="3" y="7" width="13" height="10" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="2" />
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
