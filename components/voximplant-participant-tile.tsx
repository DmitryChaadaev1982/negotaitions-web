"use client";

import { useEffect, useRef } from "react";

export type VoxTileMicState = "on" | "off" | "system_muted" | "unknown";

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
  micState,
  micStateLabel,
  micStateHint,
  micLevel,
  isSpeaking,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  title: string;
  subtitle?: string;
  micState: VoxTileMicState;
  micStateLabel: string;
  micStateHint?: string;
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
      className={`relative overflow-hidden rounded-xl border bg-slate-900 transition-all duration-150 ${
        isSpeaking
          ? "border-green-400 shadow-[0_0_0_2px_rgba(74,222,128,0.4)]"
          : micState === "system_muted"
            ? "border-slate-600"
            : micState === "on"
              ? "border-emerald-600/80"
              : micState === "off"
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
          <span
            className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
              micState === "on"
                ? "bg-emerald-500/20 text-emerald-200"
                : micState === "system_muted"
                  ? "bg-slate-500/20 text-slate-200"
                  : micState === "off"
                    ? "bg-rose-500/20 text-rose-200"
                    : "bg-slate-500/20 text-slate-200"
            }`}
            title={micStateHint}
            aria-label={micStateHint}
          >
            {micStateLabel}
          </span>
        </div>
        {micLevel !== undefined && (
          <MicLevelBar level={micLevel} muted={muted} />
        )}
      </div>
    </div>
  );
}
