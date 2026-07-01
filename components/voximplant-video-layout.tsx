"use client";

import { ParticipantType } from "@/app/generated/prisma/enums";
import { RoomTimerPanel } from "@/components/room-timer-panel";
import type { ControlState } from "@/lib/negotiation-control";
import type { SessionRosterEntry } from "@/lib/room-sidebar-types";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

type VoxTileParticipant = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
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
  title,
  subtitle,
  micLevel,
  isSpeaking,
  diagnostic,
}: {
  participant: VoxTileParticipant;
  muted: boolean;
  title: string;
  subtitle?: string;
  micLevel?: number;
  isSpeaking?: boolean;
  diagnostic?: string;
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
        <div className="min-w-0">
          <span className="block truncate text-sm text-slate-100">{title}</span>
          {subtitle ? (
            <span className="block truncate text-xs text-slate-300">{subtitle}</span>
          ) : null}
          {diagnostic ? (
            <span className="block truncate text-[10px] text-amber-300">{diagnostic}</span>
          ) : null}
        </div>
        {micLevel !== undefined && (
          <MicLevelBar level={micLevel} muted={muted} />
        )}
      </div>
    </div>
  );
}

function NoVideoPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-2 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

type ResolvedRoleInfo = {
  participantType: ParticipantType | null;
  roleLabel: string | null;
  caseRoleName: string | null;
  diagnosticLabel: string | null;
};

type ResolvedVoxTile = {
  participant: VoxTileParticipant;
  role: ResolvedRoleInfo;
};

function normalizeEndpointUsername(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.includes("@") ? normalized.split("@")[0] ?? null : normalized;
}

function roleLabelFromParticipantType(participantType: ParticipantType): string {
  if (participantType === "FACILITATOR") return "Facilitator";
  if (participantType === "OBSERVER") return "Observer";
  return "Participant";
}

function splitParticipants(participants: ResolvedVoxTile[]) {
  return {
    participantOne: participants[0] ?? null,
    participantTwo: participants[1] ?? null,
    extras: participants.slice(2),
  };
}

