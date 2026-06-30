"use client";

import { useEffect, useRef } from "react";

type VoxTileParticipant = {
  id: string;
  displayName: string;
  stream: MediaStream | null;
};

/** Mic level 0–100 (used to render the bar and speaking highlight). */
const SPEAKING_THRESHOLD = 8;

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

function VideoTile({
  participant,
  muted,
  label,
  micLevel,
  isSpeaking,
}: {
  participant: VoxTileParticipant;
  muted: boolean;
  label?: string;
  micLevel?: number;
  isSpeaking?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = participant.stream;
  }, [participant.stream]);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border bg-slate-900 transition-all duration-150 ${
        isSpeaking
          ? "border-green-400 shadow-[0_0_0_2px_rgba(74,222,128,0.4)]"
          : "border-slate-700"
      }`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="aspect-video h-full w-full bg-slate-950 object-cover"
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="text-sm text-slate-100">{label ?? participant.displayName}</span>
        {micLevel !== undefined && (
          <MicLevelBar level={micLevel} muted={muted} />
        )}
      </div>
    </div>
  );
}

function NoVideoPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/40 text-sm text-slate-400">
      {message}
    </div>
  );
}

export default function VoximplantVideoLayout({
  localParticipant,
  remoteParticipants,
  isCameraOn,
  isMicMuted,
  micLevel,
  localRoleLabel,
}: {
  localParticipant: VoxTileParticipant | null;
  remoteParticipants: VoxTileParticipant[];
  isCameraOn?: boolean;
  isMicMuted?: boolean;
  micLevel?: number;
  /**
   * Translated participant type label for the local user (e.g. "Участник", "Фасилитатор").
   * Resolved server-side via the sidebar API — same source as the LiveKit room.
   */
  localRoleLabel?: string;
}) {
  const isSpeaking =
    !isMicMuted && micLevel !== undefined && micLevel > SPEAKING_THRESHOLD;

  const localLabel = localParticipant
    ? `${localParticipant.displayName}${localRoleLabel ? ` · ${localRoleLabel}` : ""}${isMicMuted ? " 🔇" : ""}${!isCameraOn ? " 📷✕" : ""}`
    : undefined;

  return (
    <section className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-3 md:grid-cols-2">
      {localParticipant ? (
        <VideoTile
          participant={localParticipant}
          muted
          label={localLabel}
          micLevel={micLevel}
          isSpeaking={isSpeaking}
        />
      ) : (
        <NoVideoPlaceholder
          message={isCameraOn ? "Загрузка видео..." : "Камера выключена"}
        />
      )}
      {remoteParticipants.length === 0 ? (
        <NoVideoPlaceholder message="Ожидание удалённых участников..." />
      ) : (
        remoteParticipants.map((participant) => (
          // TODO (Stage 5.3+): map Voximplant endpoint identity to app user via a
          // server-backed participant directory so we can display the correct role
          // label for remote participants (participant_a / participant_b / facilitator /
          // observer). Until that mapping exists, we show the display name only —
          // never guess or hard-code a role label that could be wrong.
          <VideoTile key={participant.id} participant={participant} muted={false} />
        ))
      )}
    </section>
  );
}
