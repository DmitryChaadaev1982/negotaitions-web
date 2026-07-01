"use client";

import { ParticipantType } from "@/app/generated/prisma/enums";
import { RoomTimerPanel } from "@/components/room-timer-panel";
import type { ControlState } from "@/lib/negotiation-control";
import type { SessionRosterEntry } from "@/lib/room-sidebar-types";
import {
  resolveRemoteMicStateByPolicy,
  resolveConnectionState,
  resolveRosterVisualRoles,
  shouldShowDiagnosticsSection,
  type RosterConnectionState,
  type TileMicState,
} from "@/lib/voximplant/room-layout-model";
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
  micState,
  micStateHint,
  micLevel,
  isSpeaking,
  diagnostic,
}: {
  participant: VoxTileParticipant;
  muted: boolean;
  title: string;
  subtitle?: string;
  micState: TileMicState;
  micStateHint?: string;
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
          : micState === "system_muted"
            ? "border-slate-600"
            : micState === "on"
              ? "border-emerald-600/80"
              : "border-rose-700/70"
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
          <span
            className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${
              micState === "on"
                ? "bg-emerald-500/20 text-emerald-200"
                : micState === "system_muted"
                  ? "bg-slate-500/20 text-slate-200"
                  : "bg-rose-500/20 text-rose-200"
            }`}
            title={micStateHint}
            aria-label={micStateHint}
          >
            {micState === "on"
              ? "Микрофон включён"
              : micState === "system_muted"
                ? "Микрофон заблокирован правилами сессии"
                : "Микрофон выключен"}
          </span>
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

type ResolvedRosterTile = {
  rosterEntry: SessionRosterEntry;
  participant: VoxTileParticipant;
  matchedRemoteId: string | null;
  zone: "facilitator" | "participant_a" | "participant_b" | "observer" | "unknown";
  roleLabel: string;
  diagnosticLabel: string | null;
  connectionState: RosterConnectionState;
  isLocal: boolean;
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
  currentParticipantId,
  controlState,
  localParticipantType,
  localCaseRoleName,
  isCameraOn,
  isMicMuted,
  localMicSystemMuted,
  micLevel,
  localRoleLabel,
  showDiagnostics,
}: {
  localParticipant: VoxTileParticipant | null;
  remoteParticipants: VoxTileParticipant[];
  roster: SessionRosterEntry[];
  currentParticipantId: string;
  controlState: ControlState;
  localParticipantType: ParticipantType;
  localCaseRoleName: string | null;
  isCameraOn?: boolean;
  isMicMuted?: boolean;
  localMicSystemMuted?: boolean;
  micLevel?: number;
  /**
   * Translated participant type label for the local user (e.g. "Участник", "Фасилитатор").
   * Resolved server-side via the sidebar API — same source as the LiveKit room.
   */
  localRoleLabel?: string;
  showDiagnostics?: boolean;
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

  const remoteByVoxUsername = useMemo(() => {
    const map = new Map<string, VoxTileParticipant>();
    for (const participant of remoteParticipants) {
      const normalized = normalizeEndpointUsername(participant.endpointUsername);
      if (!normalized) {
        continue;
      }
      // Last write wins. This helps suppress duplicate same-login endpoints
      // during takeover windows by preferring the latest endpoint entry.
      map.set(normalized, participant);
    }
    return map;
  }, [remoteParticipants]);

  const visualRolesByRosterId = useMemo(
    () => resolveRosterVisualRoles(roster),
    [roster],
  );

  const resolvedRosterTiles = useMemo<ResolvedRosterTile[]>(() => {
    return roster.map((entry) => {
      const isLocal = entry.id === currentParticipantId;
      const remoteKey = normalizeEndpointUsername(entry.voximplantProviderUsername);
      const matchedRemote = remoteKey ? remoteByVoxUsername.get(remoteKey) : null;
      const participant: VoxTileParticipant = isLocal
        ? {
            id: entry.id,
            displayName: entry.displayName,
            endpointUsername: localParticipant?.endpointUsername ?? null,
            stream: localParticipant?.stream ?? null,
          }
        : {
            id: matchedRemote?.id ?? entry.id,
            displayName: matchedRemote?.displayName ?? entry.displayName,
            endpointUsername: matchedRemote?.endpointUsername ?? entry.voximplantProviderUsername,
            stream: matchedRemote?.stream ?? null,
          };

      const visual = visualRolesByRosterId.get(entry.id) ?? {
        zone: "unknown" as const,
        roleLabel: "Unknown role",
        diagnosticLabel: "Unsupported participant type",
      };
      const connectionState = resolveConnectionState({
        hasVideoStream: Boolean(participant.stream),
        isLocal,
        isCameraOn: Boolean(isCameraOn),
        lastSeenAt: entry.lastSeenAt ?? null,
      });
      return {
        rosterEntry: entry,
        participant,
        matchedRemoteId: matchedRemote?.id ?? null,
        zone: visual.zone,
        roleLabel: visual.roleLabel,
        diagnosticLabel: visual.diagnosticLabel,
        connectionState,
        isLocal,
      };
    });
  }, [currentParticipantId, isCameraOn, localParticipant, remoteByVoxUsername, roster, visualRolesByRosterId]);

  const usedRemoteIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tile of resolvedRosterTiles) {
      if (tile.isLocal || !tile.matchedRemoteId) {
        continue;
      }
      ids.add(tile.matchedRemoteId);
    }
    return ids;
  }, [resolvedRosterTiles]);

  const unknownTiles = useMemo<ResolvedVoxTile[]>(() => {
    const leftovers = remoteParticipants.filter((participant) => !usedRemoteIds.has(participant.id));
    return leftovers.map((participant) => {
      const endpointUsername = normalizeEndpointUsername(participant.endpointUsername);
      const rosterEntry = endpointUsername ? rosterByVoxUsername.get(endpointUsername) : null;
      return {
        participant,
        role: {
          participantType: null,
          roleLabel: null,
          caseRoleName: rosterEntry?.caseRoleName ?? null,
          diagnosticLabel: rosterEntry
            ? "Duplicate endpoint suppressed by deterministic mapping"
            : "Unknown participant",
        },
      };
    });
  }, [remoteParticipants, rosterByVoxUsername, usedRemoteIds]);

  const facilitatorTiles = resolvedRosterTiles.filter((tile) => tile.zone === "facilitator");
  const observerTiles = resolvedRosterTiles.filter((tile) => tile.zone === "observer");
  const participantATiles = resolvedRosterTiles.filter((tile) => tile.zone === "participant_a");
  const participantBTiles = resolvedRosterTiles.filter((tile) => tile.zone === "participant_b");
  const unknownRosterTiles = resolvedRosterTiles.filter((tile) => tile.zone === "unknown");
  const diagnosticsVisible = shouldShowDiagnosticsSection({
    unknownRosterCount: unknownRosterTiles.length,
    unknownEndpointCount: unknownTiles.length,
    debugEnabled: Boolean(showDiagnostics),
  });

  const localSubtitle = `${localRoleLabel ?? roleLabelFromParticipantType(localParticipantType)}${
    localCaseRoleName ? ` · ${localCaseRoleName}` : ""
  }${isMicMuted ? " · Muted" : ""}${!isCameraOn ? " · Camera off" : ""}`;

  const toStateLabel = (state: RosterConnectionState): string => {
    if (state === "video_on") return "Видео включено";
    if (state === "camera_off") return "Камера выключена";
    if (state === "connecting") return "Подключение видео";
    return "Не в сети";
  };

  const renderRosterTile = (
    tile: ResolvedRosterTile,
    options?: { observerCompact?: boolean },
  ) => {
    const tileMicState: TileMicState = tile.isLocal
      ? localMicSystemMuted
        ? "system_muted"
        : isMicMuted
          ? "off"
          : "on"
      : resolveRemoteMicStateByPolicy({
          negotiationState: controlState.negotiationState,
          participantType: tile.rosterEntry.participantType,
        });
    const tileMicStateHint = tile.isLocal
      ? tileMicState === "system_muted"
        ? "Микрофон заблокирован правилами сессии"
        : tileMicState === "on"
          ? "Микрофон включён"
          : "Микрофон выключен"
      : tileMicState === "system_muted"
        ? "Микрофон заблокирован правилами сессии"
        : "Состояние микрофона рассчитано по правилам сессии";
    const subtitle = tile.isLocal
      ? `${localSubtitle} · ${toStateLabel(tile.connectionState)}`
      : `${tile.roleLabel}${tile.rosterEntry.caseRoleName ? ` · ${tile.rosterEntry.caseRoleName}` : ""} · ${toStateLabel(tile.connectionState)}`;
    return (
      <div key={tile.rosterEntry.id} className={options?.observerCompact ? "w-[220px] max-w-full shrink-0" : ""}>
        <VideoTile
          participant={tile.participant}
          muted={tile.isLocal}
          title={tile.isLocal ? `${tile.rosterEntry.displayName} (you)` : tile.rosterEntry.displayName}
          subtitle={subtitle}
          micState={tileMicState}
          micStateHint={tileMicStateHint}
          diagnostic={tile.diagnosticLabel ?? undefined}
          micLevel={tile.isLocal ? micLevel : undefined}
          isSpeaking={tile.isLocal ? isSpeaking : false}
        />
      </div>
    );
  };

  return (
    <section className="min-h-0 flex-1 overflow-auto p-3" data-testid="vox-layout-root">
      <div className="space-y-3">
        <RoleSection title="Observers" testId="vox-zone-observers">
          {observerTiles.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2 pb-1" data-testid="vox-observer-row">
              {observerTiles.map((tile) => renderRosterTile(tile, { observerCompact: true }))}
            </div>
          ) : (
            <div
              className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-3 py-1 text-xs text-slate-300"
              data-testid="vox-observers-empty-state"
            >
              Наблюдатели пока не подключены
            </div>
          )}
        </RoleSection>

        <div className="hidden gap-3 lg:grid lg:grid-cols-[38%_24%_38%]" data-testid="vox-zone-main-desktop">
          <RoleSection title="Participant A" testId="vox-zone-participant-a">
            {participantATiles[0] ? renderRosterTile(participantATiles[0]) : <NoVideoPlaceholder message="Participant A slot is empty." />}
          </RoleSection>

          <div className="space-y-3" data-testid="vox-zone-center">
            <RoleSection title="Timer" testId="vox-zone-timer">
              <RoomTimerPanel controlState={controlState} />
            </RoleSection>
            <RoleSection title="Facilitator" testId="vox-zone-facilitator">
              {facilitatorTiles.length > 0
                ? facilitatorTiles.map((tile) => renderRosterTile(tile))
                : <NoVideoPlaceholder message="Facilitator slot is empty." />}
            </RoleSection>
          </div>

          <RoleSection title="Participant B" testId="vox-zone-participant-b">
            {participantBTiles[0] ? renderRosterTile(participantBTiles[0]) : <NoVideoPlaceholder message="Participant B slot is empty." />}
          </RoleSection>
        </div>

        <div className="space-y-3 lg:hidden" data-testid="vox-zone-main-mobile">
          <RoleSection title="Timer" testId="vox-zone-timer-mobile">
            <RoomTimerPanel controlState={controlState} />
          </RoleSection>
          <RoleSection title="Participants" testId="vox-zone-participants-mobile">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {participantATiles[0] ? renderRosterTile(participantATiles[0]) : <NoVideoPlaceholder message="Participant A slot is empty." />}
              {participantBTiles[0] ? renderRosterTile(participantBTiles[0]) : <NoVideoPlaceholder message="Participant B slot is empty." />}
            </div>
          </RoleSection>
          <RoleSection title="Facilitator" testId="vox-zone-facilitator-mobile">
            {facilitatorTiles.length > 0
              ? facilitatorTiles.map((tile) => renderRosterTile(tile))
              : <NoVideoPlaceholder message="Facilitator slot is empty." />}
          </RoleSection>
        </div>

        {diagnosticsVisible ? (
          <RoleSection title="Diagnostics / Unknown Endpoints" testId="vox-zone-unknown">
            {unknownRosterTiles.length > 0 || unknownTiles.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {unknownRosterTiles.map((tile) => renderRosterTile(tile))}
                {unknownTiles.map((tile) => (
                  <VideoTile
                    key={tile.participant.id}
                    participant={tile.participant}
                    muted={false}
                    title={tile.participant.displayName}
                    subtitle="Unknown endpoint"
                    micState="off"
                    micStateHint="Состояние микрофона неизвестно"
                    diagnostic={tile.role.diagnosticLabel ?? undefined}
                  />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400" data-testid="vox-diagnostics-empty">
                Unknown endpoints are not detected.
              </p>
            )}
          </RoleSection>
        ) : null}
      </div>
    </section>
  );
}