function RoleSection({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2" data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export default function VoximplantVideoLayout({
  localParticipant,
  remoteParticipants,
  roster,
  controlState,
  localParticipantType,
  localCaseRoleName,
  isCameraOn,
  isMicMuted,
  micLevel,
  localRoleLabel,
}: {
  localParticipant: VoxTileParticipant | null;
  remoteParticipants: VoxTileParticipant[];
  roster: SessionRosterEntry[];
  controlState: ControlState;
  localParticipantType: ParticipantType;
  localCaseRoleName: string | null;
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

  const rosterByVoxUsername = useMemo(() => {
    const map = new Map<string, SessionRosterEntry>();
    for (const entry of roster) {
      const normalized = normalizeEndpointUsername(entry.voximplantProviderUsername);
      if (!normalized) continue;
      if (!map.has(normalized)) {
        map.set(normalized, entry);
      }
    }
    return map;
  }, [roster]);

  const resolvedRemoteTiles = useMemo<ResolvedVoxTile[]>(() => {
    return remoteParticipants.map((participant) => {
      const endpointUsername = normalizeEndpointUsername(participant.endpointUsername);
      const rosterEntry = endpointUsername ? rosterByVoxUsername.get(endpointUsername) : null;

      if (!rosterEntry) {
        return {
          participant,
          role: {
            participantType: null,
            roleLabel: null,
            caseRoleName: null,
            diagnosticLabel: "Unknown participant",
          },
        };
      }

      return {
        participant,
        role: {
          participantType: rosterEntry.participantType,
          roleLabel: roleLabelFromParticipantType(rosterEntry.participantType),
          caseRoleName: rosterEntry.caseRoleName,
          diagnosticLabel: null,
        },
      };
    });
  }, [remoteParticipants, rosterByVoxUsername]);

  const facilitatorTiles = resolvedRemoteTiles.filter(
    (tile) => tile.role.participantType === "FACILITATOR",
  );
  const participantTiles = resolvedRemoteTiles.filter(
    (tile) => tile.role.participantType === "PARTICIPANT",
  );
  const observerTiles = resolvedRemoteTiles.filter(
    (tile) => tile.role.participantType === "OBSERVER",
  );
  const unknownTiles = resolvedRemoteTiles.filter(
    (tile) => tile.role.participantType === null,
  );
  const { participantOne, participantTwo, extras: extraParticipants } =
    splitParticipants(participantTiles);

  const localSubtitle = `${localRoleLabel ?? roleLabelFromParticipantType(localParticipantType)}${
    localCaseRoleName ? ` · ${localCaseRoleName}` : ""
  }${isMicMuted ? " · Muted" : ""}${!isCameraOn ? " · Camera off" : ""}`;

  return (
    <section className="min-h-0 flex-1 overflow-auto p-3">
      <div className="space-y-3">
        <RoleSection title="Timer" testId="vox-zone-timer">
          <RoomTimerPanel controlState={controlState} />
        </RoleSection>

        <RoleSection title="Facilitator Zone" testId="vox-zone-facilitator">
          {facilitatorTiles.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {facilitatorTiles.map((tile) => (
                <VideoTile
                  key={tile.participant.id}
                  participant={tile.participant}
                  muted={false}
                  title={tile.participant.displayName}
                  subtitle={tile.role.roleLabel ?? "Facilitator"}
                />
              ))}
            </div>
          ) : (
            <NoVideoPlaceholder message="Facilitator is not connected." />
          )}
        </RoleSection>

        <RoleSection title="Negotiating Participants" testId="vox-zone-participants">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {participantOne ? (
              <VideoTile
                participant={participantOne.participant}
                muted={false}
                title={participantOne.participant.displayName}
                subtitle={`Participant 1${participantOne.role.caseRoleName ? ` · ${participantOne.role.caseRoleName}` : ""}`}
              />
            ) : (
              <NoVideoPlaceholder message="Participant 1 is not connected." />
            )}
            {participantTwo ? (
              <VideoTile
                participant={participantTwo.participant}
                muted={false}
                title={participantTwo.participant.displayName}
                subtitle={`Participant 2${participantTwo.role.caseRoleName ? ` · ${participantTwo.role.caseRoleName}` : ""}`}
              />
            ) : (
              <NoVideoPlaceholder message="Participant 2 is not connected." />
            )}
          </div>
          {extraParticipants.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {extraParticipants.map((tile) => (
                <VideoTile
                  key={tile.participant.id}
                  participant={tile.participant}
                  muted={false}
                  title={tile.participant.displayName}
                  subtitle={`Additional participant${tile.role.caseRoleName ? ` · ${tile.role.caseRoleName}` : ""}`}
                />
              ))}
            </div>
          ) : null}
        </RoleSection>

        <RoleSection title="Observer Zone" testId="vox-zone-observers">
          {observerTiles.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {observerTiles.map((tile) => (
                <VideoTile
                  key={tile.participant.id}
                  participant={tile.participant}
                  muted={false}
                  title={tile.participant.displayName}
                  subtitle="Observer"
                />
              ))}
            </div>
          ) : (
            <NoVideoPlaceholder message="No observers connected." />
          )}
        </RoleSection>

        {unknownTiles.length > 0 ? (
          <RoleSection title="Unknown Participants" testId="vox-zone-unknown">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {unknownTiles.map((tile) => (
                <VideoTile
                  key={tile.participant.id}
                  participant={tile.participant}
                  muted={false}
                  title={tile.participant.displayName}
                  subtitle="Unknown role"
                  diagnostic={tile.role.diagnosticLabel ?? undefined}
                />
              ))}
            </div>
          </RoleSection>
        ) : null}

        <RoleSection title="You" testId="vox-zone-local">
          {localParticipant ? (
            <VideoTile
              participant={localParticipant}
              muted
              title={`${localParticipant.displayName} (you)`}
              subtitle={localSubtitle}
              micLevel={micLevel}
              isSpeaking={isSpeaking}
            />
          ) : (
            <NoVideoPlaceholder message={isCameraOn ? "Loading your camera..." : "Your camera is off."} />
          )}
        </RoleSection>
      </div>
    </section>
  );
}
