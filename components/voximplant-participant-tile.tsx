"use client";

import { useEffect, useRef } from "react";

import type {
  ParticipantConnectionStatus,
  ParticipantMediaStatus,
} from "@/lib/voximplant/participant-presence-media-model";
import { MediaStatusIconBadge } from "@/components/media-status-icon";

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

  return (
    <div
      className={`relative box-border min-w-0 overflow-hidden rounded-xl border bg-slate-900 transition-all duration-150 ${
        // Visual precedence: stale/disconnected, muted, speaking, connected/default.
        connectionStatus !== "connected"
          ? "border-slate-600/70"
          : micStatus === "off"
            ? "border-rose-700/70"
            : micStatus === "on" && isSpeaking
              ? "border-green-400 shadow-[0_0_0_2px_rgba(74,222,128,0.4)]"
              : micStatus === "on"
                ? "border-emerald-600/80"
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
            <MediaStatusIconBadge
              kind="mic"
              status={micStatus}
              connectionStatus={connectionStatus}
              label={micLabel}
              testId="participant-tile-mic-status-icon"
            />
            <MediaStatusIconBadge
              kind="camera"
              status={cameraStatus}
              connectionStatus={connectionStatus}
              label={cameraLabel}
              testId="participant-tile-camera-status-icon"
            />
          </div>
        </div>
        {micLevel !== undefined && (
          <MicLevelBar level={micLevel} muted={muted} />
        )}
      </div>
    </div>
  );
}
