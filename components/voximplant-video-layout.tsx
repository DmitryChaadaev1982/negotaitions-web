"use client";

import { ParticipantType } from "@/app/generated/prisma/enums";
import { VoximplantRemoteSpeakingActivityTracker } from "@/components/voximplant-remote-speaking-activity-tracker";
import { RoomTimerPanel } from "@/components/room-timer-panel";
import { VoximplantParticipantTile } from "@/components/voximplant-participant-tile";
import { useI18n } from "@/lib/i18n/useI18n";
import type { ControlState } from "@/lib/negotiation-control";
import type { SessionRosterEntry } from "@/lib/room-sidebar-types";
import { REMOTE_SPEAKING_LEVEL_THRESHOLD } from "@/lib/telemetry/speaking-activity-config";
import { useRemoteSpeaking } from "@/lib/voximplant/remote-speaking";
import {
  resolveRosterVisualRoles,
} from "@/lib/voximplant/room-layout-model";
import {
  normalizeParticipantPresenceMedia,
  type ParticipantPresenceMediaModel,
} from "@/lib/voximplant/participant-presence-media-model";
import type { RoomAuthToken } from "@/lib/room-auth";
import type { ReactNode } from "react";
import { useMemo } from "react";

type VoxTileParticipant = {
  id: string;
  displayName: string;
  endpointUsername?: string | null;
  stream: MediaStream | null;
  audioStream?: MediaStream | null;
};

function NoVideoPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-2 text-center text-sm text-slate-400">
      {message}
    </div>
  );
}

type ResolvedRosterTile = {
  rosterEntry: SessionRosterEntry;
  participant: VoxTileParticipant;
  matchedRemoteId: string | null;
  zone: "facilitator" | "participant_a" | "participant_b" | "observer" | "unknown";
  mediaModel: ParticipantPresenceMediaModel;
  isLocal: boolean;
};

function normalizeEndpointUsername(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized.includes("@") ? normalized.split("@")[0] ?? null : normalized;
}

function RoleSection({
  title,
  testId,
  className,
  children,
}: {
  title: string;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`space-y-2 ${className ?? ""}`} data-testid={testId}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {children}
    </section>
  );
}

export function buildRemoteSpeakingInput(remoteParticipants: VoxTileParticipant[]) {
  return remoteParticipants.map((participant) => ({
    id: participant.id,
    stream: participant.audioStream ?? participant.stream,
  }));
}

export default function VoximplantVideoLayout({
  localParticipant,
  remoteParticipants,
  roster,
  currentParticipantId,
  controlState,
  isCameraOn,
  isMicMuted,
  localMicSystemMuted,
  micLevel,
  sessionId,
  roomAuth,
  connectionId,
  remoteTelemetryDebugEnabled,
  remoteTelemetryCaptureEnabled,
  canReportRemoteTelemetry,
  joined,
  staleConnection,
  recordingStatus,
  audioProcessingEnabled,
}: {
  localParticipant: VoxTileParticipant | null;
  remoteParticipants: VoxTileParticipant[];
  roster: SessionRosterEntry[];
  currentParticipantId: string;
  controlState: ControlState;
  isCameraOn?: boolean;
  isMicMuted?: boolean;
  localMicSystemMuted?: boolean;
  micLevel?: number;
  sessionId: string;
  roomAuth: RoomAuthToken;
  connectionId?: string;
  remoteTelemetryDebugEnabled: boolean;
  remoteTelemetryCaptureEnabled: boolean;
  canReportRemoteTelemetry: boolean;
  joined: boolean;
  staleConnection: boolean;
  recordingStatus?: string | null;
  audioProcessingEnabled?: boolean;
}) {
  const { t } = useI18n();
  const isSpeaking =
    !isMicMuted && micLevel !== undefined && micLevel > REMOTE_SPEAKING_LEVEL_THRESHOLD;

  // Bug 1 fix: derive real speaking state for remote participants from their
  // audio streams. Memoized so meters are not rebuilt on local mic-level ticks.
  const remoteSpeakingInput = useMemo(
    () => buildRemoteSpeakingInput(remoteParticipants),
    [remoteParticipants],
  );
  const remoteSpeakingById = useRemoteSpeaking(remoteSpeakingInput);

  const remoteByVoxUsername = useMemo(() => {
    const map = new Map<string, VoxTileParticipant>();
    let collapsedDuplicates = 0;
    for (const participant of remoteParticipants) {
      const normalized = normalizeEndpointUsername(participant.endpointUsername);
      if (!normalized) {
        continue;
      }
      // Bug 2 mitigation: quick leave/re-enter can briefly surface two remote
      // endpoints for the same login. Render only one tile per stable identity
      // (normalized Vox username), preferring a connected (streamed) endpoint
      // and otherwise the most recent entry. This hides the stale endpoint
      // instead of rendering a duplicate tile.
      const existing = map.get(normalized);
      if (!existing) {
        map.set(normalized, participant);
        continue;
      }
      collapsedDuplicates += 1;
      const existingHasStream = Boolean(existing.stream);
      const candidateHasStream = Boolean(participant.stream);
      if (candidateHasStream || !existingHasStream) {
        map.set(normalized, participant);
      }
    }
    if (collapsedDuplicates > 0 && process.env.NODE_ENV !== "production") {
      console.debug(
        `[vox-layout] collapsed ${collapsedDuplicates} duplicate remote endpoint(s) by stable identity`,
      );
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
            audioStream: localParticipant?.audioStream ?? null,
          }
        : {
            id: matchedRemote?.id ?? entry.id,
            displayName: matchedRemote?.displayName ?? entry.displayName,
            endpointUsername: matchedRemote?.endpointUsername ?? entry.voximplantProviderUsername,
            stream: matchedRemote?.stream ?? null,
            audioStream: matchedRemote?.audioStream ?? null,
          };

      const visual = visualRolesByRosterId.get(entry.id) ?? {
        zone: "unknown" as const,
      };
      const roleLabel =
        visual.zone === "facilitator"
          ? t("room.facilitator")
          : visual.zone === "participant_a"
            ? t("room.participantA")
            : visual.zone === "participant_b"
              ? t("room.participantB")
              : visual.zone === "observer"
                ? t("room.observer")
                : t("room.unknownRole");
      const isLogicallyAbsent = entry.isLogicallyPresent === false;
      const mediaModel = normalizeParticipantPresenceMedia({
        displayName: entry.displayName,
        displayRole: roleLabel,
        // Logical room presence (SessionRoomConnection) is authoritative for who
        // is currently in the room; provider endpoint media remains authoritative
        // for actual A/V streams of those present users.
        connectedSignal: isLocal ? joined : Boolean(matchedRemote) && !isLogicallyAbsent,
        allowConnectedWithoutMediaTile: true,
        lastSeenAt: entry.lastSeenAt ?? null,
        videoStream: participant.stream,
        audioStream: isLocal ? participant.audioStream : (participant.audioStream ?? participant.stream),
        micSignal: isLocal
          ? localMicSystemMuted
            ? "off"
            : isMicMuted
              ? "off"
              : "on"
          : entry.micEnabled === null || entry.micEnabled === undefined
            ? undefined
            : entry.micEnabled
              ? "on"
              : "off",
        cameraSignal: isLocal
          ? (isCameraOn ? "on" : "off")
          : entry.cameraEnabled === null || entry.cameraEnabled === undefined
            ? undefined
            : entry.cameraEnabled
              ? "on"
              : "off",
      });
      return {
        rosterEntry: entry,
        participant,
        matchedRemoteId: matchedRemote?.id ?? null,
        zone: visual.zone,
        mediaModel,
        isLocal,
      };
    });
  }, [
    currentParticipantId,
    isCameraOn,
    isMicMuted,
    joined,
    localMicSystemMuted,
    localParticipant,
    remoteByVoxUsername,
    roster,
    t,
    visualRolesByRosterId,
  ]);

  const activeTiles = resolvedRosterTiles.filter((tile) => tile.mediaModel.shouldRenderActiveTile);
  const facilitatorTiles = activeTiles.filter((tile) => tile.zone === "facilitator");
  const observerTiles = activeTiles.filter((tile) => tile.zone === "observer");
  const participantATiles = activeTiles.filter((tile) => tile.zone === "participant_a");
  const participantBTiles = activeTiles.filter((tile) => tile.zone === "participant_b");
  const remoteTelemetryTargets = useMemo(
    () =>
      resolvedRosterTiles
        .filter((tile) => !tile.isLocal)
        .filter((tile) => tile.rosterEntry.participantType === ParticipantType.PARTICIPANT)
        .filter((tile) => Boolean(tile.matchedRemoteId))
        .map((tile) => ({
          sessionParticipantId: tile.rosterEntry.id,
          participantIdentity: tile.rosterEntry.displayName ?? null,
          isSpeaking: remoteSpeakingById[tile.participant.id] ?? false,
        })),
    [remoteSpeakingById, resolvedRosterTiles],
  );

  const renderRosterTile = (
    tile: ResolvedRosterTile,
    options?: { observerCompact?: boolean },
  ) => {
    const subtitle =
      tile.zone === "participant_a" || tile.zone === "participant_b"
        ? (tile.rosterEntry.caseRoleName ?? undefined)
        : tile.zone === "observer"
          ? (tile.rosterEntry.caseRoleName ?? undefined)
          : undefined;
    const micLabel =
      tile.mediaModel.connectionStatus !== "connected"
        ? t("room.notConnected")
        : tile.mediaModel.micStatus === "on"
          ? t("room.mediaMicOn")
          : t("room.mediaMicOff");
    const cameraLabel =
      tile.mediaModel.connectionStatus !== "connected"
        ? t("room.notConnected")
        : tile.mediaModel.cameraStatus === "on"
          ? t("room.mediaCameraOn")
          : t("room.mediaCameraOff");
    return (
      <div key={tile.rosterEntry.id} className={options?.observerCompact ? "w-[220px] min-w-0 max-w-full shrink-0" : "min-w-0"}>
        <VoximplantParticipantTile
          stream={tile.participant.stream}
          muted={tile.isLocal}
          title={tile.isLocal ? `${tile.rosterEntry.displayName} (${t("common.you")})` : tile.rosterEntry.displayName}
          subtitle={subtitle}
          connectionStatus={tile.mediaModel.connectionStatus}
          micStatus={tile.mediaModel.micStatus}
          cameraStatus={tile.mediaModel.cameraStatus}
          micLabel={micLabel}
          cameraLabel={cameraLabel}
          micLevel={tile.isLocal ? micLevel : undefined}
          isSpeaking={
            tile.isLocal
              ? isSpeaking
              : // Remote tile: highlight when the matched remote endpoint is
                // producing audio. Muted/disconnected remotes report ~0 level.
                (remoteSpeakingById[tile.participant.id] ?? false)
          }
        />
      </div>
    );
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden p-2" data-testid="vox-layout-root">
      <VoximplantRemoteSpeakingActivityTracker
        sessionId={sessionId}
        roomAuth={roomAuth}
        connectionId={connectionId}
        enabled={joined && !staleConnection && remoteTelemetryCaptureEnabled}
        debugEnabled={remoteTelemetryDebugEnabled}
        canReportRemoteTelemetry={canReportRemoteTelemetry}
        recordingStatus={recordingStatus}
        audioProcessingEnabled={audioProcessingEnabled}
        targets={remoteTelemetryTargets}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <RoleSection title={t("room.observersSection")} testId="vox-zone-observers">
          {observerTiles.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2 pb-1" data-testid="vox-observer-row">
              {observerTiles.map((tile) => renderRosterTile(tile, { observerCompact: true }))}
            </div>
          ) : (
            <div
              className="rounded-lg border border-dashed border-slate-700 bg-slate-900/40 px-3 py-1 text-xs text-slate-300"
              data-testid="vox-observers-empty-state"
            >
              {t("room.observersNotConnected")}
            </div>
          )}
        </RoleSection>

        <div
          className="hidden min-h-0 flex-1 gap-2 lg:grid lg:grid-cols-[minmax(0,38fr)_minmax(0,24fr)_minmax(0,38fr)]"
          data-testid="vox-zone-main-desktop"
        >
          <RoleSection title={t("room.participantA")} testId="vox-zone-participant-a" className="min-h-0 min-w-0">
            {participantATiles[0] ? renderRosterTile(participantATiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantAEmpty")} />}
          </RoleSection>

          <div className="flex min-h-0 min-w-0 flex-col gap-2" data-testid="vox-zone-center">
            <RoleSection title={t("room.timer")} testId="vox-zone-timer" className="shrink-0">
              <RoomTimerPanel controlState={controlState} />
            </RoleSection>
            <RoleSection title={t("room.facilitator")} testId="vox-zone-facilitator" className="min-h-0 min-w-0 flex-1">
              {facilitatorTiles.length > 0
                ? facilitatorTiles.map((tile) => renderRosterTile(tile))
                : <NoVideoPlaceholder message={t("room.slotFacilitatorEmpty")} />}
            </RoleSection>
          </div>

          <RoleSection title={t("room.participantB")} testId="vox-zone-participant-b" className="min-h-0 min-w-0">
            {participantBTiles[0] ? renderRosterTile(participantBTiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantBEmpty")} />}
          </RoleSection>
        </div>

        <div className="space-y-2 overflow-auto lg:hidden" data-testid="vox-zone-main-mobile">
          <RoleSection title={t("room.timer")} testId="vox-zone-timer-mobile">
            <RoomTimerPanel controlState={controlState} />
          </RoleSection>
          <RoleSection title={t("room.participants")} testId="vox-zone-participants-mobile">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {participantATiles[0] ? renderRosterTile(participantATiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantAEmpty")} />}
              {participantBTiles[0] ? renderRosterTile(participantBTiles[0]) : <NoVideoPlaceholder message={t("room.slotParticipantBEmpty")} />}
            </div>
          </RoleSection>
          <RoleSection title={t("room.facilitator")} testId="vox-zone-facilitator-mobile">
            {facilitatorTiles.length > 0
              ? facilitatorTiles.map((tile) => renderRosterTile(tile))
              : <NoVideoPlaceholder message={t("room.slotFacilitatorEmpty")} />}
          </RoleSection>
        </div>

      </div>
    </section>
  );
}
